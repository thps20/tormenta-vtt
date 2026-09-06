import React, { useState } from "react";
import { ChevronDown, ChevronRight, Dices, Plus, Trash2 } from "lucide-react";
import {
  createDefaultItem,
  type Action,
  type CharacterItem,
  type CharacterRollRequest,
  type ItemKindDef,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { newId } from "../../lib/ids";
import { NumInput, SectionTitle, Select, TextArea, TextInput, rollBtn, smallBtn } from "./fields";

interface Props {
  def: SystemDefinition;
  items: CharacterItem[];
  canEdit: boolean;
  onChange: (items: CharacterItem[]) => void;
  onRoll: (request: CharacterRollRequest) => void;
}

const ACTION_KINDS: { kind: Action["kind"]; label: string }[] = [
  { kind: "attack", label: "Ataque" },
  { kind: "damage", label: "Dano" },
  { kind: "check", label: "Teste" },
  { kind: "formula", label: "Fórmula" },
];

/** Ação nova de cada tipo, com defaults vindos do sistema (primeira perícia de ataque etc.). */
function newAction(def: SystemDefinition, kind: Action["kind"]): Action {
  const id = newId();
  const attackSkill = def.attackSkills[0] ?? def.skills[0]?.key ?? "skill";
  switch (kind) {
    case "attack":
      return { id, label: "Ataque", kind, skill: attackSkill, attributeOverride: null, bonus: 0, critRange: 20, critMult: 2 };
    case "damage":
      return { id, label: "Dano", kind, formula: "1d6", attribute: "auto", damageType: def.damageTypes[0]?.key ?? null, bonus: 0 };
    case "check":
      return { id, label: "Teste", kind, skill: def.skills[0]?.key ?? "skill", bonus: 0 };
    case "formula":
      return { id, label: "Fórmula", kind, formula: "1d20" };
  }
}

/**
 * Itens da ficha. Os campos de cada tipo (arma, armadura, magia...) vêm de
 * itemKinds[] do JSON; os stats de equipamento, de equipStats[].
 */
export const CharacterItems: React.FC<Props> = ({ def, items, canEdit, onChange, onRoll }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newKind, setNewKind] = useState(def.itemKinds[0]?.key ?? "");
  const kinds = new Map(def.itemKinds.map((k) => [k.key, k]));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const patchItem = (id: string, p: Partial<CharacterItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const add = () => {
    if (!newKind) return;
    const item = createDefaultItem(def, newKind, newId());
    onChange([...items, item]);
    setExpanded((s) => new Set(s).add(item.id));
  };

  return (
    <section id="sheet-items">
      <SectionTitle
        right={
          canEdit && (
            <div className="flex items-center gap-1">
              <Select value={newKind} onChange={setNewKind} options={def.itemKinds.map((k) => ({ value: k.key, label: k.label }))} className="w-36" />
              <button onClick={add} className={smallBtn} id="btn-add-item" disabled={!newKind}>
                <Plus className="w-3 h-3" /> Item
              </button>
            </div>
          )
        }
      >
        Itens
      </SectionTitle>
      {items.length === 0 ? (
        <p className="text-[11px] text-zinc-600 italic">Nenhum item.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              def={def}
              kind={kinds.get(item.kind)}
              item={item}
              canEdit={canEdit}
              expanded={expanded.has(item.id)}
              onToggle={() => toggle(item.id)}
              onPatch={(p) => patchItem(item.id, p)}
              onRemove={() => onChange(items.filter((i) => i.id !== item.id))}
              onRoll={(actionId) => onRoll({ type: "action", itemId: item.id, actionId })}
            />
          ))}
        </div>
      )}
    </section>
  );
};

interface ItemCardProps {
  def: SystemDefinition;
  kind: ItemKindDef | undefined;
  item: CharacterItem;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<CharacterItem>) => void;
  onRemove: () => void;
  onRoll: (actionId: string) => void;
}

const ItemCard: React.FC<ItemCardProps> = ({ def, kind, item, canEdit, expanded, onToggle, onPatch, onRemove, onRoll }) => {
  const physical = kind?.physical ?? true;
  const patchAction = (id: string, p: Partial<Action>) =>
    onPatch({ actions: item.actions.map((a) => (a.id === id ? ({ ...a, ...p } as Action) : a)) });

  return (
    <div className={`rounded border ${item.equipped ? "border-[#d4af37]/40 bg-[#2d2417]/20" : "border-[#2d2417] bg-black/20"}`}>
      {/* Linha resumo: nome, tipo, ações roláveis */}
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px]">
        <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-200 cursor-pointer" title={expanded ? "Recolher" : "Editar"}>
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {physical && (
          <input
            type="checkbox"
            checked={item.equipped}
            disabled={!canEdit}
            onChange={(e) => onPatch({ equipped: e.target.checked })}
            title="Equipado (conta para Defesa/penalidades)"
            className="accent-[#d4af37]"
          />
        )}
        <span className="font-semibold text-zinc-100 truncate">{item.name}</span>
        <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider shrink-0">{kind?.label ?? item.kind}</span>
        {physical && item.quantity !== 1 && <span className="text-zinc-500 font-mono">×{item.quantity}</span>}
        <span className="flex-1" />
        {item.actions.map((a) => (
          <button
            key={a.id}
            onClick={() => onRoll(a.id)}
            disabled={!canEdit}
            title={`Rolar ${a.label}`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d4af37]/40 bg-[#2d2417]/40 text-[#d4af37] hover:bg-[#3d311f] text-[10px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Dices className="w-3 h-3" />
            {a.label}
          </button>
        ))}
      </div>

      {expanded && (
        <div className="border-t border-[#2d2417] px-2 py-2 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-zinc-400">
              Nome
              <TextInput value={item.name} onCommit={(name) => name.trim() && onPatch({ name: name.trim() })} disabled={!canEdit} className="w-44" maxLength={80} />
            </label>
            {physical && (
              <>
                <label className="flex items-center gap-1 text-zinc-400">
                  Qtd.
                  <NumInput value={item.quantity} onCommit={(v) => onPatch({ quantity: Math.max(0, Math.floor(v ?? 0)) })} disabled={!canEdit} />
                </label>
                <label className="flex items-center gap-1 text-zinc-400">
                  Espaços
                  <NumInput value={item.slots} onCommit={(v) => onPatch({ slots: Math.max(0, v ?? 0) })} disabled={!canEdit} />
                </label>
                <label className="flex items-center gap-1 text-zinc-400">
                  Preço
                  <NumInput value={item.price} onCommit={(v) => onPatch({ price: Math.max(0, v ?? 0) })} disabled={!canEdit} className="w-16" />
                </label>
              </>
            )}
            {kind?.fields.map((f) => (
              <label key={f.key} className="flex items-center gap-1 text-zinc-400">
                {f.label}
                {f.type === "enum" ? (
                  <Select
                    value={String(item.fields[f.key] ?? "")}
                    onChange={(v) => onPatch({ fields: { ...item.fields, [f.key]: v } })}
                    options={(f.options ?? []).map((o) => ({ value: o.key, label: o.label }))}
                    disabled={!canEdit}
                  />
                ) : f.type === "number" ? (
                  <NumInput value={Number(item.fields[f.key] ?? 0)} onCommit={(v) => onPatch({ fields: { ...item.fields, [f.key]: v ?? 0 } })} disabled={!canEdit} />
                ) : f.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(item.fields[f.key])}
                    disabled={!canEdit}
                    onChange={(e) => onPatch({ fields: { ...item.fields, [f.key]: e.target.checked } })}
                    className="accent-[#d4af37]"
                  />
                ) : (
                  <TextInput value={String(item.fields[f.key] ?? "")} onCommit={(v) => onPatch({ fields: { ...item.fields, [f.key]: v } })} disabled={!canEdit} className="w-40" maxLength={500} />
                )}
              </label>
            ))}
          </div>

          {kind && kind.statBonuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500">Quando equipado:</span>
              {kind.statBonuses.map((statKey) => {
                const stat = def.equipStats.find((s) => s.key === statKey);
                return (
                  <label key={statKey} className="flex items-center gap-1 text-zinc-400" title={`Vazio = este item não define ${stat?.label ?? statKey}`}>
                    {stat?.label ?? statKey}
                    <NumInput
                      value={item.statBonuses[statKey] ?? null}
                      allowEmpty
                      placeholder="—"
                      onCommit={(v) => {
                        const next = { ...item.statBonuses };
                        if (v === null) delete next[statKey];
                        else next[statKey] = v;
                        onPatch({ statBonuses: next });
                      }}
                      disabled={!canEdit}
                    />
                  </label>
                );
              })}
            </div>
          )}

          {/* Ações */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Ações</span>
              {canEdit &&
                ACTION_KINDS.map((k) => (
                  <button key={k.kind} onClick={() => onPatch({ actions: [...item.actions, newAction(def, k.kind)] })} className={smallBtn}>
                    <Plus className="w-3 h-3" /> {k.label}
                  </button>
                ))}
            </div>
            {item.actions.map((a) => (
              <ActionRow
                key={a.id}
                def={def}
                action={a}
                canEdit={canEdit}
                onPatch={(p) => patchAction(a.id, p)}
                onRemove={() => onPatch({ actions: item.actions.filter((x) => x.id !== a.id) })}
                onRoll={() => onRoll(a.id)}
              />
            ))}
          </div>

          <TextArea value={item.description} onCommit={(description) => onPatch({ description })} disabled={!canEdit} placeholder="Descrição" rows={2} />

          {canEdit && (
            <button onClick={onRemove} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer">
              <Trash2 className="w-3 h-3" /> Remover item
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface ActionRowProps {
  def: SystemDefinition;
  action: Action;
  canEdit: boolean;
  onPatch: (p: Partial<Action>) => void;
  onRemove: () => void;
  onRoll: () => void;
}

const ActionRow: React.FC<ActionRowProps> = ({ def, action, canEdit, onPatch, onRemove, onRoll }) => {
  const attackSkills = (def.attackSkills.length ? def.skills.filter((s) => def.attackSkills.includes(s.key)) : def.skills).map((s) => ({ value: s.key, label: s.label }));
  const allSkills = def.skills.filter((s) => !s.variants).map((s) => ({ value: s.key, label: s.label }));
  const attrOptions = def.attributes.map((a) => ({ value: a.key, label: a.abbr }));
  const kindLabel = ACTION_KINDS.find((k) => k.kind === action.kind)?.label ?? action.kind;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-[#2d2417]">
      <button onClick={onRoll} disabled={!canEdit} className={rollBtn} title="Rolar">
        <Dices className="w-3.5 h-3.5" />
      </button>
      <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider">{kindLabel}</span>
      <TextInput value={action.label} onCommit={(label) => label.trim() && onPatch({ label: label.trim() })} disabled={!canEdit} className="w-24" maxLength={60} />

      {action.kind === "attack" && (
        <>
          <Select value={action.skill} onChange={(skill) => onPatch({ skill })} options={attackSkills} disabled={!canEdit} title="Perícia do ataque" />
          <Select
            value={action.attributeOverride ?? ""}
            onChange={(v) => onPatch({ attributeOverride: v || null })}
            options={[{ value: "", label: "atributo padrão" }, ...attrOptions]}
            disabled={!canEdit}
            title="Trocar o atributo da perícia (ex.: arma ágil)"
          />
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} disabled={!canEdit} />
          </label>
          <label className="flex items-center gap-1 text-zinc-500">
            crítico <NumInput value={action.critRange} onCommit={(v) => onPatch({ critRange: Math.max(1, v ?? 20) })} disabled={!canEdit} title="Margem de crítico (natural ≥)" />
            ×<NumInput value={action.critMult} onCommit={(v) => onPatch({ critMult: Math.max(1, v ?? 2) })} disabled={!canEdit} className="w-8" title="Multiplicador" />
          </label>
        </>
      )}

      {action.kind === "damage" && (
        <>
          <TextInput value={action.formula} onCommit={(formula) => formula.trim() && onPatch({ formula: formula.trim() })} disabled={!canEdit} className="w-20 font-mono" maxLength={200} placeholder="1d8" />
          <Select
            value={action.attribute === null ? "none" : action.attribute}
            onChange={(v) => onPatch({ attribute: v === "none" ? null : v })}
            options={[{ value: "auto", label: "atributo: auto" }, { value: "none", label: "sem atributo" }, ...attrOptions.map((a) => ({ value: a.value, label: `+ ${a.label}` }))]}
            disabled={!canEdit}
            title="Atributo somado ao dano"
          />
          {def.damageTypes.length > 0 && (
            <Select
              value={action.damageType ?? ""}
              onChange={(v) => onPatch({ damageType: v || null })}
              options={[{ value: "", label: "tipo —" }, ...def.damageTypes.map((d) => ({ value: d.key, label: d.label }))]}
              disabled={!canEdit}
            />
          )}
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} disabled={!canEdit} />
          </label>
        </>
      )}

      {action.kind === "check" && (
        <>
          <Select value={action.skill} onChange={(skill) => onPatch({ skill })} options={allSkills} disabled={!canEdit} />
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} disabled={!canEdit} />
          </label>
        </>
      )}

      {action.kind === "formula" && (
        <TextInput
          value={action.formula}
          onCommit={(formula) => formula.trim() && onPatch({ formula: formula.trim() })}
          disabled={!canEdit}
          className="w-48 font-mono"
          maxLength={200}
          placeholder="1d20 + {skill.luta}"
        />
      )}

      {canEdit && (
        <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 cursor-pointer" title="Remover ação">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
