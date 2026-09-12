import React, { useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import type { PinIconDef } from "@tormenta-vtt/shared";

export interface PinCreatePopoverProps {
  icons: PinIconDef[];
  onCreate: (data: { title: string; text: string; icon: string; color: string; visible: boolean }) => void;
  onCancel: () => void;
}

/**
 * Formulário da ferramenta "Pino" (atalho P, docs/plano-narracao.md): título + nota (markdown
 * leve) + ícone/cor (da lista do sistema ou padrão embutido, `lib/pinIcons.ts`) + visibilidade.
 * Aberto ao clicar no mapa com a ferramenta ativa; o clique em si só guarda x/y (RoomPage), este
 * popover não sabe de canvas — só do conteúdo do pino.
 */
export const PinCreatePopover: React.FC<PinCreatePopoverProps> = ({ icons, onCreate, onCancel }) => {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [iconKey, setIconKey] = useState(icons[0]?.key ?? "flag");
  const [visible, setVisible] = useState(false);

  const selected = icons.find((i) => i.key === iconKey) ?? icons[0];

  const submit = () => {
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (!trimmedTitle || !trimmedText || !selected) return;
    onCreate({ title: trimmedTitle, text: trimmedText, icon: selected.key, color: selected.color, visible });
  };

  return (
    <div id="pin-create-popover" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-[340px] max-w-[calc(100vw-2rem)] bg-[#14120f] border border-[#3d311f] rounded-lg shadow-2xl text-zinc-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2.5 border-b border-[#2d2417] flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-amber-200">Novo pino</span>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5 text-xs">
          <div className="space-y-1">
            <label className="text-zinc-400">Título</label>
            <input
              autoFocus
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='"O barão mente sobre o irmão"'
              className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400">Nota</label>
            <textarea
              value={text}
              maxLength={20_000}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-[#d4af37] resize-y"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400">Ícone</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {icons.map((icon) => (
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
            onClick={() => setVisible((v) => !v)}
            className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs font-serif font-bold cursor-pointer ${
              visible ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "bg-[#252525] text-zinc-400 border-[#3d3d3d]"
            }`}
          >
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {visible ? "Todos veem" : "Só o GM (padrão)"}
          </button>

          <button
            onClick={submit}
            disabled={!title.trim() || !text.trim()}
            className="w-full py-1.5 rounded bg-[#2b2317] hover:bg-[#3d3120] disabled:opacity-40 border border-[#d4af37]/40 hover:border-[#d4af37] text-amber-300 hover:text-amber-100 font-serif font-semibold text-xs cursor-pointer"
          >
            Fixar pino
          </button>
        </div>
      </div>
    </div>
  );
};
