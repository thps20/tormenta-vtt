import React, { useState } from "react";
import { CheckCircle2, Circle, Plus, Sliders, Trash2 } from "lucide-react";
import { listModifierTargets, type Character, type CharacterPatch, type Modifier, type SystemDefinition } from "@tormenta-vtt/shared";
import { newId } from "../../lib/ids";
import { NumInput, Select, TextInput, smallBtn } from "./fields";

interface ModifiersSectionProps {
  def: SystemDefinition;
  character: Character;
  canEdit: boolean;
  onPatch: (patch: CharacterPatch) => void;
}

/**
 * Modificadores: bônus/penalidades com alvo textual (attr.for, skill[tag=ataque]...).
 * A lista de alvos vem do JSON do sistema (listModifierTargets); ligar/desligar
 * funciona fora do modo edição, porque condições mudam no meio do combate.
 */
export const ModifiersSection: React.FC<ModifiersSectionProps> = ({ def, character, canEdit, onPatch }) => {
  const targets = listModifierTargets(def);
  const [isAdding, setIsAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState(targets[0]?.value ?? "attack");
  const [value, setValue] = useState(1);

  const modifiers = character.modifiers;
  const setModifiers = (next: Modifier[]) => onPatch({ modifiers: next });
  const patch = (id: string, p: Partial<Modifier>) => setModifiers(modifiers.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const targetLabel = (t: string) => targets.find((x) => x.value === t)?.label ?? t;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setModifiers([...modifiers, { id: newId(), label: label.trim(), target, value: Math.round(value), source: null, enabled: true }]);
    setLabel("");
    setValue(1);
    setIsAdding(false);
  };

  return (
    <div className="p-4 bg-[#0d0d0d] border-b border-[#2d2417]">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-[#d4af37]" />
          <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Modificadores</h3>
        </div>
        {canEdit && (
          <button onClick={() => setIsAdding(!isAdding)} className={smallBtn} id="btn-add-modifier">
            <Plus className="w-3.5 h-3.5" />
            <span>Novo modificador</span>
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={submit} className="p-3 bg-[#161412] border border-[#d4af37]/50 rounded-lg mb-3 space-y-2.5 text-xs text-zinc-200">
          <div className="font-serif font-bold text-[#d4af37]">Adicionar condição / bônus</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="block text-[10px] text-zinc-400 font-serif mb-0.5">Nome / origem</span>
              <input
                type="text"
                placeholder="Ex.: Bênção"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                maxLength={80}
                className="w-full bg-[#0a0a0a] border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-[#d4af37]"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-zinc-400 font-serif mb-0.5">Alvo</span>
              <Select value={target} onChange={setTarget} options={targets} className="w-full py-1" />
            </label>
            <label className="block">
              <span className="block text-[10px] text-zinc-400 font-serif mb-0.5">Bônus (+ / −)</span>
              <NumInput value={value} onCommit={(v) => setValue(v ?? 0)} className="w-full py-1" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setIsAdding(false)} className="px-3 py-1 rounded bg-[#222] text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer">
              Cancelar
            </button>
            <button type="submit" className="px-3 py-1 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-xs hover:bg-amber-300 cursor-pointer">
              Salvar
            </button>
          </div>
        </form>
      )}

      {modifiers.length === 0 ? (
        <div className="py-4 text-center text-zinc-500 font-serif text-xs border border-dashed border-[#242018] rounded">Nenhum modificador ativo. Use para poderes, condições e bônus temporários.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {modifiers.map((mod) => {
            const isPositive = mod.value >= 0;
            return (
              <div key={mod.id} className={`flex items-center justify-between p-2 rounded border transition-colors ${mod.enabled ? "bg-[#181613] border-[#382f20]" : "bg-[#121212] border-[#222] opacity-60"}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => patch(mod.id, { enabled: !mod.enabled })} disabled={!canEdit} className="text-zinc-400 hover:text-[#d4af37] cursor-pointer disabled:cursor-default" title={mod.enabled ? "Desativar" : "Ativar"}>
                    {mod.enabled ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4 text-zinc-600" />}
                  </button>
                  <div className="min-w-0">
                    {canEdit ? (
                      <TextInput value={mod.label} onCommit={(v) => patch(mod.id, { label: v })} placeholder="Origem" className="font-serif font-bold w-36 py-0" maxLength={80} />
                    ) : (
                      <div className="text-xs font-serif font-bold text-zinc-200 truncate">{mod.label || "(sem nome)"}</div>
                    )}
                    <div className="text-[10px] text-zinc-500 font-mono truncate" title={mod.target}>
                      Alvo: <span className="text-amber-300 font-semibold">{targetLabel(mod.target)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {canEdit ? (
                    <NumInput value={mod.value} onCommit={(v) => patch(mod.id, { value: Math.round(v ?? 0) })} className={`font-bold ${isPositive ? "text-emerald-300" : "text-red-300"}`} />
                  ) : (
                    <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded border ${isPositive ? "bg-emerald-950/60 text-emerald-300 border-emerald-900/60" : "bg-red-950/60 text-red-300 border-red-900/60"}`}>
                      {isPositive ? `+${mod.value}` : mod.value}
                    </span>
                  )}
                  {canEdit && (
                    <button onClick={() => setModifiers(modifiers.filter((m) => m.id !== mod.id))} className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors cursor-pointer" title="Excluir modificador">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
