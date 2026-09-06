import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { listModifierTargets, type Modifier, type SystemDefinition } from "@tormenta-vtt/shared";
import { newId } from "../../lib/ids";
import { NumInput, SectionTitle, Select, TextInput, smallBtn } from "./fields";

interface Props {
  def: SystemDefinition;
  modifiers: Modifier[];
  canEdit: boolean;
  onChange: (modifiers: Modifier[]) => void;
}

/**
 * Modificadores: bônus/penalidades com alvo textual (attr.for, skill[tag=ataque]...).
 * A lista de alvos vem do JSON do sistema; o componente não conhece nenhuma chave.
 */
export const CharacterModifiers: React.FC<Props> = ({ def, modifiers, canEdit, onChange }) => {
  const targets = listModifierTargets(def);
  const patch = (id: string, p: Partial<Modifier>) => onChange(modifiers.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const add = () =>
    onChange([...modifiers, { id: newId(), label: "", target: targets[0]?.value ?? "attack", value: 1, source: null, enabled: true }]);

  return (
    <section id="sheet-modifiers">
      <SectionTitle
        right={
          canEdit && (
            <button onClick={add} className={smallBtn} id="btn-add-modifier">
              <Plus className="w-3 h-3" /> Modificador
            </button>
          )
        }
      >
        Modificadores
      </SectionTitle>
      {modifiers.length === 0 ? (
        <p className="text-[11px] text-zinc-600 italic">Nenhum. Use para poderes, condições e bônus de itens.</p>
      ) : (
        <div className="space-y-1">
          {modifiers.map((m) => (
            <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={m.enabled}
                disabled={!canEdit}
                onChange={(e) => patch(m.id, { enabled: e.target.checked })}
                title="Ativo"
                className="accent-[#d4af37]"
              />
              <TextInput value={m.label} onCommit={(label) => patch(m.id, { label })} disabled={!canEdit} placeholder="Origem (ex.: Poção)" className="flex-1 min-w-0" maxLength={80} />
              <Select value={m.target} onChange={(target) => patch(m.id, { target })} options={targets} disabled={!canEdit} className="w-40" />
              <NumInput value={m.value} onCommit={(v) => patch(m.id, { value: v ?? 0 })} disabled={!canEdit} />
              {canEdit && (
                <button onClick={() => onChange(modifiers.filter((x) => x.id !== m.id))} className="text-zinc-600 hover:text-red-400 cursor-pointer" title="Remover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
