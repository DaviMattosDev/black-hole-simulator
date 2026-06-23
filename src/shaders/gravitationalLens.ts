// Shaders GLSL para lensing gravitacional por ray marching

export const lensVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lensFragmentShader = `
  uniform float uTime;
  uniform float uBlackHoleMass;      // massa em unidades visuais
  uniform float uSpin;               // spin 0..0.998
  uniform vec3 uCameraPos;
  uniform mat4 uCameraMatrixInverse;
  uniform sampler2D uBackgroundTexture;  // starfield
  uniform float uDiskInnerRadius;    // ISCO em unidades visuais
  uniform float uDiskOuterRadius;    // borda externa do disco
  uniform float uHorizonRadius;      // raio do horizonte
  
  varying vec2 vUv;
  
  // Simplex noise para textura do disco
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  // Cor de corpo negro aproximada (temperatura em Kelvin)
  vec3 blackBodyColor(float temperature) {
    float t = temperature / 100.0;
    vec3 color;
    
    if (t <= 66.0) {
      color.r = 1.0;
      color.g = clamp(0.39008157876901960784 * log(t) - 0.63184144378862745098, 0.0, 1.0);
      color.b = t <= 19.0 ? 0.0 : clamp(0.54320678911019607843 * log(t - 10.0) - 1.19625408, 0.0, 1.0);
    } else {
      color.r = clamp(1.29293618606274509804 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
      color.g = clamp(1.12989086059511324702 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
      color.b = 1.0;
    }
    
    return color;
  }
  
  // Amostrar o disco de acreção
  vec4 sampleAccretionDisk(vec3 pos, float radius) {
    if (abs(pos.y) > 0.15) return vec4(0.0);
    if (radius < uDiskInnerRadius || radius > uDiskOuterRadius) return vec4(0.0);
    
    // Coordenadas polares no disco
    float angle = atan(pos.z, pos.x);
    float normalizedRadius = (radius - uDiskInnerRadius) / (uDiskOuterRadius - uDiskInnerRadius);
    
    // Temperatura do disco (modelo simplificado Novikov-Thorne)
    // T ∝ r^(-3/4) × (1 - sqrt(r_isco/r))^(1/4)
    float tempFactor = pow(1.0 / radius, 0.75);
    float iscoFactor = 1.0 - sqrt(uDiskInnerRadius / radius);
    float temperature = 30000.0 * tempFactor * pow(max(0.0, iscoFactor), 0.25);
    
    // Noise para turbulência
    float noise1 = snoise(vec3(pos.xz * 2.0, uTime * 0.1)) * 0.3;
    float noise2 = snoise(vec3(pos.xz * 5.0, uTime * 0.2)) * 0.15;
    float noise3 = snoise(vec3(pos.xz * 10.0, uTime * 0.3)) * 0.05;
    
    float turbulence = 1.0 + noise1 + noise2 + noise3;
    
    // Cor baseada na temperatura
    vec3 color = blackBodyColor(temperature * turbulence);
    
    // Doppler boosting (lado que gira em direção à câmera fica mais brilhante)
    float dopplerAngle = angle + uTime * 0.5;
    float dopplerFactor = 1.0 + 0.3 * sin(dopplerAngle);
    color *= dopplerFactor;
    
    // Opacidade baseada na densidade do disco
    float opacity = smoothstep(uDiskOuterRadius, uDiskInnerRadius, radius);
    opacity *= smoothstep(uDiskInnerRadius * 0.8, uDiskInnerRadius * 1.2, radius);
    opacity *= turbulence * 0.8;
    
    return vec4(color, opacity);
  }
  
  // Amostrar o fundo de estrelas
  vec3 sampleBackground(vec3 direction) {
    // Mapear direção para coordenadas esféricas
    float theta = acos(direction.y);
    float phi = atan(direction.z, direction.x);
    
    vec2 uv = vec2(phi / (2.0 * 3.14159) + 0.5, theta / 3.14159);
    
    // Amostrar textura de fundo
    vec3 bgColor = texture2D(uBackgroundTexture, uv).rgb;
    
    // Adicionar estrelas pontuais
    float starNoise = snoise(direction * 50.0);
    if (starNoise > 0.95) {
      float brightness = (starNoise - 0.95) * 20.0;
      bgColor += vec3(brightness);
    }
    
    return bgColor;
  }
  
  // Ray marching com curvatura gravitacional
  vec3 traceRay(vec3 origin, vec3 direction) {
    vec3 pos = origin;
    vec3 dir = normalize(direction);
    
    const int MAX_STEPS = 128;
    const float STEP_SIZE = 0.15;
    const float MIN_DISTANCE = 0.01;
    
    vec3 accumulatedColor = vec3(0.0);
    float accumulatedAlpha = 0.0;
    
    for (int i = 0; i < MAX_STEPS; i++) {
      float distFromCenter = length(pos);
      
      // Verifica se caiu no horizonte de eventos
      if (distFromCenter < uHorizonRadius) {
        return vec3(0.0); // preto
      }
      
      // Curvatura da luz pela gravidade (aproximação Schwarzschild)
      // A deflexão é proporcional a 1/r² na direção radial
      if (distFromCenter > MIN_DISTANCE) {
        vec3 radialDir = pos / distFromCenter;
        float gravitationalStrength = uBlackHoleMass * 0.5 / (distFromCenter * distFromCenter);
        
        // Curvar o raio de luz
        vec3 bendDirection = radialDir - dir * dot(radialDir, dir);
        dir = normalize(dir + bendDirection * gravitationalStrength * STEP_SIZE);
      }
      
      // Avançar o raio
      pos += dir * STEP_SIZE;
      
      // Verifica se cruzou o disco de acreção (y ≈ 0)
      if (abs(pos.y) < 0.1 && distFromCenter > uHorizonRadius * 1.5) {
        vec4 diskColor = sampleAccretionDisk(pos, distFromCenter);
        
        if (diskColor.a > 0.01) {
          // Alpha blending
          accumulatedColor += diskColor.rgb * diskColor.a * (1.0 - accumulatedAlpha);
          accumulatedAlpha += diskColor.a * (1.0 - accumulatedAlpha);
          
          if (accumulatedAlpha > 0.95) break;
        }
      }
      
      // Se saiu muito longe, amostra o fundo
      if (distFromCenter > 50.0) {
        vec3 bgColor = sampleBackground(dir);
        accumulatedColor += bgColor * (1.0 - accumulatedAlpha);
        break;
      }
    }
    
    return accumulatedColor;
  }
  
  void main() {
    // Converter UV para direção da câmera
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 clipPos = vec4(ndc, 1.0, 1.0);
    vec4 worldPos = uCameraMatrixInverse * clipPos;
    vec3 direction = normalize(worldPos.xyz / worldPos.w - uCameraPos);
    
    // Trace the ray
    vec3 color = traceRay(uCameraPos, direction);
    
    // Tone mapping simples
    color = color / (color + vec3(1.0));
    
    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));
    
    gl_FragColor = vec4(color, 1.0);
  }
`;