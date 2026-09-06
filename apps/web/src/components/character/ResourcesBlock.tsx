import React from "react";
import { Heart, Lock, Minus, Plus, Sparkles, Zap } from "lucide-react";
import type { Character, CharacterPatch, CharacterResource, ComputedCharacter, SystemDefinition } from "@tormenta-vtt/shared";
import { NumInput } from "./fields";

interface ResourcesBlockProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  canEdit: boolean;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
}

/**
 * Aparência por POSIÇÃO na lista de recursos do sistema (o código não sabe o
 * que é "PV"): o primeiro recurso é vermelho, o segundo azul, os demais âmbar.
 */
const STYLES = [
  { bar: "bg-gradient-to-r from-red-800 to-red-500", text: "text-red-400", Icon: Heart },
  { bar: "bg-gradient-to-r from-blue-800 to-sky-500", text: "text-sky-400", Icon: Zap },
  { bar: "bg-gradient-to-r from-amber-700 to-amber-500", text: "text-amber-400", Icon: Sparkles },
];

const EMPTY: CharacterResource = { current: 0, temp: 0, maxOverride: null };

/** Recursos (PV, PM...) com barra, ajuste rápido (±1/±5) e pontos temporários. */
export const ResourcesBlock: React.FC<ResourcesBlockProps> = ({ def, character, computed, canEdit, isEditMode, onPatch }) => {
  if (def.resources.length === 0) return null;

  return (
    <div className="p-4 bg-[#0d0d0d] border-b border-[#2d2417]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Recursos</h3>
        <span className="text-[11px] text-zinc-500 font-serif">{isEditMode ? "Máximo em branco = fórmula do sistema" : ""}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {def.resources.map((rDef, index) => {
          const style = STYLES[Math.min(index, STYLES.length - 1)] ?? STYLES[0]!;
          const Icon = style.Icon;
          const res = character.resources[rDef.key] ?? EMPTY;
          const { max, min, detail } = computed.resources[rDef.key] ?? { max: 0, min: 0, detail: null };
          // Máximo vindo das classes: somente leitura, com a conta no tooltip ("Modo manual" no cabeçalho libera).
          const byClasses = computed.levelSource === "classes" && rDef.perLevel !== undefined;
          const maxTitle = byClasses && detail ? `${rDef.abbr} pelas classes: ${detail}` : undefined;
          const percent = max > 0 ? Math.min(100, Math.max(0, (res.current / max) * 100)) : 0;
          const tempPercent = max > 0 ? Math.min(30, (res.temp / max) * 100) : 0;

          const set = (patch: Partial<CharacterResource>) => onPatch({ resources: { ...character.resources, [rDef.key]: { ...res, ...patch } } });
          // Ajuste rápido respeita o mínimo (ex.: -metade do máximo) e o máximo do sistema.
          const clampCurrent = (n: number) => Math.min(max > 0 ? max : Number.POSITIVE_INFINITY, Math.max(min, n));
          const adjustCurrent = (delta: number) => set({ current: clampCurrent(res.current + delta) });
          const adjustTemp = (delta: number) => set({ temp: Math.max(0, res.temp + delta) });

          const quickBtn = (delta: number) => (
            <button
              key={delta}
              onClick={() => adjustCurrent(delta)}
              disabled={!canEdit}
              className={`px-1.5 py-0.5 rounded bg-[#201d19] text-zinc-300 border border-zinc-700 text-[11px] font-mono transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                delta < 0 ? "hover:bg-red-950/80 hover:text-red-300" : "hover:bg-emerald-950/80 hover:text-emerald-300"
              }`}
              title={`${delta > 0 ? "Aumentar" : "Diminuir"} ${Math.abs(delta)}`}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          );

          return (
            <div key={rDef.key} id={`resource-${rDef.key}`} className="bg-[#141414] border border-[#2c261e] rounded-lg p-3 shadow-inner flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon className={`w-4 h-4 ${style.text} shrink-0`} />
                  <span className={`font-serif font-bold text-sm ${style.text} truncate`}>
                    {rDef.label} ({rDef.abbr})
                  </span>
                </div>

                <div className="flex items-center gap-1 font-mono text-xs shrink-0">
                  {isEditMode ? (
                    <div className="flex items-center gap-1">
                      <NumInput value={res.current} onCommit={(v) => set({ current: Math.floor(v ?? 0) })} className="font-bold text-zinc-100" title="Valor atual" />
                      <span className="text-zinc-500">/</span>
                      {byClasses ? (
                        <span className="inline-flex items-center gap-1 w-12 justify-center bg-[#141414] border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300 cursor-help" title={maxTitle ?? "Máximo calculado pelas classes"}>
                          <Lock className="w-3 h-3 text-zinc-500" /> {max}
                        </span>
                      ) : (
                        <NumInput
                          value={res.maxOverride}
                          allowEmpty
                          placeholder={String(max)}
                          onCommit={(v) => set({ maxOverride: v === null ? null : Math.floor(v) })}
                          className="text-zinc-300"
                          title={rDef.maxFormula ? `Máximo (vazio = fórmula: ${rDef.maxFormula})` : "Máximo (vazio = 0)"}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-base font-bold text-zinc-100">{res.current}</span>
                      <span className="text-zinc-500">/</span>
                      <span className={`text-zinc-400 ${maxTitle ? "cursor-help underline decoration-dotted decoration-zinc-600" : ""}`} title={maxTitle}>
                        {max}
                      </span>
                      {res.temp > 0 && (
                        <span className="text-amber-400 font-bold ml-1" title="Pontos temporários">
                          (+{res.temp} temp)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Barra */}
              <div className="w-full bg-[#0a0a0a] border border-zinc-800 rounded-full h-3 overflow-hidden relative my-1">
                <div className={`h-full transition-all duration-300 rounded-full ${style.bar}`} style={{ width: `${percent}%` }} />
                {res.temp > 0 && <div className="absolute top-0 right-0 h-full bg-amber-400/80 rounded-r-full" style={{ width: `${tempPercent}%` }} title={`Pontos temporários: +${res.temp}`} />}
              </div>

              <div className="flex items-center justify-between mt-2 pt-1 border-t border-[#1f1b16] text-xs gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500 font-serif mr-1">Ajustar:</span>
                  {[-5, -1, 1, 5].map(quickBtn)}
                  {min !== 0 && (
                    <span className="text-[10px] text-zinc-600 font-mono ml-1" title="Mínimo do sistema">
                      mín. {min}
                    </span>
                  )}
                </div>

                {rDef.hasTemp && (
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-zinc-400 font-serif text-[10px]">Temp:</span>
                    {isEditMode ? (
                      <NumInput value={res.temp} onCommit={(v) => set({ temp: Math.max(0, Math.floor(v ?? 0)) })} className="w-10 text-amber-300" />
                    ) : (
                      <div className="flex items-center gap-1 bg-[#1a1712] border border-[#3b3224] px-1.5 py-0.5 rounded">
                        <button onClick={() => adjustTemp(-1)} disabled={!canEdit || res.temp <= 0} className="text-zinc-400 hover:text-zinc-100 disabled:opacity-30 cursor-pointer">
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="font-mono text-amber-300 font-bold px-1">{res.temp}</span>
                        <button onClick={() => adjustTemp(1)} disabled={!canEdit} className="text-zinc-400 hover:text-zinc-100 disabled:opacity-30 cursor-pointer">
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
