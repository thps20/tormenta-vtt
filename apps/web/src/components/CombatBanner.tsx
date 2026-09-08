import type { Combat, Participant } from "@tormenta-vtt/shared";
import { activeCombatant, isMyTurn, myPendingCombatants } from "../store/combat";

interface CombatBannerProps {
  combat: Combat | null;
  me: Participant;
  onRollSelf: () => void;
  onDelay: (combatantId: string) => void;
}

/**
 * Faixa discreta sobre o mapa (SPEC §... modo de combate): dois estados possíveis, nunca os dois
 * juntos ("rolar" só aparece pra quem ainda tem combatente sem iniciativa; "seu turno" cobre isso).
 */
export function CombatBanner({ combat, me, onRollSelf, onDelay }: CombatBannerProps) {
  if (!combat || combat.status === "ended") return null;

  const active = activeCombatant(combat);
  if (active && isMyTurn(combat, me)) {
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-full bg-[#2d2417] border border-[#d4af37] text-[#d4af37] shadow-lg shadow-black/40">
        <span className="text-xs font-serif font-bold uppercase tracking-wider">É o seu turno</span>
        <button onClick={() => onDelay(active.id)} className="text-[11px] font-bold underline decoration-dotted hover:no-underline cursor-pointer">
          Adiar
        </button>
      </div>
    );
  }

  const pending = myPendingCombatants(combat, me);
  if (pending.length > 0) {
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-full bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-200 shadow-lg shadow-black/40">
        <span className="text-xs font-serif tracking-wide">Combate iniciado — rolar iniciativa</span>
        <button
          onClick={onRollSelf}
          className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#2d2417] border border-[#d4af37]/60 text-[#d4af37] hover:bg-[#3d311f] cursor-pointer"
        >
          Rolar
        </button>
      </div>
    );
  }

  return null;
}
