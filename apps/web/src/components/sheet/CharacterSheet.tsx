import React, { useMemo, useState } from "react";
import { AlertTriangle, Dices, Plus, X } from "lucide-react";
import {
  computeCharacter,
  listSkillKeys,
  skillDefFor,
  type Character,
  type CharacterPatch,
  type CharacterRollRequest,
  type Participant,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { NumInput, SectionTitle, Select, TextArea, TextInput, rollBtn, smallBtn } from "./fields";
import { CharacterItems } from "./CharacterItems";
import { CharacterModifiers } from "./CharacterModifiers";

interface Props {
  def: SystemDefinition;
  character: Character;
  participants: Participant[];
  me: Participant;
  canEdit: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
  onClose: () => void;
}

/**
 * Ficha de personagem (modal). Tudo que aparece vem do JSON do sistema:
 * atributos, perícias, recursos, derivados, traços, moedas, tipos de item.
 * Os valores finais vêm de computeCharacter; a ficha só guarda entradas.
 */
export const CharacterSheet: React.FC<Props> = ({ def, character, participants, me, canEdit, onPatch, onRoll, onClose }) => {
  const isGm = me.role === "gm";
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const ownerName = character.ownerId ? (participants.find((p) => p.id === character.ownerId)?.nickname ?? "Jogador") : "Apenas GM";

  return (
    <div id="character-sheet-overlay" className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-5xl h-[92vh] bg-[#141414] border border-[#2d2417] rounded shadow-2xl flex flex-col text-zinc-200 select-text">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2d2417] bg-[#1a1a1a]">
          {canEdit ? (
            <TextInput
              id="sheet-name"
              value={character.name}
              onCommit={(name) => name.trim() && onPatch({ name: name.trim() })}
              className="text-sm font-serif font-bold text-[#d4af37] w-64 bg-transparent border-transparent border-b-[#2d2417] rounded-none px-0"
              maxLength={80}
            />
          ) : (
            <span className="text-sm font-serif font-bold text-[#d4af37]">{character.name}</span>
          )}
          {isGm ? (
            <Select
              value={character.kind}
              onChange={(kind) => onPatch({ kind: kind === "npc" ? "npc" : "pc" })}
              options={[
                { value: "pc", label: "Personagem" },
                { value: "npc", label: "NPC (só GM)" },
              ]}
            />
          ) : (
            <span className="text-[10px] px-1.5 rounded bg-zinc-800 text-zinc-400 uppercase">{character.kind === "pc" ? "Personagem" : "NPC"}</span>
          )}
          {isGm ? (
            <Select
              value={character.ownerId ?? ""}
              onChange={(v) => onPatch({ ownerId: v || null })}
              options={[{ value: "", label: "Dono: apenas GM" }, ...participants.filter((p) => p.role === "player").map((p) => ({ value: p.id, label: `Dono: ${p.nickname}` }))]}
            />
          ) : (
            <span className="text-[11px] text-zinc-500">Dono: {ownerName}</span>
          )}
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            Nível
            <NumInput id="sheet-level" value={character.level} onCommit={(v) => onPatch({ level: Math.max(0, Math.min(def.level.max, Math.floor(v ?? 0))) })} disabled={!canEdit} />
          </label>
          {def.level.xpTable && (
            <label className="flex items-center gap-1 text-[11px] text-zinc-400" title={`Próximo nível: ${def.level.xpTable[computed.level] ?? "—"} XP`}>
              XP
              <NumInput value={character.xp} onCommit={(v) => onPatch({ xp: Math.max(0, Math.floor(v ?? 0)) })} disabled={!canEdit} className="w-16" />
            </label>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer" title="Fechar" id="sheet-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {computed.warnings.length > 0 && (
          <div className="px-4 py-1.5 bg-red-950/30 border-b border-red-900/40 text-[11px] text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{computed.warnings.join(" • ")}</span>
          </div>
        )}

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-6 gap-y-5">
          <div className="space-y-5">
            {/* Atributos */}
            <section id="sheet-attributes">
              <SectionTitle>Atributos</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {def.attributes.map((a) => {
                  const base = character.attributes[a.key]?.base ?? a.default;
                  const value = computed.attributes[a.key] ?? 0;
                  return (
                    <div key={a.key} className="rounded border border-[#2d2417] bg-black/20 p-2 flex flex-col items-center gap-1">
                      <span className="text-[10px] font-serif font-bold text-[#d4af37] tracking-widest" title={a.label}>
                        {a.abbr}
                      </span>
                      <div className="flex items-center gap-1">
                        <NumInput
                          value={base}
                          onCommit={(v) => onPatch({ attributes: { ...character.attributes, [a.key]: { base: v ?? a.default } } })}
                          disabled={!canEdit}
                          title="Valor base"
                        />
                        {value !== base && (
                          <span className="text-[11px] font-mono text-emerald-400" title="Com modificadores">
                            → {signed(value)}
                          </span>
                        )}
                        <button onClick={() => onRoll({ type: "attribute", key: a.key })} disabled={!canEdit} className={rollBtn} title={`Rolar ${a.label}`}>
                          <Dices className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Recursos */}
            <section id="sheet-resources">
              <SectionTitle>Recursos</SectionTitle>
              <div className="space-y-1.5">
                {def.resources.map((r) => {
                  const cr = character.resources[r.key] ?? { current: 0, temp: 0, maxOverride: null };
                  const c = computed.resources[r.key] ?? { max: 0, min: 0 };
                  const set = (p: Partial<typeof cr>) => onPatch({ resources: { ...character.resources, [r.key]: { ...cr, ...p } } });
                  const pct = c.max > 0 ? Math.max(0, Math.min(100, (cr.current / c.max) * 100)) : 0;
                  return (
                    <div key={r.key} className="rounded border border-[#2d2417] bg-black/20 p-2">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-serif font-bold text-[#d4af37] w-8" title={r.label}>
                          {r.abbr}
                        </span>
                        <NumInput value={cr.current} onCommit={(v) => set({ current: Math.floor(v ?? 0) })} disabled={!canEdit} title="Atual" className="w-14" />
                        <span className="text-zinc-500">/</span>
                        <NumInput
                          value={cr.maxOverride}
                          allowEmpty
                          placeholder={String(c.max)}
                          onCommit={(v) => set({ maxOverride: v === null ? null : Math.floor(v) })}
                          disabled={!canEdit}
                          title={r.maxFormula ? `Máximo (vazio = fórmula: ${r.maxFormula})` : "Máximo"}
                          className="w-14"
                        />
                        {cr.maxOverride !== null && c.max !== cr.maxOverride && <span className="text-[10px] text-emerald-400 font-mono">→ {c.max}</span>}
                        {r.hasTemp && (
                          <label className="flex items-center gap-1 text-zinc-500 ml-2">
                            temp.
                            <NumInput value={cr.temp} onCommit={(v) => set({ temp: Math.max(0, Math.floor(v ?? 0)) })} disabled={!canEdit} />
                          </label>
                        )}
                        {c.min !== 0 && <span className="text-[10px] text-zinc-600 ml-auto font-mono">mín. {c.min}</span>}
                      </div>
                      <div className="mt-1 h-1 rounded bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-[#d4af37]/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Derivados */}
            <section id="sheet-derived">
              <SectionTitle>Derivados</SectionTitle>
              <div className="grid grid-cols-2 gap-1.5">
                {def.derived.map((d) => {
                  const override = character.derivedOverrides[d.key];
                  return (
                    <div key={d.key} className="flex items-center justify-between gap-2 rounded border border-[#2d2417] bg-black/20 px-2 py-1 text-[11px]" title={d.formula}>
                      <span className="text-zinc-400 truncate">{d.label}</span>
                      <div className="flex items-center gap-1">
                        {d.editable && canEdit && (
                          <NumInput
                            value={override ?? null}
                            allowEmpty
                            placeholder="auto"
                            onCommit={(v) => {
                              const next = { ...character.derivedOverrides };
                              if (v === null) delete next[d.key];
                              else next[d.key] = v;
                              onPatch({ derivedOverrides: next });
                            }}
                            title="Forçar um valor (vazio = fórmula)"
                          />
                        )}
                        <span className={`font-mono font-bold ${override !== undefined ? "text-emerald-400" : "text-[#d4af37]"}`}>{computed.derived[d.key] ?? 0}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {def.sizes.length > 0 && (
                  <label className="flex items-center gap-1 text-zinc-400">
                    Tamanho
                    <Select value={character.size ?? ""} onChange={(v) => onPatch({ size: v || null })} options={def.sizes.map((s) => ({ value: s.key, label: s.label }))} disabled={!canEdit} />
                  </label>
                )}
                <label className="flex items-center gap-1 text-zinc-400" title="Entra em {spellcastingAttr} (ex.: CD de magias)">
                  Conjuração
                  <Select
                    value={character.spellcastingAttribute ?? ""}
                    onChange={(v) => onPatch({ spellcastingAttribute: v || null })}
                    options={[{ value: "", label: "—" }, ...def.attributes.map((a) => ({ value: a.key, label: a.abbr }))]}
                    disabled={!canEdit}
                  />
                </label>
                <button onClick={() => onRoll({ type: "initiative" })} disabled={!canEdit} className={smallBtn} title={def.rolls.initiative}>
                  <Dices className="w-3 h-3" /> Iniciativa
                </button>
                {def.extraRolls.map((r) => (
                  <button key={r.key} onClick={() => onRoll({ type: "extra", key: r.key })} disabled={!canEdit} className={smallBtn} title={r.formula}>
                    <Dices className="w-3 h-3" /> {r.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Traços e moedas */}
            {(def.traitFields.length > 0 || def.currencies.length > 0) && (
              <section id="sheet-traits">
                <SectionTitle>Detalhes</SectionTitle>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {def.traitFields.map((t) => (
                    <label key={t.key} className="flex items-center gap-1 text-zinc-400">
                      <span className="w-20 truncate shrink-0">{t.label}</span>
                      {t.type === "enum" ? (
                        <Select
                          value={character.traits[t.key] ?? ""}
                          onChange={(v) => onPatch({ traits: { ...character.traits, [t.key]: v } })}
                          options={[{ value: "", label: "—" }, ...(t.options ?? []).map((o) => ({ value: o.key, label: o.label }))]}
                          disabled={!canEdit}
                          className="flex-1 min-w-0"
                        />
                      ) : (
                        <TextInput value={character.traits[t.key] ?? ""} onCommit={(v) => onPatch({ traits: { ...character.traits, [t.key]: v } })} disabled={!canEdit} className="flex-1 min-w-0" maxLength={500} />
                      )}
                    </label>
                  ))}
                </div>
                {def.currencies.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {def.currencies.map((c) => (
                      <label key={c.key} className="flex items-center gap-1 text-zinc-400" title={c.label}>
                        {c.abbr}
                        <NumInput value={character.currency[c.key] ?? 0} onCommit={(v) => onPatch({ currency: { ...character.currency, [c.key]: Math.max(0, v ?? 0) } })} disabled={!canEdit} className="w-14" />
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="space-y-5">
            <SkillsSection def={def} character={character} computed={computed} canEdit={canEdit} onPatch={onPatch} onRoll={onRoll} />
          </div>

          <div className="lg:col-span-2 space-y-5">
            <CharacterItems def={def} items={character.items} canEdit={canEdit} onChange={(items) => onPatch({ items })} onRoll={onRoll} />
            <CharacterModifiers def={def} modifiers={character.modifiers} canEdit={canEdit} onChange={(modifiers) => onPatch({ modifiers })} />
            <section id="sheet-bio">
              <SectionTitle>Anotações</SectionTitle>
              <TextArea value={character.bio} onCommit={(bio) => onPatch({ bio })} disabled={!canEdit} rows={4} placeholder="História, aparência, notas..." />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SkillsProps {
  def: SystemDefinition;
  character: Character;
  computed: ReturnType<typeof computeCharacter>;
  canEdit: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
}

const SkillsSection: React.FC<SkillsProps> = ({ def, character, computed, canEdit, onPatch, onRoll }) => {
  const [variantName, setVariantName] = useState("");
  const [variantOf, setVariantOf] = useState(def.skills.find((s) => s.variants)?.key ?? "");
  const keys = listSkillKeys(def, character);
  const variantSkills = def.skills.filter((s) => s.variants);

  const setSkill = (key: string, p: Partial<NonNullable<Character["skills"][string]>>) => {
    const current = character.skills[key] ?? { trained: false, other: 0, attribute: null };
    onPatch({ skills: { ...character.skills, [key]: { ...current, ...p } } });
  };
  const addVariant = () => {
    const slug = variantName
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!variantOf || !slug) return;
    const key = `${variantOf}:${slug}`;
    if (character.skills[key]) return;
    onPatch({ skills: { ...character.skills, [key]: { trained: true, other: 0, attribute: null, label: variantName.trim() } } });
    setVariantName("");
  };

  return (
    <section id="sheet-skills">
      <SectionTitle>Perícias</SectionTitle>
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-2 gap-y-0.5 text-[11px] items-center">
        <span className="text-[9px] text-zinc-600 uppercase" title="Treinada">
          T
        </span>
        <span className="text-[9px] text-zinc-600 uppercase">Perícia</span>
        <span className="text-[9px] text-zinc-600 uppercase">Atr.</span>
        <span className="text-[9px] text-zinc-600 uppercase" title="Bônus fixo (outros)">
          Outros
        </span>
        <span className="text-[9px] text-zinc-600 uppercase text-right">Total</span>
        <span />
        {keys.map((key) => {
          const sdef = skillDefFor(def, key);
          const cs = character.skills[key] ?? { trained: false, other: 0, attribute: null };
          const c = computed.skills[key];
          if (!sdef || !c) return null;
          return (
            <React.Fragment key={key}>
              <input type="checkbox" checked={cs.trained} disabled={!canEdit} onChange={(e) => setSkill(key, { trained: e.target.checked })} className="accent-[#d4af37]" />
              <span className={`truncate ${c.usable ? "text-zinc-200" : "text-zinc-500"}`} title={sdef.trainedOnly ? "Só treinados" : undefined}>
                {c.label}
                {sdef.trainedOnly && <span className="text-zinc-600"> *</span>}
                {key.includes(":") && canEdit && (
                  <button
                    onClick={() => {
                      const { [key]: _drop, ...rest } = character.skills;
                      onPatch({ skills: rest });
                    }}
                    className="ml-1 text-zinc-600 hover:text-red-400 cursor-pointer"
                    title="Remover variante"
                  >
                    ×
                  </button>
                )}
              </span>
              <Select
                value={cs.attribute ?? ""}
                onChange={(v) => setSkill(key, { attribute: v || null })}
                options={[{ value: "", label: def.attributes.find((a) => a.key === sdef.attribute)?.abbr ?? sdef.attribute }, ...def.attributes.map((a) => ({ value: a.key, label: a.abbr }))]}
                disabled={!canEdit}
                className="py-0"
                title="Atributo (padrão ou alternativo)"
              />
              <NumInput value={cs.other} onCommit={(v) => setSkill(key, { other: Math.floor(v ?? 0) })} disabled={!canEdit} className="py-0" />
              <span className={`font-mono font-bold text-right ${c.usable ? "text-[#d4af37]" : "text-zinc-600"}`}>{signed(c.total)}</span>
              <button onClick={() => onRoll({ type: "skill", key })} disabled={!canEdit || !c.usable} className={rollBtn} title={c.usable ? `Rolar ${c.label}` : "Exige treinamento"}>
                <Dices className="w-3.5 h-3.5" />
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {variantSkills.length > 0 && canEdit && (
        <div className="mt-2 flex items-center gap-1 text-[11px]">
          <Select value={variantOf} onChange={setVariantOf} options={variantSkills.map((s) => ({ value: s.key, label: s.label }))} />
          <input
            value={variantName}
            onChange={(e) => setVariantName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addVariant()}
            placeholder="Especialidade (ex.: Alquimia)"
            maxLength={40}
            className="bg-[#141414] border border-[#2d2417] rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37] w-40"
          />
          <button onClick={addVariant} className={smallBtn} disabled={!variantName.trim()}>
            <Plus className="w-3 h-3" /> Adicionar
          </button>
        </div>
      )}
      <p className="mt-1 text-[10px] text-zinc-600">* só treinados</p>
    </section>
  );
};
