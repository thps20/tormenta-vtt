import { randomUUID } from "node:crypto";
import type { Participant as DbParticipant } from "@prisma/client";
import {
  DiceParseError,
  evaluateHitRule,
  multiplyFormulaDice,
  naturalD20,
  parseFormula,
  resolveTargetPlaceholder,
  rollParsed,
  rollParsedMany,
  type ChatMessage,
  type ComputedCharacter,
  type DamageComponent,
  type DiceRoll,
  type RollTarget,
  type RollVisibility,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";
import type { TypedServer } from "../socket/types.js";
import { emitChatMessage, redactForAuthor, rollTargetsForRoomViewer } from "./chatVisibility.js";
import { toChatMessage } from "./serialize.js";

/** Um alvo marcado pelo autor no momento da rolagem (docs/plano-alvos.md). */
export interface RollTargetInput {
  tokenId: string;
  name: string;
  /** null = token sem ficha vinculada (token solto): sem stat pra comparar, `hit` fica null. */
  computed: ComputedCharacter | null;
}

/**
 * Calcula `hit`/`targetValue`/`reason` de UM alvo (docs/plano-alvos.md): `attackAutoHit`/
 * `attackAutoMiss` decidem primeiro (só {natural}, T20: 20/1 natural); senão `attackHit` (compara
 * {total} com um stat do alvo). Ausência de qualquer uma das três, ou nada decidindo, devolve
 * `hit: null` — o card só lista o alvo, sem "Acertou/Errou".
 */
function computeRollTarget(def: SystemDefinition, ctx: { total: number; natural: number | null }, t: RollTargetInput): RollTarget {
  const evalCtx = { total: ctx.total, natural: ctx.natural ?? undefined };
  if (def.rolls.attackAutoHit && evaluateHitRule(def.rolls.attackAutoHit, evalCtx)?.hit) {
    return { tokenId: t.tokenId, name: t.name, hit: true, reason: "auto-hit" };
  }
  if (def.rolls.attackAutoMiss && evaluateHitRule(def.rolls.attackAutoMiss, evalCtx)?.hit) {
    return { tokenId: t.tokenId, name: t.name, hit: false, reason: "auto-miss" };
  }
  if (def.rolls.attackHit) {
    const resolveTarget = t.computed ? (path: string) => resolveTargetPlaceholder(t.computed!, path) : undefined;
    const result = evaluateHitRule(def.rolls.attackHit, evalCtx, resolveTarget);
    if (result) return { tokenId: t.tokenId, name: t.name, hit: result.hit, targetValue: result.targetValue, reason: "compare" };
  }
  return { tokenId: t.tokenId, name: t.name, hit: null, reason: "no-rule" };
}

/**
 * Congela `roll.targets[]` pra um card (docs/plano-alvos.md, §9.13): ataque (sozinho ou combinado
 * com dano) avalia acerto de verdade contra `attackCtx` (o total/natural do ATAQUE); dano avulso
 * (sem ataque) só lista quem foi mirado, `hit` sempre `null` — não há total de ataque pra comparar,
 * mas o "Aplicar" do card já sabe quem pré-selecionar, mesmo que quem for aplicar não seja quem
 * rolou. Pura, sem RNG nem I/O: fácil de testar isolada da rolagem de verdade.
 */
export function buildRollTargets(
  inputTargets: RollTargetInput[] | undefined,
  opts: { isAttack: boolean; hasDamage: boolean; def?: SystemDefinition; attackCtx: { total: number; natural: number | null } },
): RollTarget[] {
  if (!inputTargets?.length) return [];
  if (opts.isAttack && opts.def) return inputTargets.map((t) => computeRollTarget(opts.def!, opts.attackCtx, t));
  if (opts.hasDamage) return inputTargets.map((t): RollTarget => ({ tokenId: t.tokenId, name: t.name, hit: null, reason: "no-rule" }));
  return [];
}

/**
 * Crítico CONFIRMADO ao "Rolar dano junto com o ataque" (SPEC §9.13): o natural do d20 do ataque
 * precisa estar na margem (`natural >= critThreshold`) E `def.rolls.critical` precisa confirmar
 * (ausente = nunca confirma sozinho — o card só marca "possível crítico"). Pura, sem RNG.
 */
export function confirmCritical(def: SystemDefinition | undefined, natural: number | null, critThreshold: number | undefined): boolean {
  if (natural === null || critThreshold === undefined || natural < critThreshold) return false;
  const rule = def?.rolls.critical;
  if (!rule) return false;
  return evaluateHitRule(rule, { natural })?.hit === true;
}

export interface RollMessageInput {
  /** Fórmula já sem placeholders. */
  formula: string;
  label?: string;
  /** Modo de rolagem (all | gm | self). */
  visibility: RollVisibility;
  /** Rolagem vinda de uma ficha. */
  characterId?: string;
  critThreshold?: number;
  /**
   * Multiplicador de dano em crítico confirmado (`action.critMult`, SPEC §9.13 — "Rolar dano junto
   * com o ataque"). Só tem efeito quando `isAttack` e `damage` vêm juntos: o natural do d20 desta
   * rolagem precisa cair em `critThreshold`, e `def.rolls.critical` precisa confirmar (ausente = só
   * marca `criticalConfirmed: false`, "possível crítico", sem multiplicar nada).
   */
  critMult?: number;
  /** Dano fixo ("2") é uma "rolagem" sem dado; no chat (/r) continua exigindo dado. */
  allowNoDice?: boolean;
  /** Parcelas de dano por tipo (ação de dano da ficha): cada uma é rolada em separado e `formula` é ignorada. */
  damage?: DamageComponent[];
  /**
   * Token ao qual esta rolagem está ligada (combatente de combat:roll, ou personagem com
   * token vinculado na cena ativa). Quem não vê esse token não recebe a mensagem, nem
   * placeholder, independente de `visibility` (ver services/chatVisibility.ts).
   */
  tokenId?: string;
  /**
   * Alvos marcados pelo autor (docs/plano-alvos.md): ações de ATAQUE (`isAttack`, sozinhas ou com
   * `damage` junto — §9.13) constroem `roll.targets[]` com acerto/erro calculado contra
   * `attackHit`/`attackAutoHit`/`attackAutoMiss`; uma ação de DANO avulsa (sem `isAttack`) também
   * congela a lista, mas sem avaliar acerto (`hit: null` em todas — não há total de ataque pra
   * comparar), só para o "Aplicar" do card pré-selecionar quem foi mirado, mesmo que quem abrir o
   * seletor depois não seja quem rolou (e não compartilhe os alvos AO VIVO dele). `def` é exigido
   * para a variante com acerto: sem ele os alvos de ataque saem sem `hit` calculado.
   */
  targets?: RollTargetInput[];
  isAttack?: boolean;
  def?: SystemDefinition;
  /**
   * Sussurro pontual desta rolagem (docs/plano-narracao.md, seletor "para" do chat): só GM e este
   * participantId recebem — mesmo campo/gate de `ChatMessage.whisperTo` que já existia só para
   * handout:show (services/chatVisibility.ts). null/ausente = sem sussurro, regra normal de
   * `visibility`.
   */
  whisperTo?: string | null;
}

export interface RollMessageResult {
  /** Mensagem como o autor pode vê-la (às cegas = sem `roll`). */
  message: ChatMessage;
  /** Total real (o servidor sempre sabe, mesmo numa rolagem às cegas) — usado pelo combate para gravar Combatant.initiative. */
  total: number;
}

/**
 * Rola NO SERVIDOR, persiste como ChatMessage{kind:"roll"} e faz o broadcast
 * conforme a visibilidade. Usado pelo chat (/r, /gmr, /pr), pela ficha (character:roll)
 * e pelo combate (combat:roll).
 */
export async function createRollMessage(io: TypedServer, roomId: string, me: DbParticipant, input: RollMessageInput): Promise<RollMessageResult> {
  const hasDamage = !!input.damage && input.damage.length > 0;
  let outcome;
  let damage: DiceRoll["damage"];
  let criticalConfirmed = false;
  let attackNatural: number | null = null;
  try {
    // 1. Ataque/teste/fórmula solta: roda sempre que a rolagem NÃO for dano puro — isso cobre o
    // ataque sozinho de sempre E o combinado ("Rolar dano junto com o ataque", SPEC §9.13), onde o
    // d20 do ataque vira o total/groups do card e o dano fica à parte, em `damage[]`.
    if (input.isAttack || !hasDamage) {
      outcome = rollParsed(parseFormula(input.formula, { requireDice: !input.allowNoDice }));
      if (input.isAttack) attackNatural = naturalD20(outcome.groups);
    }
    if (hasDamage) {
      // Crítico (§9.13): só existe pra avaliar quando o dano está sendo rolado JUNTO com um ataque
      // — dano avulso não tem d20 nenhum pra checar margem. Confirmado → multiplica os DADOS de
      // cada parcela por `critMult` antes de rolar.
      criticalConfirmed = input.isAttack ? confirmCritical(input.def, attackNatural, input.critThreshold) : false;
      const mult = criticalConfirmed && input.critMult && input.critMult > 1 ? input.critMult : 1;
      // Uma parcela por tipo de dano: rolar em separado dá o total de cada tipo para o chat.
      const multi = rollParsedMany(input.damage!.map((d) => parseFormula(mult > 1 ? multiplyFormulaDice(d.formula, mult) : d.formula, { requireDice: !input.allowNoDice })));
      damage = multi.parts.map((part, i) => ({ damageType: input.damage?.[i]?.damageType ?? null, ...part }));
      if (!outcome) outcome = multi; // dano avulso: o total do card É a soma das parcelas.
    }
  } catch (err) {
    if (err instanceof DiceParseError) throw new HandlerError(`Fórmula inválida: ${err.message}`);
    throw err;
  }

  // Alvos (docs/plano-alvos.md, §9.13): ataque (sozinho ou combinado com dano) avalia acerto de
  // verdade; dano avulso com alvo marcado só congela a lista, sem acerto (buildRollTargets).
  const natural = input.isAttack && input.targets?.length ? attackNatural : null;
  const targets = buildRollTargets(input.targets, { isAttack: !!input.isAttack, hasDamage, def: input.def, attackCtx: { total: outcome!.total, natural } });

  const diceRoll: DiceRoll = {
    id: randomUUID(),
    roomId,
    participantId: me.id,
    nickname: me.nickname,
    formula: outcome!.formula,
    label: input.label,
    groups: outcome!.groups,
    modifier: outcome!.modifier,
    total: outcome!.total,
    characterId: input.characterId,
    critThreshold: input.critThreshold,
    criticalConfirmed,
    damage,
    applied: [],
    natural,
    targets,
    createdAt: new Date().toISOString(),
  };

  const msg = toChatMessage(
    await prisma.chatMessage.create({
      data: {
        roomId,
        participantId: me.id,
        nickname: me.nickname,
        kind: "roll",
        roll: diceRoll,
        visibility: input.visibility,
        tokenId: input.tokenId ?? null,
        whisperTo: input.whisperTo ?? null,
      },
    }),
  );

  await emitChatMessage(io, roomId, msg);
  const authorViewer = { role: me.role === "gm" ? ("gm" as const) : ("player" as const), participantId: me.id };
  let message = redactForAuthor(msg, authorViewer);
  // O ack do autor também não pode vazar targetValue que ele mesmo não veria no broadcast (regra 4
  // de chatVisibility.ts) — ex.: jogador atacando um NPC não vê a Defesa dele nem no próprio ack.
  if (targets.length > 0 && message.roll) {
    message = { ...message, roll: { ...message.roll, targets: await rollTargetsForRoomViewer(roomId, targets, authorViewer) } };
  }
  return { message, total: outcome!.total };
}

export interface InitiativeBatchEntryInput {
  combatantId: string;
  tokenId: string;
  name: string;
  /** Fórmula já sem placeholders (buildCombatantInitiativeRoll). */
  formula: string;
}

export interface InitiativeBatchRollInput {
  round: number;
  visibility: RollVisibility;
  entries: InitiativeBatchEntryInput[];
}

/**
 * Rola VÁRIOS combatentes de uma vez no servidor e publica um único
 * `ChatMessage{kind:"initiative-batch"}` (combat:roll com mais de um alvo), em vez de um card por
 * combatente. Devolve `combatantId -> total` (o servidor sempre sabe, mesmo que a visibilidade
 * esconda o valor de algum viewer) pra combat:roll gravar `Combatant.initiative`.
 */
export async function createInitiativeBatchRoll(
  io: TypedServer,
  roomId: string,
  me: DbParticipant,
  input: InitiativeBatchRollInput,
): Promise<{ results: Map<string, number> }> {
  let rolled: { entry: InitiativeBatchEntryInput; total: number }[];
  try {
    rolled = input.entries.map((entry) => ({ entry, total: rollParsed(parseFormula(entry.formula, { requireDice: false })).total }));
  } catch (err) {
    if (err instanceof DiceParseError) throw new HandlerError(`Fórmula inválida: ${err.message}`);
    throw err;
  }

  // Card mostra do maior pro menor (ordem de ação).
  const sorted = [...rolled].sort((a, b) => b.total - a.total);

  const msg = toChatMessage(
    await prisma.chatMessage.create({
      data: {
        roomId,
        participantId: me.id,
        nickname: me.nickname,
        kind: "initiative-batch",
        visibility: input.visibility,
        initiativeBatch: {
          round: input.round,
          entries: sorted.map(({ entry, total }) => ({ combatantId: entry.combatantId, tokenId: entry.tokenId, name: entry.name, formula: entry.formula, result: total })),
        },
      },
    }),
  );

  await emitChatMessage(io, roomId, msg);
  return { results: new Map(rolled.map(({ entry, total }) => [entry.combatantId, total])) };
}
