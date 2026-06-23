// ─────────────────────────────────────────────────────────────
// Constantes físicas fundamentais (CODATA 2018)
// ─────────────────────────────────────────────────────────────
export const PHYS = {
  G: 6.67430e-11,          // m³ kg⁻¹ s⁻²
  c: 299_792_458,          // m/s
  c2: 299_792_458 ** 2,
  Msun: 1.98847e30,        // kg
  AU: 1.495978707e11,      // m
  ly: 9.4607304725808e15,  // m
} as const;

// ─────────────────────────────────────────────────────────────
// Parâmetros do buraco negro
// ─────────────────────────────────────────────────────────────
export type BlackHoleParams = {
  massSolar: number;         // massa em massas solares
  spin: number;              // parâmetro de spin adimensional a* ∈ [0, 0.998]
  observerDistanceRs: number;// distância do observador em raios de Schwarzschild
  diskSpeed: number;         // 0..100 (escala visual)
  lensing: number;           // 0..100 (escala visual)
  particles: number;         // 300..5000
};

// ─────────────────────────────────────────────────────────────
// Métricas derivadas (física Kerr)
// ─────────────────────────────────────────────────────────────
export type BlackHoleMetrics = {
  massKg: number;
  schwarzschildRadiusM: number;
  schwarzschildRadiusKm: number;
  eventHorizonDiameterKm: number;
  // Kerr: horizonte externo r+ = M + √(M² - a²) em unidades geométricas
  kerrHorizonRadiusM: number;
  kerrHorizonRadiusKm: number;
  // Ergosfera no equador: r_E = 2M (coincide com horizonte no equador só para a=0)
  ergosphereEquatorKm: number;
  photonSphereKm: number;
  iscoKm: number;
  iscoRs: number;            // ISCO em unidades de Rs
  farHoursForOneLocalHour: number;
  redshift: number;
  orbitalVelocityAtIsco: number; // fração de c
  comparison: string;
};

// ─────────────────────────────────────────────────────────────
// Fórmulas Kerr (Bardeen, Press & Teukolsky 1972)
// ─────────────────────────────────────────────────────────────

/**
 * Raio do horizonte externo em unidades de M (massa geométrica):
 *   r+ = M + √(M² - a²)
 * Em unidades geométricas (G=c=1), a = a* × M, então:
 *   r+ = M × (1 + √(1 - a*²))
 */
function kerrHorizonRadiusInM(aStar: number): number {
  const a = clamp01(aStar);
  return 1 + Math.sqrt(Math.max(0, 1 - a * a));
}

/**
 * ISCO para Kerr prógrado (matéria co-rotando com o BH):
 *   Z1 = 1 + (1-a²)^(1/3) × [(1+a)^(1/3) + (1-a)^(1/3)]
 *   Z2 = √(3a² + Z1²)
 *   r_isco/M = 3 + Z2 - √((3-Z1)(3+Z1+2Z2))
 *
 * Para a=0 → r_isco = 6M = 3Rs ✓
 * Para a=1 → r_isco = M = 0.5Rs (máximo co-rotante)
 */
function kerrIscoInM(aStar: number): number {
  const a = clamp01(aStar);
  if (a < 1e-9) return 6; // Schwarzschild
  const a2 = a * a;
  const Z1 = 1 + Math.cbrt(1 - a2) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const Z2 = Math.sqrt(3 * a2 + Z1 * Z1);
  return 3 + Z2 - Math.sqrt(Math.max(0, (3 - Z1) * (3 + Z1 + 2 * Z2)));
}

/**
 * Esfera de fótons para Kerr prógrado:
 *   r_ph = 2M × (1 + cos(⅔ arccos(-a/M)))
 * Para a=0 → r_ph = 3M = 1.5Rs ✓
 * Para a=1 → r_ph = M = 0.5Rs (co-rotante)
 */
function kerrPhotonSphereInM(aStar: number): number {
  const a = clamp01(aStar);
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

/**
 * Velocidade orbital Kepleriana no ISCO (prógrado, Kerr):
 *   v = √(M / r_isco) / (1 + a × (M/r_isco)^(3/2))
 * Em unidades de c.
 */
function orbitalVelocityAtIsco(aStar: number, rIscoInM: number): number {
  const a = clamp01(aStar);
  const sqrtMr = Math.sqrt(1 / rIscoInM);
  const denom = 1 + a * Math.pow(1 / rIscoInM, 1.5);
  return sqrtMr / denom;
}

function clamp01(x: number): number {
  return Math.min(0.998, Math.max(0, x));
}

// ─────────────────────────────────────────────────────────────
// Comparadores visuais (para o Readout)
// ─────────────────────────────────────────────────────────────
function compareRadius(radiusKm: number): string {
  const earthR = 6371;
  const sunR = 696_340;
  if (radiusKm < earthR * 2) return `≈ ${(radiusKm / earthR).toFixed(2)} × raio da Terra`;
  if (radiusKm < sunR) return `≈ ${(radiusKm / earthR).toFixed(0)} × raios da Terra`;
  if (radiusKm < sunR * 10) return `≈ ${(radiusKm / sunR).toFixed(2)} × raio do Sol`;
  if (radiusKm < PHYS.AU / 1000) return `≈ ${(radiusKm / sunR).toFixed(1)} × raios solares`;
  if (radiusKm < PHYS.AU / 1000 * 100) return `≈ ${(radiusKm / (PHYS.AU / 1000)).toFixed(2)} UA`;
  return `≈ ${(radiusKm / (PHYS.ly / 1000)).toFixed(2)} anos-luz`;
}

// ─────────────────────────────────────────────────────────────
// Função principal
// ─────────────────────────────────────────────────────────────
export function calculateBlackHole(params: BlackHoleParams): BlackHoleMetrics {
  const massKg = params.massSolar * PHYS.Msun;
  const RsM = (2 * PHYS.G * massKg) / PHYS.c2;
  const RsKm = RsM / 1000;

  // Kerr (em metros)
  const rHorizonInM = kerrHorizonRadiusInM(params.spin);
  const kerrHorizonM = (RsM / 2) * rHorizonInM; // M_geom = Rs/2
  const kerrHorizonKm = kerrHorizonM / 1000;

  // Ergosfera no equador: r_E = 2M_geom = Rs (sempre, independente do spin no equador)
  const ergosphereKm = RsKm;

  // ISCO
  const rIscoInM = kerrIscoInM(params.spin);
  const iscoM = (RsM / 2) * rIscoInM;
  const iscoKm = iscoM / 1000;
  const iscoRs = rIscoInM / 2; // em unidades de Rs

  // Esfera de fótons
  const rPhInM = kerrPhotonSphereInM(params.spin);
  const photonM = (RsM / 2) * rPhInM;
  const photonKm = photonM / 1000;

  // Dilatação temporal no ISCO (aproximação Schwarzschild-like para o observador distante)
  // Para Kerr é mais complexo, usamos a aproximação estática: √(1 - Rs/r)
  const rObsM = params.observerDistanceRs * RsM;
  const timeDilation = Math.sqrt(Math.max(1e-6, 1 - RsM / rObsM));
  const farHoursForOneLocalHour = 1 / timeDilation;

  // Redshift gravitacional no ISCO
  const redshift = 1 / Math.sqrt(Math.max(1e-6, 1 - RsM / iscoM)) - 1;

  // Velocidade orbital no ISCO (fração de c)
  const vIsco = orbitalVelocityAtIsco(params.spin, rIscoInM);

  return {
    massKg,
    schwarzschildRadiusM: RsM,
    schwarzschildRadiusKm: RsKm,
    eventHorizonDiameterKm: RsKm * 2,
    kerrHorizonRadiusM: kerrHorizonM,
    kerrHorizonRadiusKm: kerrHorizonKm,
    ergosphereEquatorKm: ergosphereKm,
    photonSphereKm: photonKm,
    iscoKm,
    iscoRs,
    farHoursForOneLocalHour,
    redshift,
    orbitalVelocityAtIsco: vIsco,
    comparison: compareRadius(RsKm),
  };
}

// ─────────────────────────────────────────────────────────────
// Formatadores
// ─────────────────────────────────────────────────────────────
export function formatKm(valueKm: number): string {
  if (valueKm < 1) return `${(valueKm * 1000).toFixed(1)} m`;
  if (valueKm < 1e3) return `${valueKm.toFixed(1)} km`;
  if (valueKm < 1e6) return `${(valueKm / 1e3).toFixed(2)} mil km`;
  if (valueKm < PHYS.AU / 1000) return `${(valueKm / 1e6).toFixed(2)} milhões km`;
  if (valueKm < PHYS.ly / 1000) return `${(valueKm / (PHYS.AU / 1000)).toFixed(2)} UA`;
  return `${(valueKm / (PHYS.ly / 1000)).toFixed(3)} anos-luz`;
}

export function formatCompact(value: number, digits: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

// ─────────────────────────────────────────────────────────────
// Presets de buracos negros reais (com spins observados/estimados)
// ─────────────────────────────────────────────────────────────
export const PRESETS = {
  sagittarius: {
    name: 'Sagitário A*',
    params: {
      massSolar: 4_300_000,
      spin: 0.1,        // estimativa: baixo, consistente com observações do EHT
      observerDistanceRs: 10,
      diskSpeed: 58,
      lensing: 82,
      particles: 2800,
    },
  },
  m87: {
    name: 'M87*',
    params: {
      massSolar: 6_500_000_000,
      spin: 0.9,        // estimativa EHT: alto, co-rotante com o jet
      observerDistanceRs: 8,
      diskSpeed: 72,
      lensing: 90,
      particles: 4200,
    },
  },
  cygnus: {
    name: 'Cygnus X-1',
    params: {
      massSolar: 21.2,
      spin: 0.95,       // um dos spins mais altos medidos
      observerDistanceRs: 14,
      diskSpeed: 85,
      lensing: 75,
      particles: 2400,
    },
  },
  gw150914: {
    name: 'GW150914 (fusão)',
    params: {
      massSolar: 62,
      spin: 0.67,       // spin do remanescente
      observerDistanceRs: 12,
      diskSpeed: 80,
      lensing: 95,
      particles: 3500,
    },
  },
  grs1915: {
    name: 'GRS 1915+105',
    params: {
      massSolar: 14,
      spin: 0.98,       // próximo do limite de Thorne
      observerDistanceRs: 13,
      diskSpeed: 92,
      lensing: 78,
      particles: 2600,
    },
  },
  stellar: {
    name: 'Massa estelar típica',
    params: {
      massSolar: 10,
      spin: 0.3,
      observerDistanceRs: 14,
      diskSpeed: 45,
      lensing: 70,
      particles: 2200,
    },
  },
  schwarzschild: {
    name: 'Schwarzschild (sem rotação)',
    params: {
      massSolar: 1_000_000,
      spin: 0,
      observerDistanceRs: 10,
      diskSpeed: 50,
      lensing: 80,
      particles: 2800,
    },
  },
} as const;