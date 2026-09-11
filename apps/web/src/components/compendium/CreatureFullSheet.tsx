import React, { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { characterTiebreakBonus, computeCharacter, entryToCharacter, formatArea, type CompendiumCreatureEntry, type SystemDefinition } from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { seeBook } from "../../lib/compendium";
import { DamageTypeBadge } from "../DamageTypeBadge";

interface CreatureFullSheetProps {
  def: SystemDefinition;
  entry: CompendiumCreatureEntry;
  onClose: () => void;
}

/** Só entra na comparação `useMemo`; um id fixo basta (não muda nada da ficha). */
const SHEET_ID = () => "full-sheet";

/** "Imune"/"Vulnerável" ganham prioridade sobre RD/½ (mesma regra de NpcQuickCard). */
function describeResponse(r: { reduction: number; half: boolean; immune: boolean; vulnerable: boolean }): string | null {
  if (r.immune) return "Imune";
  if (r.vulnerable) return "Vulnerável";
  const parts: string[] = [];
  if (r.reduction > 0) parts.push(`RD ${r.reduction}`);
  if (r.half) parts.push("½");
  return parts.length > 0 ? parts.join(" + ") : null;
}

/**
 * Bloco de monstro COMPLETO, em modo leitura — o que o preview compacto (`CreaturePreview.tsx`)
 * deixa de fora: atributos, perícias treinadas, todos os recursos/derivados, traços (traitFields
 * populados), resistências, ataques com o detalhe do teste (perícia/crítico), poderes/habilidades
 * (ativação + descrição) e a descrição da criatura. Nunca solta no mapa — é só consulta (§9.5); GM
 * fecha com o X, Esc ou clicando fora.
 */
export const CreatureFullSheet: React.FC<CreatureFullSheetProps> = ({ def, entry, onClose }) => {
  const sheet = entry.sheet;
  const character = useMemo(() => entryToCharacter(def, entry, SHEET_ID).data, [def, entry]);
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const initiative = useMemo(() => characterTiebreakBonus(def, character), [def, character]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const creatures = def.creatures;
  const typeValue = creatures ? sheet.traits[creatures.typeField] : undefined;
  const typeLabel = creatures ? (def.traitFields.find((f) => f.key === creatures.typeField)?.options?.find((o) => o.key === typeValue)?.label ?? typeValue) : undefined;
  const nd = creatures ? sheet.traits[creatures.ndField] : undefined;
  const sizeLabel = def.sizes.find((s) => s.key === sheet.size)?.label;

  const traitLines = def.traitFields
    .map((f) => ({ label: f.label, value: sheet.traits[f.key] }))
    .filter((t): t is { label: string; value: string } => !!t.value);

  const resistanceLines: { type: string | null; text: string }[] = [];
  const allText = describeResponse(sheet.damageResponses.all);
  if (allText) resistanceLines.push({ type: null, text: allText });
  for (const [type, r] of Object.entries(sheet.damageResponses.byType)) {
    const text = describeResponse(r);
    if (text) resistanceLines.push({ type, text });
  }

  const trainedSkills = Object.keys(sheet.skills)
    .map((key) => computed.skills[key])
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => a.label.localeCompare(b.label));

  const attackItems = sheet.items.filter((i) => !i.activation && i.actions.length > 0);
  const abilityItems = sheet.items.filter((i) => i.activation !== null);

  return (
    <div
      id="creature-full-sheet"
      role="dialog"
      aria-label={`Bloco completo: ${entry.name}`}
      onPointerDown={onClose}
      className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[1px]"
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-full overflow-y-auto rounded-lg border border-[#3a3022] bg-[#0f0e0c] shadow-[0_0_40px_rgba(0,0,0,0.8)] text-xs"
      >
        <div className="sticky top-0 flex items-start justify-between gap-2 p-3 border-b border-[#2d2417] bg-[#0f0e0c]">
          <div>
            <div className="text-base font-serif font-bold text-amber-200">{entry.name}</div>
            <div className="text-[10px] text-zinc-500 font-serif flex flex-wrap gap-x-1.5">
              {nd && <span>ND {nd}</span>}
              {sizeLabel && <span>· {sizeLabel}</span>}
              {typeLabel && <span>· {typeLabel}</span>}
              {entry.page !== null && <span>· p. {entry.page}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Fechar (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {def.attributes.map((a) => (
              <div key={a.key} className="text-center">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-serif">{a.label}</div>
                <div className="text-sm font-serif font-bold text-zinc-100">{signed(computed.attributes[a.key] ?? 0)}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {def.resources.map((r) => (
              <PreviewLine key={r.key} label={r.label} value={`${computed.resources[r.key]?.max ?? 0}`} />
            ))}
            {def.derived.map((d) => (
              <PreviewLine key={d.key} label={d.label} value={String(computed.derived[d.key] ?? 0)} />
            ))}
            <PreviewLine label="Iniciativa" value={signed(initiative)} />
          </div>

          {trainedSkills.length > 0 && (
            <Section title="Perícias">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                {trainedSkills.map((s) => (
                  <PreviewLine key={s.key} label={s.label} value={signed(s.total)} />
                ))}
              </div>
            </Section>
          )}

          {traitLines.length > 0 && (
            <Section title="Traços">
              <div className="space-y-1">
                {traitLines.map((t) => (
                  <PreviewLine key={t.label} label={t.label} value={t.value} />
                ))}
              </div>
            </Section>
          )}

          {resistanceLines.length > 0 && (
            <Section title="Resistências">
              {resistanceLines.map((line, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {line.type !== null && <DamageTypeBadge def={def} type={line.type} />}
                  <span className="text-zinc-300">{line.text}</span>
                </div>
              ))}
            </Section>
          )}

          {attackItems.length > 0 && (
            <Section title="Ataques">
              <div className="space-y-1.5">
                {attackItems.map((item) => (
                  <div key={item.name}>
                    <div className="text-zinc-200 font-serif font-bold">{item.name}</div>
                    {item.actions.map((a, i) => {
                      if (a.kind === "attack") {
                        const skill = def.skills.find((s) => s.key === a.skill)?.label ?? a.skill;
                        return <PreviewLine key={i} label={a.label} value={`${skill}${a.bonus ? ` ${signed(a.bonus)}` : ""}, crítico ${a.critRange}/×${a.critMult}`} />;
                      }
                      if (a.kind === "damage") {
                        return (
                          <PreviewLine
                            key={i}
                            label={a.label}
                            value={
                              <>
                                {a.formula}
                                {a.bonus ? ` ${signed(a.bonus)}` : ""} <DamageTypeBadge def={def} type={a.damageType} />
                              </>
                            }
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {abilityItems.length > 0 && (
            <Section title="Poderes e habilidades">
              <div className="space-y-2">
                {abilityItems.map((item) => {
                  const activation = item.activation;
                  const execLabel = activation ? (def.activation.executions.find((e) => e.key === activation.execution)?.label ?? activation.execution) : null;
                  const costResource = activation && def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
                  const areaText = activation ? formatArea(def, activation.area) : null;
                  return (
                    <div key={item.name}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-zinc-200 font-serif font-bold">{item.name}</span>
                        {execLabel && <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950/40 text-amber-300 border border-amber-800/30">{execLabel}</span>}
                        {activation && activation.cost > 0 && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-800/40">
                            {activation.cost}
                            {costResource ? ` ${costResource.abbr ?? costResource.label}` : ""}
                          </span>
                        )}
                        {areaText && <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-800/60 text-zinc-300 border border-zinc-700/40">{areaText}</span>}
                      </div>
                      {item.description && <p className="text-zinc-400 mt-0.5 leading-relaxed">{item.description}</p>}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="Descrição">
            {entry.description ? (
              <p className="text-zinc-400 font-serif italic leading-relaxed whitespace-pre-line">{entry.description}</p>
            ) : (
              <p className="text-zinc-600 italic">{seeBook(entry.page)}</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-1 pt-2 border-t border-[#2d2417]">
    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">{title}</div>
    {children}
  </div>
);

const PreviewLine: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex gap-2">
    <span className="text-zinc-500 shrink-0 leading-tight font-serif">{label}</span>
    <span className="text-zinc-200 min-w-0 break-words">{value}</span>
  </div>
);
