import { DEFAULT_MAP_SIZE, findFreeCells, type CellRect, type Scene } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize } from "./grid.js";

/**
 * Ponto (em pixels do mapa) da célula LIVRE mais próxima de `point` para um token de `cells`
 * células de lado — a mesma espiral do spawn de criatura (`findFreeCells`), então "Colocar no mapa"
 * (§9.30) cai onde o Mestre já espera e nunca empilha em cima de outro token. Se a espiral estourar
 * o raio máximo (mapa lotado), devolve o ponto pedido grudado no grid mesmo: empilhar é melhor que
 * não colocar nada.
 *
 * `count` posições de uma vez continua sendo feito na mão por quem solta em lote (socket/
 * compendium.ts, socket/encounter.ts): lá a lista de tokens existentes também serve pra numerar os
 * nomes, e reler tudo aqui seria uma consulta a mais por cópia.
 */
export async function freeSpotNear(scene: Scene, point: { x: number; y: number }, cells: number): Promise<{ x: number; y: number }> {
  const cellSize = effectiveCellSize(scene.grid);
  // Mapa sem imagem: mesmo tamanho padrão que o cliente desenha (igual ao spawn de criatura).
  const map = { width: scene.mapWidth ?? DEFAULT_MAP_SIZE.width, height: scene.mapHeight ?? DEFAULT_MAP_SIZE.height };
  const bounds = { cols: Math.max(1, Math.ceil(map.width / cellSize)), rows: Math.max(1, Math.ceil(map.height / cellSize)) };
  const existing = await prisma.token.findMany({ where: { sceneId: scene.id, deletedAt: null } });
  const occupied: CellRect[] = existing.map((t) => cellRect(t, scene.grid));
  const start = cellAt(point, scene.grid);
  const [spot] = findFreeCells({ start, cells, count: 1, occupied, bounds });
  return cellToPoint(spot ?? start, scene.grid);
}
