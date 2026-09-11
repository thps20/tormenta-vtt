/**
 * Quem recebe cada mensagem do chat. Duas regras, aplicadas em conjunto:
 *   1. `visibility` (all | gm | self) -> messageVisibleTo (mesma de sempre).
 *   2. `tokenId` (ver docs/plano-combate.md, acréscimo de 08/09) -> quem NÃO pode ver esse
 *      token (oculto ou sob a névoa) fica de fora por completo, mesmo com visibility "all" —
 *      nem o card, nem o placeholder de "rolagem secreta". O GM nunca é bloqueado por isso
 *      (ele vê todo token); o AUTOR também nunca é bloqueado por isso — sempre recebe a própria
 *      rolagem, mesmo que o GM tenha escondido o token dele depois. O gate vale só para os
 *      demais jogadores. Usada no broadcast (emitChatMessage) e no snapshot (histórico).
 *
 * Um card de iniciativa em lote (`kind: "initiative-batch"`, combat:roll rolando vários
 * combatentes de uma vez) tem várias linhas, cada uma com o seu próprio token: aí a regra 2 vira
 * por linha em vez de pela mensagem inteira (linha de token oculto some da cópia do jogador, sem
 * derrubar as outras), e a regra 1 decide só se `formula`/`result` aparecem em cada linha, não se
 * a linha existe — ver `initiativeBatchForViewer`.
 *
 * Regra 2b, mesmo mecanismo da 2: um token cujo MAPA não é o ativo da sala também some por
 * completo para os demais jogadores (o GM pode estar preparando/rolando num mapa que a mesa não
 * vê — docs/plano-mapas.md §5 — e um jogador nunca deveria saber disso), mesmo que o próprio token
 * esteja `visible` e fora da névoa; GM e autor nunca são bloqueados por isso, igual à regra 2. Sem
 * isso, `character:roll`/`character:use-item`/`combat:roll` feitos pelo GM num mapa que não é o
 * ativo vazavam pro chat dos jogadores (o token, em si, podia estar perfeitamente visível — só o
 * mapa é que não era o que a mesa está vendo). Quando o mapa vira ativo, a mensagem volta a ser
 * entregue no próximo snapshot (`room:join`), igual à regra 2 — sem reenvio ao vivo.
 *
 * Regra 3 (`whisperTo`, §9.10 — handout:show "para X"): mesmo mecanismo de exclusão total da
 * regra 2, mas por PESSOA em vez de por token — quem não é o GM nem o participante alvo fica de
 * fora por completo (nem card, nem placeholder), independente de `visibility` (que fica "all"
 * nessas mensagens). Como só o GM publica handout, "autor sempre recebe" já vale de graça (GM
 * nunca é bloqueado por regra nenhuma aqui).
 *
 * Regra 4 (`roll.targets[]`, docs/plano-alvos.md — ataque com alvo marcado): mesma ideia da regra
 * 2/2b, mas por LINHA de alvo em vez de pela mensagem inteira (a linha some da cópia de quem não
 * vê aquele token — `rollTargetsForViewer`), MAIS uma redação por campo: `targetValue` (a Defesa
 * do alvo, por exemplo) só vai a quem é GM ou dono do token alvo; os demais veem só
 * "Acertou/Errou" (`hit`), sem o número. Como o resultado muda por pessoa, uma rolagem COM alvos
 * vira "uma cópia por participante" (mesmo mecanismo do card de iniciativa em lote), mas ainda
 * respeitando `visibility`/`tokenId`/`whisperTo` da mensagem como um todo primeiro.
 */
import { FogConfigSchema, type ChatMessage, type FogConfig, type RollTarget, type Token } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { rooms, type TypedServer } from "../socket/types.js";
import { toToken } from "./serialize.js";
import { tokenVisibleTo } from "./visibility.js";

export interface Viewer {
  role: "gm" | "player";
  participantId: string;
}

export function messageVisibleTo(msg: ChatMessage, viewer: Viewer): boolean {
  switch (msg.visibility) {
    case "all":
      return true;
    case "gm":
      return viewer.role === "gm";
    case "self":
      return msg.participantId === viewer.participantId;
  }
}

/**
 * Ids dos jogadores (nunca o GM, nunca o autor) que não podem ver o token e por isso ficam de
 * fora da mensagem — por token oculto/névoa (regra 2) OU por o token estar num mapa que não é o
 * ativo da sala (regra 2b).
 */
async function blockedPlayerIds(roomId: string, tokenId: string, authorParticipantId: string): Promise<string[]> {
  const [row, room] = await Promise.all([
    prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } }),
    prisma.room.findUnique({ where: { id: roomId }, select: { activeSceneId: true } }),
  ]);
  if (!row) return []; // token apagado: a FK já zerou tokenId na mensagem antes desta chamada acontecer de novo.
  const token = toToken(row);
  const fog = FogConfigSchema.parse(row.scene.fog ?? {});
  const inactiveScene = token.sceneId !== room?.activeSceneId;
  const players = await prisma.participant.findMany({ where: { roomId, role: "player" } });
  return players
    .filter((p) => p.id !== authorParticipantId)
    .filter((p) => inactiveScene || !tokenVisibleTo(token, { role: "player", participantId: p.id }, fog))
    .map((p) => p.id);
}

/**
 * Token + névoa da cena de cada um de `tokenIds`, pronto pra `tokenVisibleTo`. Usado pro gate por
 * linha de um card de iniciativa em lote (`initiativeBatchForViewer`) e reaproveitável pelo
 * snapshot (histórico), que já refaz essa consulta pra mensagens com `tokenId` único.
 */
export async function loadTokenInfo(tokenIds: string[]): Promise<Map<string, { token: Token; fog: FogConfig }>> {
  if (tokenIds.length === 0) return new Map();
  const rows = await prisma.token.findMany({ where: { id: { in: tokenIds } }, include: { scene: true } });
  return new Map(rows.map((t) => [t.id, { token: toToken(t), fog: FogConfigSchema.parse(t.scene.fog ?? {}) }]));
}

/**
 * Mesma regra de `blockedPlayerIds`, mas para filtrar uma lista já carregada (histórico do
 * snapshot): passa `authorParticipantId` da própria mensagem (`msg.participantId`) — o autor
 * nunca é bloqueado por essa regra, mesmo que o token dele esteja oculto ou no mapa que não é o
 * ativo agora. `activeSceneId` é reavaliado a cada chamada (mapa da sala AGORA, não quando a
 * mensagem foi criada) — é assim que uma mensagem represada volta a aparecer sozinha quando o
 * mapa dela vira o ativo (no próximo snapshot).
 */
export function tokenGateOk(
  tokenId: string | null | undefined,
  viewer: Viewer,
  authorParticipantId: string,
  tokenInfo: { token: Token; fog: FogConfig } | undefined,
  activeSceneId: string | null,
): boolean {
  if (!tokenId) return true;
  if (viewer.role === "gm") return true;
  if (viewer.participantId === authorParticipantId) return true;
  if (!tokenInfo) return true; // referência órfã (não deveria acontecer, a FK zera); não trava o resto do chat por isso.
  if (tokenInfo.token.sceneId !== activeSceneId) return false;
  return tokenVisibleTo(tokenInfo.token, { role: "player", participantId: viewer.participantId }, tokenInfo.fog);
}

/** Regra 3: sussurro visual (`whisperTo`, §9.10). GM sempre passa; jogador só se for o alvo. */
export function whisperGateOk(msg: Pick<ChatMessage, "whisperTo">, viewer: Viewer): boolean {
  if (!msg.whisperTo) return true;
  return viewer.role === "gm" || viewer.participantId === msg.whisperTo;
}

/** Ids dos jogadores (nunca o GM) que não são o alvo do sussurro e por isso ficam de fora por
 *  completo — mesmo papel de `blockedPlayerIds`, mas pra regra 3. `[]` quando não é sussurro. */
async function blockedPlayerIdsForWhisper(roomId: string, whisperTo: string | null): Promise<string[]> {
  if (!whisperTo) return [];
  const players = await prisma.participant.findMany({ where: { roomId, role: "player" } });
  return players.filter((p) => p.id !== whisperTo).map((p) => p.id);
}

/**
 * Emite `chat:message` para a sala toda: quem não pode ver o resultado recebe
 * a mesma mensagem sem `roll`/`item`/`text` (existe no chat dele, com um
 * placeholder no lugar do conteúdo) em vez de nada. Quem pode ver recebe a
 * versão completa por cima, mesmo `id` — o cliente faz upsert (igual ao
 * Revelar: `chat:reveal` chama esta função de novo com `visibility:"all"`,
 * e aí todo mundo já está na sala que recebe o conteúdo completo).
 *
 * Quando a mensagem tem `tokenId` OU `whisperTo`, quem não vê esse token/não é o alvo do sussurro
 * fica de fora de TUDO (nem o placeholder) — daí o `.except(...)` nos dois envios abaixo.
 *
 * Um card de iniciativa em lote (`kind: "initiative-batch"`) não tem um `tokenId` só: cada
 * linha cita o seu, e o gate é por linha (não pela mensagem inteira) — delega pra
 * `emitInitiativeBatchMessage`, que manda uma cópia calculada pra cada participante.
 */
export async function emitChatMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
  if (msg.kind === "initiative-batch") return emitInitiativeBatchMessage(io, roomId, msg);
  if (msg.kind === "roll" && msg.roll?.targets && msg.roll.targets.length > 0) return emitRollWithTargetsMessage(io, roomId, msg);

  const [tokenBlocked, whisperBlocked] = await Promise.all([
    msg.tokenId ? blockedPlayerIds(roomId, msg.tokenId, msg.participantId) : Promise.resolve([]),
    blockedPlayerIdsForWhisper(roomId, msg.whisperTo),
  ]);
  const blocked = [...new Set([...tokenBlocked, ...whisperBlocked])];
  const exceptRooms = blocked.map(rooms.participant);
  const withExcept = (target: ReturnType<TypedServer["to"]>) => (exceptRooms.length ? target.except(exceptRooms) : target);

  if (msg.visibility === "all") {
    withExcept(io.to(rooms.all(roomId))).emit("chat:message", msg);
    return;
  }
  withExcept(io.to(rooms.all(roomId))).emit("chat:message", redactMessage(msg));
  const visibleRoom = msg.visibility === "gm" ? rooms.gm(roomId) : rooms.participant(msg.participantId);
  withExcept(io.to(visibleRoom)).emit("chat:message", msg);
}

/**
 * Card de iniciativa em lote do ponto de vista de UM viewer: linha a linha, quem não vê o token
 * daquela linha (oculto/névoa, regra 2) OU cujo mapa não é o ativo da sala (regra 2b) fica sem
 * ela — a linha simplesmente não existe pra ele, não um placeholder (diferente do `tokenId` único
 * de cima, que bloqueia a mensagem inteira). Todo combatente de um mesmo combate está sempre no
 * mesmo mapa, então a regra 2b costuma valer (ou não) pra linha inteira de uma vez — checada por
 * linha do mesmo jeito, por simetria com a 2 e porque o token pode ter mudado de mapa depois
 * (§9.7). Nas linhas que sobram, `formula`/`result` só aparecem se `visibility` (all/gm/self)
 * permite a este viewer (mesma regra de sempre); os demais recebem só
 * `name`/`tokenId`/`combatantId` (a UI mostra "rolou"). `undefined` = nenhuma linha sobrou — o
 * viewer não recebe o card.
 */
export function initiativeBatchForViewer(
  msg: ChatMessage,
  viewer: Viewer,
  tokenInfoById: Map<string, { token: Token; fog: FogConfig }>,
  activeSceneId: string | null,
): ChatMessage | undefined {
  if (!msg.initiativeBatch) return undefined;
  const showValues = messageVisibleTo(msg, viewer);
  const entries = msg.initiativeBatch.entries
    .filter((e) => {
      const info = tokenInfoById.get(e.tokenId);
      if (!info) return true; // referência órfã: não trava (mesma regra do resto)
      if (viewer.role === "gm") return true;
      if (info.token.sceneId !== activeSceneId) return false;
      return tokenVisibleTo(info.token, viewer, info.fog);
    })
    .map((e) => (showValues ? e : { combatantId: e.combatantId, tokenId: e.tokenId, name: e.name }));
  if (entries.length === 0) return undefined;
  return { ...msg, initiativeBatch: { round: msg.initiativeBatch.round, entries } };
}

/**
 * Alvos de uma rolagem (`DiceRoll.targets[]`) do ponto de vista de UM viewer (regra 4): linha de
 * token que ele não vê (oculto/névoa) OU cujo mapa não é o ativo da sala some da lista (mesma
 * regra 2/2b de sempre — token sem info carregada, "referência órfã", não trava: passa como
 * está). Nas que sobram, `targetValue` só continua pra GM ou pro dono do token daquela linha.
 */
export function rollTargetsForViewer(
  targets: RollTarget[],
  viewer: Viewer,
  tokenInfoById: Map<string, { token: Token; fog: FogConfig }>,
  activeSceneId: string | null,
): RollTarget[] {
  return targets.flatMap((t) => {
    const info = tokenInfoById.get(t.tokenId);
    if (info && viewer.role !== "gm") {
      if (info.token.sceneId !== activeSceneId) return [];
      if (!tokenVisibleTo(info.token, viewer, info.fog)) return [];
    }
    if (viewer.role === "gm" || info?.token.ownerId === viewer.participantId || t.targetValue === undefined) return [t];
    const { targetValue: _drop, ...rest } = t;
    return [rest];
  });
}

/** Mesma regra de `rollTargetsForViewer`, mas fazendo as consultas (mapa ativo + token/névoa de
 *  cada alvo) por conta própria — usado pelo ack do AUTOR (`createRollMessage`), que é uma
 *  chamada só, ao contrário do broadcast (que já carrega isso uma vez para todos os viewers). */
export async function rollTargetsForRoomViewer(roomId: string, targets: RollTarget[], viewer: Viewer): Promise<RollTarget[]> {
  if (targets.length === 0) return targets;
  const [room, tokenInfoById] = await Promise.all([
    prisma.room.findUnique({ where: { id: roomId }, select: { activeSceneId: true } }),
    loadTokenInfo(targets.map((t) => t.tokenId)),
  ]);
  return rollTargetsForViewer(targets, viewer, tokenInfoById, room?.activeSceneId ?? null);
}

/**
 * Rolagem com alvos (regra 4): mesmo desenho de `emitInitiativeBatchMessage` (uma cópia por
 * participante), mas por cima da regra normal de `tokenId`/`whisperTo`/`visibility` — a rolagem em
 * si continua ligada ao token de QUEM ROLOU (o atacante), não aos alvos.
 */
async function emitRollWithTargetsMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
  const targets = msg.roll?.targets ?? [];
  const [tokenBlocked, whisperBlocked, room, participants, tokenInfoById] = await Promise.all([
    msg.tokenId ? blockedPlayerIds(roomId, msg.tokenId, msg.participantId) : Promise.resolve([]),
    blockedPlayerIdsForWhisper(roomId, msg.whisperTo),
    prisma.room.findUnique({ where: { id: roomId }, select: { activeSceneId: true } }),
    prisma.participant.findMany({ where: { roomId } }),
    loadTokenInfo(targets.map((t) => t.tokenId)),
  ]);
  const blocked = new Set([...tokenBlocked, ...whisperBlocked]);
  for (const p of participants) {
    if (blocked.has(p.id)) continue;
    const viewer: Viewer = { role: p.role === "gm" ? "gm" : "player", participantId: p.id };
    const view = messageVisibleTo(msg, viewer)
      ? { ...msg, roll: { ...msg.roll!, targets: rollTargetsForViewer(targets, viewer, tokenInfoById, room?.activeSceneId ?? null) } }
      : redactMessage(msg);
    io.to(rooms.participant(p.id)).emit("chat:message", view);
  }
}

/** Manda a cópia de `initiativeBatchForViewer` pra cada participante que tem alguma linha a ver. */
async function emitInitiativeBatchMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
  if (!msg.initiativeBatch) return;
  const [tokenInfoById, room, participants] = await Promise.all([
    loadTokenInfo([...new Set(msg.initiativeBatch.entries.map((e) => e.tokenId))]),
    prisma.room.findUnique({ where: { id: roomId }, select: { activeSceneId: true } }),
    prisma.participant.findMany({ where: { roomId } }),
  ]);
  for (const p of participants) {
    const view = initiativeBatchForViewer(msg, { role: p.role === "gm" ? "gm" : "player", participantId: p.id }, tokenInfoById, room?.activeSceneId ?? null);
    if (view) io.to(rooms.participant(p.id)).emit("chat:message", view);
  }
}

/** Tira o conteúdo (`roll`/`item`/`text`) de uma mensagem, sem checar permissão. */
export function redactMessage(msg: ChatMessage): ChatMessage {
  const { roll: _roll, item: _item, text: _text, ...rest } = msg;
  return rest;
}

/**
 * O ack do autor não pode vazar o que ele não pode ver: uma rolagem às cegas
 * volta sem `roll` (o cliente usa isso para avisar "enviada ao GM").
 */
export function redactForAuthor(msg: ChatMessage, author: Viewer): ChatMessage {
  return messageVisibleTo(msg, author) ? msg : redactMessage(msg);
}
