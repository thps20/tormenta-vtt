/**
 * Alvos de soltura genéricos (arrastar-e-soltar por pointer events, não HTML5 drag — Konva não
 * participa do drag nativo do navegador). Um alvo é um elemento com o atributo
 * data-drop-target="<id>" mais um ou mais registros aqui dizendo o que aceitam e o que fazer ao
 * soltar. Genérico em `T` (o tipo do que está sendo arrastado): o compêndio arrasta
 * `CompendiumEntry` (para a ficha e para o mapa, §9.4/§9.5), handouts arrastam `Handout` (para o
 * mapa, §9.10) — o MESMO elemento "mapa" aceita os dois ao mesmo tempo, então o id "map" pode ter
 * mais de um registro; `dropTargetAt` usa o primeiro cujo `accepts` topa a entrada arrastada.
 *
 * O teste de "está sobre o alvo" usa document.elementFromPoint, então quem arrasta precisa deixar
 * o fantasma e a paleta/painel com pointer-events: none.
 */
export const DROP_TARGET_ATTR = "data-drop-target";

export interface DropPoint {
  /** Coordenadas na tela (clientX/clientY). */
  x: number;
  y: number;
}

export interface DropTarget<T> {
  id: string;
  /** Aceita esta entrada? (ex.: o mapa só aceita criaturas do compêndio, não itens). */
  accepts: (entry: T) => boolean;
  onDrop: (entry: T, point: DropPoint) => void;
}

const targets = new Map<string, DropTarget<never>[]>();

/** Registra o alvo (pode conviver com outros do mesmo id); devolve a função que o remove
 *  (cleanup do useEffect) — remove só este registro, não os outros do mesmo id. */
export function registerDropTarget<T>(target: DropTarget<T>): () => void {
  const stored = target as unknown as DropTarget<never>;
  targets.set(target.id, [...(targets.get(target.id) ?? []), stored]);
  return () => {
    const list = targets.get(target.id);
    if (!list) return;
    const next = list.filter((t) => t !== stored);
    if (next.length > 0) targets.set(target.id, next);
    else targets.delete(target.id);
  };
}

/** Primeiro alvo registrado sob o ponto da tela cujo `accepts` topa esta entrada, ou null. */
export function dropTargetAt<T>(point: DropPoint, entry: T): DropTarget<T> | null {
  const el = document.elementFromPoint(point.x, point.y);
  const host = el?.closest<HTMLElement>(`[${DROP_TARGET_ATTR}]`);
  const id = host?.getAttribute(DROP_TARGET_ATTR);
  if (!id) return null;
  const list = (targets.get(id) ?? []) as unknown as DropTarget<T>[];
  return list.find((t) => t.accepts(entry)) ?? null;
}
