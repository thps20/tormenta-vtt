/** Formatação de números na unidade do sistema (metros...), compartilhada entre `MovementLayer`
 *  (orçamento de deslocamento) e a régua (docs/SPEC.md §3.2/§9.11) — as duas mostram a mesma conta
 *  ("gasto / orçamento"), nunca deveriam arredondar diferente. */

/** "4,5" em vez de "4.500000000001" (soma de floats) — 1 casa, sem zero à toa quando é inteiro. */
export function fmtUnit(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
}
