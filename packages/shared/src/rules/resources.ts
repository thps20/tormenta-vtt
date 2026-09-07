/**
 * Aplica um delta (com sinal) num recurso com PV temporário, travado em min/max.
 * Usado por token:apply-damage: dano (delta < 0) gasta `temp` antes de `current`;
 * cura (delta >= 0) só mexe em `current`, sem passar do máximo. Serve tanto pro
 * recurso da ficha (`tokenBar`, com temp e min negativo) quanto pro PV do token
 * solto (chame com `temp: 0` e `min: 0`; o resultado sempre devolve temp: 0 nesse caso).
 */
export interface ResourceAmount {
  current: number;
  temp: number;
}

export function applyResourceDelta(res: ResourceAmount, delta: number, bounds: { min: number; max: number }): ResourceAmount {
  const clamp = (n: number) => Math.min(bounds.max, Math.max(bounds.min, n));
  if (delta >= 0) {
    return { current: clamp(res.current + delta), temp: res.temp };
  }
  let missing = -delta;
  const tempUsed = Math.min(res.temp, missing);
  missing -= tempUsed;
  return { current: clamp(res.current - missing), temp: res.temp - tempUsed };
}
