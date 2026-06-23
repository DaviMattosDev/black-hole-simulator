import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BlackHoleScene } from './components/BlackHoleScene';
import { Readout } from './components/Readout';
import { SliderControl } from './components/SliderControl';
import {
  calculateBlackHole, formatCompact, formatKm,
  PRESETS, type BlackHoleParams,
} from './lib/physics';

type Locale = 'pt' | 'en';
type Theme = 'dark' | 'light';

const immersionParams: BlackHoleParams = {
  massSolar: 10_000_000_000,
  spin: 0.95,
  observerDistanceRs: 1.1,
  diskSpeed: 100,
  lensing: 100,
  particles: 5000,
};

const HORIZON_DURATION_MS = 26_000;
const FORCE_LENSING_TOGGLE = { high: 100, low: 72 } as const;
const FORCE_FLASH_MS = 1400;
const PSYCHEDELIC_WARNING_MS = 6200;

function readStorage<T>(key: string, fallback: T, parse: (v: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch { return fallback; }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// i18n (mantido inline — pode ser extraído)
const COPY = {
  pt: {
    eyebrow: 'Black Hole Lab 3D',
    title: 'Buraco negro interativo.',
    description: 'Uma experiência com física Kerr real: horizonte dependente do spin, ISCO encolhendo até 0,5 Rs, Doppler boosting no disco, redshift gravitacional e geodésicas curvadas em tempo real.',
    enter: 'Entrar no Horizonte',
    spectator: 'Modo espectador',
    force: 'Forçar deformação',
    forceActive: 'Deformação forçada ✓',
    panelToggleOpen: 'Mostrar painel',
    panelToggleClose: 'Ocultar painel',
    simulator: 'Simulador',
    panelTitle: 'Horizonte de Eventos',
    reset: 'Reset',
    presets: 'Cenários reais',
    mass: 'Massa',
    spin: 'Spin (a*)',
    spinDetail: '0 = Schwarzschild · 0,998 = limite de Thorne',
    distance: 'Distância do observador',
    diskSpeed: 'Velocidade do disco',
    lensing: 'Distorção gravitacional',
    particles: 'Partículas',
    simulationNote: 'Física Kerr real: o horizonte, ISCO e esfera de fótons mudam com o spin. O lado do disco que gira em direção à câmera fica mais brilhante (Doppler boosting).',
    rs: 'Raio de Schwarzschild',
    kerrHorizon: 'Horizonte Kerr (r+)',
    kerrHorizonDetail: 'r+ = M(1 + √(1-a*²))',
    ergosphere: 'Ergosfera (equador)',
    ergosphereDetail: 'r_E = 2M no equador',
    photon: 'Esfera de fótons',
    photonDetail: 'depende do spin',
    isco: 'ISCO',
    iscoDetail: 'órbita estável mais interna',
    time: 'Dilatação temporal',
    timeDetail: 'longe para cada 1 h local',
    redshift: 'Redshift no ISCO',
    redshiftDetail: 'z = 1/√(1-Rs/r) - 1',
    vIsco: 'Velocidade orbital no ISCO',
    vIscoDetail: 'fração de c',
    spectatorButton: 'Ativar modo espectador',
    interaction: 'Interação: arraste para girar, scroll para zoom, duplo toque no centro para entrar.',
    shortcuts: 'Atalhos: S (espectador) · L (idioma) · T (tema) · Esc (sair)',
    spectatorHint: 'Modo espectador ativo — sem HUD, só a simulação física visual',
    credits: 'Créditos',
    createdBy: 'Criado por Davi Mattos',
    linkedin: 'LinkedIn oficial',
    language: 'Idioma',
    theme: 'Tema',
    dark: 'Escuro',
    light: 'Claro',
    comparisonFallback: 'comparação visual aproximada',
    theoryTitle: 'Cálculos e teorias usadas',
    theoryIntro: 'Fórmulas e aproximações que alimentam a experiência visual.',
    theoryItems: [
      { name: 'Constantes físicas', formula: 'G = 6.67430×10⁻¹¹ | c = 299792458 m/s | M☉ = 1.98847×10³⁰ kg', desc: 'Base dos cálculos reais (CODATA 2018).' },
      { name: 'Raio de Schwarzschild', formula: 'Rs = 2GM / c²', desc: 'Horizonte para buraco sem rotação nem carga.' },
      { name: 'Métrica de Kerr', formula: 'r+ = M(1 + √(1-a*²))', desc: 'Horizonte externo para buraco rotacionando com spin adimensional a*.' },
      { name: 'ISCO (Bardeen 1972)', formula: 'Z1, Z2 → r_isco = 3 + Z2 - √((3-Z1)(3+Z1+2Z2))', desc: 'Órbita estável mais interna. Para a*=0 → 6M; para a*=1 → M (prógrado).' },
      { name: 'Esfera de fótons Kerr', formula: 'r_ph = 2M(1 + cos(⅔ arccos(-a*)))', desc: 'Região onde luz orbita temporariamente.' },
      { name: 'Ergosfera', formula: 'r_E(θ) = M + √(M² - a²cos²θ)', desc: 'Região onde nenhum observador pode permanecer estático.' },
      { name: 'Velocidade orbital no ISCO', formula: 'v = √(M/r) / (1 + a(M/r)^(3/2))', desc: 'Fração da velocidade da luz no ISCO prógrado.' },
      { name: 'Doppler boosting', formula: 'I ∝ (1 - v·n/c)^(-3)', desc: 'Lado do disco que gira em direção ao observador fica mais brilhante e azulado.' },
      { name: 'Redshift gravitacional', formula: 'z = 1/√(1-Rs/r) - 1', desc: 'Luz perde energia ao escapar de regiões próximas ao horizonte.' },
      { name: 'Dilatação temporal', formula: '√(1 - Rs/r)', desc: 'Tempo local diverge do observador distante.' },
      { name: 'Limite de Thorne', formula: 'a* ≤ 0.998', desc: 'Limite teórico para spin de buracos negros astrofísicos (acoplamento com disco).' },
    ],
    spaghettifyText: 'ESPAGUETIFICAÇÃO  GRAVIDADE QUÂNTICA  SINGULARIDADE',
    crawlTitle: 'Entrada no horizonte de eventos',
    psychedelicWarningTitle: 'Aviso de efeito psicodélico',
    psychedelicWarningText: 'A imersão usa distorções intensas, flashes suaves, rotação e sensação de queda. Se sentir desconforto, pressione Esc para sair.',
    crawlMessages: [
      { label: 'Impulso inicial', text: 'A câmera é arremessada para longe para revelar a escala do poço gravitacional.' },
      { label: 'Atração gravitacional', text: 'A gravidade domina a trajetória. A queda deixa de ser escolha e vira destino.' },
      { label: 'Luz curvada', text: 'A luz do disco é desviada pelo campo gravitacional extremo.' },
      { label: 'Tempo em desacordo', text: 'Para observadores distantes, o tempo perto do horizonte desacelera.' },
      { label: 'Horizonte de eventos', text: 'Ao cruzar essa fronteira, nenhum sinal volta. Nem a luz.' },
      { label: 'Rotação extrema', text: 'A aproximação acelera a percepção visual, reforçando o colapso.' },
      { label: 'Limite quântico', text: 'Perto da singularidade, a Relatividade Geral já não basta.' },
    ],
    crawlFooter: 'Representação artística e educativa inspirada na Relatividade Geral e na métrica de Kerr.',
  },
  en: {
    eyebrow: 'Black Hole Lab 3D',
    title: 'Interactive black hole.',
    description: 'A real-Kerr physics experience: spin-dependent horizon, ISCO shrinking to 0.5 Rs, Doppler boosting on the disk, gravitational redshift, and curved geodesics in real time.',
    enter: 'Enter the Horizon',
    spectator: 'Spectator mode',
    force: 'Force distortion',
    forceActive: 'Distortion forced ✓',
    panelToggleOpen: 'Show panel',
    panelToggleClose: 'Hide panel',
    simulator: 'Simulator',
    panelTitle: 'Event Horizon',
    reset: 'Reset',
    presets: 'Real scenarios',
    mass: 'Mass',
    spin: 'Spin (a*)',
    spinDetail: '0 = Schwarzschild · 0.998 = Thorne limit',
    distance: 'Observer distance',
    diskSpeed: 'Disk speed',
    lensing: 'Gravitational distortion',
    particles: 'Particles',
    simulationNote: 'Real Kerr physics: horizon, ISCO and photon sphere change with spin. The disk side rotating toward the camera appears brighter (Doppler boosting).',
    rs: 'Schwarzschild radius',
    kerrHorizon: 'Kerr horizon (r+)',
    kerrHorizonDetail: 'r+ = M(1 + √(1-a*²))',
    ergosphere: 'Ergosphere (equator)',
    ergosphereDetail: 'r_E = 2M at equator',
    photon: 'Photon sphere',
    photonDetail: 'spin-dependent',
    isco: 'ISCO',
    iscoDetail: 'innermost stable orbit',
    time: 'Time dilation',
    timeDetail: 'far away for each 1 local hour',
    redshift: 'Redshift at ISCO',
    redshiftDetail: 'z = 1/√(1-Rs/r) - 1',
    vIsco: 'Orbital velocity at ISCO',
    vIscoDetail: 'fraction of c',
    spectatorButton: 'Activate spectator mode',
    interaction: 'Interaction: drag to rotate, scroll to zoom, double tap the center to enter.',
    shortcuts: 'Shortcuts: S (spectator) · L (language) · T (theme) · Esc (exit)',
    spectatorHint: 'Spectator mode active — no HUD, only the visual physics simulation',
    credits: 'Credits',
    createdBy: 'Created by Davi Mattos',
    linkedin: 'Official LinkedIn',
    language: 'Language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    comparisonFallback: 'approximate visual comparison',
    theoryTitle: 'Calculations and theories used',
    theoryIntro: 'Formulas and approximations powering the visual experience.',
    theoryItems: [
      { name: 'Physical constants', formula: 'G = 6.67430×10⁻¹¹ | c = 299792458 m/s | M☉ = 1.98847×10³⁰ kg', desc: 'Real calculation basis (CODATA 2018).' },
      { name: 'Schwarzschild radius', formula: 'Rs = 2GM / c²', desc: 'Horizon for non-rotating, uncharged black hole.' },
      { name: 'Kerr metric', formula: 'r+ = M(1 + √(1-a*²))', desc: 'Outer horizon for rotating black hole with dimensionless spin a*.' },
      { name: 'ISCO (Bardeen 1972)', formula: 'Z1, Z2 → r_isco = 3 + Z2 - √((3-Z1)(3+Z1+2Z2))', desc: 'Innermost stable orbit. For a*=0 → 6M; for a*=1 → M (prograde).' },
      { name: 'Kerr photon sphere', formula: 'r_ph = 2M(1 + cos(⅔ arccos(-a*)))', desc: 'Region where light orbits temporarily.' },
      { name: 'Ergosphere', formula: 'r_E(θ) = M + √(M² - a²cos²θ)', desc: 'Region where no observer can remain static.' },
      { name: 'Orbital velocity at ISCO', formula: 'v = √(M/r) / (1 + a(M/r)^(3/2))', desc: 'Fraction of light speed at prograde ISCO.' },
      { name: 'Doppler boosting', formula: 'I ∝ (1 - v·n/c)^(-3)', desc: 'Disk side rotating toward observer appears brighter and bluer.' },
      { name: 'Gravitational redshift', formula: 'z = 1/√(1-Rs/r) - 1', desc: 'Light loses energy escaping near the horizon.' },
      { name: 'Time dilation', formula: '√(1 - Rs/r)', desc: 'Local time diverges from distant observer.' },
      { name: 'Thorne limit', formula: 'a* ≤ 0.998', desc: 'Theoretical limit for astrophysical black hole spin (disk coupling).' },
    ],
    spaghettifyText: 'SPAGHETTIFICATION  QUANTUM GRAVITY  SINGULARITY',
    crawlTitle: 'Crossing the event horizon',
    psychedelicWarningTitle: 'Psychedelic effect warning',
    psychedelicWarningText: 'This immersion uses intense distortion, soft flashes, rotation and falling motion. If you feel discomfort, press Esc to exit.',
    crawlMessages: [
      { label: 'Initial impulse', text: 'The camera is thrown far to reveal the gravitational well scale.' },
      { label: 'Gravitational pull', text: 'Gravity now dominates. The fall becomes destiny.' },
      { label: 'Curved light', text: 'Disk light is bent by the extreme gravitational field.' },
      { label: 'Time disagreement', text: 'For distant observers, time near the horizon slows down.' },
      { label: 'Event horizon', text: 'Once crossed, no signal returns. Not even light.' },
      { label: 'Extreme rotation', text: 'The final approach accelerates visual perception.' },
      { label: 'Quantum limit', text: 'Near the singularity, General Relativity is no longer enough.' },
    ],
    crawlFooter: 'Artistic and educational representation inspired by General Relativity and the Kerr metric.',
  },
} as const;

type Copy = (typeof COPY)[Locale];

function App() {
  const [params, setParams] = useState<BlackHoleParams>(PRESETS.sagittarius.params);
  const [panelOpen, setPanelOpen] = useState(() => readStorage('bh.panel', true, (v) => v !== '0'));
  const [entering, setEntering] = useState(false);
  const [horizonFocus, setHorizonFocus] = useState(false);
  const [spectatorMode, setSpectatorMode] = useState(false);
  const [sequenceStartedAt, setSequenceStartedAt] = useState(0);
  const [locale, setLocale] = useState<Locale>(() => readStorage<Locale>('bh.locale', 'pt', (v) => (v === 'en' ? 'en' : 'pt')));
  const [theme, setTheme] = useState<Theme>(() => readStorage<Theme>('bh.theme', 'dark', (v) => (v === 'light' ? 'light' : 'dark')));
  const [forceFlash, setForceFlash] = useState(false);
  const [psychedelicWarningVisible, setPsychedelicWarningVisible] = useState(false);

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const previousParamsRef = useRef<BlackHoleParams | null>(null);

  const copy: Copy = COPY[locale];
  const metrics = useMemo(() => calculateBlackHole(params), [params]);
  const spaghettifyLetters = useMemo(() => Array.from(copy.spaghettifyText), [copy]);

  useEffect(() => { try { localStorage.setItem('bh.panel', panelOpen ? '1' : '0'); } catch {} }, [panelOpen]);
  useEffect(() => { try { localStorage.setItem('bh.locale', locale); } catch {} }, [locale]);
  useEffect(() => { try { localStorage.setItem('bh.theme', theme); } catch {} }, [theme]);

  const updateParam = useCallback(<K extends keyof BlackHoleParams>(key: K, value: BlackHoleParams[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: BlackHoleParams) => {
    if (entering) return;
    previousParamsRef.current = null;
    setParams(preset);
  }, [entering]);

  const enterHorizon = useCallback(() => {
    if (entering) return;
    if (!previousParamsRef.current) previousParamsRef.current = params;
    setParams(immersionParams);
    setHorizonFocus(true);
    setEntering(true);
    setPanelOpen(false);
    setSpectatorMode(true);
    setPsychedelicWarningVisible(true);
    setSequenceStartedAt(performance.now());
  }, [params, entering]);

  const resetCamera = useCallback(() => {
    setHorizonFocus(false);
    setEntering(false);
    setSequenceStartedAt(0);
    setSpectatorMode(false);
    setPsychedelicWarningVisible(false);
    setPanelOpen(true);
    if (previousParamsRef.current) {
      setParams(previousParamsRef.current);
      previousParamsRef.current = null;
    }
  }, []);

  const toggleForceLensing = useCallback(() => {
    updateParam('lensing', params.lensing >= FORCE_LENSING_TOGGLE.high - 4 ? FORCE_LENSING_TOGGLE.low : FORCE_LENSING_TOGGLE.high);
    setForceFlash(true);
    window.setTimeout(() => setForceFlash(false), FORCE_FLASH_MS);
  }, [params.lensing, updateParam]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      const key = event.key.toLowerCase();
      if (key === 's') setSpectatorMode((v) => !v);
      else if (key === 'l') setLocale((v) => (v === 'pt' ? 'en' : 'pt'));
      else if (key === 't') setTheme((v) => (v === 'dark' ? 'light' : 'dark'));
      else if (key === 'escape') {
        if (spectatorMode) setSpectatorMode(false);
        if (entering) resetCamera();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entering, resetCamera, spectatorMode]);

  useEffect(() => {
    if (!entering || !psychedelicWarningVisible) return undefined;
    const timeout = window.setTimeout(() => setPsychedelicWarningVisible(false), PSYCHEDELIC_WARNING_MS);
    return () => window.clearTimeout(timeout);
  }, [entering, psychedelicWarningVisible]);

  useEffect(() => {
    if (!entering || sequenceStartedAt <= 0) return undefined;
    const timeout = window.setTimeout(() => resetCamera(), HORIZON_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [entering, sequenceStartedAt, resetCamera]);

  return (
    <main className={`app theme-${theme}${entering ? ' entering' : ''}${spectatorMode ? ' spectator' : ''}${reducedMotion ? ' reduced-motion' : ''}`}>
      <BlackHoleScene
        params={params} entering={entering} horizonFocus={horizonFocus}
        spectatorMode={spectatorMode} sequenceStartedAt={sequenceStartedAt}
        reducedMotion={reducedMotion} onDoubleTapHorizon={enterHorizon}
      />

      <section className="hero-copy" aria-label="Introdução">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="hero-actions">
          <button onClick={enterHorizon} disabled={entering}>{copy.enter}</button>
          <button className="ghost" onClick={() => setSpectatorMode(true)}>{copy.spectator}</button>
          <button className={`ghost${forceFlash ? ' flash' : ''}`} onClick={toggleForceLensing}>
            {forceFlash ? copy.forceActive : copy.force}
          </button>
        </div>
      </section>

      <div className="top-controls" aria-label="Opções globais">
        <div className="toggle-group" role="radiogroup" aria-label={copy.language}>
          <span>{copy.language}</span>
          <button role="radio" aria-checked={locale === 'pt'} className={locale === 'pt' ? 'active' : ''} onClick={() => setLocale('pt')}>PT</button>
          <button role="radio" aria-checked={locale === 'en'} className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button>
        </div>
        <div className="toggle-group" role="radiogroup" aria-label={copy.theme}>
          <span>{copy.theme}</span>
          <button role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{copy.dark}</button>
          <button role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{copy.light}</button>
        </div>
      </div>

      <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
        {panelOpen ? copy.panelToggleClose : copy.panelToggleOpen}
      </button>

      <aside className={panelOpen ? 'lab-panel open' : 'lab-panel'} aria-label="Controles do buraco negro">
        <div className="panel-header">
          <div>
            <span>{copy.simulator}</span>
            <h2>{copy.panelTitle}</h2>
          </div>
          <button onClick={resetCamera}>{copy.reset}</button>
        </div>

        <div className="presets" role="group" aria-label={copy.presets}>
          <span>{copy.presets}</span>
          <div className="preset-row">
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button key={key} onClick={() => applyPreset(preset.params)}>{preset.name}</button>
            ))}
          </div>
        </div>

        <div className="controls">
          <SliderControl label={copy.mass} min={1} max={10_000_000_000} value={params.massSolar} unit="M☉" scale="log"
            format={(v) => formatCompact(v, 0)} onChange={(v) => updateParam('massSolar', Math.round(v))} />
          <SliderControl label={copy.spin} min={0} max={0.998} step={0.001} value={params.spin}
            format={(v) => formatCompact(v, 3)} onChange={(v) => updateParam('spin', Number(v.toFixed(3)))} />
          <SliderControl label={copy.distance} min={1.1} max={50} step={0.1} value={params.observerDistanceRs} unit="Rs"
            format={(v) => formatCompact(v, 1)} onChange={(v) => updateParam('observerDistanceRs', Number(v.toFixed(1)))} />
          <SliderControl label={copy.diskSpeed} min={0} max={100} value={params.diskSpeed} unit="%"
            onChange={(v) => updateParam('diskSpeed', Math.round(v))} />
          <SliderControl label={copy.lensing} min={0} max={100} value={params.lensing} unit="%"
            onChange={(v) => updateParam('lensing', Math.round(v))} />
          <SliderControl label={copy.particles} min={300} max={5000} step={50} value={params.particles}
            format={(v) => formatCompact(v, 0)} onChange={(v) => updateParam('particles', Math.round(v))} />
        </div>

        <p className="simulation-note">{copy.simulationNote}</p>

        <div className="readout-grid" role="region" aria-label="Métricas calculadas">
          <Readout label={copy.rs} value={formatKm(metrics.schwarzschildRadiusKm)} detail={metrics.comparison} />
          <Readout label={copy.kerrHorizon} value={formatKm(metrics.kerrHorizonRadiusKm)} detail={copy.kerrHorizonDetail} />
          <Readout label={copy.photon} value={formatKm(metrics.photonSphereKm)} detail={copy.photonDetail} />
          <Readout label={copy.isco} value={`${formatCompact(metrics.iscoRs, 3)} Rs · ${formatKm(metrics.iscoKm)}`} detail={copy.iscoDetail} />
          <Readout label={copy.vIsco} value={`${formatCompact(metrics.orbitalVelocityAtIsco * 100, 1)}% c`} detail={copy.vIscoDetail} />
          <Readout label={copy.time} value={`${formatCompact(metrics.farHoursForOneLocalHour, 2)} h`} detail={copy.timeDetail} />
          <Readout label={copy.redshift} value={`z = ${formatCompact(metrics.redshift, 3)}`} detail={copy.redshiftDetail} />
        </div>

        <section className="theory-section" aria-label={copy.theoryTitle}>
          <div className="theory-header">
            <span>{copy.theoryTitle}</span>
            <p>{copy.theoryIntro}</p>
          </div>
          <div className="theory-list">
            {copy.theoryItems.map((item) => (
              <article className="theory-item" key={`${locale}-${item.name}`}>
                <strong>{item.name}</strong>
                <code>{item.formula}</code>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <button className="wide-action" onClick={() => setSpectatorMode(true)}>{copy.spectatorButton}</button>

        <div className="credits-card">
          <span>{copy.credits}</span>
          <strong>{copy.createdBy}</strong>
          <a href="https://www.linkedin.com/in/davinmattos/" target="_blank" rel="noreferrer">{copy.linkedin}</a>
        </div>
      </aside>

      <div className="bottom-note">
        <strong>{copy.credits}:</strong> {copy.createdBy} — <a href="https://www.linkedin.com/in/davinmattos/" target="_blank" rel="noreferrer">{copy.linkedin}</a>
        <br />{copy.interaction}<br /><kbd>{copy.shortcuts}</kbd>
      </div>

      {spectatorMode && !entering ? (
        <div className="spectator-hint" role="status" aria-live="polite">{copy.spectatorHint}</div>
      ) : null}

      {entering ? (
        <div className="horizon-overlay" role="status" aria-label={copy.crawlTitle}>
          {psychedelicWarningVisible ? (
            <div className="psychedelic-warning" role="alert" aria-live="assertive">
              <span>{copy.psychedelicWarningTitle}</span>
              <strong>{copy.psychedelicWarningText}</strong>
            </div>
          ) : null}
          <div className="crawl-mask">
            <div className="crawl-track">
              <p className="crawl-kicker">{copy.crawlTitle}</p>
              {copy.crawlMessages.map((message) => (
                <p key={`${locale}-${message.label}`} className="crawl-line">
                  <span>{message.label}</span>{message.text}
                </p>
              ))}
              <p className="crawl-footer">{copy.crawlFooter}</p>
            </div>
          </div>
          <div className="spaghettify-layer" aria-hidden="true">
            {spaghettifyLetters.map((letter, index) => (
              <span key={`${locale}-letter-${index}`} style={{
                '--i': index,
                '--a': `${(index / Math.max(1, spaghettifyLetters.length)) * 360}deg`,
                '--r': `${180 + (index % 22) * 9}px`,
              } as CSSProperties}>
                {letter === ' ' ? ' ' : letter}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;