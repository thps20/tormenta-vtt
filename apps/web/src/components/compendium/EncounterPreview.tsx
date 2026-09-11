import React from "react";
import { Copy, Pencil, Skull, Swords, Trash2 } from "lucide-react";
import { sumChallengeRating, type CompendiumEntry, type SavedEncounter, type SystemDefinition } from "@tormenta-vtt/shared";
import { creatureIcon as CreatureIcon } from "../character/kindIcons";

/** Checkboxes de "soltar" (§9.14): reaproveitam combat:add/start + combat:roll no cliente, nada de novo no servidor. */
export interface EncounterSpawnControls {
  startCombat: boolean;
  onStartCombatChange: (v: boolean) => void;
  rollNpcInitiative: boolean;
  onRollNpcInitiativeChange: (v: boolean) => void;
  onSpawn: () => void;
}

interface EncounterPreviewProps {
  def: SystemDefinition;
  encounter: SavedEncounter;
  /** Compêndio mesclado carregado (sistema + sala), pra resolver nome/ND de cada entrada. */
  compendiumEntries: CompendiumEntry[];
  /** Ausente fora do contexto "map" (não deveria acontecer — encontros só aparecem lá). */
  spawn?: EncounterSpawnControls;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/**
 * Resumo de um encontro salvo: lista de entradas (nome × quantidade, avisando quem sumiu do
 * compêndio desde que foi salvo), ND somado (só informativo, best-effort — sumChallengeRating),
 * notas e, no contexto "map", os checkboxes de combate + botão "Soltar" (Enter no preview faz o
 * mesmo; arrastar o card pro mapa também soltar no ponto largado).
 */
export const EncounterPreview: React.FC<EncounterPreviewProps> = ({ def, encounter, compendiumEntries, spawn, onEdit, onDuplicate, onDelete }) => {
  const totalCount = encounter.entries.reduce((sum, e) => sum + e.count, 0);
  const { total: ndTotal, unparsed } = sumChallengeRating(def, encounter.entries, compendiumEntries);

  return (
    <div className="p-2 space-y-1.5 text-xs" id="encounter-preview">
      <div>
        <div className="text-sm font-serif font-bold text-amber-200">{encounter.name}</div>
        <div className="text-[10px] text-zinc-500 font-serif flex flex-wrap gap-x-1.5">
          <span>{totalCount} criatura{totalCount === 1 ? "" : "s"}</span>
          {ndTotal !== null && <span>· ND total {formatChallenge(ndTotal)}</span>}
          {unparsed > 0 && <span title="Entradas com ND em formato livre, fora da soma">· {unparsed} fora da soma</span>}
        </div>
        {encounter.tags.length > 0 && <div className="text-[10px] text-zinc-500 truncate mt-0.5">{encounter.tags.join(" · ")}</div>}
      </div>

      {(onEdit || onDuplicate || onDelete) && (
        <div className="flex items-center gap-1">
          {onEdit && (
            <button onClick={onEdit} title="Editar" className="p-1 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate} title="Duplicar" className="p-1 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} title="Apagar" className="p-1 rounded border border-zinc-700 text-red-400/80 hover:border-red-400 hover:text-red-300 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {spawn && (
        <div className="space-y-2 p-2 rounded bg-[#161412] border border-[#2d2417]">
          <label className="flex items-center gap-1.5 text-[10px] text-zinc-300 font-serif cursor-pointer">
            <input type="checkbox" checked={spawn.startCombat} onChange={(e) => spawn.onStartCombatChange(e.target.checked)} className="accent-[#d4af37]" />
            Iniciar combate com eles
          </label>
          <label className={`flex items-center gap-1.5 text-[10px] font-serif ${spawn.startCombat ? "text-zinc-300 cursor-pointer" : "text-zinc-600 cursor-not-allowed"}`}>
            <input
              type="checkbox"
              checked={spawn.rollNpcInitiative}
              disabled={!spawn.startCombat}
              onChange={(e) => spawn.onRollNpcInitiativeChange(e.target.checked)}
              className="accent-[#d4af37]"
            />
            Rolar iniciativa dos NPCs
          </label>
          <button
            id="encounter-spawn-button"
            onClick={spawn.onSpawn}
            title="Soltar no centro da área visível do mapa (Enter)"
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-[11px] hover:bg-amber-300 transition-colors cursor-pointer"
          >
            <Swords className="w-3.5 h-3.5" />
            Soltar encontro
          </button>
        </div>
      )}

      <div className="space-y-1">
        {encounter.entries.map((entry, i) => {
          const creature = compendiumEntries.find((e) => e.id === entry.entryId && e.type === "creature");
          const name = entry.nameOverride ?? creature?.name ?? entry.entryId;
          return (
            <div key={i} className="flex items-center gap-2">
              <CreatureIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className={creature ? "text-zinc-200" : "text-red-400/80"}>{name}</span>
              <span className="text-zinc-500 font-mono text-[10px]">×{entry.count}</span>
              {!entry.visibleOnSpawn && <span className="text-[10px] text-zinc-600">(invisível)</span>}
              {!creature && <span className="text-[10px] text-red-400/80 ml-auto">sumiu do compêndio</span>}
            </div>
          );
        })}
      </div>

      {encounter.notes ? <p className="text-zinc-400 font-serif italic leading-relaxed whitespace-pre-line">{encounter.notes}</p> : null}
    </div>
  );
};

/** "1/4", "1/2" ou o inteiro — mesma convenção de texto do sistema, sem casas decimais espúrias.
 *  Exportada: o carrinho de "montar encontro" (CompendiumPalette) mostra o mesmo ND total. */
export function formatChallenge(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value - 0.25) < 1e-9) return "1/4";
  if (Math.abs(value - 0.5) < 1e-9) return "1/2";
  return value.toFixed(2);
}

/** Ícone genérico pro grupo "Encontros" (mesma família de creatureIcon/kindIcon). */
export const encounterIcon = Skull;
