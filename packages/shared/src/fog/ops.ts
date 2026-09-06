import { FOG_SHAPES_MAX, type FogConfig } from "../schemas/fog.js";
import type { FogOp } from "../schemas/payloads.js";

export type FogOpResult = { ok: true; fog: FogConfig } | { ok: false; error: string };

/**
 * Aplica uma operação de névoa e devolve o estado novo. Função pura: o cliente
 * usa para a mudança otimista, o servidor para o estado que vai ao banco. O
 * limite de shapes é a decisão documentada no SPEC (§9.3): acima de
 * FOG_SHAPES_MAX recusamos em vez de mesclar geometria.
 */
export function applyFogOp(fog: FogConfig, op: FogOp): FogOpResult {
  switch (op.type) {
    case "add":
      if (fog.shapes.length >= FOG_SHAPES_MAX) {
        return { ok: false, error: `Limite de ${FOG_SHAPES_MAX} formas de névoa atingido. Use "Revelar tudo" ou "Ocultar tudo" para recomeçar.` };
      }
      return { ok: true, fog: { ...fog, shapes: [...fog.shapes, op.shape] } };
    case "removeLast":
      return { ok: true, fog: { ...fog, shapes: fog.shapes.slice(0, -1) } };
    case "revealAll":
      return { ok: true, fog: { ...fog, base: "revealed", shapes: [] } };
    case "hideAll":
      return { ok: true, fog: { ...fog, base: "hidden", shapes: [] } };
    case "setEnabled":
      return { ok: true, fog: { ...fog, enabled: op.enabled } };
  }
}
