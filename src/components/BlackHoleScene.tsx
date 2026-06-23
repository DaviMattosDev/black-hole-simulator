import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { clamp, easeInCubic, lerp, smoothstep } from '../lib/math';
import { kerrIscoInM, kerrHorizonRadiusInM } from '../lib/kerr';
import type { BlackHoleParams } from '../lib/physics';

type BlackHoleSceneProps = {
  params: BlackHoleParams;
  entering: boolean;
  horizonFocus: boolean;
  spectatorMode: boolean;
  sequenceStartedAt: number;
  reducedMotion: boolean;
  onDoubleTapHorizon: () => void;
};

type ParticleOrbitData = {
  radius: Float32Array;
  angle: Float32Array;
  height: Float32Array;
  speed: Float32Array;
  eccentricity: Float32Array;
  phase: Float32Array;
};

type SceneRefs = {
  horizon: THREE.Mesh;
  rim: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  lens: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  iscoRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  photonRing: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  disk: THREE.Group;
  diskBands: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[];
  diskParticles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  gravityGrid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lightGeodesics: THREE.Group;
  stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  warpLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
};

const MAX_PARTICLES = 5000;
const GEODESIC_SEGMENTS = 116;
const ORIGIN = new THREE.Vector3(0, 0, 0);

function visualRadius(massSolar: number): number {
  const normalized = Math.log10(Math.max(1, massSolar)) / 10;
  return 0.72 + normalized * 0.78;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

// Shader de distorção pós-processada (lente gravitacional aplicada na imagem final)
const gravitationalDistortionShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlackHoleScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uRadius: { value: 0.1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uBlackHoleScreenPos;
    uniform float uStrength;
    uniform float uRadius;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 delta = uv - uBlackHoleScreenPos;
      float dist = length(delta);
      
      // Só distorce dentro do raio de influência
      if (dist < uRadius && uStrength > 0.01) {
        // Curvatura estilo lente gravitacional (mais forte perto do centro)
        float bend = uStrength * (1.0 - smoothstep(0.0, uRadius, dist));
        vec2 dir = normalize(delta + 0.0001);
        // Deslocamento radial (como na imagem do Interstellar)
        uv -= dir * bend * 0.08;
      }
      
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

export function BlackHoleScene({
  params, entering, horizonFocus, spectatorMode, sequenceStartedAt,
  reducedMotion, onDoubleTapHorizon,
}: BlackHoleSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const paramsRef = useLatest(params);
  const enteringRef = useLatest(entering);
  const horizonFocusRef = useLatest(horizonFocus);
  const spectatorModeRef = useLatest(spectatorMode);
  const sequenceStartedAtRef = useLatest(sequenceStartedAt);
  const reducedMotionRef = useLatest(reducedMotion);
  const callbackRef = useLatest(onDoubleTapHorizon);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !reducedMotionRef.current,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      mount.innerHTML = '<p style="color:#fff;padding:2rem">WebGL não suportado.</p>';
      return undefined;
    }

    renderer.setClearColor(0x000005, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(54, 1, 0.04, 400);
    camera.position.set(0, 2.15, 8.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.74;
    controls.minDistance = 2.05;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.24;

    // Iluminação mais cinematográfica
    scene.add(new THREE.AmbientLight(0xffc38a, 0.15));
    const keyLight = new THREE.PointLight(0xff9a2a, 28, 40);
    keyLight.position.set(4.8, 2.7, 4.2);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0xffe0ad, 12, 35);
    rimLight.position.set(-4.2, -0.8, -2.2);
    scene.add(rimLight);
    const fillLight = new THREE.PointLight(0x4488ff, 3, 30);
    fillLight.position.set(-3, 4, -5);
    scene.add(fillLight);

    const refs = buildBlackHoleObjects();
    scene.add(
      refs.skyDome,
      refs.stars, refs.gravityGrid, refs.lightGeodesics, refs.warpLines,
      refs.lens, refs.photonRing, refs.iscoRing, refs.disk, refs.rim, refs.horizon,
    );

    // Post-processing: Bloom + Distorção gravitacional
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      1.4,   // strength (intensidade do glow)
      0.75,  // radius
      0.35,  // threshold (o que fica brilhante)
    );
    composer.addPass(bloomPass);

    const distortionPass = new ShaderPass(gravitationalDistortionShader);
    distortionPass.uniforms.uStrength.value = 0.0;
    distortionPass.uniforms.uRadius.value = 0.35;
    composer.addPass(distortionPass);

    // Interação
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const horizonScreenPos = new THREE.Vector3();
    let pointerDownAt = 0;

    const castToHorizon = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(refs.horizon, false)[0];
    };

    const onPointerDown = () => { pointerDownAt = performance.now(); };
    const onDoubleClick = (e: MouseEvent) => {
      if (castToHorizon(e.clientX, e.clientY)) callbackRef.current();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (performance.now() - pointerDownAt > 240) return;
      if (e.pointerType === 'mouse') return;
      if (castToHorizon(e.clientX, e.clientY)) callbackRef.current();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      composer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const clock = new THREE.Clock();
    const targetVector = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);
    let animationFrame = 0;
    const motionScale = reducedMotionRef.current ? 0.25 : 1;

    const cameraDir = new THREE.Vector3();
    const particlePos = new THREE.Vector3();
    const particleVel = new THREE.Vector3();

    const animate = () => {
      const delta = Math.min(0.05, clock.getDelta());
      const elapsed = clock.elapsedTime;
      const current = paramsRef.current;
      const radius = visualRadius(current.massSolar);
      const spin = current.spin;

      const rHorizonVis = (kerrHorizonRadiusInM(spin) / 2);
      const rIscoVis = (kerrIscoInM(spin) / 2);
      const rPhotonVis = (2 * (1 + Math.cos((2 / 3) * Math.acos(-spin))) / 2);

      const lensStrength = current.lensing / 100;
      const diskSpeed = current.diskSpeed / 100;
      const focusBoost = horizonFocusRef.current || spectatorModeRef.current ? 0.65 : 0;
      const enteringNow = enteringRef.current;
      const spectatorNow = spectatorModeRef.current;

      const fallElapsed = enteringNow && sequenceStartedAtRef.current > 0
        ? Math.max(0, (performance.now() - sequenceStartedAtRef.current) / 1000) * motionScale
        : 0;
      const pull = enteringNow ? clamp((fallElapsed - 1.7) / 12, 0, 1) : 0;
      const warped = enteringNow ? clamp((fallElapsed - 2.6) / 8.5, 0, 1) : 0;
      const singularitySpin = enteringNow ? easeInCubic(clamp((fallElapsed - 9.4) / 5.6, 0, 1)) : 0;
      const extremeSpin = enteringNow ? easeInCubic(clamp((fallElapsed - 13.4) / 2.9, 0, 1)) : 0;

      refs.horizon.scale.setScalar(radius * rHorizonVis);
      refs.rim.scale.setScalar(radius * rHorizonVis * (1.035 + Math.sin(elapsed * 2) * 0.008));
      refs.lens.scale.setScalar(radius * (2.95 + lensStrength * 1.75 + focusBoost + warped * 0.65));
      refs.disk.scale.setScalar(radius * (0.96 + lensStrength * 0.05));

      refs.iscoRing.scale.setScalar(radius * rIscoVis);
      refs.iscoRing.visible = !enteringNow;
      refs.photonRing.scale.setScalar(radius * rPhotonVis * 0.95);
      refs.photonRing.visible = !enteringNow;

      // 🆕 Atualiza o photon ring
      if (refs.photonRing.material.uniforms) {
        refs.photonRing.material.uniforms.uTime.value = elapsed;
        refs.photonRing.material.uniforms.uIntensity.value = 0.8 + lensStrength * 0.5 + pull * 0.5;
      }

      // 🆕 Atualiza o sky dome (fundo com nebulosas)
      refs.skyDome.material.uniforms.uTime.value = elapsed * 0.05;

      const drawCount = Math.min(MAX_PARTICLES, Math.round(current.particles));
      refs.diskParticles.geometry.setDrawRange(0, drawCount);

      refs.disk.rotation.x = Math.PI * 0.12;
      refs.disk.rotation.y += delta * (0.18 + diskSpeed * 1.65 + pull * 1.4 + singularitySpin * 11 + extremeSpin * 20) * motionScale;
      refs.disk.rotation.z = Math.sin(elapsed * 0.23) * 0.025 + singularitySpin * 0.24;

      refs.diskBands.forEach((band, index) => {
        band.rotation.z += delta * (0.18 + diskSpeed * (0.75 + index * 0.16) + singularitySpin * (3.2 + index * 1.6) + extremeSpin * (9 + index * 3.4)) * motionScale;
        band.material.opacity = bandOpacity(index, lensStrength, pull);
      });

      camera.getWorldDirection(cameraDir);

      updateDiskParticles(
        refs.diskParticles, delta, elapsed, diskSpeed, pull,
        singularitySpin, extremeSpin, current.massSolar, spin,
        drawCount, camera, cameraDir, particlePos, particleVel,
      );
      updateGravityGrid(refs.gravityGrid, elapsed, radius * rHorizonVis, lensStrength, pull, spectatorNow);
      updateLightGeodesics(refs.lightGeodesics, elapsed, radius * rHorizonVis, lensStrength, pull);

      refs.stars.rotation.y += delta * (0.006 + warped * 0.05 + singularitySpin * 0.1) * motionScale;
      refs.stars.rotation.x = Math.sin(elapsed * 0.04) * 0.018;
      refs.warpLines.rotation.y -= delta * (0.02 + pull * 0.25 + singularitySpin * 0.85) * motionScale;

      refs.diskParticles.material.size = 0.027 + lensStrength * 0.018 + pull * 0.018;
      refs.stars.material.size = enteringNow ? 0.038 + warped * 0.09 + singularitySpin * 0.05 : 0.03;
      refs.stars.material.opacity = enteringNow ? 0.78 + warped * 0.18 : 0.9;
      refs.warpLines.material.opacity = enteringNow ? warped * 0.56 : 0;
      refs.lens.material.uniforms.uTime.value = elapsed;
      refs.lens.material.uniforms.uIntensity.value = 0.3 + lensStrength * 1.18 + focusBoost + warped * 0.75;
      refs.rim.material.uniforms.uTime.value = elapsed;
      refs.rim.material.uniforms.uIntensity.value = 0.72 + pull * 0.85;

      controls.autoRotateSpeed = enteringNow ? 0 : 0.12 + diskSpeed * 0.28;
      controls.enabled = !enteringNow;

      if (enteringNow) {
        const shake = Math.sin(elapsed * 23) * 0.02 * pull;
        if (fallElapsed < 1.7) {
          targetVector.set(0, radius * 2.9, radius * 14.2);
          camera.position.lerp(targetVector, 0.08);
          camera.up.lerp(upVector.set(0, 1, 0), 0.12);
        } else {
          const gravity = easeInCubic(pull);
          const spinAngle = elapsed * (0.5 + singularitySpin * 12 + extremeSpin * 22);
          const spinRadius = radius * lerp(0.22, 0.025, singularitySpin);
          const baseX = Math.sin(elapsed * 1.8) * radius * 0.22 * (1 - gravity);
          const x = lerp(baseX, Math.cos(spinAngle) * spinRadius, singularitySpin);
          const swirlY = Math.sin(spinAngle * 1.35) * spinRadius * 0.36;
          const z = lerp(radius * 14.2, radius * (0.68 - singularitySpin * 0.18), gravity);
          const y = lerp(radius * 2.9, radius * 0.02, gravity) + swirlY;
          targetVector.set(x + shake, y + shake * 0.3, z);
          camera.position.lerp(targetVector, 0.055 + gravity * 0.08 + singularitySpin * 0.04 + extremeSpin * 0.05);
          camera.up.lerp(upVector.set(Math.sin(spinAngle * 0.42) * 0.7, 1, Math.cos(spinAngle * 0.42) * 0.7), 0.05 + singularitySpin * 0.08);
        }
        controls.target.lerp(ORIGIN, 0.18);
        camera.lookAt(0, 0, 0);
      } else if (horizonFocusRef.current || spectatorNow) {
        targetVector.set(0, 1.18, radius * (spectatorNow ? 4.2 : 4.45));
        camera.position.lerp(targetVector, 0.025);
        controls.target.lerp(ORIGIN, 0.08);
        camera.up.lerp(upVector.set(0, 1, 0), 0.08);
      } else {
        camera.up.lerp(upVector.set(0, 1, 0), 0.06);
      }

      controls.update();

      // 🆕 Atualiza a posição do buraco negro em coordenadas de tela para distorção
      horizonScreenPos.set(0, 0, 0);
      horizonScreenPos.project(camera);
      distortionPass.uniforms.uBlackHoleScreenPos.value.set(
        (horizonScreenPos.x + 1) / 2,
        (horizonScreenPos.y + 1) / 2,
      );
      distortionPass.uniforms.uStrength.value = 0.4 + lensStrength * 1.2 + pull * 0.8;
      distortionPass.uniforms.uRadius.value = 0.15 + radius * rHorizonVis * 0.12;

      composer.render();
      animationFrame = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      composer.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="scene-mount" ref={mountRef} aria-label="Buraco negro 3D interativo" role="img" />;
}

// ─────────────────────────────────────────────────────────────
// Construtores
// ─────────────────────────────────────────────────────────────
function buildBlackHoleObjects(): SceneRefs {
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 112, 72),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  horizon.name = 'event-horizon';

  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 112, 72),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.8 } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vWorld;
        uniform float uTime; uniform float uIntensity;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 3.1);
          float pulse = 0.8 + sin(uTime * 2.0) * 0.07;
          vec3 color = mix(vec3(1.0, 0.28, 0.02), vec3(1.0, 0.78, 0.34), fresnel);
          gl_FragColor = vec4(color, fresnel * pulse * uIntensity);
        }`,
    }),
  );

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(3, 112, 72),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.75 } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vWorld;
        uniform float uTime; uniform float uIntensity;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float edge = pow(1.0 - abs(dot(vNormal, viewDir)), 3.35);
          float wave = 0.5 + 0.5 * sin((vWorld.x + vWorld.y + vWorld.z) * 4.7 + uTime * 1.35);
          vec3 color = mix(vec3(0.52, 0.14, 0.0), vec3(1.0, 0.62, 0.18), wave);
          gl_FragColor = vec4(color, edge * (0.11 + uIntensity * 0.18));
        }`,
    }),
  );

  const iscoRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.008, 8, 200),
    new THREE.MeshBasicMaterial({
      color: 0x00ffcc, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  iscoRing.rotation.x = Math.PI / 2 + Math.PI * 0.12;

  // 🆕 Photon Ring brilhante (múltiplos anéis concêntricos, como na imagem de referência)
  const photonRing = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.15, 128, 1),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center) * 2.0;
          
          // Múltiplos anéis brilhantes (efeito de "anel de fótons")
          float ring1 = smoothstep(0.02, 0.0, abs(dist - 0.85));
          float ring2 = smoothstep(0.015, 0.0, abs(dist - 0.92));
          float ring3 = smoothstep(0.01, 0.0, abs(dist - 0.98));
          
          float rings = ring1 * 0.7 + ring2 * 1.0 + ring3 * 1.4;
          
          // Pulsar suave
          float pulse = 0.9 + sin(uTime * 1.5) * 0.1;
          
          // Cor dourada quente
          vec3 color = vec3(1.0, 0.85, 0.45);
          float alpha = rings * pulse * uIntensity;
          
          gl_FragColor = vec4(color * alpha, alpha * 0.9);
        }`,
    }),
  );
  photonRing.rotation.x = Math.PI / 2 + Math.PI * 0.12;

  const disk = new THREE.Group();
  disk.rotation.x = Math.PI * 0.12;
  const diskBands = buildDiskBands();
  disk.add(...diskBands);
  const diskParticles = buildDiskParticles();
  disk.add(diskParticles);

  return {
    horizon, rim, lens, iscoRing, photonRing,
    disk, diskBands, diskParticles,
    gravityGrid: buildGravityGrid(),
    lightGeodesics: buildLightGeodesics(),
    stars: buildStars(),
    warpLines: buildWarpLines(),
    skyDome: buildSkyDome(),
  };
}

// 🆕 Sky dome com nebulosas procedurais (fundo mais rico que estrelas simples)
function buildSkyDome() {
  const geometry = new THREE.SphereGeometry(180, 64, 64);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vPosition;
      varying vec3 vNormal;
      void main() {
        vPosition = position;
        vNormal = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPosition;
      varying vec3 vNormal;
      uniform float uTime;
      
      // Hash simples para noise
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      
      // Noise 3D value
      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                      mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                      mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      
      // Fractal Brownian Motion
      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }
      
      void main() {
        vec3 dir = normalize(vNormal);
        
        // Fundo base: preto profundo com leve gradiente
        vec3 bgColor = vec3(0.0, 0.0, 0.02);
        
        // Nebulosas (duas camadas com cores diferentes)
        float n1 = fbm(dir * 2.0 + uTime * 0.1);
        float n2 = fbm(dir * 3.5 - uTime * 0.08);
        
        // Nebulosa laranja/avermelhada (tipo disco de acreção distante)
        vec3 nebula1 = vec3(0.4, 0.15, 0.05) * pow(n1, 3.0) * 0.6;
        
        // Nebulosa azulada (poeira interestelar)
        vec3 nebula2 = vec3(0.05, 0.12, 0.25) * pow(n2, 3.5) * 0.4;
        
        vec3 color = bgColor + nebula1 + nebula2;
        
        // Estrelas pontuais brilhantes
        float starField = hash(dir * 300.0);
        if (starField > 0.997) {
          float brightness = (starField - 0.997) * 333.0;
          color += vec3(1.0, 0.95, 0.85) * brightness * 0.8;
        }
        
        // Estrelas mais fracas
        float starField2 = hash(dir * 150.0);
        if (starField2 > 0.994) {
          float brightness = (starField2 - 0.994) * 166.0;
          color += vec3(0.7, 0.75, 0.9) * brightness * 0.3;
        }
        
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  
  return new THREE.Mesh(geometry, material);
}

function buildDiskBands() {
  const bands: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  const bandData = [
    { radius: 1.34, color: 0xffffff, opacity: 0.65, tube: 0.014 },
    { radius: 1.54, color: 0xffe2a8, opacity: 0.6, tube: 0.018 },
    { radius: 1.9, color: 0xffaa36, opacity: 0.54, tube: 0.03 },
    { radius: 2.34, color: 0xff6b0a, opacity: 0.45, tube: 0.046 },
    { radius: 2.95, color: 0x9f2404, opacity: 0.3, tube: 0.062 },
  ];
  for (const data of bandData) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(data.radius, data.tube, 12, 280),
      new THREE.MeshBasicMaterial({
        color: data.color, transparent: true, opacity: data.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.userData.baseOpacity = data.opacity;
    bands.push(mesh);
  }
  return bands;
}

function buildDiskParticles() {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const orbit: ParticleOrbitData = {
    radius: new Float32Array(MAX_PARTICLES),
    angle: new Float32Array(MAX_PARTICLES),
    height: new Float32Array(MAX_PARTICLES),
    speed: new Float32Array(MAX_PARTICLES),
    eccentricity: new Float32Array(MAX_PARTICLES),
    phase: new Float32Array(MAX_PARTICLES),
  };
  const color = new THREE.Color();
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    const radius = 1.18 + Math.random() ** 0.62 * 2.55;
    const angle = Math.random() * Math.PI * 2;
    const height = (Math.random() - 0.5) * 0.09;
    const heat = 1 - (radius - 1.18) / 2.55;
    orbit.radius[i] = radius;
    orbit.angle[i] = angle;
    orbit.height[i] = height;
    orbit.speed[i] = 0.9 + heat * 3.8 + Math.random() * 0.35;
    orbit.eccentricity[i] = Math.random() * 0.025;
    orbit.phase[i] = Math.random() * Math.PI * 2;

    const spiralAngle = angle + radius * 0.26;
    positions[i * 3] = Math.cos(spiralAngle) * radius;
    positions[i * 3 + 1] = height;
    positions[i * 3 + 2] = Math.sin(spiralAngle) * radius;

    const temp = heat;
    color.setHSL(0.045 + temp * 0.12, 1, 0.39 + temp * 0.44);
    if (temp > 0.82 && Math.random() > 0.36) color.setRGB(1, 0.95, 0.85);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 2800);
  (geometry.userData as { orbit: ParticleOrbitData }).orbit = orbit;
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.034, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.93, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

function buildGravityGrid() {
  const radialLines = 36, ringCount = 20, ringSegments = 112, radialSegments = 14;
  const vertices: number[] = [];
  const baseXZ: number[] = [];
  const minRadius = 1.05, maxRadius = 8.7;
  const pushVertex = (x: number, z: number) => { vertices.push(x, 0, z); baseXZ.push(x, z); };
  for (let rIndex = 0; rIndex < ringCount; rIndex += 1) {
    const radius = minRadius + (maxRadius - minRadius) * (rIndex / (ringCount - 1));
    for (let segment = 0; segment < ringSegments; segment += 1) {
      const a1 = (segment / ringSegments) * Math.PI * 2;
      const a2 = ((segment + 1) / ringSegments) * Math.PI * 2;
      pushVertex(Math.cos(a1) * radius, Math.sin(a1) * radius);
      pushVertex(Math.cos(a2) * radius, Math.sin(a2) * radius);
    }
  }
  for (let line = 0; line < radialLines; line += 1) {
    const angle = (line / radialLines) * Math.PI * 2;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const r1 = minRadius + (maxRadius - minRadius) * (segment / radialSegments);
      const r2 = minRadius + (maxRadius - minRadius) * ((segment + 1) / radialSegments);
      pushVertex(Math.cos(angle) * r1, Math.sin(angle) * r1);
      pushVertex(Math.cos(angle) * r2, Math.sin(angle) * r2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3).setUsage(THREE.DynamicDrawUsage));
  (geometry.userData as { grid: { baseXZ: Float32Array } }).grid = { baseXZ: new Float32Array(baseXZ) };
  const material = new THREE.LineBasicMaterial({
    color: 0xffb45a, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const grid = new THREE.LineSegments(geometry, material);
  grid.position.y = -0.42;
  return grid;
}

function buildLightGeodesics() {
  const group = new THREE.Group();
  const offsets = [-3.35, -2.75, -2.22, -1.74, -1.32, -0.96, 0.96, 1.32, 1.74, 2.22, 2.75, 3.35];
  offsets.forEach((offset, index) => {
    const positions = new Float32Array(GEODESIC_SEGMENTS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    (geometry.userData as { geodesic: { offset: number; height: number; phase: number } }).geodesic = {
      offset, height: (index - offsets.length / 2) * 0.015, phase: index * 0.77,
    };
    const material = new THREE.LineBasicMaterial({
      color: index % 3 === 0 ? 0xffffff : 0xffd28a,
      transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    group.add(new THREE.Line(geometry, material));
  });
  return group;
}

function buildStars() {
  const count = 2800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const radius = 22 + Math.random() * 92;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    color.setHSL(0.08 + Math.random() * 0.06, 0.18, 0.7 + Math.random() * 0.26);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.03, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
  }));
}

function buildWarpLines() {
  const count = 520;
  const positions = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const spread = 7 + Math.random() * 24;
    const y = (Math.random() - 0.5) * 16;
    const z = 5 + Math.random() * 90;
    const length = 2.5 + Math.random() * 7;
    const x = Math.cos(angle) * spread;
    positions[i * 6] = x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x * 0.9; positions[i * 6 + 4] = y * 0.9; positions[i * 6 + 5] = z - length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xffcf8a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

// ─────────────────────────────────────────────────────────────
// Updates
// ─────────────────────────────────────────────────────────────

function updateDiskParticles(
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
  delta: number, elapsed: number, diskSpeed: number, pull: number,
  singularitySpin: number, extremeSpin: number, massSolar: number, spin: number,
  drawCount: number, _camera: THREE.Camera, cameraDir: THREE.Vector3,
  particlePos: THREE.Vector3, particleVel: THREE.Vector3,
) {
  const position = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
  const positions = position.array as Float32Array;
  const colors = particles.geometry.getAttribute('color') as THREE.BufferAttribute;
  const colorsArray = colors.array as Float32Array;
  const orbit = (particles.geometry.userData as { orbit: ParticleOrbitData }).orbit;

  const speedMultiplier = 0.55 + diskSpeed * 5.4 + pull * 4.2 + singularitySpin * 18 + extremeSpin * 34;
  const massFactor = Math.sqrt(Math.max(0.01, massSolar / 4_300_000));

  const tmpColor = new THREE.Color();
  const rotDir = spin >= 0 ? 1 : -1;

  for (let i = 0; i < drawCount; i += 1) {
    const baseRadius = orbit.radius[i];
    const keplerFactor = 1 / Math.pow(baseRadius, 1.5);
    orbit.angle[i] += delta * speedMultiplier * orbit.speed[i] * keplerFactor * massFactor * rotDir;

    const inwardPull = pull * (0.09 + 0.18 * Math.sin(elapsed * 0.9 + orbit.phase[i]))
      + singularitySpin * 0.18 + extremeSpin * 0.28;
    const eccentric = 1 + Math.sin(orbit.angle[i] * 2 + orbit.phase[i]) * orbit.eccentricity[i];
    const radius = Math.max(1.05, (baseRadius - inwardPull) * eccentric);
    const spiralAngle = orbit.angle[i] + radius * 0.26;

    const x = Math.cos(spiralAngle) * radius;
    const y = orbit.height[i] + Math.sin(orbit.angle[i] * 3 + orbit.phase[i]) * (0.018 + singularitySpin * 0.08 + extremeSpin * 0.14);
    const z = Math.sin(spiralAngle) * radius;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const proximity = clamp(1 / radius, 0, 1);
    const heat = 1 - (baseRadius - 1.18) / 2.55;

    particlePos.set(x, y, z);
    const tangentAngle = spiralAngle + Math.PI / 2 * rotDir;
    const vMag = keplerFactor * speedMultiplier * 0.01;
    particleVel.set(Math.cos(tangentAngle) * vMag, 0, Math.sin(tangentAngle) * vMag);

    const dopplerFactor = -particleVel.dot(cameraDir);
    const boost = clamp(1 + dopplerFactor * 2.5, 0.5, 1.8);

    const hue = 0.045 + heat * 0.12 - proximity * 0.04 + (boost - 1) * 0.05;
    const lightness = clamp((0.39 + heat * 0.44 + proximity * 0.1) * boost, 0.1, 0.95);

    tmpColor.setHSL(clamp(hue, 0, 0.15), 1, lightness);
    colorsArray[i * 3] = tmpColor.r;
    colorsArray[i * 3 + 1] = tmpColor.g;
    colorsArray[i * 3 + 2] = tmpColor.b;
  }
  position.needsUpdate = true;
  colors.needsUpdate = true;
}

function updateGravityGrid(
  grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  elapsed: number, horizonRadius: number, lensStrength: number, pull: number, spectatorMode: boolean,
) {
  const position = grid.geometry.getAttribute('position') as THREE.BufferAttribute;
  const positions = position.array as Float32Array;
  const { baseXZ } = (grid.geometry.userData as { grid: { baseXZ: Float32Array } }).grid;
  const depthPower = 0.54 + lensStrength * 2.85 + pull * 2.4;
  const influence = horizonRadius * (1.85 + lensStrength * 1.35 + pull * 0.9);
  const vertexCount = baseXZ.length / 2;
  for (let i = 0; i < vertexCount; i += 1) {
    const x = baseXZ[i * 2];
    const z = baseXZ[i * 2 + 1];
    const distance = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const exclusion = smoothstep(horizonRadius * 0.72, horizonRadius * 1.38, distance);
    const curvature = (-depthPower * Math.exp(-distance / influence)) / Math.sqrt(distance + 0.18);
    const ripple = Math.sin(angle * 8 - elapsed * 0.9) * 0.018 * lensStrength * exclusion;
    positions[i * 3] = x;
    positions[i * 3 + 1] = curvature * exclusion + ripple;
    positions[i * 3 + 2] = z;
  }
  position.needsUpdate = true;
  grid.material.opacity = spectatorMode ? 0.2 + lensStrength * 0.18 : 0.16 + lensStrength * 0.3 + pull * 0.2;
}

function updateLightGeodesics(
  group: THREE.Group, elapsed: number, horizonRadius: number, lensStrength: number, pull: number,
) {
  const strength = 0.22 + lensStrength * 1.2 + pull * 0.8;
  group.children.forEach((child) => {
    const line = child as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    const position = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const data = (line.geometry.userData as { geodesic: { offset: number; height: number; phase: number } }).geodesic;
    const sign = Math.sign(data.offset) || 1;
    for (let i = 0; i < GEODESIC_SEGMENTS; i += 1) {
      const t = i / (GEODESIC_SEGMENTS - 1);
      const centered = t * 2 - 1;
      const baseX = centered * 8.4;
      const baseZ = data.offset;
      const closest = 1 - Math.abs(centered);
      const distance = Math.sqrt(baseX * baseX + baseZ * baseZ);
      const bend = (sign * strength * Math.exp(-Math.abs(baseX) / 2.45)) / (Math.abs(baseZ) * 0.58 + 0.55);
      const swirl = (sign * strength * closest * closest * 0.33) / Math.max(0.8, distance);
      const warpedX = baseX * Math.cos(swirl) - (baseZ - bend) * Math.sin(swirl);
      const warpedZ = baseX * Math.sin(swirl) + (baseZ - bend) * Math.cos(swirl);
      const safeDistance = Math.sqrt(warpedX * warpedX + warpedZ * warpedZ);
      const minDistance = horizonRadius * 1.18;
      const correction = safeDistance < minDistance ? minDistance / Math.max(0.001, safeDistance) : 1;

      positions[i * 3] = warpedX * correction;
      positions[i * 3 + 1] = data.height + Math.sin(t * Math.PI * 2 + elapsed * 0.7 + data.phase) * 0.025 * lensStrength;
      positions[i * 3 + 2] = warpedZ * correction;
    }
    position.needsUpdate = true;
    line.material.opacity = 0.06 + lensStrength * 0.2 + pull * 0.12;
  });
  group.rotation.y = Math.sin(elapsed * 0.1) * 0.06;
}

function bandOpacity(index: number, lensStrength: number, pull: number) {
  const base = [0.58, 0.52, 0.46, 0.38, 0.24][index] ?? 0.3;
  return Math.min(0.78, base + lensStrength * 0.08 + pull * 0.1);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const obj = object as unknown as {
      geometry?: { dispose: () => void };
      material?: THREE.Material | THREE.Material[];
    };
    if (obj.geometry && 'dispose' in obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}