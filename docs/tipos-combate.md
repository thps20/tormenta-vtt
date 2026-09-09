# Tipos do modo de combate

Bloco único, sem imports, para colar em outra ferramenta. Reflete o formato real de
`packages/shared/src/schemas/combat.ts` e os callbacks do painel (`InitiativeTab`/`CombatActions`
em `apps/web/src/components/InitiativeTab.tsx`) — `onSkip` é o único que não tem evento de socket
próprio na implementação atual (fica como espaço reservado).

```ts
// --- Tipos -------------------------------------------------------------

type CombatStatus = "rolling" | "active" | "ended";

interface Combatant {
  id: string;
  tokenId: string;
  /** Cópia do token no momento em que entrou no combate; só informativa. */
  characterId: string | null;
  /** Denormalizados do token no momento do envio (nunca ficam desatualizados). */
  name: string;
  color: string;
  /** Dono do token. null = NPC sem dono. */
  ownerId: string | null;
  /** null = não rolou ainda, OU você não pode ver o valor (não é seu combatente, ou rolou às cegas). */
  initiative: number | null;
  /** Já rolou (mesmo que você não veja o valor)? Separado de `initiative` pra não vazar número. */
  rolled: boolean;
  /** Mesma regra de visibilidade de `initiative`. */
  bonus: number | null;
  delayed: boolean;
  surprised: boolean;
  /** Ordem manual (desempate final / posição de quem ainda não rolou). */
  order: number;
  /** Rodada em que entrou (reforço). 0 = entrou junto com o início do combate. */
  addedRound: number;
}

interface Combat {
  id: string;
  sceneId: string;
  round: number;
  status: CombatStatus;
  /** Combatente da vez. null = ninguém agindo (rolando iniciativa, ou combate encerrado). */
  activeCombatantId: string | null;
  /** Já vem ordenado e filtrado pelo servidor para quem recebeu este objeto. */
  combatants: Combatant[];
}

// --- Callbacks do painel -------------------------------------------------

interface CombatPanelCallbacks {
  /** GM seleciona tokens e inicia o combate na cena. */
  onStart: (sceneId: string, tokenIds: string[]) => void;
  /** scope "self" = os seus que faltam; "one" = um específico; "npcs"/"missing" = só GM. */
  onRoll: (scope: "self" | "one" | "npcs" | "missing", combatantId?: string, visibility?: "all" | "gm" | "self") => void;
  /** Valor digitado à mão pelo GM; initiative null volta pra "não rolou". */
  onSetInitiative: (combatantId: string, initiative: number | null, bonus?: number) => void;
  onNext: () => void;
  onPrev: () => void;
  /** Nova ordem manual completa (arrastar na lista). */
  onReorder: (combatantIds: string[]) => void;
  /** Reforços: entram sem iniciativa, no fim da ordem. */
  onAdd: (tokenIds: string[]) => void;
  onRemove: (combatantIds: string[]) => void;
  /** Só no próprio turno: sai da rotação até "entrar agora" (onResume). */
  onDelay: (combatantId: string) => void;
  onResume: (combatantId: string) => void;
  /** Pular o turno sem adiar — não tem evento de socket próprio hoje, reservado pro painel. */
  onSkip: (combatantId: string) => void;
  onSetSurprised: (combatantId: string, surprised: boolean) => void;
  /** clear=false: encerra mas mantém a ordem visível; clear=true: apaga o combate. */
  onEnd: (clear?: boolean) => void;
}

// --- Exemplo: rodada 2, turno no 3º, 2 sem iniciativa, 1 adiado, 1 surpreso ---
//
// Ordem (a mesma para os dois, GM e jogador — só o conteúdo numérico muda):
//   1. Kael            iniciativa 22
//   2. Ithara          iniciativa 17
//   3. Goblin batedor  iniciativa 14, surpreso    <- turno atual (activeCombatantId)
//   4. Brakko          iniciativa 9,  adiado
//   5. Goblin arqueiro sem iniciativa (reforço da rodada 0)
//   6. Chefe goblin    sem iniciativa (reforço entrou na rodada 1)

/** Como o GM recebe: todos os valores visíveis. */
const exampleCombatAsGm: Combat = {
  id: "combat_1",
  sceneId: "scene_1",
  round: 2,
  status: "active",
  activeCombatantId: "cbt_3",
  combatants: [
    { id: "cbt_1", tokenId: "tok_1", characterId: "char_1", name: "Kael", color: "#e11d48", ownerId: "part_1", initiative: 22, rolled: true, bonus: 4, delayed: false, surprised: false, order: 0, addedRound: 0 },
    { id: "cbt_2", tokenId: "tok_2", characterId: "char_2", name: "Ithara", color: "#2563eb", ownerId: "part_2", initiative: 17, rolled: true, bonus: 3, delayed: false, surprised: false, order: 1, addedRound: 0 },
    { id: "cbt_3", tokenId: "tok_3", characterId: null, name: "Goblin batedor", color: "#16a34a", ownerId: null, initiative: 14, rolled: true, bonus: 1, delayed: false, surprised: true, order: 2, addedRound: 0 },
    { id: "cbt_4", tokenId: "tok_4", characterId: "char_3", name: "Brakko", color: "#d4af37", ownerId: "part_3", initiative: 9, rolled: true, bonus: 0, delayed: true, surprised: false, order: 3, addedRound: 0 },
    { id: "cbt_5", tokenId: "tok_5", characterId: null, name: "Goblin arqueiro", color: "#16a34a", ownerId: null, initiative: null, rolled: false, bonus: 0, delayed: false, surprised: false, order: 4, addedRound: 0 },
    { id: "cbt_6", tokenId: "tok_6", characterId: null, name: "Chefe goblin", color: "#7c3aed", ownerId: null, initiative: null, rolled: false, bonus: 0, delayed: false, surprised: false, order: 5, addedRound: 1 },
  ],
};

/** Como um jogador recebe (dono de "Ithara", cbt_2): vê a ORDEM de todo mundo, mas o valor
 *  numérico (initiative/bonus) só do PRÓPRIO combatente — e mesmo assim não se a última
 *  rolagem dele tivesse sido às cegas (não é o caso aqui). Dos demais, sempre null. */
const exampleCombatAsPlayer: Combat = {
  id: "combat_1",
  sceneId: "scene_1",
  round: 2,
  status: "active",
  activeCombatantId: "cbt_3",
  combatants: [
    { id: "cbt_1", tokenId: "tok_1", characterId: "char_1", name: "Kael", color: "#e11d48", ownerId: "part_1", initiative: null, rolled: true, bonus: null, delayed: false, surprised: false, order: 0, addedRound: 0 },
    { id: "cbt_2", tokenId: "tok_2", characterId: "char_2", name: "Ithara", color: "#2563eb", ownerId: "part_2", initiative: 17, rolled: true, bonus: 3, delayed: false, surprised: false, order: 1, addedRound: 0 },
    { id: "cbt_3", tokenId: "tok_3", characterId: null, name: "Goblin batedor", color: "#16a34a", ownerId: null, initiative: null, rolled: true, bonus: null, delayed: false, surprised: true, order: 2, addedRound: 0 },
    { id: "cbt_4", tokenId: "tok_4", characterId: "char_3", name: "Brakko", color: "#d4af37", ownerId: "part_3", initiative: null, rolled: true, bonus: null, delayed: true, surprised: false, order: 3, addedRound: 0 },
    { id: "cbt_5", tokenId: "tok_5", characterId: null, name: "Goblin arqueiro", color: "#16a34a", ownerId: null, initiative: null, rolled: false, bonus: null, delayed: false, surprised: false, order: 4, addedRound: 0 },
    { id: "cbt_6", tokenId: "tok_6", characterId: null, name: "Chefe goblin", color: "#7c3aed", ownerId: null, initiative: null, rolled: false, bonus: null, delayed: false, surprised: false, order: 5, addedRound: 1 },
  ],
};
```
