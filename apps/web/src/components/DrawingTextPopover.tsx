import React, { useState } from "react";
import { X } from "lucide-react";

export interface DrawingTextPopoverProps {
  onCreate: (text: string) => void;
  onCancel: () => void;
}

/**
 * Formulário mínimo da ferramenta "Desenho" quando a forma é "Texto" (SPEC §9.17): só o conteúdo —
 * cor/espessura(=tamanho da fonte)/visibilidade já vêm escolhidos na sub-barra (`DrawToolbar`), como
 * qualquer outra forma. Aberto ao clicar no mapa com "Texto" ativo; o clique em si só guarda x/y
 * (RoomPage), mesmo padrão de `PinCreatePopover`.
 */
export const DrawingTextPopover: React.FC<DrawingTextPopoverProps> = ({ onCreate, onCancel }) => {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  return (
    <div id="drawing-text-popover" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-[300px] max-w-[calc(100vw-2rem)] bg-[#14120f] border border-[#3d311f] rounded-lg shadow-2xl text-zinc-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2.5 border-b border-[#2d2417] flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-amber-200">Texto no mapa</span>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5 text-xs">
          <input
            autoFocus
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="Escreva o texto..."
            className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37]"
          />

          <button
            onClick={submit}
            disabled={!text.trim()}
            className="w-full py-1.5 rounded bg-[#2b2317] hover:bg-[#3d3120] disabled:opacity-40 border border-[#d4af37]/40 hover:border-[#d4af37] text-amber-300 hover:text-amber-100 font-serif font-semibold text-xs cursor-pointer"
          >
            Colocar no mapa
          </button>
        </div>
      </div>
    </div>
  );
};
