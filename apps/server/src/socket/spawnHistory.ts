import { type Character, type SystemDefinition, type Token } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { broadcastCharacter, characterDataOf, toCharacter, toJson } from "../services/characters.js";
import { emitCombat } from "../services/combat.js";
import { toScene, toToken } from "../services/serialize.js";
import { sceneGeometry } from "../services/grid.js";
import type { HistoryEntry } from "../services/history.js";
import { adjustCombatForTokenRemoval, broadcastToken, hpJson } from "./token.js";
import { rooms, type TypedServer } from "./types.js";

/**
 * Entrada de histórico de uma soltura em lote (N `Character`+`Token` criados numa transação só):
 * desfazer com HARD delete (§9.6 — cópias recém-criadas, sem histórico próprio ainda), refazer
 * recria as MESMAS linhas (mesmos ids) a partir do snapshot capturado na hora do spawn. Usada tanto
 * por `compendium:spawn-creature` (uma criatura, N cópias) quanto por `encounter:spawn` (várias
 * criaturas do encontro, uma entrada de undo só) — só o `summary` e a origem de `results` mudam.
 *
 * `character: null` = só o token nasceu nesta ação, a ficha já existia antes ("Colocar no mapa",
 * §9.30): aí desfazer apaga só o token e refazer recria só o token — a ficha, que é a prateleira do
 * personagem, nunca entra no undo de uma colocação no mapa.
 */
export function buildMultiSpawnHistoryEntry(
  io: TypedServer,
  roomId: string,
  sceneId: string,
  def: SystemDefinition,
  summary: string,
  results: { character: Character | null; token: Token }[],
): HistoryEntry {
  return {
    summary,
    async revert() {
      // Um token spawnado pode ter entrado num combate depois (combat:add, manual — spawn nunca
      // entra sozinho, §9.5/§9.14): mesmo ajuste de round/activeCombatantId/order de sempre ANTES do
      // hard delete (o snapshot devolvido não serve pra nada aqui — não tem "restaurar" num hard
      // delete, só evita o combate ficar com um combatente fantasma).
      let combatAffected = false;
      for (const { token } of results) {
        if (await adjustCombatForTokenRemoval(def, token.sceneId, token.id)) combatAffected = true;
      }
      const tokenIds = results.map((r) => r.token.id);
      const characterIds = results.map((r) => r.character?.id).filter((id): id is string => id !== undefined);
      await prisma.token.deleteMany({ where: { id: { in: tokenIds } } });
      if (characterIds.length > 0) await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      for (const { token, character } of results) {
        io.to(rooms.all(roomId)).emit("token:deleted", { tokenId: token.id });
        // Mesmo padrão de character:delete (socket/character.ts): broadcast geral, sem vazar nada
        // (é só o id) — jogador nunca teve o NPC no cache, então o remove() dele é um no-op.
        if (character) io.to(rooms.all(roomId)).emit("character:deleted", { characterId: character.id });
      }
      if (combatAffected) await emitCombat(io, roomId, sceneId, { role: "gm", participantId: "" });
    },
    async apply() {
      const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
      const geom = sceneGeometry(toScene(scene));
      for (const { character, token } of results) {
        if (character) {
          const characterRow = await prisma.character.create({
            data: {
              id: character.id,
              roomId: character.roomId,
              ownerId: character.ownerId,
              name: character.name,
              kind: character.kind,
              data: toJson(characterDataOf(character)),
            },
          });
          broadcastCharacter(io, roomId, toCharacter(characterRow), "character:created");
        }
        const tokenRow = await prisma.token.create({
          data: {
            id: token.id,
            sceneId: token.sceneId,
            name: token.name,
            imageUrl: token.imageUrl,
            x: token.x,
            y: token.y,
            cells: token.cells,
            rotation: token.rotation,
            zIndex: token.zIndex,
            visible: token.visible,
            ownerId: token.ownerId,
            color: token.color,
            characterId: token.characterId,
            hp: hpJson(token.hp),
            conditions: token.conditions,
          },
        });
        broadcastToken(io, roomId, toToken(tokenRow), "token:created", geom);
      }
    },
  };
}
