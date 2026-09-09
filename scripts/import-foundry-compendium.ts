/**
 * Importa os packs do sistema Tormenta20 para Foundry (fonte YAML em
 * packs/_source) e gera os arquivos do nosso compêndio em
 * packages/shared/systems/tormenta20/compendium/.
 *
 *   pnpm import:compendium [--with-descriptions] [--source <dir>] [--system <id>]
 *
 * Regras (ver docs/plano-importador.md):
 * - Só mecânica vai para o repositório. Descrições só com --with-descriptions,
 *   em descriptions.local.json (ignorado pelo git).
 * - O que não tem correspondência vira TODO em scripts/import-report.md; nada
 *   é inventado.
 * - Idempotente: ids derivados do nome, saída ordenada, sem timestamps.
 * - custom.json é editado à mão e nunca é tocado; ids que existam lá são
 *   pulados aqui (e o loader ainda dá precedência a custom.json).
 * - Toda entrada é validada com o Zod + validateCompendiumEntry; qualquer
 *   entrada inválida faz o script falhar.
 *
 * Nada aqui referencia chave concreta do NOSSO sistema ("for", "luta"): os
 * mapas abaixo traduzem chaves do FOUNDRY para as opções declaradas no JSON do
 * sistema, e o script confere que cada opção existe.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CUSTOM_FILE, DESCRIPTIONS_FILE, compendiumDir, enhancementTextKey, readCompendiumFile, validateCompendiumEntries } from "../packages/shared/src/compendium/index.js";
import { parseFormula } from "../packages/shared/src/dice/index.js";
import { saveSkills } from "../packages/shared/src/rules/activation.js";
import type { ActionTemplate, Activation, EnhancementEffect, Save, SkillGrantsValue } from "../packages/shared/src/schemas/character.js";
import type { CompendiumItemEntry } from "../packages/shared/src/schemas/compendium.js";
import type { ItemKindDef, SystemDefinition } from "../packages/shared/src/schemas/system.js";
import { getSystemDefinition } from "../packages/shared/src/systems.js";

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

interface Options {
  source: string;
  systemId: string;
  withDescriptions: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    source: join(homedir(), "projetos", "foundry-tormenta20", "packs", "_source"),
    systemId: "tormenta20",
    withDescriptions: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--with-descriptions") opts.withDescriptions = true;
    else if (arg === "--source") opts.source = resolve(argv[++i] ?? "");
    else if (arg === "--system") opts.systemId = argv[++i] ?? opts.systemId;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Leitura dos packs
// ---------------------------------------------------------------------------

/** Documento do Foundry como vem do YAML. Só os campos que usamos são tipados. */
interface FoundryDoc {
  _id: string;
  name: string;
  type: string;
  system: Record<string, unknown>;
  effects: FoundryEffect[];
  /** Pack (primeira pasta) e caminho relativo dentro dele. */
  pack: string;
  path: string;
}

interface FoundryEffect {
  name?: string;
  changes?: unknown[];
  /** onuse+self = aprimoramento do próprio item (é o filtro do diálogo de uso do Foundry); aumenta = "Múltiplas Aplicações". */
  flags?: { tormenta20?: { custo?: string | number; aumenta?: boolean; onuse?: boolean; self?: boolean } };
}

/** Packs que ficam fora do compêndio de personagem (criaturas, convocações, macros, tabelas, journals). */
const SKIPPED_PACKS: Record<string, string> = {
  ameacas: "criaturas (NPCs)",
  basico: "journals de condições e perícias",
  convocacoes: "criaturas convocadas",
  "habilidades-de-criaturas": "habilidades e armas naturais de criaturas",
  macros: "macros",
  parceiros: "parceiros (regra de NPC)",
  "tabelas-de-tesouro": "tabelas de rolagem",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".yml") && name !== "_folder.yml") out.push(full);
  }
  return out;
}

function readPacks(source: string): FoundryDoc[] {
  if (!existsSync(source)) throw new Error(`Pasta de packs não encontrada: ${source}`);
  const docs: FoundryDoc[] = [];
  for (const file of walk(source)) {
    const raw = parseYaml(readFileSync(file, "utf-8")) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || typeof raw.type !== "string" || typeof raw.system !== "object") continue;
    const rel = relative(source, file);
    docs.push({
      _id: String(raw._id ?? ""),
      name: String(raw.name ?? ""),
      type: raw.type,
      system: (raw.system ?? {}) as Record<string, unknown>,
      effects: Array.isArray(raw.effects) ? (raw.effects as FoundryEffect[]) : [],
      pack: rel.split("/")[0] ?? "",
      path: rel,
    });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Sem acento, minúsculo, espaços normalizados: base para comparar rótulos e gerar ids. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slug(s: string): string {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Primeiro número depois de "p." em `source` ("Tormenta20 — Edição Jogo do Ano, p. 148"). */
function pageOf(source: string): number | null {
  const m = /\bp\.\s*(\d+)/i.exec(source);
  return m ? Number(m[1]) : null;
}

const capitalize = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

class Report {
  readonly generated = new Map<string, number>();
  readonly skippedPacks = new Map<string, number>();
  readonly skippedTypes = new Map<string, number>();
  readonly effectsIgnored = new Map<string, number>();
  readonly replacedByCustom: string[] = [];
  readonly collisions: string[] = [];
  /** Categoria → linhas "`id`: detalhe". */
  readonly todos = new Map<string, string[]>();
  readonly notes: string[] = [];
  descriptions = 0;
  descriptionsEmpty: string[] = [];
  /** Aprimoramentos gerados (entradas com pelo menos um, total, repetíveis) e o que ficou só como texto. */
  enhancementEntries = 0;
  enhancements = 0;
  enhancementsRepeatable = 0;
  cantrips = 0;
  /** Effects `onuse` sem `self` (aprimoramentos que um poder concede a OUTRAS magias/ataques): fora do modelo. */
  grantedEffects = 0;
  /** Efeitos mecânicos preenchidos por padrão estrito, por tipo. */
  readonly effectsByKind = new Map<string, number>();
  /** Aprimoramentos SEM efeito mecânico (texto fora dos padrões), por categoria → "`id#eN`: texto". */
  readonly noEffect = new Map<string, string[]>();

  todo(category: string, id: string, detail: string): void {
    const list = this.todos.get(category) ?? [];
    list.push(`\`${id}\`: ${detail}`);
    this.todos.set(category, list);
  }

  bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  render(opts: Options, sourceVersion: string): string {
    const lines: string[] = [];
    const table = (map: Map<string, number>) => [...map.entries()].sort().map(([k, v]) => `| ${k} | ${v} |`);
    lines.push("# Relatório da importação do compêndio (Foundry → tormenta-vtt)");
    lines.push("");
    lines.push(`Gerado por \`scripts/import-foundry-compendium.ts\` a partir de \`${opts.source}\` (system.json ${sourceVersion}).`);
    lines.push("Este arquivo é regenerado a cada execução; não edite à mão. Plano e decisões em `docs/plano-importador.md`.");
    lines.push("");
    lines.push("## Entradas geradas por arquivo");
    lines.push("");
    lines.push("| Arquivo | Entradas |", "|---|---|", ...table(this.generated));
    lines.push("");
    lines.push("## Fora do escopo");
    lines.push("");
    lines.push("Packs ignorados de propósito (criaturas, convocações, macros, tabelas, journals):");
    lines.push("");
    lines.push("| Pack | Documentos |", "|---|---|", ...table(this.skippedPacks));
    lines.push("");
    if (this.skippedTypes.size > 0) {
      lines.push("Documentos de tipo sem mapeamento dentro dos packs importados:");
      lines.push("");
      lines.push("| Tipo | Documentos |", "|---|---|", ...table(this.skippedTypes));
      lines.push("");
    }
    lines.push("## Regras aplicadas (decisões do dono do projeto)");
    lines.push("");
    for (const n of this.notes) lines.push(`- ${n}`);
    lines.push("");
    lines.push(
      `Aprimoramentos (effects \`onuse\`+\`self\`): ${this.enhancements} em ${this.enhancementEntries} entradas, ${this.enhancementsRepeatable} repetíveis (\`aumenta\`); ` +
        `${this.cantrips} truques (custo vazio em magia, só na descrição); ${this.grantedEffects} effects \`onuse\` sem \`self\` não modelados (aprimoramentos concedidos a outras magias/ataques, ex.: Familiar Coruja).`,
    );
    lines.push("");
    const kinds = [...this.effectsByKind.entries()].sort().map(([k, n]) => `${n} \`${k}\``).join(", ") || "nenhum";
    lines.push(
      `Efeito mecânico preenchido só quando o texto inteiro casa um padrão estrito ("aumenta o dano em +XdY", "+XdY de dano", "muda o dano para XdY", "aumenta a cura em +XdY", "aumenta a CD em +N", "muda o alcance para <unidade>", "muda a duração para [N] <unidade>", "muda a área para <texto>", "aumenta o número de alvos em +N"): ${kinds}. Frases compostas ("muda o alcance para médio e a duração para cena") e os demais ficam como só custo e estão listados por categoria no fim deste relatório.`,
    );
    lines.push("");
    lines.push("Efeitos ativos (`effects[]` com `changes`) são ignorados de propósito; só a contagem:");
    lines.push("");
    lines.push("| Tipo Foundry | Documentos com efeitos |", "|---|---|", ...table(this.effectsIgnored));
    lines.push("");
    lines.push("## Substituídos por custom.json");
    lines.push("");
    lines.push("Ids que existem em `custom.json` (confirmados no livro) e por isso não foram gerados:");
    lines.push("");
    for (const id of this.replacedByCustom.sort()) lines.push(`- \`${id}\``);
    lines.push("");
    if (this.collisions.length > 0) {
      lines.push("## Colisões de id");
      lines.push("");
      lines.push("Nomes repetidos; o id ganhou sufixo (subtipo ou id do Foundry):");
      lines.push("");
      for (const c of this.collisions.sort()) lines.push(`- ${c}`);
      lines.push("");
    }
    lines.push("## TODO (sem correspondência no Foundry ou fora dos nossos enums)");
    lines.push("");
    lines.push(`Total: ${[...this.todos.values()].reduce((n, l) => n + l.length, 0)} pendências em ${this.todos.size} categorias.`);
    lines.push("");
    for (const [category, items] of [...this.todos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`### ${category} (${items.length})`);
      lines.push("");
      for (const item of items.sort()) lines.push(`- ${item}`);
      lines.push("");
    }
    if (this.noEffect.size > 0) {
      const total = [...this.noEffect.values()].reduce((n, l) => n + l.length, 0);
      lines.push("## Aprimoramentos sem efeito mecânico (por categoria)");
      lines.push("");
      lines.push(`${total} aprimoramentos ficaram como só custo (\`effect\` ausente) porque o texto não casa nenhum padrão estrito. Não entram no total de TODO; o jogador pode completar o efeito na ficha (modo edição).`);
      lines.push("");
      for (const [category, items] of [...this.noEffect.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`### ${category} (${items.length})`);
        lines.push("");
        for (const item of items.sort()) lines.push(`- ${item}`);
        lines.push("");
      }
    }
    lines.push("## Descrições");
    lines.push("");
    if (opts.withDescriptions) {
      lines.push(`\`${DESCRIPTIONS_FILE}\` gravado com ${this.descriptions} descrições e ${this.enhancements} textos de aprimoramento (\`<id>#eN\`), fora do git.`);
      if (this.descriptionsEmpty.length > 0) {
        lines.push("");
        lines.push(`Entradas sem descrição no Foundry (o app mostra "ver livro"): ${this.descriptionsEmpty.length}.`);
        lines.push("");
        for (const id of this.descriptionsEmpty.sort()) lines.push(`- \`${id}\``);
      }
    } else {
      lines.push("Rodado sem `--with-descriptions`: o arquivo de descrições não foi tocado.");
    }
    lines.push("");
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Mapas Foundry → nosso sistema
// ---------------------------------------------------------------------------

/** Chave do Foundry → chave de opção nossa. Cada uso confere que a opção existe no JSON do sistema. */
const MAP = {
  spellType: { arc: "arcana", div: "divina", uni: "universal" },
  school: { abj: "abjuracao", adv: "adivinhacao", con: "convocacao", enc: "encantamento", evo: "evocacao", ilu: "ilusao", nec: "necromancia", tra: "transmutacao" },
  execution: { action: "standard", full: "full", reaction: "reaction", free: "free", move: "move", special: "special", passive: "passive", "": "", none: "" },
  range: { short: "short", self: "self", touch: "touch", medium: "medium", long: "long", none: "", "": "" },
  duration: { scene: "scene", inst: "instant", sust: "sustained", day: "day", special: "special", round: "round", perm: "permanent", turn: "turn", hour: "hour", minute: "minute", "": "" },
  proficiency: { simples: "simples", marcial: "marcial", exotica: "exotica", fogo: "fogo" },
  purpose: { "corpo-a-corpo": "melee", disparo: "ranged", arremesso: "thrown", "corpo-a-corpo-arremesso": "melee_thrown" },
  wield: { uma: "one_hand", duas: "two_hands", leve: "light" },
  armorType: { leve: "light", pesada: "heavy", escudo: "shield" },
  consumableType: { potion: "pocao", alchemy: "alquimico", ammo: "municao", material: "outro", food: "outro" },
  powerType: { classe: "classe", ability: "habilidade", geral: "geral", concedido: "concedido", racial: "racial", origem: "origem", distincao: "distincao" },
  size: { min: "minusculo", peq: "pequeno", med: "medio", gra: "grande", eno: "enorme", col: "colossal" },
  damageType: { dano: "normal", curapv: "cura" },
} as const;

/** Propriedades booleanas de arma (o Foundry tem chaves curtas e longas duplicadas). */
const WEAPON_PROPERTIES: Record<string, string> = {
  agi: "ágil",
  agil: "ágil",
  leve: "leve",
  duasMaos: "duas mãos",
  ver: "versátil",
  versatil: "versátil",
  dup: "dupla",
  dupla: "dupla",
  alo: "alongada",
  alongada: "alongada",
  arr: "arremesso",
  arremesso: "arremesso",
  mun: "munição",
  municao: "munição",
  ada: "adaptável",
  adaptavel: "adaptável",
  dst: "ataque à distância",
  ataqueDistancia: "ataque à distância",
};

const GEAR_TAGS: Record<string, string> = { acessorio: "acessório", traje: "traje", ferramenta: "ferramenta", esoterico: "esotérico" };
const CONSUMABLE_TAGS: Record<string, string> = { potion: "poção", alchemy: "alquímico", ammo: "munição", material: "material", food: "alimentação" };
const FOLDER_TAGS: Record<string, string> = {
  "equipamentos-magicos": "mágico",
  "itens-de-origem": "item de origem",
  "veículos": "veículo",
  animais: "animal",
  "equipamento-de-aventura": "aventura",
  "poderes-distincao": "distinção",
};
const SAVE_TYPOS: Record<string, string> = { relfexos: "reflexos" };
const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };

// ---------------------------------------------------------------------------
// Conversor: um documento do Foundry → CompendiumItemEntry
// ---------------------------------------------------------------------------

/** Entrada de item em construção: CompendiumItemEntry sem os defaults, mais `$source` para rastrear. */
type Draft = Partial<CompendiumItemEntry> & { id: string; name: string; kind: string; $source: string };

class Converter {
  private readonly optionKeys = new Map<string, Set<string>>();
  private readonly skillByLabel = new Map<string, string>();
  private readonly saveSkillByLabel = new Map<string, string>();
  private readonly attrKeys: Set<string>;
  private readonly damageTypes: Set<string>;

  constructor(
    private readonly def: SystemDefinition,
    private readonly report: Report,
  ) {
    for (const kind of def.itemKinds) {
      for (const f of kind.fields) if (f.type === "enum") this.optionKeys.set(`${kind.key}.${f.key}`, new Set((f.options ?? []).map((o) => o.key)));
    }
    for (const s of def.skills) this.skillByLabel.set(normalize(s.label), s.key);
    for (const s of saveSkills(def)) this.saveSkillByLabel.set(normalize(s.label), s.key);
    this.attrKeys = new Set(def.attributes.map((a) => a.key));
    this.damageTypes = new Set(def.damageTypes.map((d) => d.key));
  }

  kind(key: string): ItemKindDef {
    const kind = this.def.itemKinds.find((k) => k.key === key);
    if (!kind) throw new Error(`O sistema "${this.def.id}" não tem o tipo de item "${key}"`);
    return kind;
  }

  /** Traduz uma chave do Foundry para a opção nossa, conferindo que ela existe no sistema. */
  private option(id: string, kindKey: string, field: string, map: Record<string, string>, foundry: string, label: string): string | null {
    const ours = map[foundry];
    if (ours === undefined) {
      this.report.todo(`${label}: valor sem mapeamento`, id, `\`${foundry}\``);
      return null;
    }
    if (!this.optionKeys.get(`${kindKey}.${field}`)?.has(ours)) throw new Error(`Opção "${ours}" não existe em ${kindKey}.${field} do sistema`);
    return ours;
  }

  private activationKey(id: string, list: { key: string }[], map: Record<string, string>, foundry: string, label: string): string {
    const ours = map[foundry];
    if (ours === undefined) {
      this.report.todo(`${label}: valor fora dos nossos enums (gravado "special")`, id, `\`${foundry}\``);
      return "special";
    }
    if (ours !== "" && !list.some((e) => e.key === ours)) throw new Error(`"${ours}" não existe em system.activation (${label})`);
    return ours;
  }

  /** Bloco de ativação a partir de system.ativacao/duracao/alcance/alvo/area/efeito. Null se tudo estiver no default. */
  activation(id: string, s: Record<string, unknown>): Activation | null {
    const ativacao = obj(s.ativacao);
    const duracao = obj(s.duracao);
    const a = this.def.activation;
    const execution = this.activationKey(id, a.executions, MAP.execution, str(ativacao.execucao), "execução");
    const rangeUnits = this.activationKey(id, a.rangeUnits, MAP.range, str(s.alcance), "alcance");
    const durationUnits = this.activationKey(id, a.durationUnits, MAP.duration, str(duracao.units), "duração");
    const special = str(duracao.special).trim();
    if (special) this.report.todo("duração: texto livre no Foundry (só a unidade foi mapeada)", id, `"${special}"`);
    const activation: Activation = {
      cost: Math.max(0, Math.round(num(ativacao.custo))),
      execution,
      duration: { units: durationUnits, value: num(duracao.value) },
      range: { units: rangeUnits, value: 0 },
      target: str(s.alvo).trim().slice(0, 200),
      area: str(s.area).trim().slice(0, 200),
      effect: str(s.efeito).trim().slice(0, 2000),
    };
    const isDefault =
      activation.cost === 0 && !execution && !rangeUnits && !durationUnits && activation.duration.value === 0 && !activation.target && !activation.area && !activation.effect;
    return isDefault ? null : activation;
  }

  /**
   * Resistência a partir do texto livre ("Vontade parcial", "Reflexos reduz à
   * metade"). Exatamente uma perícia de resistência citada → save; zero ou mais
   * de uma → null + TODO. O atributo do Foundry (resistencia.atributo) é
   * ignorado: a CD usa o atributo de conjuração da ficha.
   */
  save(id: string, s: Record<string, unknown>): Save | null {
    const text = str(obj(s.resistencia).txt).trim();
    if (!text) return null;
    const words = normalize(text)
      .split(/[^a-z]+/)
      .map((w) => SAVE_TYPOS[w] ?? w);
    const found = [...new Set(words.map((w) => this.saveSkillByLabel.get(w)).filter((k): k is string => k !== undefined))];
    if (found.length !== 1) {
      if (!["nenhuma", "nenhum", "-"].includes(normalize(text))) this.report.todo("resistência: texto sem uma perícia única", id, `"${text}"`);
      return null;
    }
    return { skill: found[0]!, attribute: null, bonus: 0, text: text.slice(0, 500) };
  }

  /**
   * Rolagens do Foundry → ações nossas. Cada `rolls[]` tem `parts: [fórmula, tipo, extra][]`.
   * - ataque: [1d20, perícia, bônus]
   * - dano: partes com dado viram uma ação cada; "+N" vira bônus; "@atr" vira o atributo.
   */
  actions(id: string, s: Record<string, unknown>, weapon: { critRange: number; critMult: number } | null): ActionTemplate[] {
    const out: ActionTemplate[] = [];
    const rolls = Array.isArray(s.rolls) ? (s.rolls as Record<string, unknown>[]) : [];
    for (const roll of rolls) {
      const type = str(roll.type);
      const parts = (Array.isArray(roll.parts) ? roll.parts : []).map((p) => (Array.isArray(p) ? p.map(str) : [str(p)]));
      const label = str(roll.name).trim() || (type === "ataque" ? "Ataque" : "Dano");
      if (type === "ataque") {
        const foundrySkill = str(parts[1]?.[0]).trim();
        const skill = this.skillByPrefix(foundrySkill);
        const bonus = Math.round(num(parts[2]?.[0]));
        if (!skill) {
          this.report.todo("ataque: perícia vazia ou desconhecida no Foundry (ação de ataque omitida)", id, `perícia \`${foundrySkill || "(vazia)"}\``);
          continue;
        }
        if (this.def.attackSkills.includes(skill)) {
          out.push({ label: label.slice(0, 60), kind: "attack", skill, attributeOverride: null, bonus, critRange: weapon?.critRange ?? 20, critMult: weapon?.critMult ?? 2 });
        } else {
          // "1d20 + Atuação" não é ataque no nosso sistema: vira teste de perícia.
          out.push({ label: label.slice(0, 60), kind: "check", skill, bonus });
        }
      } else if (type === "formula") {
        const formula = str(parts[0]?.[0]).trim();
        try {
          parseFormula(formula);
          // Nunca infere damageType aqui: fórmula livre importada fica "crua", como sempre.
          out.push({ label: label.slice(0, 60), kind: "formula", formula, damageType: null });
        } catch (e) {
          this.report.todo("fórmula: rolagem que o nosso parser não aceita (ação omitida)", id, `\`${formula}\`: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (type === "dano") {
        let bonus = 0;
        let attribute: string | null = null;
        const dice: { formula: string; damageType: string | null }[] = [];
        for (const part of parts) {
          const raw = str(part[0]).trim();
          if (!raw) continue;
          if (/^[+-]?\d+$/.test(raw) && dice.length > 0) {
            bonus += Number(raw);
            continue;
          }
          const attrRef = /^@([a-z]+)$/i.exec(raw);
          if (attrRef) {
            const key = attrRef[1]!.toLowerCase();
            if (this.attrKeys.has(key)) attribute = key;
            else this.report.todo("dano: referência @ desconhecida", id, `\`${raw}\``);
            continue;
          }
          // "1d6+@for": tira o atributo da fórmula e o guarda à parte.
          let formula = raw;
          const inline = /([+-])\s*@([a-z]+)/i.exec(formula);
          if (inline) {
            const key = inline[2]!.toLowerCase();
            if (this.attrKeys.has(key) && inline[1] === "+") attribute = key;
            else this.report.todo("dano: referência @ desconhecida", id, `\`${raw}\``);
            formula = formula.replace(inline[0], "").trim();
          }
          try {
            parseFormula(formula, { requireDice: false });
          } catch (e) {
            this.report.todo("dano: fórmula que o nosso parser não aceita (ação omitida)", id, `\`${raw}\`: ${e instanceof Error ? e.message : String(e)}`);
            continue;
          }
          dice.push({ formula, damageType: this.damageType(id, str(part[1]).trim()) });
        }
        // Arma: "@for" no dano vira "auto" (regra damageAttribute do sistema decide por tipo de uso).
        const attr: "auto" | string | null = weapon ? (attribute ? "auto" : null) : attribute;
        for (const [i, d] of dice.entries()) {
          const typeLabel = d.damageType ? this.def.damageTypes.find((t) => t.key === d.damageType)?.label : undefined;
          const suffix = dice.length > 1 && typeLabel ? ` (${typeLabel})` : "";
          out.push({ label: `${label}${suffix}`.slice(0, 60), kind: "damage", formula: d.formula, attribute: attr, damageType: d.damageType, bonus: i === 0 ? bonus : 0 });
        }
      } else {
        this.report.todo("rolagem: tipo desconhecido", id, `\`${type}\``);
      }
    }
    return out;
  }

  /** Perícia pela abreviação do Foundry ("pont" → pontaria): chave igual ou prefixo único. */
  private skillByPrefix(abbr: string): string | null {
    const key = normalize(abbr);
    if (!key) return null;
    const exact = this.def.skills.find((s) => s.key === key || normalize(s.label) === key);
    if (exact) return exact.key;
    const matches = this.def.skills.filter((s) => s.key.startsWith(key));
    return matches.length === 1 ? matches[0]!.key : null;
  }

  private damageType(id: string, foundry: string): string | null {
    if (!foundry) return null;
    const ours = (MAP.damageType as Record<string, string>)[foundry] ?? foundry;
    if (this.damageTypes.has(ours)) return ours;
    this.report.todo("dano: tipo sem correspondência (gravado sem tipo)", id, `\`${foundry}\``);
    return null;
  }

  private folderTags(doc: FoundryDoc): string[] {
    const tags: string[] = [];
    for (const segment of dirname(doc.path).split("/")) {
      const tag = FOLDER_TAGS[segment];
      if (tag) tags.push(tag);
    }
    if (FOLDER_TAGS[doc.pack]) tags.push(FOLDER_TAGS[doc.pack]!);
    return [...new Set(tags)];
  }

  private base(doc: FoundryDoc, kind: string, id: string): Draft {
    const s = doc.system;
    const page = pageOf(str(s.source));
    if (page === null) this.report.todo("página: sem `source` com \"p. N\"", id, str(s.source).trim() ? `"${str(s.source).trim()}"` : "(vazio)");
    return { id, name: doc.name.trim().slice(0, 80), kind, $source: `Compendium.tormenta20.${doc.pack}.Item.${doc._id}`, page };
  }

  private physical(draft: Draft, s: Record<string, unknown>): void {
    draft.slots = Math.max(0, num(s.espacos));
    draft.price = Math.max(0, num(s.preco));
  }

  // --- por tipo ------------------------------------------------------------

  weapon(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "weapon";
    const proficiency = this.option(id, kind, "proficiency", MAP.proficiency, str(s.proficiencia), "arma: proficiência");
    const purpose = this.option(id, kind, "purpose", MAP.purpose, str(s.proposito), "arma: uso");
    const wield = this.option(id, kind, "wield", MAP.wield, str(s.empunhadura), "arma: empunhadura");
    if (!proficiency || !purpose || !wield) return null;
    const props = [...new Set(Object.entries(obj(s.propriedades)).filter(([, v]) => v === true).map(([k]) => WEAPON_PROPERTIES[k] ?? k))];
    const rangeLabel = this.def.activation.rangeUnits.find((r) => r.key === (MAP.range as Record<string, string>)[str(s.alcance)])?.label;
    if (rangeLabel) props.push(`alcance ${rangeLabel.toLowerCase()}`);
    const draft = this.base(doc, kind, id);
    const label = (field: string, key: string) => this.kind(kind).fields.find((f) => f.key === field)?.options?.find((o) => o.key === key)?.label.toLowerCase() ?? key;
    draft.tags = [label("proficiency", proficiency), label("purpose", purpose), label("wield", wield), ...this.folderTags(doc)];
    draft.fields = { proficiency, purpose, wield, properties: props.join(", ") };
    draft.actions = this.actions(id, s, { critRange: Math.round(num(s.criticoM)) || 20, critMult: Math.round(num(s.criticoX)) || 2 });
    this.physical(draft, s);
    return draft;
  }

  armor(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "armor";
    const type = this.option(id, kind, "type", MAP.armorType, str(s.tipo), "armadura: tipo");
    if (!type) return null;
    const armadura = obj(s.armadura);
    const draft = this.base(doc, kind, id);
    const typeLabel = this.kind(kind).fields.find((f) => f.key === "type")?.options?.find((o) => o.key === type)?.label.toLowerCase() ?? type;
    draft.tags = [typeLabel, ...this.folderTags(doc)];
    draft.fields = { type };
    draft.statBonuses = { defense: num(armadura.value), armorPenalty: num(armadura.penalidade) };
    for (const stat of Object.keys(draft.statBonuses)) if (!this.kind(kind).statBonuses.includes(stat)) throw new Error(`"${kind}" não fornece o stat "${stat}"`);
    if (type === "heavy") this.report.todo("armadura pesada: limite de atributo na Defesa (maxAttr) não importado; conferir no livro", id, `Foundry maxAtr = ${num(armadura.maxAtr)}`);
    this.physical(draft, s);
    return draft;
  }

  gear(doc: FoundryDoc, id: string): Draft {
    const s = doc.system;
    const draft = this.base(doc, "gear", id);
    const tags = doc.type === "tesouro" ? ["tesouro"] : [GEAR_TAGS[str(s.tipo)] ?? str(s.tipo)].filter(Boolean);
    draft.tags = [...tags, ...this.folderTags(doc)];
    this.physical(draft, s);
    return draft;
  }

  consumable(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "consumable";
    const type = this.option(id, kind, "type", MAP.consumableType, str(s.tipo), "consumível: tipo");
    if (!type) return null;
    const draft = this.base(doc, kind, id);
    draft.tags = [CONSUMABLE_TAGS[str(s.tipo)] ?? str(s.tipo), ...this.folderTags(doc)];
    draft.fields = { type };
    draft.activation = this.activation(id, s);
    draft.save = this.save(id, s);
    draft.actions = this.actions(id, s, null);
    this.physical(draft, s);
    return draft;
  }

  spell(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "spell";
    const type = this.option(id, kind, "type", MAP.spellType, str(s.tipo), "magia: tipo");
    const school = this.option(id, kind, "school", MAP.school, str(s.escola), "magia: escola");
    const circle = Math.round(num(s.circulo));
    if (!type || !school) return null;
    if (circle < 1) {
      this.report.todo("magia: círculo inválido", id, `\`${str(s.circulo)}\``);
      return null;
    }
    const draft = this.base(doc, kind, id);
    const label = (field: string, key: string) => this.kind(kind).fields.find((f) => f.key === field)?.options?.find((o) => o.key === key)?.label.toLowerCase() ?? key;
    draft.tags = [label("type", type), label("school", school), `${circle}º círculo`];
    draft.fields = { circle, school, type };
    draft.activation = this.activation(id, s);
    draft.save = this.save(id, s);
    draft.actions = this.actions(id, s, null);
    return draft;
  }

  power(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "power";
    const type = this.option(id, kind, "type", MAP.powerType, str(s.tipo), "poder: tipo");
    if (!type) return null;
    const draft = this.base(doc, kind, id);
    const typeLabel = this.kind(kind).fields.find((f) => f.key === "type")?.options?.find((o) => o.key === type)?.label.toLowerCase() ?? type;
    const subtypes = str(s.subtipo)
      .split(",")
      .map((t) => capitalize(t.trim()))
      .filter(Boolean);
    draft.tags = [...new Set([typeLabel, ...subtypes, ...this.folderTags(doc)])];
    draft.fields = { type };
    draft.activation = this.activation(id, s);
    draft.save = this.save(id, s);
    draft.actions = this.actions(id, s, null);
    return draft;
  }

  race(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "race";
    const sizes = Array.isArray(s.tamanho) ? s.tamanho.map(str) : [str(s.tamanho)];
    const sizeFoundry = sizes[0] ?? "";
    const size = (MAP.size as Record<string, string>)[sizeFoundry];
    if (!size || !this.def.sizes.some((z) => z.key === size)) {
      this.report.todo("raça: tamanho sem mapeamento", id, `\`${sizeFoundry}\``);
      return null;
    }
    if (sizes.length > 1) this.report.todo("raça: mais de um tamanho no Foundry (só o primeiro foi usado)", id, sizes.join(", "));
    const attributeBonuses: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(s.atributos))) {
      if (num(v) === 0) continue;
      if (!this.attrKeys.has(k)) throw new Error(`Raça ${id}: atributo "${k}" não existe no sistema`);
      attributeBonuses[k] = Math.round(num(v));
    }
    // Bônus à escolha: a lista `value` diz quais atributos podem receber; a quantidade e o valor vêm do texto.
    const dyn = obj(s.atributosDinamicos);
    const allowed = Array.isArray(dyn.value) ? dyn.value.map(str) : [];
    let flexible = { amount: 0, count: 0, exclude: [] as string[], chosen: [] as string[] };
    if (allowed.length > 0) {
      const text = normalize(str(dyn.description));
      const m = /([+-]?\d+) em (\w+) atributos?/.exec(text);
      const count = m ? (NUMBER_WORDS[m[2]!] ?? Number(m[2])) : NaN;
      if (!m || !Number.isFinite(count)) {
        this.report.todo("raça: bônus à escolha com texto que não consegui ler", id, `"${str(dyn.description)}"`);
        return null;
      }
      for (const k of allowed) if (!this.attrKeys.has(k)) throw new Error(`Raça ${id}: atributo "${k}" não existe no sistema`);
      flexible = { amount: Number(m[1]), count, exclude: [...this.attrKeys].filter((k) => !allowed.includes(k)), chosen: [] };
    }
    const draft = this.base(doc, kind, id);
    draft.tags = [];
    draft.fields = {
      attributeBonuses,
      flexibleBonuses: flexible,
      size,
      movement: num(obj(s.movement).walk),
      senses: "",
      skillsGranted: { fixed: [], choices: [] },
    };
    this.report.todo("raça: sentidos e perícias treinadas não existem no Foundry", id, "conferir no livro");
    return draft;
  }

  /**
   * Classe. PV inicial não existe no Foundry: por decisão do dono do projeto
   * (conferido no livro para Guerreiro, Arcanista, Bárbaro e Ladino), é 4× o
   * PV por nível.
   */
  klass(doc: FoundryDoc, id: string): Draft | null {
    const s = doc.system;
    const kind = "class";
    const hpPerLevel = num(s.pvPorNivel);
    const mpPerLevel = num(s.pmPorNivel);
    const pericias = obj(s.pericias);
    const skillsGranted = this.parseClassSkills(id, str(pericias.inatas), num(pericias.numero));
    if (!skillsGranted) return null;
    const draft = this.base(doc, kind, id);
    draft.tags = [];
    draft.fields = { hpInitial: hpPerLevel * 4, hpPerLevel, mpPerLevel, skillsGranted, proficiencies: "" };
    this.report.todo("classe: proficiências não existem no Foundry", id, "conferir no livro");
    return draft;
  }

  /**
   * "Luta (For) ou Pontaria (Des), Fortitude (Con), mais 2 a sua escolha entre A (x), B (y) e C (z)."
   * → fixas [fortitude], escolhas [{1 de [luta, pontaria]}, {2 de [a, b, c]}].
   */
  private parseClassSkills(id: string, text: string, declared: number): SkillGrantsValue | null {
    const clean = text
      .replace(/\s+/g, " ")
      .replace(/(\p{L})- (\p{L})/gu, "$1$2") // quebra de linha do PDF: "Sobre- vivência"
      .replace(/\s*\([^)]*\)/g, ",") // "(For)" vira separador
      .replace(/\.\s*$/, "");
    const split = /,?\s*mais (\d+) a sua escolha entre\s*/i.exec(clean);
    if (!split) {
      this.report.todo("classe: não consegui ler o texto de perícias", id, `"${text}"`);
      return null;
    }
    const count = Number(split[1]);
    if (declared > 0 && declared !== count) this.report.todo("classe: número de perícias à escolha difere entre texto e campo", id, `texto ${count}, campo ${declared}`);
    const tokens = (part: string) =>
      part
        .split(/,|\s+e\s+/)
        .map((t) => t.trim())
        .filter((t) => t && t !== "e");
    const lookup = (label: string): string | null => {
      const key = this.skillByLabel.get(normalize(label));
      if (!key) this.report.todo("classe: perícia do texto sem correspondência no sistema", id, `"${label}"`);
      return key ?? null;
    };
    const fixed: string[] = [];
    const choices: SkillGrantsValue["choices"] = [];
    for (const token of tokens(clean.slice(0, split.index))) {
      const m = /^ou\s+(.+)$/i.exec(token);
      if (m) {
        const previous = fixed.pop();
        const alt = lookup(m[1]!);
        if (previous === undefined || alt === null) return null;
        choices.push({ count: 1, from: [previous, alt], chosen: [] });
        continue;
      }
      const key = lookup(token);
      if (key === null) return null;
      fixed.push(key);
    }
    const from: string[] = [];
    for (const token of tokens(clean.slice(split.index + split[0].length))) {
      const key = lookup(token);
      if (key === null) return null;
      from.push(key);
    }
    choices.push({ count, from, chosen: [] });
    return { fixed, choices };
  }
}

// ---------------------------------------------------------------------------
// HTML do Foundry → texto simples / markdown leve
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", minus: "−", hellip: "…", bull: "•", middot: "·",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", laquo: "«", raquo: "»",
  deg: "°", ordf: "ª", ordm: "º", sect: "§", para: "¶", times: "×", divide: "÷", copy: "©", reg: "®", trade: "™",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
};

function decodeEntities(s: string, unknown: Set<string>): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const v = ENTITIES[body];
    if (v === undefined) unknown.add(m);
    return v ?? m;
  });
}

function htmlToText(html: string, unknownEntities: Set<string>): string {
  let t = html.replace(/\r\n?/g, "\n");
  // Links do Foundry: só o rótulo.
  t = t.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*\]/g, "");
  t = t.replace(/@Compendium\[[^\]]*\]\{([^}]*)\}/g, "$1");
  // Rolagens inline: [[/r 2d6 #rótulo]] → 2d6.
  t = t.replace(/\[\[\/r\s*([^\]#]*)(#[^\]]*)?\]\]/g, (_, f: string) => f.trim());
  // Ênfase antes de tirar as tags (conteúdo aparado para o markdown fechar certo).
  t = t.replace(/<(strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>/gi, (_, __, inner: string) => (inner ? `**${inner}**` : ""));
  t = t.replace(/<(em|i)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>/gi, (_, __, inner: string) => (inner ? `*${inner}*` : ""));
  // Estrutura.
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  t = t.replace(/<\/(ul|ol)>/gi, "\n");
  t = t.replace(/<\/t[dh]>/gi, " | ").replace(/<\/tr>/gi, "\n");
  t = t.replace(/<\/(p|div|h[1-6]|table|blockquote)>/gi, "\n\n");
  t = t.replace(/<h[1-6]\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t, unknownEntities);
  // Espaços: colapsa dentro da linha, apara, no máximo uma linha em branco seguida.
  t = t
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}

/** Tamanho máximo do texto de um aprimoramento (EnhancementSchema.label). */
const ENHANCEMENT_TEXT_MAX = 1000;

/** Tipo de dano que a frase nomeia mas o sistema não tem: fica só custo e vai para o TODO. */
export interface UnknownDamageType {
  unknownType: string;
}

/** Rótulo → chave, para tipos de dano e unidades de alcance/duração do sistema (null = não existe). */
export interface EffectResolvers {
  damageTypeKey: (label: string) => string | null;
  rangeUnitKey: (label: string) => string | null;
  durationUnitKey: (label: string) => string | null;
}
const NO_RESOLVERS: EffectResolvers = { damageTypeKey: () => null, rangeUnitKey: () => null, durationUnitKey: () => null };

/**
 * Efeito mecânico a partir do texto, SÓ quando a frase inteira casa um padrão
 * estrito. Qualquer outra frase devolve null (vai para o relatório): nunca inferir.
 * Padrões (ponto final opcional; frases compostas "muda X e Y" não casam):
 *   "aumenta o dano em +XdY [de <tipo>]", "+XdY de dano [de <tipo>]" → damageDiceAdd
 *     (rótulo → chave via damageTypeKey; tipo desconhecido devolve { unknownType })
 *   "muda o dano para XdY"                                            → damageSet
 *   "aumenta a cura em +XdY", "+XdY de cura"                         → healDiceAdd
 *   "aumenta a CD em +N"                                              → dcAdd
 *   "muda o alcance para <unidade>"                                   → rangeSet
 *   "muda a duração para <unidade>" / "para N <unidade>[s]"           → durationSet
 *   "muda a área para <texto>"                                        → areaSet
 *   "aumenta o número/a quantidade de alvos em +N", "+N alvo(s)"      → targetsAdd
 * attackBonusAdd e text nunca são preenchidos aqui.
 */
export function parseEnhancementEffect(text: string, resolvers: EffectResolvers = NO_RESOLVERS): EnhancementEffect | UnknownDamageType | null {
  const original = text.trim().replace(/\s+/g, " ");
  const t = original.toLowerCase();
  const add = /^aumenta o dano em \+?(\d+d\d+)(?: de ([\p{L}]+))?[.;]?$/u.exec(t) ?? /^\+?(\d+d\d+) de dano(?: de ([\p{L}]+))?[.;]?$/u.exec(t);
  if (add?.[1]) {
    const typeLabel = add[2];
    if (typeLabel === undefined) return { kind: "damageDiceAdd", dice: add[1] };
    const key = resolvers.damageTypeKey(typeLabel);
    return key ? { kind: "damageDiceAdd", dice: add[1], damageType: key } : { unknownType: typeLabel };
  }
  const set = /^muda o dano para (\d+d\d+)[.;]?$/.exec(t);
  if (set?.[1]) return { kind: "damageSet", formula: set[1] };
  const heal = /^aumenta a cura em \+?(\d+d\d+)[.;]?$/.exec(t) ?? /^\+?(\d+d\d+) de cura[.;]?$/.exec(t);
  if (heal?.[1]) return { kind: "healDiceAdd", dice: heal[1] };
  const dc = /^aumenta a cd em \+?(\d+)[.;]?$/.exec(t);
  if (dc?.[1]) return { kind: "dcAdd", value: Number(dc[1]) };
  const range = /^muda o alcance para ([\p{L}]+)[.;]?$/u.exec(t);
  if (range?.[1]) {
    const units = resolvers.rangeUnitKey(range[1]);
    return units ? { kind: "rangeSet", units } : null;
  }
  const duration = /^muda a duração para (?:(\d+) )?([\p{L}]+)[.;]?$/u.exec(t);
  if (duration?.[2]) {
    const label = duration[2];
    const value = duration[1] !== undefined ? Number(duration[1]) : undefined;
    // "2 rodadas": aceita o plural do rótulo quando há valor.
    const units = resolvers.durationUnitKey(label) ?? (value !== undefined && label.endsWith("s") ? resolvers.durationUnitKey(label.slice(0, -1)) : null);
    if (!units) return null;
    return value !== undefined ? { kind: "durationSet", units, value } : { kind: "durationSet", units };
  }
  // Área é texto livre (mantém a caixa original): uma frase só, sem outra cláusula ("... e o alvo para ...").
  const area = /^muda a área para ([^.;]+)[.;]?$/iu.exec(original);
  if (area?.[1] && !/\be (o|a|os|as) /i.test(area[1])) return { kind: "areaSet", text: area[1].trim().slice(0, 200) };
  const targets = /^aumenta (?:o número|a quantidade) de alvos em \+?(\d+)[.;]?$/u.exec(t) ?? /^\+(\d+) alvos?[.;]?$/.exec(t);
  if (targets?.[1] && Number(targets[1]) >= 1) return { kind: "targetsAdd", count: Number(targets[1]) };
  return null;
}

/** Chave a partir do rótulo ou da própria chave, sem acento/caixa ("Frio", "frio" → "frio"). */
function optionKeyResolver(options: { key: string; label: string }[]): (label: string) => string | null {
  const byLabel = new Map<string, string>();
  for (const o of options) {
    byLabel.set(normalize(o.label), o.key);
    byLabel.set(normalize(o.key), o.key);
    // "Curto (9 m)" também casa só "curto".
    const short = normalize(o.label).replace(/\s*\(.*\)$/, "");
    if (!byLabel.has(short)) byLabel.set(short, o.key);
  }
  return (label) => byLabel.get(normalize(label)) ?? null;
}

function effectResolvers(def: SystemDefinition): EffectResolvers {
  return { damageTypeKey: optionKeyResolver(def.damageTypes), rangeUnitKey: optionKeyResolver(def.activation.rangeUnits), durationUnitKey: optionKeyResolver(def.activation.durationUnits) };
}

/** Categoria do relatório para um aprimoramento sem efeito (primeira que casar). */
function noEffectCategory(text: string): string {
  const t = normalize(text);
  if (/\bdano\b/.test(t)) return "dano fora do padrão";
  if (/\bcura\b/.test(t)) return "cura fora do padrão";
  if (/\bcd\b/.test(t)) return "CD";
  if (/\balvos?\b/.test(t)) return "alvo adicional";
  if (/\balcance\b/.test(t)) return "alcance";
  if (/\bduracao\b/.test(t)) return "duração";
  return "outro";
}

interface ExtractedEnhancements {
  /** Só mecânica, na ordem do arquivo; ids "e1", "e2"... */
  list: { id: string; cost: number; repeatable: boolean; effect?: EnhancementEffect }[];
  /** Texto de cada aprimoramento, por id. */
  texts: Map<string, string>;
  /** Lista para o fim da descrição ("Aprimoramentos:" + "- +N PM: ..."), vazia se não há nada. */
  description: string;
}

/**
 * Aprimoramentos: no Foundry são os effects[] com flags.tormenta20 onuse+self
 * (o mesmo filtro do diálogo de uso). `custo` é o PM extra; `aumenta` é o
 * checkbox "Múltiplas Aplicações" (repetível). Em magia, custo vazio é o
 * Truque, que é outra regra (custo total 0): fica só na descrição.
 */
function extractEnhancements(doc: FoundryDoc, id: string, kind: string, report: Report, unknownEntities: Set<string>, resolvers: EffectResolvers): ExtractedEnhancements {
  const list: ExtractedEnhancements["list"] = [];
  const texts = new Map<string, string>();
  const lines: string[] = [];
  for (const effect of doc.effects) {
    const flags = effect.flags?.tormenta20 ?? {};
    if (!flags.onuse) continue;
    if (!flags.self) {
      report.grantedEffects++;
      continue;
    }
    let text = htmlToText(str(effect.name), unknownEntities);
    if (!text) {
      report.todo("aprimoramento: effect sem texto (ignorado)", id, `effect ${str((effect as { _id?: unknown })._id) || "?"}`);
      continue;
    }
    const rawCost = str(flags.custo).trim();
    if (rawCost === "" && kind === "spell") {
      report.cantrips++;
      lines.push(`- Truque: ${text}`);
      continue;
    }
    const cost = Math.round(num(rawCost));
    if (cost < 0) {
      report.todo("aprimoramento: custo negativo (ficou só na descrição)", id, `\`${rawCost}\`: "${text.slice(0, 80)}"`);
      lines.push(`- ${rawCost} PM: ${text}`);
      continue;
    }
    if (text.length > ENHANCEMENT_TEXT_MAX) {
      report.todo(`aprimoramento: texto com mais de ${ENHANCEMENT_TEXT_MAX} caracteres (truncado)`, id, `"${text.slice(0, 60)}..."`);
      text = `${text.slice(0, ENHANCEMENT_TEXT_MAX - 1)}…`;
    }
    if (flags.aumenta === undefined) report.todo("aprimoramento: sem a flag de múltiplas aplicações (gravado como não repetível)", id, `"${text.slice(0, 80)}"`);
    const enhId = `e${list.length + 1}`;
    const parsed = parseEnhancementEffect(text, resolvers);
    let mech: EnhancementEffect | null = null;
    if (parsed && "unknownType" in parsed) {
      // O texto nomeia um tipo que o sistema não tem: fica só custo e vira pendência (não é "sem padrão").
      report.todo("aprimoramento: tipo de dano sem correspondência (gravado só custo)", id, `\`${parsed.unknownType}\`: "${text.slice(0, 80)}"`);
    } else mech = parsed;
    if (mech) report.bump(report.effectsByKind, mech.kind);
    else if (!parsed) {
      const category = report.noEffect.get(noEffectCategory(text)) ?? [];
      category.push(`\`${enhancementTextKey(id, enhId)}\`: ${text.length > 100 ? `${text.slice(0, 99)}…` : text}`);
      report.noEffect.set(noEffectCategory(text), category);
    }
    list.push(mech ? { id: enhId, cost, repeatable: flags.aumenta === true, effect: mech } : { id: enhId, cost, repeatable: flags.aumenta === true });
    texts.set(enhId, text);
    lines.push(`- +${cost} PM: ${text}`);
  }
  if (list.length > 0) {
    report.enhancementEntries++;
    report.enhancements += list.length;
    report.enhancementsRepeatable += list.filter((e) => e.repeatable).length;
  }
  return { list, texts, description: lines.length > 0 ? `Aprimoramentos:\n${lines.join("\n")}` : "" };
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

const KIND_FILES: Record<string, string> = {
  class: "classes.json",
  race: "races.json",
  weapon: "weapons.json",
  armor: "armor.json",
  gear: "gear.json",
  consumable: "consumables.json",
  spell: "spells.json",
  power: "powers.json",
};

/** Tira os campos no default para o JSON ficar enxuto (o Zod repõe ao carregar). */
function compact(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = { id: draft.id, name: draft.name, kind: draft.kind, $source: draft.$source };
  if (draft.tags && draft.tags.length > 0) out.tags = draft.tags;
  if (draft.fields && Object.keys(draft.fields).length > 0) out.fields = draft.fields;
  if (draft.actions && draft.actions.length > 0) out.actions = draft.actions;
  if (draft.activation) out.activation = draft.activation;
  if (draft.enhancements && draft.enhancements.length > 0) {
    out.enhancements = draft.enhancements.map((e) => ({ id: e.id, cost: e.cost, ...(e.repeatable ? { repeatable: true } : {}), ...(e.effect ? { effect: e.effect } : {}) }));
  }
  if (draft.save) out.save = draft.save;
  if (draft.statBonuses && Object.keys(draft.statBonuses).length > 0) out.statBonuses = draft.statBonuses;
  if (draft.slots) out.slots = draft.slots;
  if (draft.price) out.price = draft.price;
  if (draft.page !== null && draft.page !== undefined) out.page = draft.page;
  return out;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const def = getSystemDefinition(opts.systemId);
  const report = new Report();
  const converter = new Converter(def, report);
  const resolvers = effectResolvers(def);
  const outDir = compendiumDir(opts.systemId);
  if (!existsSync(outDir)) throw new Error(`Pasta do compêndio não existe: ${outDir}`);
  const scriptsDir = dirname(fileURLToPath(import.meta.url));

  report.notes.push("PV inicial das classes = 4 × PV por nível (não existe no Foundry; conferido no livro para Guerreiro, Arcanista, Bárbaro e Ladino).");
  report.notes.push("Armaduras: `maxAttr` (limite de atributo na Defesa) não é importado; o Foundry traz 0 em todas. Pesadas estão listadas em TODO para conferir no livro.");
  report.notes.push("Resistência: `resistencia.atributo` do Foundry é ignorado; a CD usa o atributo de conjuração da ficha (`save.attribute = null`).");
  report.notes.push("Armas: `@for` no dano vira `attribute: \"auto\"` (a regra `damageAttribute` do sistema decide por tipo de uso); armas mágicas com \"+N\" no ataque/dano recebem `bonus: N`.");
  report.notes.push("Poderes `ability` → `habilidade`, `distincao` → `distincao` (opções adicionadas a `power.type` no JSON do sistema).");
  report.notes.push(
    "Aprimoramentos (effects `onuse`+`self` de magias, poderes e consumíveis) viram `enhancements[{ id: \"eN\", cost, repeatable, effect? }]`; `repeatable` = flag `aumenta` (\"Múltiplas Aplicações\"). O texto vai para `descriptions.local.json` na chave `<id>#eN` e a lista continua no fim da descrição (\"+N PM: ...\"). Truque (custo vazio em magia) e custos negativos ficam só na descrição. Os demais effects (efeitos ativos) não entram mais na descrição.",
  );
  report.notes.push("Poderes raciais entram em `powers.json` com a raça como tag; o vínculo raça → poderes (`grants` do Foundry) não é modelado no nosso schema.");

  const customIds = new Set<string>();
  const customPath = join(outDir, CUSTOM_FILE);
  if (existsSync(customPath)) for (const e of readCompendiumFile(customPath) as { id?: unknown }[]) if (typeof e.id === "string") customIds.add(e.id);

  const docs = readPacks(opts.source);
  const drafts = new Map<string, Draft[]>();
  const usedIds = new Set<string>(customIds);
  const descriptions: Record<string, string> = {};
  const unknownEntities = new Set<string>();
  const sourceVersion = (() => {
    const p = join(opts.source, "..", "..", "system.json");
    return existsSync(p) ? str((JSON.parse(readFileSync(p, "utf-8")) as { version?: unknown }).version) : "?";
  })();

  for (const doc of docs) {
    if (SKIPPED_PACKS[doc.pack]) {
      report.bump(report.skippedPacks, `${doc.pack} (${SKIPPED_PACKS[doc.pack]})`);
      continue;
    }
    const kind = kindOf(doc);
    if (!kind) {
      report.bump(report.skippedTypes, doc.type);
      continue;
    }
    if (doc.effects.some((e) => Array.isArray(e.changes) && e.changes.length > 0)) report.bump(report.effectsIgnored, doc.type);

    // Id: slug do nome; colisão → sufixo do subtipo (poderes) ou do id do Foundry.
    let id = slug(doc.name);
    if (!id) throw new Error(`Documento sem nome utilizável: ${doc.path}`);
    if (customIds.has(id)) {
      report.replacedByCustom.push(id);
      continue;
    }
    if (usedIds.has(id)) {
      const subtype = slug(str(doc.system.subtipo).split(",")[0] ?? "");
      const candidate = subtype && !usedIds.has(`${id}-${subtype}`) ? `${id}-${subtype}` : `${id}-${doc._id.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      report.collisions.push(`"${doc.name}" (${doc.path}) → \`${candidate}\``);
      id = candidate;
    }
    usedIds.add(id);

    const draft = convert(converter, doc, kind, id);
    if (!draft) continue;
    const list = drafts.get(kind) ?? [];
    list.push(draft);
    drafts.set(kind, list);

    // Aprimoramentos só em tipos com bloco de ativação (o schema recusa nos outros).
    const enhancements = converter.kind(kind).hasActivation ? extractEnhancements(doc, id, kind, report, unknownEntities, resolvers) : null;
    if (enhancements && enhancements.list.length > 0) draft.enhancements = enhancements.list.map((e) => ({ ...e, label: "" }));

    if (opts.withDescriptions) {
      const parts = [htmlToText(str(obj(doc.system.description).value), unknownEntities), enhancements?.description ?? ""];
      const text = parts.filter(Boolean).join("\n\n");
      if (!text) report.descriptionsEmpty.push(id);
      else if (text.length > 4000) throw new Error(`Descrição de "${id}" tem ${text.length} caracteres (máximo 4000 no schema)`);
      else {
        descriptions[id] = text;
        report.descriptions++;
      }
      for (const [enhId, enhText] of enhancements?.texts ?? []) descriptions[enhancementTextKey(id, enhId)] = enhText;
    }
  }

  // Validação (Zod + coerência com o sistema) antes de gravar qualquer coisa.
  const files = new Map<string, Record<string, unknown>[]>();
  for (const [kind, list] of drafts) {
    const file = KIND_FILES[kind];
    if (!file) throw new Error(`Sem arquivo de saída para o tipo "${kind}"`);
    const entries = list.sort((a, b) => a.id.localeCompare(b.id)).map(compact);
    validateCompendiumEntries(opts.systemId, entries);
    files.set(file, entries);
    report.generated.set(file, entries.length);
  }
  // Ids únicos entre arquivos (o loader já dá precedência, mas gerado não pode repetir).
  const all = [...files.values()].flat().map((e) => e.id as string);
  if (new Set(all).size !== all.length) throw new Error("Id repetido entre arquivos gerados");

  for (const file of Object.values(KIND_FILES)) {
    const entries = files.get(file) ?? [];
    const payload = {
      $generated: "Gerado por scripts/import-foundry-compendium.ts a partir dos packs do Foundry. Não edite à mão: use custom.json (tem precedência por id).",
      entries,
    };
    writeFileSync(join(outDir, file), JSON.stringify(payload, null, 2) + "\n");
  }
  if (opts.withDescriptions) {
    const sorted = Object.fromEntries(Object.entries(descriptions).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(outDir, DESCRIPTIONS_FILE), JSON.stringify(sorted, null, 2) + "\n");
    if (unknownEntities.size > 0) report.notes.push(`Entidades HTML não decodificadas: ${[...unknownEntities].sort().join(" ")}`);
  }
  writeFileSync(join(scriptsDir, "import-report.md"), report.render(opts, sourceVersion));

  const total = [...report.generated.values()].reduce((a, b) => a + b, 0);
  console.log(`OK: ${total} entradas em ${files.size} arquivos (${outDir})`);
  for (const [file, n] of [...report.generated.entries()].sort()) console.log(`  ${file}: ${n}`);
  console.log(`  substituídas por custom.json: ${report.replacedByCustom.length}`);
  console.log(`  TODOs: ${[...report.todos.values()].reduce((n, l) => n + l.length, 0)} (scripts/import-report.md)`);
  if (opts.withDescriptions) console.log(`  descrições: ${report.descriptions} (${DESCRIPTIONS_FILE})`);
}

/** Tipo do Foundry → nosso kind, ou null se não importamos. */
function kindOf(doc: FoundryDoc): string | null {
  switch (doc.type) {
    case "arma":
      return "weapon";
    case "equipamento":
      return (MAP.armorType as Record<string, string>)[str(doc.system.tipo)] ? "armor" : "gear";
    case "tesouro":
      return "gear";
    case "consumivel":
      return "consumable";
    case "magia":
      return "spell";
    case "poder":
      return "power";
    case "race":
      return "race";
    case "classe":
      return "class";
    default:
      return null;
  }
}

function convert(c: Converter, doc: FoundryDoc, kind: string, id: string): Draft | null {
  switch (kind) {
    case "weapon":
      return c.weapon(doc, id);
    case "armor":
      return c.armor(doc, id);
    case "gear":
      return c.gear(doc, id);
    case "consumable":
      return c.consumable(doc, id);
    case "spell":
      return c.spell(doc, id);
    case "power":
      return c.power(doc, id);
    case "race":
      return c.race(doc, id);
    case "class":
      return c.klass(doc, id);
    default:
      return null;
  }
}

try {
  main();
} catch (e) {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
