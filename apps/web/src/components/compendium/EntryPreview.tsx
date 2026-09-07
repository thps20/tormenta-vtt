import React from "react";
import { AlertCircle, Replace } from "lucide-react";
import { describeActivation, entryToItem, pendingChoices, type SystemDefinition } from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { summarizeField } from "../character/StructuredFields";
import { seeBook } from "../../lib/compendium";
import type { PaletteRow } from "./CompendiumPalette";

interface EntryPreviewProps {
  def: SystemDefinition;
  row: PaletteRow;
  /** Confirmação de troca (tipos com maxCount = 1): o clique é a confirmação. */
  onReplace: () => void;
}

const STRUCTURED = ["attributeBonuses", "attributeChoice", "skillGrants", "size"];

/** Resumo mecânico de uma entrada, com os rótulos do JSON do sistema. */
export const EntryPreview: React.FC<EntryPreviewProps> = ({ def, row, onReplace }) => {
  const { entry, check } = row;
  const kind = def.itemKinds.find((k) => k.key === entry.kind);
  const physical = kind?.physical ?? true;
  const lines: { label: string; value: string }[] = [];

  for (const f of kind?.fields ?? []) {
    const v = entry.fields[f.key];
    if (v === undefined || v === "" || v === false) continue;
    const text = STRUCTURED.includes(f.type)
      ? summarizeField(def, f, v)
      : f.type === "enum"
        ? (f.options?.find((o) => o.key === v)?.label ?? String(v))
        : f.type === "boolean"
          ? "sim"
          : String(v);
    if (text) lines.push({ label: f.label, value: text });
  }
  for (const [stat, value] of Object.entries(entry.statBonuses)) {
    lines.push({ label: def.equipStats.find((s) => s.key === stat)?.label ?? stat, value: signed(value) });
  }
  for (const a of entry.actions) {
    if (a.kind === "attack") {
      const skill = def.skills.find((s) => s.key === a.skill)?.label ?? a.skill;
      lines.push({ label: a.label, value: `${skill}${a.bonus ? ` ${signed(a.bonus)}` : ""}, crítico ${a.critRange}/×${a.critMult}` });
    } else if (a.kind === "damage") {
      const type = a.damageType ? (def.damageTypes.find((d) => d.key === a.damageType)?.label ?? a.damageType) : "";
      lines.push({ label: a.label, value: `${a.formula}${a.bonus ? ` ${signed(a.bonus)}` : ""} ${type}`.trim() });
    } else if (a.kind === "check") {
      lines.push({ label: a.label, value: def.skills.find((s) => s.key === a.skill)?.label ?? a.skill });
    } else {
      lines.push({ label: a.label, value: a.formula });
    }
  }
  if (kind?.hasActivation && entry.activation) {
    const a = entry.activation;
    const d = describeActivation(def, a);
    const resource = def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
    if (a.cost > 0) lines.push({ label: "Custo", value: `${a.cost} ${resource?.abbr ?? ""}`.trim() });
    if (d.execution) lines.push({ label: "Execução", value: d.execution });
    if (d.range) lines.push({ label: "Alcance", value: d.range });
    if (d.duration) lines.push({ label: "Duração", value: d.duration });
    if (a.target) lines.push({ label: "Alvo", value: a.target });
    if (a.area) lines.push({ label: "Área", value: a.area });
    if (a.effect) lines.push({ label: "Efeito", value: a.effect });
  }
  if (kind?.hasSave && entry.save) {
    const skill = def.skills.find((s) => s.key === entry.save?.skill)?.label ?? entry.save.skill;
    lines.push({ label: "Resistência", value: `${skill}${entry.save.text ? ` (${entry.save.text})` : ""}` });
  }
  if (physical) {
    if (entry.slots > 0) lines.push({ label: "Espaços", value: String(entry.slots) });
    if (entry.price > 0) lines.push({ label: "Preço", value: String(entry.price) });
  }

  // Quantas escolhas a ficha vai pedir depois de inserir (Humano, perícias de classe).
  const missing = pendingChoices(def, entryToItem(def, entry, () => "preview")).reduce((acc, p) => acc + p.missing, 0);

  return (
    <div className="p-3 space-y-2 text-xs" id="compendium-preview">
      <div>
        <div className="text-sm font-serif font-bold text-amber-200">{entry.name}</div>
        <div className="text-[10px] text-zinc-500 font-serif">
          {kind?.label ?? entry.kind}
          {entry.page !== null && ` · p. ${entry.page}`}
        </div>
      </div>

      {!check.ok && (
        <div className="p-2 rounded bg-amber-950/40 border border-amber-800/60 text-amber-200 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{check.reason}</span>
          </div>
          {check.replaces && (
            <button
              onClick={onReplace}
              id="compendium-replace"
              className="flex items-center gap-1 px-2 py-1 rounded bg-[#2d2417] border border-[#d4af37]/60 text-[#d4af37] font-serif font-bold hover:bg-[#3d311f] cursor-pointer"
            >
              <Replace className="w-3.5 h-3.5" /> Substituir {check.replaces.name}
            </button>
          )}
        </div>
      )}

      {lines.length > 0 ? (
        <dl className="space-y-1">
          {lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="flex gap-2">
              <dt className="text-zinc-500 shrink-0 w-24 leading-tight font-serif">{l.label}</dt>
              <dd className="text-zinc-200 min-w-0 break-words">{l.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-zinc-600 italic">Sem dados mecânicos.</div>
      )}

      {missing > 0 && (
        <div className="text-[10px] text-amber-300 font-serif">
          Ao inserir, a ficha pede {missing === 1 ? "1 escolha" : `${missing} escolhas`}.
        </div>
      )}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-[#1a1814] border border-[#2d2417] text-[10px] text-zinc-400">{t}</span>
          ))}
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
