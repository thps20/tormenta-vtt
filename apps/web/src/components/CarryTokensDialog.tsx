import React, { useState } from "react";
import { AlertTriangle, ArrowRight, Swords } from "lucide-react";

export interface CarryTokenRow {
  tokenId: string;
  name: string;
  ownerNickname: string | null;
  /** Pré-marcado por padrão (ficha/dono de jogador, ou estava selecionado no mapa). */
  preselected: boolean;
  /** É combatente do combate do mapa de origem — sai dele ao ser levado (§8). */
  inCombat: boolean;
}

interface CarryTokensDialogProps {
  destSceneName: string;
  rows: CarryTokenRow[];
  onCancel: () => void;
  onConfirm: (moveTokenIds: string[]) => void;
}

/**
 * "Levar para o mapa" (docs/plano-mapas.md §8): antes de ativar, o GM escolhe quais tokens do mapa
 * ativo atual vão junto. Pré-marcado: tokens de jogador (ficha ou dono) e os que estavam
 * selecionados no mapa. Não bloqueia se algum marcado está em combate — só avisa.
 */
export const CarryTokensDialog: React.FC<CarryTokensDialogProps> = ({ destSceneName, rows, onCancel, onConfirm }) => {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rows.filter((r) => r.preselected).map((r) => r.tokenId)));

  const toggle = (tokenId: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(tokenId)) next.delete(tokenId);
      else next.add(tokenId);
      return next;
    });

  const anyInCombatChecked = rows.some((r) => r.inCombat && checked.has(r.tokenId));

  return (
    <div
      id="carry-tokens-dialog-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div id="carry-tokens-dialog" className="w-full max-w-md bg-[#141414] border border-[#2d2417] rounded shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 bg-[#1a1a1a] border-b border-[#2d2417] shrink-0">
          <h2 className="text-sm font-serif font-bold text-zinc-100 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-[#d4af37]" />
            Levar para o mapa <span className="text-[#d4af37]">&quot;{destSceneName}&quot;</span>
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">Tokens marcados saem deste mapa (não é cópia) e mantêm PV, condições e ficha.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="text-center text-xs text-zinc-500 font-serif py-6">Este mapa não tem tokens.</p>
          ) : (
            rows.map((row) => (
              <label
                key={row.tokenId}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[#1f1f1f] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked.has(row.tokenId)}
                  onChange={() => toggle(row.tokenId)}
                  className="accent-[#d4af37] cursor-pointer"
                />
                <span className="flex-1 min-w-0 text-xs text-zinc-200 truncate">{row.name}</span>
                {row.ownerNickname && <span className="text-[10px] text-zinc-500 shrink-0">jogador: {row.ownerNickname}</span>}
                {row.inCombat && (
                  <span title="Está no combate deste mapa">
                    <Swords className="w-3 h-3 text-amber-400 shrink-0" />
                  </span>
                )}
              </label>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-[#2d2417] bg-[#131210] shrink-0 space-y-1.5">
          <p className="text-[11px] text-zinc-400">
            {checked.size} de {rows.length} {rows.length === 1 ? "token será movido" : "tokens serão movidos"}.
          </p>
          {anyInCombatChecked && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Combatentes marcados sairão do combate deste mapa.
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#2d2417] bg-[#1a1a1a] flex items-center justify-end gap-2 shrink-0 flex-wrap">
          <button
            id="btn-carry-cancel"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] border border-[#3d3d3d] text-zinc-300 text-xs font-serif font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            id="btn-carry-none"
            onClick={() => onConfirm([])}
            className="px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2e2e2e] border border-[#3d3d3d] text-zinc-300 text-xs font-serif font-semibold cursor-pointer"
          >
            Ativar sem levar ninguém
          </button>
          <button
            id="btn-carry-confirm"
            onClick={() => onConfirm([...checked])}
            className="px-3 py-1.5 rounded bg-[#d4af37] hover:bg-[#e0bc46] text-black font-serif font-bold text-xs cursor-pointer"
          >
            Ativar e levar
          </button>
        </div>
      </div>
    </div>
  );
};
