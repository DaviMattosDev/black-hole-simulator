// Funções puras da métrica de Kerr, reutilizáveis pela cena e pela UI.

export function clampSpin(aStar: number): number {
  return Math.min(0.998, Math.max(0, aStar));
}

/**
 * Horizonte externo em unidades de M (massa geométrica):
 *   r+ = M × (1 + √(1 - a*²))
 */
export function kerrHorizonRadiusInM(aStar: number): number {
  const a = clampSpin(aStar);
  return 1 + Math.sqrt(Math.max(0, 1 - a * a));
}

/**
 * ISCO prógrado em unidades de M (Bardeen, Press & Teukolsky 1972):
 *   Z1 = 1 + (1-a²)^(1/3) × [(1+a)^(1/3) + (1-a)^(1/3)]
 *   Z2 = √(3a² + Z1²)
 *   r_isco = 3 + Z2 - √((3-Z1)(3+Z1+2Z2))
 */
export function kerrIscoInM(aStar: number): number {
  const a = clampSpin(aStar);
  if (a < 1e-9) return 6;
  const a2 = a * a;
  const Z1 = 1 + Math.cbrt(1 - a2) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const Z2 = Math.sqrt(3 * a2 + Z1 * Z1);
  return 3 + Z2 - Math.sqrt(Math.max(0, (3 - Z1) * (3 + Z1 + 2 * Z2)));
}

/**
 * Esfera de fótons prógrado em unidades de M:
 *   r_ph = 2M × (1 + cos(⅔ arccos(-a*)))
 */
export function kerrPhotonSphereInM(aStar: number): number {
  const a = clampSpin(aStar);
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

/**
 * Ergosfera no equador em unidades de M (sempre = 2M, independente do spin):
 *   r_E(θ=π/2) = 2M
 */
export function kerrErgosphereEquatorInM(_aStar: number): number {
  return 2;
}