import React, { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { ConditionDef } from "@tormenta-vtt/shared";

interface ConditionMenuProps {
  /** Posição (relativa ao container do canvas), já escolhida pelo chamador. */
  x: number;
  y: number;
  conditions: ConditionDef[];
  /** Chaves ativas no token alvo. */
  active: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
}

/**
 * Popover com a lista de condições do sistema (checkbox por linha). Usado tanto pelo botão
 * "Condições" do TokenInspector quanto pelo botão direito no token — os dois só escolhem a
 * posição e abrem este mesmo componente (ver VttCanvas).
 */
export const ConditionMenu: React.FC<ConditionMenuProps> = ({ x, y, conditions, active, onToggle, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc — mesmo padrão de "clique fora fecha" de outros popovers da UI.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="absolute z-20 w-56 max-h-80 overflow-y-auto p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl"
    >
      <div className="text-[10px] font-serif font-bold text-[#d4af37] tracking-wide uppercase px-1.5 pb-1.5 mb-1 border-b border-[#2d2417]">Condições</div>
      <div className="space-y-0.5">
        {conditions.map((c) => {
          const isActive = active.includes(c.key);
          return (
            <button
              key={c.key}
              onClick={() => onToggle(c.key)}
              title={c.description || c.label}
              className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-[11px] cursor-pointer ${
                isActive ? "bg-[#2d2417] text-zinc-100" : "text-zinc-400 hover:bg-[#202020] hover:text-zinc-200"
              }`}
            >
              <span
                className="w-4 h-4 shrink-0 [&>svg]:w-full [&>svg]:h-full"
                style={{ color: c.color }}
                dangerouslySetInnerHTML={{ __html: c.icon }}
              />
              <span className="flex-1 truncate">{c.label}</span>
              {isActive && <Check className="w-3 h-3 shrink-0 text-[#d4af37]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
