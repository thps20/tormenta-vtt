import React, { useState } from "react";
import { Dices, MessageSquare, X } from "lucide-react";
import type { MacroAction } from "@tormenta-vtt/shared";
import { DEFAULT_PIN_ICONS } from "../lib/pinIcons";

export interface MacroFormValue {
  label: string;
  icon: string;
  color: string;
  action: MacroAction;
}

export interface MacroFormPopoverProps {
  title: string;
  /** Valores iniciais (edição, ou pré-preenchido por "salvar como macro"/arrastar da ficha). */
  initial?: Partial<MacroFormValue>;
  /**
   * A AÇÃO já veio pronta (salvar como macro / arrastar da ficha / editar uma macro de ficha):
   * o formulário edita só nome/ícone/cor, com uma prévia do que a macro faz. Sem isto, o usuário
   * escolhe o tipo (rolagem livre ou texto) e preenche os campos — os dois únicos tipos que dá
   * pra criar "do zero", sem apontar pra uma ficha (docs/SPEC.md §9.20).
   */
  lockedAction?: MacroAction;
  /** Descrição da ação travada, para a prévia ("Ataque: Espada longa", "/r 2d6+3"). */
  lockedActionSummary?: string;
  onSubmit: (value: MacroFormValue) => void;
  onCancel: () => void;
}

type FreeType = "roll" | "chatText";

/**
 * Formulário de criação/edição de macro (docs/SPEC.md §9.20). Mesmo estilo visual de
 * `PinCreatePopover.tsx` (modal centralizado, paleta de ícones de `lib/pinIcons.ts` — aparência de
 * UI, não regra de sistema, por isso reaproveitada tal e qual).
 */
export const MacroFormPopover: React.FC<MacroFormPopoverProps> = ({ title, initial, lockedAction, lockedActionSummary, onSubmit, onCancel }) => {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [iconKey, setIconKey] = useState(initial?.icon ?? DEFAULT_PIN_ICONS[0]!.key);
  const [freeType, setFreeType] = useState<FreeType>(initial?.action?.type === "chatText" ? "chatText" : "roll");
  const [formula, setFormula] = useState(initial?.action?.type === "roll" ? initial.action.formula : "");
  const [rollLabel, setRollLabel] = useState(initial?.action?.type === "roll" ? (initial.action.label ?? "") : "");
  const [text, setText] = useState(initial?.action?.type === "chatText" ? initial.action.text : "");

  const selected = DEFAULT_PIN_ICONS.find((i) => i.key === iconKey) ?? DEFAULT_PIN_ICONS[0]!;

  const buildAction = (): MacroAction | null => {
    if (lockedAction) return lockedAction;
    if (freeType === "roll") {
      const trimmed = formula.trim();
      return trimmed ? { type: "roll", formula: trimmed, label: rollLabel.trim() || undefined } : null;
    }
    const trimmedText = text.trim();
    return trimmedText ? { type: "chatText", text: trimmedText } : null;
  };

  const action = buildAction();
  const trimmedLabel = label.trim();
  const canSubmit = trimmedLabel.length > 0 && action !== null;

  const submit = () => {
    if (!canSubmit || !action) return;
    onSubmit({ label: trimmedLabel, icon: selected.key, color: selected.color, action });
  };

  return (
    <div id="macro-form-popover" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-[340px] max-w-[calc(100vw-2rem)] bg-[#14120f] border border-[#3d311f] rounded-lg shadow-2xl text-zinc-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2.5 border-b border-[#2d2417] flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-amber-200">{title}</span>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5 text-xs">
          <div className="space-y-1">
            <label className="text-zinc-400">Nome do botão</label>
            <input
              autoFocus
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ataque duplo"
              className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37]"
            />
          </div>

          {lockedAction ? (
            <div className="rounded border border-[#2d2417] bg-[#0f0e0c] px-2 py-1.5 text-zinc-400 flex items-center gap-1.5">
              {lockedAction.type === "chatText" ? <MessageSquare className="w-3.5 h-3.5 shrink-0" /> : <Dices className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate font-mono text-zinc-300">{lockedActionSummary}</span>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setFreeType("roll")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs font-serif font-bold cursor-pointer ${
                    freeType === "roll" ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "bg-[#1a1a1a] text-zinc-400 border-[#3d3d3d]"
                  }`}
                >
                  <Dices className="w-3.5 h-3.5" /> Rolagem
                </button>
                <button
                  onClick={() => setFreeType("chatText")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs font-serif font-bold cursor-pointer ${
                    freeType === "chatText" ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "bg-[#1a1a1a] text-zinc-400 border-[#3d3d3d]"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Texto no chat
                </button>
              </div>

              {freeType === "roll" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-zinc-400">Fórmula</label>
                    <input
                      value={formula}
                      maxLength={200}
                      onChange={(e) => setFormula(e.target.value)}
                      placeholder="2d6+3"
                      className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-zinc-400">Rótulo da rolagem (opcional)</label>
                    <input
                      value={rollLabel}
                      maxLength={80}
                      onChange={(e) => setRollLabel(e.target.value)}
                      placeholder="Ataque duplo"
                      className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <label className="text-zinc-400">Texto</label>
                  <textarea
                    value={text}
                    maxLength={2000}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37] resize-y"
                  />
                </div>
              )}
            </>
          )}

          <div className="space-y-1">
            <label className="text-zinc-400">Ícone</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DEFAULT_PIN_ICONS.map((icon) => (
                <button
                  key={icon.key}
                  title={icon.label}
                  onClick={() => setIconKey(icon.key)}
                  className={`p-1.5 rounded border cursor-pointer [&>svg]:w-4 [&>svg]:h-4 ${
                    iconKey === icon.key ? "border-current" : "border-[#2d2417] opacity-60 hover:opacity-100"
                  }`}
                  style={{ color: icon.color }}
                  dangerouslySetInnerHTML={{ __html: icon.icon }}
                />
              ))}
            </div>
          </div>

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full py-1.5 rounded bg-[#2b2317] hover:bg-[#3d3120] disabled:opacity-40 border border-[#d4af37]/40 hover:border-[#d4af37] text-amber-300 hover:text-amber-100 font-serif font-semibold text-xs cursor-pointer"
          >
            Salvar macro
          </button>
        </div>
      </div>
    </div>
  );
};

/** Resumo de uma ação, pra prévia do formulário e tooltip do botão na barra. */
export function summarizeMacroAction(action: MacroAction): string {
  switch (action.type) {
    case "roll":
      return action.label ? `/r ${action.formula} # ${action.label}` : `/r ${action.formula}`;
    case "chatText":
      return action.text;
    case "characterAction":
      return "Ação de ficha";
    case "useItem":
      return "Usar item";
  }
}
