import React, { useMemo } from "react";
import { Eye, EyeOff, Skull } from "lucide-react";
import { characterTiebreakBonus, computeCharacter, entryToCharacter, type CompendiumCreatureEntry, type SystemDefinition } from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { seeBook } from "../../lib/compendium";
import { DamageTypeBadge } from "../DamageTypeBadge";

/** Quantidade e toggle "invisível ao soltar" (controlados pela paleta: Enter solta, ver CompendiumPalette). */
export interface CreatureSpawnControls {
  count: number;
  onCountChange: (n: number) => void;
  invisible: boolean;
  onInvisibleChange: (v: boolean) => void;
  onSpawn: () => void;
}

interface CreaturePreviewProps {
  def: SystemDefinition;
  entry: CompendiumCreatureEntry;
  /** Ausente fora do contexto "map" (ex.: jogador consultando): esconde quantidade/toggle/botão. */
  spawn?: CreatureSpawnControls;
}

/** Só entra na comparação `preview` de useMemo; um id fixo basta (não muda nada da ficha). */
const PREVIEW_ID = () => "preview";

/**
 * Resumo mecânico de um bloco de monstro: cabeçalho (ND/tamanho/tipo), recursos, derivados,
 * iniciativa, resistências, ataques (dos itens sem ativação) e nomes de poderes/habilidades (dos
 * itens com ativação, sem o texto). Com `spawn` (GM, contexto "map"): quantidade (1..20), toggle
 * "invisível ao soltar" e botão pra soltar no centro da área visível do mapa (Enter faz o mesmo).
 */
export const CreaturePreview: React.FC<CreaturePreviewProps> = ({ def, entry, spawn }) => {
  const sheet = entry.sheet;
  const character = useMemo(() => entryToCharacter(def, entry, PREVIEW_ID).data, [def, entry]);
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const initiative = useMemo(() => characterTiebreakBonus(def, character), [def, character]);

  const creatures = def.creatures;
  const typeValue = creatures ? sheet.traits[creatures.typeField] : undefined;
  const typeLabel = creatures ? (def.traitFields.find((f) => f.key === creatures.typeField)?.options?.find((o) => o.key === typeValue)?.label ?? typeValue) : undefined;
  const nd = creatures ? sheet.traits[creatures.ndField] : undefined;
  const sizeLabel = def.sizes.find((s) => s.key === sheet.size)?.label;

  const resistanceLines: { type: string | null; text: string }[] = [];
  const describe = (r: { reduction: number; half: boolean; immune: boolean; vulnerable: boolean }): string | null => {
    const parts: string[] = [];
    if (r.immune) parts.push("imune");
    if (r.vulnerable) parts.push("vulnerável");
    if (r.half) parts.push("dano reduzido à metade");
    if (r.reduction > 0) parts.push(`RD ${r.reduction}`);
    return parts.length > 0 ? parts.join(", ") : null;
  };
  const allText = describe(sheet.damageResponses.all);
  if (allText) resistanceLines.push({ type: null, text: allText });
  for (const [type, r] of Object.entries(sheet.damageResponses.byType)) {
    const text = describe(r);
    if (text) resistanceLines.push({ type, text });
  }

  const attackItems = sheet.items.filter((i) => !i.activation && i.actions.length > 0);
  const abilityItems = sheet.items.filter((i) => i.activation !== null);

  return (
    <div className="p-3 space-y-3 text-xs" id="creature-preview">
      <div>
        <div className="text-sm font-serif font-bold text-amber-200">{entry.name}</div>
        <div className="text-[10px] text-zinc-500 font-serif flex flex-wrap gap-x-1.5">
          {nd && <span>ND {nd}</span>}
          {sizeLabel && <span>· {sizeLabel}</span>}
          {typeLabel && <span>· {typeLabel}</span>}
          {entry.page !== null && <span>· p. {entry.page}</span>}
        </div>
      </div>

      {spawn && (
        <div className="flex items-center gap-2 p-2 rounded bg-[#161412] border border-[#2d2417]">
          <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-serif">
            Quantidade
            <input
              id="creature-spawn-count"
              type="number"
              min={1}
              max={20}
              value={spawn.count}
              onChange={(e) => spawn.onCountChange(Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))))}
              className="w-12 bg-[#0f0e0c] border border-zinc-700 rounded px-1 py-0.5 text-zinc-100 text-xs"
            />
          </label>
          <button
            id="creature-spawn-invisible"
            onClick={() => spawn.onInvisibleChange(!spawn.invisible)}
            title="Invisível ao soltar (só o GM vê até revelar)"
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-serif cursor-pointer transition-colors ${
              spawn.invisible ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37]" : "bg-[#0f0e0c] border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {spawn.invisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            Invisível
          </button>
          <button
            id="creature-spawn-button"
            onClick={spawn.onSpawn}
            title="Soltar no centro da área visível do mapa (Enter)"
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-[11px] hover:bg-amber-300 transition-colors cursor-pointer"
          >
            <Skull className="w-3.5 h-3.5" />
            Soltar
          </button>
        </div>
      )}

      <div className="space-y-1">
        {def.resources.map((r) => (
          <PreviewLine key={r.key} label={r.label} value={`${computed.resources[r.key]?.max ?? 0} ${r.abbr}`} />
        ))}
        {def.derived.map((d) => (
          <PreviewLine key={d.key} label={d.label} value={String(computed.derived[d.key] ?? 0)} />
        ))}
        <PreviewLine label="Iniciativa" value={signed(initiative)} />
      </div>

      {resistanceLines.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">Resistências</div>
          {resistanceLines.map((line, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {line.type !== null && <DamageTypeBadge def={def} type={line.type} />}
              <span className="text-zinc-300">{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {attackItems.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">Ataques</div>
          {attackItems.map((item) => (
            <div key={item.name}>
              <div className="text-zinc-200 font-serif font-bold">{item.name}</div>
              {item.actions.map((a, i) => {
                if (a.kind === "attack") {
                  const skill = def.skills.find((s) => s.key === a.skill)?.label ?? a.skill;
                  return (
                    <PreviewLine key={i} label={a.label} value={`${skill}${a.bonus ? ` ${signed(a.bonus)}` : ""}, crítico ${a.critRange}/×${a.critMult}`} />
                  );
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
      )}

      {abilityItems.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">Poderes e habilidades</div>
          <div className="text-zinc-300">{abilityItems.map((i) => i.name).join(", ")}</div>
        </div>
      )}

      {entry.description ? (
        <p className="text-zinc-400 font-serif italic leading-relaxed whitespace-pre-line">{entry.description}</p>
      ) : (
        <p className="text-zinc-600 italic">{seeBook(entry.page)}</p>
      )}
    </div>
  );
};

const PreviewLine: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex gap-2">
    <span className="text-zinc-500 shrink-0 w-24 leading-tight font-serif">{label}</span>
    <span className="text-zinc-200 min-w-0 break-words">{value}</span>
  </div>
);
