import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Modo de combate por cena (substitui o rastreador manual de iniciativa).
 * Regras (fórmula de iniciativa, desempate, surpresa) vêm de `SystemDefinition.combat`;
 * este schema é só o formato do estado, ver docs/plano-combate.md.
 *
 *   rolling -> ninguém iniciou os turnos ainda (só rolando/ajustando iniciativa)
 *   active  -> turnos correndo (round >= 1)
 *   ended   -> combate encerrado; a ordem final fica visível, sem combatente ativo
 */
export const CombatStatusSchema = z.enum(["rolling", "active", "ended"]);
export type CombatStatus = z.infer<typeof CombatStatusSchema>;

/**
 * Combatente, já preparado para o fio: nome/cor vêm do token no momento do envio
 * (nunca ficam desatualizados, nada extra vai pro banco). `initiative` e `bonus`
 * só vêm preenchidos para o GM — jogador vê apenas a ORDEM (nome, `rolled`),
 * nunca o valor numérico, nem do próprio combatente (ver docs/plano-combate.md §4).
 */
export const CombatantSchema = z.object({
  id: IdSchema,
  tokenId: IdSchema,
  characterId: IdSchema.nullable(),
  name: z.string(),
  color: z.string(),
  /** Dono do token (null = NPC sem dono). Define quem pode rolar a própria / adiar / entrar agora. */
  ownerId: IdSchema.nullable(),
  /** null = não rolou ainda, OU o viewer não pode ver o valor (jogador). */
  initiative: z.number().nullable(),
  /** Já rolou (mesmo que o viewer não veja o valor)? Separado de `initiative` para não vazar número. */
  rolled: z.boolean(),
  /** Bônus de desempate (fórmula combat.tiebreakBonus, ou digitado pelo GM). Só o GM recebe. */
  bonus: z.number().nullable(),
  delayed: z.boolean(),
  surprised: z.boolean(),
  /** Ordem manual do GM (desempate final, e posição de quem ainda não rolou). Renumerada 0..n-1. */
  order: z.number().int(),
  /** Rodada em que entrou (reforço). 0 = entrou junto com combat:start. */
  addedRound: z.number().int(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

export const CombatSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  round: z.number().int().min(0),
  status: CombatStatusSchema,
  /** Combatente da vez. null = ninguém agindo (rolando iniciativa, ou combate encerrado). */
  activeCombatantId: IdSchema.nullable(),
  /** Já ordenados pelo servidor (sortCombatants) e filtrados pela visibilidade do destinatário. */
  combatants: z.array(CombatantSchema),
});
export type Combat = z.infer<typeof CombatSchema>;
