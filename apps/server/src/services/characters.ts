import type { Character as DbCharacter } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { CharacterSchema, getSystemDefinition, type Character, type CharacterData, type CharacterKind, type SystemDefinition } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError, type Ctx } from "../socket/ack.js";
import { rooms, type TypedServer } from "../socket/types.js";

/** Carrega o sistema da sala (JSON validado por SystemDefinitionSchema). */
export async function requireSystem(roomId: string): Promise<SystemDefinition> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new HandlerError("Sala não encontrada");
  return getSystemDefinition(room.systemId);
}

/**
 * Linha do Prisma -> Character do shared. As colunas vencem o que estiver
 * dentro de `data` (se um JSON antigo carregar chaves repetidas).
 * Passar pelo Zod na saída garante que um JSON gravado por uma versão
 * antiga ganhe os defaults novos em vez de quebrar o cliente.
 */
export function toCharacter(row: DbCharacter): Character {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return CharacterSchema.parse({
    ...data,
    id: row.id,
    roomId: row.roomId,
    ownerId: row.ownerId,
    name: row.name,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Só o conteúdo que vai na coluna `data` (sem as colunas próprias). */
export function characterDataOf(character: Character): CharacterData {
  const { id: _id, roomId: _room, ownerId: _owner, name: _name, kind: _kind, createdAt: _c, updatedAt: _u, ...data } = character;
  return data;
}

export function toJson(data: CharacterData): Prisma.InputJsonValue {
  return data as unknown as Prisma.InputJsonValue;
}

/** Jogador só vê fichas de personagem-jogador; NPCs são do GM. */
export function characterVisibleTo(character: Pick<Character, "kind">, role: "gm" | "player"): boolean {
  return role === "gm" || character.kind === "pc";
}

/** GM pode tudo; jogador só mexe na ficha que possui. */
export function canEditCharacter(ctx: Ctx, character: Pick<Character, "ownerId">): boolean {
  return ctx.role === "gm" || (character.ownerId !== null && character.ownerId === ctx.participantId);
}

/** Carrega a ficha e confirma que é desta sala. */
export async function requireCharacter(characterId: string, roomId: string): Promise<DbCharacter> {
  const row = await prisma.character.findUnique({ where: { id: characterId } });
  if (!row || row.roomId !== roomId) throw new HandlerError("Ficha não encontrada");
  return row;
}

/**
 * Token vinculado a esta ficha (qualquer mapa da sala, não só o ativo). Usado só para saber a que
 * `tokenId` uma rolagem de ficha (character:roll / character:use-item) fica ligada — quem não vê
 * esse token, OU cujo mapa não é o ativo da sala, não recebe a mensagem (ver
 * services/chatVisibility.ts, regras 2/2b). Prefere o token da cena ativa quando existe (o caso
 * comum); sem um lá, cai pra qualquer outro mapa em vez de devolver `undefined` — voltar
 * `undefined` faria a rolagem virar uma mensagem "solta" sem `tokenId`, sem gate nenhum, vazando
 * pros jogadores mesmo com o GM olhando/rolando num mapa que a mesa não vê. Se o personagem tiver
 * mais de um token (incomum; nada no MVP impede), pega o primeiro encontrado em cada busca.
 */
export async function findLinkedTokenId(characterId: string, roomId: string): Promise<string | undefined> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  const activeToken = room?.activeSceneId
    ? await prisma.token.findFirst({ where: { characterId, sceneId: room.activeSceneId, deletedAt: null } })
    : null;
  if (activeToken) return activeToken.id;
  const anyToken = await prisma.token.findFirst({ where: { characterId, deletedAt: null } });
  return anyToken?.id;
}

/**
 * Broadcast respeitando visibilidade: GM sempre; jogadores só se for PC.
 * Se a ficha deixou de ser PC (virou NPC), jogadores recebem character:deleted.
 */
export function broadcastCharacter(
  io: TypedServer,
  roomId: string,
  character: Character,
  event: "character:created" | "character:updated",
  previousKind?: CharacterKind,
): void {
  io.to(rooms.gm(roomId)).emit(event, character);
  if (character.kind === "pc") io.to(rooms.players(roomId)).emit(event, character);
  else if (previousKind === "pc") io.to(rooms.players(roomId)).emit("character:deleted", { characterId: character.id });
}
