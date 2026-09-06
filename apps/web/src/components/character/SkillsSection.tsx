import React, { useState } from "react";
import { Dices, Plus, Search, ShieldAlert, Star } from "lucide-react";
import {
  listSkillKeys,
  skillDefFor,
  type Character,
  type CharacterPatch,
  type CharacterRollRequest,
  type CharacterSkill,
  type ComputedCharacter,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { NumInput, Select, smallBtn } from "./fields";

interface SkillsSectionProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  canEdit: boolean;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
}

const EMPTY: CharacterSkill = { trained: false, other: 0, attribute: null };

/** "Alquimia" -> "alquimia" (chave de variante: só [a-z0-9_]). */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Perícias: lista vem de listSkillKeys (fixas + variantes que a ficha tem);
 * o total vem de computeCharacter. Clique rola; modo edição marca treino,
 * troca o atributo e digita "outros".
 */
export const SkillsSection: React.FC<SkillsSectionProps> = ({ def, character, computed, canEdit, isEditMode, onPatch, onRoll }) => {
  const [filterQuery, setFilterQuery] = useState("");
  const [filterTrainedOnly, setFilterTrainedOnly] = useState(false);
  const [variantName, setVariantName] = useState("");
  const [variantOf, setVariantOf] = useState(def.skills.find((s) => s.variants)?.key ?? "");
  const variantSkills = def.skills.filter((s) => s.variants);
  const canRoll = canEdit && !isEditMode;

  const keys = listSkillKeys(def, character);
  const trainedCount = keys.filter((k) => computed.skills[k]?.trained).length;
  const query = filterQuery.trim().toLowerCase();
  const visibleKeys = keys.filter((key) => {
    const c = computed.skills[key];
    if (!c) return false;
    if (filterTrainedOnly && !c.trained) return false;
    if (!query) return true;
    const attrAbbr = def.attributes.find((a) => a.key === c.attribute)?.abbr ?? "";
    return c.label.toLowerCase().includes(query) || key.includes(query) || attrAbbr.toLowerCase().includes(query);
  });

  const setSkill = (key: string, patch: Partial<CharacterSkill>) => {
    const current = character.skills[key] ?? EMPTY;
    onPatch({ skills: { ...character.skills, [key]: { ...current, ...patch } } });
  };
  const addVariant = () => {
    const slug = slugify(variantName);
    if (!variantOf || !slug) return;
    const key = `${variantOf}:${slug}`;
    if (character.skills[key]) return;
    onPatch({ skills: { ...character.skills, [key]: { trained: true, other: 0, attribute: null, label: variantName.trim() } } });
    setVariantName("");
  };
  const removeVariant = (key: string) => {
    const { [key]: _drop, ...rest } = character.skills;
    onPatch({ skills: rest });
  };

  return (
    <div className="p-4 bg-[#0f0f0f] border-b border-[#2d2417]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Perícias</h3>
          <p className="text-[11px] text-zinc-500 font-serif">{isEditMode ? "Marque perícias treinadas e adicione bônus manuais" : canRoll ? "Clique em uma perícia para rolar o teste" : ""}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterTrainedOnly((prev) => !prev)}
            className={`px-2 py-1 rounded text-xs font-serif transition-colors border cursor-pointer ${
              filterTrainedOnly ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]" : "bg-[#181818] text-zinc-400 border-zinc-700 hover:text-zinc-200"
            }`}
          >
            Treinadas ({trainedCount})
          </button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar perícia…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-36 sm:w-44 bg-[#141414] border border-zinc-700 focus:border-[#d4af37] rounded pl-7 pr-2 py-1 text-xs text-zinc-200 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isEditMode ? "" : "lg:grid-cols-3"} gap-1.5 max-h-72 overflow-y-auto pr-1`}>
        {visibleKeys.map((key) => {
          const sdef = skillDefFor(def, key);
          const c = computed.skills[key];
          if (!sdef || !c) return null;
          const cs = character.skills[key] ?? EMPTY;
          const attrAbbr = def.attributes.find((a) => a.key === c.attribute)?.abbr ?? c.attribute;
          const rollable = canRoll && c.usable;
          const isVariant = key.includes(":");

          return (
            <div
              key={key}
              id={`skill-row-${key}`}
              onClick={() => rollable && onRoll({ type: "skill", key })}
              className={`flex items-center justify-between p-2 rounded border transition-all select-none ${
                rollable
                  ? "bg-[#141311] border-[#292218] hover:border-[#d4af37] hover:bg-[#1f1b14] cursor-pointer group active:scale-[0.99]"
                  : "bg-[#161616] border-zinc-800"
              } ${!c.usable ? "opacity-60" : ""}`}
              title={rollable ? `Rolar ${c.label} (${def.rolls.skillCheck.replace("{skill}", signed(c.total))})` : !c.usable ? "Só quem é treinado pode usar" : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isEditMode ? (
                  <input type="checkbox" checked={cs.trained} onChange={(e) => setSkill(key, { trained: e.target.checked })} className="accent-[#d4af37] cursor-pointer" title="Treinada" />
                ) : (
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                      c.trained ? "bg-[#d4af37]/20 border border-[#d4af37] text-[#d4af37]" : "bg-zinc-800/40 border border-zinc-700 text-zinc-600"
                    }`}
                    title={c.trained ? "Treinada" : "Não treinada"}
                  >
                    {c.trained ? <Star className="w-2.5 h-2.5 fill-[#d4af37]" /> : "·"}
                  </div>
                )}

                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-serif truncate ${c.trained ? "text-amber-100 font-bold" : "text-zinc-300 font-semibold"}`}>{c.label}</span>
                    {sdef.trainedOnly && (
                      <span className="text-zinc-600 text-[10px]" title="Só treinados">
                        *
                      </span>
                    )}
                    {sdef.armorPenalty && (
                      <span title="Sofre penalidade de armadura">
                        <ShieldAlert className="w-3 h-3 text-red-400 shrink-0" />
                      </span>
                    )}
                    {isVariant && isEditMode && (
                      <button onClick={() => removeVariant(key)} className="text-zinc-600 hover:text-red-400 cursor-pointer text-xs" title="Remover variante">
                        ×
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase font-mono">
                    {isEditMode ? (
                      <Select
                        value={cs.attribute ?? ""}
                        onChange={(v) => setSkill(key, { attribute: v || null })}
                        options={[{ value: "", label: `${def.attributes.find((a) => a.key === sdef.attribute)?.abbr ?? sdef.attribute} (padrão)` }, ...def.attributes.map((a) => ({ value: a.key, label: a.abbr }))]}
                        className="py-0 text-[9px]"
                        title="Atributo (padrão ou alternativo)"
                      />
                    ) : (
                      <span className="bg-[#1c1a16] border border-zinc-700 px-1 rounded text-zinc-400">{attrAbbr}</span>
                    )}
                    {sdef.tags.map((t) => (
                      <span key={t} className="text-zinc-600">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {isEditMode ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500">Outros:</span>
                    <NumInput value={cs.other} onCommit={(v) => setSkill(key, { other: Math.floor(v ?? 0) })} className="w-10 py-0.5" />
                    <span className="text-xs font-mono font-bold text-[#d4af37] w-8 text-right">{signed(c.total)}</span>
                  </div>
                ) : (
                  <>
                    <span className={`text-sm font-mono font-bold ${c.trained ? "text-[#d4af37]" : "text-zinc-400"} group-hover:text-amber-200`}>{signed(c.total)}</span>
                    <Dices className="w-3.5 h-3.5 text-zinc-600 group-hover:text-[#d4af37] transition-colors" />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isEditMode && variantSkills.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <Select value={variantOf} onChange={setVariantOf} options={variantSkills.map((s) => ({ value: s.key, label: s.label }))} />
          <input
            value={variantName}
            onChange={(e) => setVariantName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addVariant()}
            placeholder="Especialidade (ex.: Alquimia)"
            maxLength={40}
            className="bg-[#0c0c0c] border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-[#d4af37] w-44"
          />
          <button onClick={addVariant} className={smallBtn} disabled={!variantName.trim()}>
            <Plus className="w-3 h-3" /> Adicionar
          </button>
        </div>
      )}
      <p className="mt-1 text-[10px] text-zinc-600">* só treinados</p>
    </div>
  );
};
