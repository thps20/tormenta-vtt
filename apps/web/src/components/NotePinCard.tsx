import React, { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Pin, PinIconDef } from "@tormenta-vtt/shared";
import { findPinIcon } from "../lib/pinIcons";

export interface NotePinCardProps {
  pin: Pin & { kind: "note" };
  icons: PinIconDef[];
  isGm: boolean;
  onClose: () => void;
  onSave: (patch: { title?: string; text?: string }) => void;
  onDelete: () => void;
}

/**
 * Cartão de um pino de nota (docs/plano-narracao.md — "pino visível para jogadores abre um cartão
 * ao clicar"): título + texto (markdown leve, mostrado como texto puro por ora — mesmo limite do
 * Handout de texto, sem parser). Diferente do handout, que abre em tela cheia (HandoutOverlay):
 * uma nota é curta, então um cartão flutuante já basta. GM edita no lugar (`pin:update`) e apaga;
 * jogador só lê (a visibilidade — se ele chegou a ver o pino — já foi decidida antes de abrir).
 */
export const NotePinCard: React.FC<NotePinCardProps> = ({ pin, icons, isGm, onClose, onSave, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(pin.title);
  const [text, setText] = useState(pin.text);
  const iconDef = findPinIcon(icons, pin.icon);
  const color = pin.color ?? iconDef.color;

  const commit = () => {
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (!trimmedTitle || !trimmedText) return;
    onSave({ title: trimmedTitle, text: trimmedText });
    setEditing(false);
  };

  return (
    <div
      id="note-pin-card"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[360px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-[#14120f] border rounded-lg shadow-2xl text-zinc-200"
        style={{ borderColor: `${color}66` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b border-[#2d2417] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="shrink-0 flex items-center [&>svg]:w-4 [&>svg]:h-4"
              style={{ color }}
              dangerouslySetInnerHTML={{ __html: iconDef.icon }}
            />
            {editing ? (
              <input
                autoFocus
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 min-w-0 bg-transparent text-sm font-serif font-bold focus:outline-none border-b border-transparent focus:border-current"
                style={{ color }}
              />
            ) : (
              <span className="font-serif font-bold text-sm truncate" style={{ color }} title={pin.title}>
                {pin.title}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 flex-1 custom-scrollbar">
          {editing ? (
            <textarea
              autoFocus={false}
              value={text}
              maxLength={20_000}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-[#d4af37] resize-y"
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap leading-relaxed text-zinc-300">{pin.text}</p>
          )}
        </div>

        {isGm && (
          <div className="px-3 py-2 border-t border-[#2d2417] flex items-center justify-end gap-1.5 shrink-0">
            {editing ? (
              <button
                onClick={commit}
                className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-700/60 text-emerald-400 hover:bg-emerald-950/40 text-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Salvar
              </button>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-300 hover:text-[#d4af37] text-xs cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Editar
              </button>
            )}
            <button
              onClick={onDelete}
              className="flex items-center gap-1 px-2 py-1 rounded border border-red-900/60 text-red-400 hover:bg-red-950/40 text-xs cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Apagar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
