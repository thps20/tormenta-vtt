import { FOG_SHAPES_MAX, type FogConfig, type FogOp } from "@tormenta-vtt/shared";
import { HandlerError } from "../socket/ack.js";

/**
 * Aplica uma operação de névoa e devolve o estado novo (função pura; o handler
 * persiste). O limite de shapes é a decisão documentada no SPEC (§9.3): acima
 * de FOG_SHAPES_MAX recusamos em vez de mesclar geometria.
 */
export function applyFogOp(fog: FogConfig, op: FogOp): FogConfig {
  switch (op.type) {
    case "add":
      if (fog.shapes.length >= FOG_SHAPES_MAX) {
        throw new HandlerError(`Limite de ${FOG_SHAPES_MAX} formas de névoa atingido. Use "Revelar tudo" ou "Ocultar tudo" para recomeçar.`);
      }
      return { ...fog, shapes: [...fog.shapes, op.shape] };
    case "removeLast":
      return { ...fog, shapes: fog.shapes.slice(0, -1) };
    case "revealAll":
      return { ...fog, base: "revealed", shapes: [] };
    case "hideAll":
      return { ...fog, base: "hidden", shapes: [] };
    case "setEnabled":
      return { ...fog, enabled: op.enabled };
  }
}
