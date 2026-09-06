import type { CompendiumEntry } from "@tormenta-vtt/shared";

/**
 * Alvos de soltura para arrastar entradas do compêndio. Um alvo é um elemento
 * com o atributo data-drop-target="<id>" mais um registro aqui dizendo o que
 * aceita e o que fazer ao soltar. Hoje só a ficha se registra; o mapa entra
 * depois (ex.: monstro vira token) sem mudar a paleta nem a store.
 *
 * O teste de "está sobre o alvo" usa document.elementFromPoint, então quem
 * arrasta precisa deixar o fantasma e a paleta com pointer-events: none.
 */
export const DROP_TARGET_ATTR = "data-drop-target";

export interface DropPoint {
  /** Coordenadas na tela (clientX/clientY). */
  x: number;
  y: number;
}

export interface DropTarget {
  id: string;
  /** Aceita esta entrada? (ex.: o mapa só aceita criaturas). */
  accepts: (entry: CompendiumEntry) => boolean;
  onDrop: (entry: CompendiumEntry, point: DropPoint) => void;
}

const targets = new Map<string, DropTarget>();

/** Registra o alvo; devolve a função que o remove (para o cleanup do useEffect). */
export function registerDropTarget(target: DropTarget): () => void {
  targets.set(target.id, target);
  return () => {
    if (targets.get(target.id) === target) targets.delete(target.id);
  };
}

/** Alvo registrado sob o ponto da tela que aceita a entrada, ou null. */
export function dropTargetAt(point: DropPoint, entry: CompendiumEntry): DropTarget | null {
  const el = document.elementFromPoint(point.x, point.y);
  const host = el?.closest<HTMLElement>(`[${DROP_TARGET_ATTR}]`);
  const id = host?.getAttribute(DROP_TARGET_ATTR);
  if (!id) return null;
  const target = targets.get(id);
  return target && target.accepts(entry) ? target : null;
}
