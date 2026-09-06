import React, { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  AttributeBonusesValueSchema,
  AttributeChoiceValueSchema,
  SkillGrantsValueSchema,
  chosenAttributes,
  chosenSkills,
  type AttributeBonusesValue,
  type AttributeChoiceValue,
  type ItemFieldDef,
  type ItemFieldValue,
  type SkillGrantsValue,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { NumInput, Select, ghostBtn } from "./fields";

/**
 * Campos estruturados de item (tipos attributeBonuses, attributeChoice,
 * skillGrants e size de ItemFieldDef). Cada um tem:
 *   - um resumo em texto para o cartão do item (summarizeField);
 *   - um editor para o modo edição (define o que o item oferece);
 *   - quando há escolha, chips que funcionam também fora do modo edição,
 *     porque escolher a perícia do Guerreiro não é "editar a ficha".
 * Os nomes de atributos e perícias vêm sempre do JSON do sistema.
 */

const attrAbbr = (def: SystemDefinition, key: string) => def.attributes.find((a) => a.key === key)?.abbr ?? key;
const skillLabel = (def: SystemDefinition, key: string) => def.skills.find((s) => s.key === key.split(":")[0])?.label ?? key;

/** Texto curto do valor de um campo estruturado (null = nada a mostrar). */
export function summarizeField(def: SystemDefinition, field: ItemFieldDef, value: ItemFieldValue | undefined): string | null {
  switch (field.type) {
    case "attributeBonuses": {
      const parsed = AttributeBonusesValueSchema.safeParse(value);
      if (!parsed.success) return null;
      const parts = def.attributes.filter((a) => (parsed.data[a.key] ?? 0) !== 0).map((a) => `${a.abbr} ${signed(parsed.data[a.key] ?? 0)}`);
      return parts.length ? parts.join(", ") : null;
    }
    case "attributeChoice": {
      const parsed = AttributeChoiceValueSchema.safeParse(value);
      if (!parsed.success || parsed.data.count === 0) return null;
      const chosen = chosenAttributes(def, parsed.data).map((k) => attrAbbr(def, k));
      return `${signed(parsed.data.amount)} em ${parsed.data.count}${chosen.length ? `: ${chosen.join(", ")}` : ""}`;
    }
    case "skillGrants": {
      const parsed = SkillGrantsValueSchema.safeParse(value);
      if (!parsed.success) return null;
      const keys = [...parsed.data.fixed, ...parsed.data.choices.flatMap((c) => chosenSkills(def, c))];
      return keys.length ? keys.map((k) => skillLabel(def, k)).join(", ") : null;
    }
    case "size":
      return def.sizes.find((s) => s.key === value)?.label ?? null;
    default:
      return null;
  }
}

const chip = (active: boolean, disabled: boolean) =>
  `px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors ${
    active ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37] font-bold" : "bg-[#141414] border-zinc-700 text-zinc-400"
  } ${disabled ? "opacity-50 cursor-default" : "cursor-pointer hover:border-[#d4af37]"}`;

// --- attributeBonuses --------------------------------------------------------

export const AttributeBonusesEditor: React.FC<{ def: SystemDefinition; value: ItemFieldValue | undefined; onChange: (v: AttributeBonusesValue) => void }> = ({ def, value, onChange }) => {
  const current = AttributeBonusesValueSchema.safeParse(value);
  const bonuses: AttributeBonusesValue = current.success ? current.data : {};
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {def.attributes.map((a) => (
        <label key={a.key} className="flex items-center gap-1 text-zinc-500 text-[10px] font-mono">
          {a.abbr}
          <NumInput
            value={bonuses[a.key] ?? 0}
            onCommit={(v) => {
              const next = { ...bonuses };
              const n = Math.round(v ?? 0);
              if (n === 0) delete next[a.key];
              else next[a.key] = n;
              onChange(next);
            }}
            className="w-10 py-0"
          />
        </label>
      ))}
    </div>
  );
};

// --- attributeChoice ---------------------------------------------------------

interface AttributeChoiceProps {
  def: SystemDefinition;
  value: ItemFieldValue | undefined;
  /** Pode marcar/desmarcar a escolha (GM ou dono). */
  canChoose: boolean;
  /** Modo edição: também mostra quantidade, valor e exclusões. */
  isEditMode: boolean;
  onChange: (v: AttributeChoiceValue) => void;
}

export const AttributeChoiceField: React.FC<AttributeChoiceProps> = ({ def, value, canChoose, isEditMode, onChange }) => {
  const parsed = AttributeChoiceValueSchema.safeParse(value);
  const choice: AttributeChoiceValue = parsed.success ? parsed.data : { amount: 1, count: 1, exclude: [], chosen: [] };
  if (!isEditMode && choice.count === 0) return null;
  const valid = chosenAttributes(def, choice);
  const full = valid.length >= choice.count;
  const toggle = (key: string) => {
    const has = choice.chosen.includes(key);
    if (!has && full) return;
    onChange({ ...choice, chosen: has ? choice.chosen.filter((k) => k !== key) : [...choice.chosen, key] });
  };
  const toggleExclude = (key: string) => {
    const has = choice.exclude.includes(key);
    onChange({ ...choice, exclude: has ? choice.exclude.filter((k) => k !== key) : [...choice.exclude, key], chosen: choice.chosen.filter((k) => k !== key) });
  };

  return (
    <div className="space-y-1 text-[11px]">
      {isEditMode && (
        <div className="flex flex-wrap items-center gap-2 text-zinc-400">
          <label className="flex items-center gap-1">
            Bônus <NumInput value={choice.amount} onCommit={(v) => onChange({ ...choice, amount: Math.round(v ?? 0) })} className="w-10 py-0" />
          </label>
          <label className="flex items-center gap-1">
            em <NumInput value={choice.count} onCommit={(v) => onChange({ ...choice, count: Math.max(0, Math.round(v ?? 0)) })} className="w-10 py-0" /> atributos
          </label>
          <span className="text-zinc-500">Exceto:</span>
          {def.attributes.map((a) => (
            <button key={a.key} type="button" onClick={() => toggleExclude(a.key)} className={chip(choice.exclude.includes(a.key), false)} title={choice.exclude.includes(a.key) ? "Permitir" : "Excluir da escolha"}>
              {a.abbr}
            </button>
          ))}
        </div>
      )}
      {choice.count > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[10px] font-serif ${full ? "text-zinc-500" : "text-amber-300"}`}>
            {full ? `${signed(choice.amount)} em:` : `Escolha ${choice.count - valid.length} atributo(s) para ${signed(choice.amount)}:`}
          </span>
          {def.attributes
            .filter((a) => !choice.exclude.includes(a.key))
            .map((a) => {
              const active = valid.includes(a.key);
              const disabled = !canChoose || (!active && full);
              return (
                <button key={a.key} type="button" disabled={disabled} onClick={() => toggle(a.key)} className={chip(active, disabled)} title={active ? "Desmarcar" : "Escolher"}>
                  {a.abbr}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
};

// --- skillGrants -------------------------------------------------------------

/** Lista de perícias com checkboxes, recolhida num botão (29 perícias não cabem em chips). */
const SkillPicker: React.FC<{ def: SystemDefinition; label: string; selected: string[]; onChange: (keys: string[]) => void; emptyLabel?: string }> = ({ def, label, selected, onChange, emptyLabel = "nenhuma" }) => {
  const [open, setOpen] = useState(false);
  const skills = def.skills.filter((s) => !s.variants);
  const names = selected.map((k) => skillLabel(def, k)).join(", ");
  return (
    <div className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className={ghostBtn}>
        <span className="text-zinc-500">{label}:</span> <span className="text-zinc-200 max-w-[16rem] truncate">{names || emptyLabel}</span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5 p-2 rounded bg-[#0f0f0f] border border-[#2d2417] max-h-40 overflow-y-auto text-[10px]">
          {skills.map((s) => (
            <label key={s.key} className="flex items-center gap-1 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(s.key)}
                onChange={(e) => onChange(e.target.checked ? [...selected, s.key] : selected.filter((k) => k !== s.key))}
                className="accent-[#d4af37]"
              />
              {s.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

interface SkillGrantsProps {
  def: SystemDefinition;
  value: ItemFieldValue | undefined;
  canChoose: boolean;
  isEditMode: boolean;
  onChange: (v: SkillGrantsValue) => void;
}

export const SkillGrantsField: React.FC<SkillGrantsProps> = ({ def, value, canChoose, isEditMode, onChange }) => {
  const parsed = SkillGrantsValueSchema.safeParse(value);
  const grants: SkillGrantsValue = parsed.success ? parsed.data : { fixed: [], choices: [] };
  const patchChoice = (index: number, p: Partial<SkillGrantsValue["choices"][number]>) =>
    onChange({ ...grants, choices: grants.choices.map((c, i) => (i === index ? { ...c, ...p } : c)) });
  if (!isEditMode && grants.fixed.length === 0 && grants.choices.length === 0) return null;

  return (
    <div className="space-y-1 text-[11px]">
      {isEditMode ? (
        <div className="flex flex-wrap items-start gap-2">
          <SkillPicker def={def} label="Treinadas" selected={grants.fixed} onChange={(fixed) => onChange({ ...grants, fixed })} />
          {grants.choices.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-[#2d2417]">
              <label className="flex items-center gap-1 text-zinc-400">
                mais <NumInput value={c.count} onCommit={(v) => patchChoice(i, { count: Math.max(1, Math.round(v ?? 1)) })} className="w-8 py-0" />
              </label>
              <SkillPicker def={def} label="entre" selected={c.from} onChange={(from) => patchChoice(i, { from, chosen: c.chosen.filter((k) => from.length === 0 || from.includes(k)) })} emptyLabel="qualquer perícia" />
              <button type="button" onClick={() => onChange({ ...grants, choices: grants.choices.filter((_, j) => j !== i) })} className="text-zinc-600 hover:text-red-400 cursor-pointer" title="Remover grupo de escolha">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...grants, choices: [...grants.choices, { count: 1, from: [], chosen: [] }] })} className={ghostBtn}>
            <Plus className="w-3 h-3" /> grupo "escolha N de…"
          </button>
        </div>
      ) : (
        grants.fixed.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-serif text-zinc-500">Treinadas:</span>
            {grants.fixed.map((k) => (
              <span key={k} className={chip(true, true)}>
                {skillLabel(def, k)}
              </span>
            ))}
          </div>
        )
      )}

      {/* Escolhas: aparecem nos dois modos, para o jogador escolher sem entrar em edição. */}
      {grants.choices.map((c, i) => {
        const valid = chosenSkills(def, c);
        const full = valid.length >= c.count;
        const pool = def.skills.filter((s) => !s.variants && (c.from.length === 0 || c.from.includes(s.key)));
        const toggle = (key: string) => {
          const has = c.chosen.includes(key);
          if (!has && full) return;
          patchChoice(i, { chosen: has ? c.chosen.filter((k) => k !== key) : [...c.chosen, key] });
        };
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-serif ${full ? "text-zinc-500" : "text-amber-300"}`}>{full ? `Escolhidas (${c.count}):` : `Escolha ${c.count - valid.length} perícia(s):`}</span>
            {pool.map((s) => {
              const active = valid.includes(s.key);
              const disabled = !canChoose || (!active && full);
              return (
                <button key={s.key} type="button" disabled={disabled} onClick={() => toggle(s.key)} className={chip(active, disabled)}>
                  {s.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

// --- size --------------------------------------------------------------------

export const SizeField: React.FC<{ def: SystemDefinition; value: ItemFieldValue | undefined; onChange: (key: string) => void }> = ({ def, value, onChange }) => (
  <Select value={typeof value === "string" ? value : ""} onChange={onChange} options={def.sizes.map((s) => ({ value: s.key, label: s.label }))} title="Aplica o tamanho à ficha" />
);
