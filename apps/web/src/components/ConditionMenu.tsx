import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { deriveExpiresRound, effectiveCombatRound, type ConditionDef, type TokenCondition } from "@tormenta-vtt/shared";

interface ConditionMenuProps {
  /** Posição (relativa ao container do canvas), já escolhida pelo chamador. */
  x: number;
  y: number;
  conditions: ConditionDef[];
  /** Condições ativas no token alvo (chave + duração opcional). */
  active: TokenCondition[];
  /**
   * Rodada atual do combate da cena, se houver um ativo (status !== "ended"); null = sem combate,
   * esconde o campo de duração (toda condição marcada vira permanente).
   */
  combatRound: number | null;
  /** O menu decide a lista nova (marcar/desmarcar/editar duração); o chamador só aplica o patch. */
  onChange: (next: TokenCondition[]) => void;
  onClose: () => void;
}

/**
 * Popover com a lista de condições do sistema (checkbox por linha). Usado tanto pelo botão
 * "Condições" do TokenInspector quanto pelo botão direito no token — os dois só escolhem a
 * posição e abrem este mesmo componente (ver VttCanvas).
 *
 * Com combate ativo, cada condição MARCADA ganha um campo numérico de duração em rodadas (vazio =
 * permanente). A conversão pra `expiresRound` é sempre via `deriveExpiresRound` (shared): com o
 * combate em "rolling" (round 0) ele conta a partir da rodada 1, senão uma condição marcada antes
 * do primeiro "Próximo" expiraria na própria virada, sem nunca ter valido.
 */
export const ConditionMenu: React.FC<ConditionMenuProps> = ({ x, y, conditions, active, combatRound, onChange, onClose }) => {
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

  const toggle = (c: ConditionDef) => {
    const has = active.some((a) => a.key === c.key);
    if (has) {
      onChange(active.filter((a) => a.key !== c.key));
      return;
    }
    const expiresRound = combatRound !== null && c.defaultDuration ? deriveExpiresRound(combatRound, c.defaultDuration) : undefined;
    onChange([...active, { key: c.key, ...(expiresRound !== undefined ? { expiresRound } : {}) }]);
  };

  /** `rounds` = quantas rodadas a partir de AGORA (não o expiresRound absoluto); undefined = permanente. */
  const setDuration = (key: string, rounds: number | undefined) => {
    const expiresRound = combatRound !== null && rounds !== undefined ? deriveExpiresRound(combatRound, rounds) : undefined;
    onChange(active.map((a) => (a.key === key ? { key, ...(expiresRound !== undefined ? { expiresRound } : {}) } : a)));
  };

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="absolute z-20 w-64 max-h-80 overflow-y-auto p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl"
    >
      <div className="text-[10px] font-serif font-bold text-[#d4af37] tracking-wide uppercase px-1.5 pb-1.5 mb-1 border-b border-[#2d2417]">Condições</div>
      <div className="space-y-0.5">
        {conditions.map((c) => {
          const entry = active.find((a) => a.key === c.key);
          const isActive = entry !== undefined;
          return (
            <div key={c.key} className={`rounded ${isActive ? "bg-[#2d2417]" : ""}`}>
              <button
                onClick={() => toggle(c)}
                title={c.description || c.label}
                className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-[11px] cursor-pointer ${
                  isActive ? "text-zinc-100" : "text-zinc-400 hover:bg-[#202020] hover:text-zinc-200"
                }`}
              >
                <span className="w-4 h-4 shrink-0 [&>svg]:w-full [&>svg]:h-full" style={{ color: c.color }} dangerouslySetInnerHTML={{ __html: c.icon }} />
                <span className="flex-1 truncate">{c.label}</span>
                {isActive && <Check className="w-3 h-3 shrink-0 text-[#d4af37]" />}
              </button>

              {isActive && combatRound !== null && (
                <DurationField
                  roundsLeft={entry.expiresRound !== undefined ? entry.expiresRound - effectiveCombatRound(combatRound) : undefined}
                  onChange={(rounds) => setDuration(c.key, rounds)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Campo de duração de uma condição marcada: vazio = permanente. Aparece só com combate ativo. */
const DurationField: React.FC<{ roundsLeft: number | undefined; onChange: (rounds: number | undefined) => void }> = ({ roundsLeft, onChange }) => {
  const [value, setValue] = useState(roundsLeft !== undefined ? String(roundsLeft) : "");
  // Se o dono do menu mudar a duração por fora (outro cliente, ou reabrir o menu), acompanha.
  const [prevRoundsLeft, setPrevRoundsLeft] = useState(roundsLeft);
  if (prevRoundsLeft !== roundsLeft) {
    setPrevRoundsLeft(roundsLeft);
    setValue(roundsLeft !== undefined ? String(roundsLeft) : "");
  }

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === "") {
      onChange(undefined);
      return;
    }
    const n = Math.trunc(Number(trimmed));
    if (!Number.isFinite(n) || n < 1) {
      setValue(roundsLeft !== undefined ? String(roundsLeft) : "");
      return;
    }
    onChange(n);
  };

  return (
    <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pl-7">
      <span className="text-[10px] text-zinc-500 shrink-0">duração (rodadas)</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="permanente"
        className="w-16 bg-[#141414] border border-[#3d3d3d] rounded px-1 py-0.5 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
      />
    </div>
  );
};
