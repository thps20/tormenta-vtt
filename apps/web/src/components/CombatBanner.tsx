import React from 'react';
import { Swords, Dices, Clock, Play } from 'lucide-react';
import type { Combat } from '@tormenta-vtt/shared';

interface CombatBannerProps {
  combat: Combat | null;
  meId: string;
  viewer: 'gm' | 'player';
  onRollSelf?: (combatantId: string) => void;
  onDelay?: (combatantId: string) => void;
  onResume?: (combatantId: string) => void;
}

/**
 * Faixa discreta sobre o mapa: um dos três estados abaixo, nunca mais de um ao mesmo tempo
 * (precisa rolar > é o meu turno > estou adiado), ver docs/plano-combate.md.
 */
export const CombatBanner: React.FC<CombatBannerProps> = ({
  combat,
  meId,
  viewer,
  onRollSelf,
  onDelay,
  onResume,
}) => {
  if (!combat || combat.status === 'ended') {
    return null;
  }

  // Check if player has a combatant in this combat
  const myCombatant = combat.combatants.find((c) => c.ownerId === meId);

  // Case 1: Player hasn't rolled initiative yet
  const needsRoll = myCombatant && !myCombatant.rolled;

  // Case 2: It is player's active turn
  const isMyTurn =
    myCombatant &&
    combat.status === 'active' &&
    combat.activeCombatantId === myCombatant.id;

  // Case 3: Player is currently delayed
  const isDelayed = myCombatant && myCombatant.delayed;

  if (!needsRoll && !isMyTurn && !isDelayed) {
    return null;
  }

  return (
    <div
      id="combat-top-banner"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-lg bg-[#14120e]/95 border border-[#d4af37] text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.85)] backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2 duration-300"
    >
      {needsRoll ? (
        <>
          <div className="flex items-center gap-2 text-amber-300 text-xs font-serif font-bold">
            <Swords className="w-4 h-4 text-[#d4af37] animate-pulse" />
            <span>Combate iniciado — role sua iniciativa</span>
          </div>

          <button
            id="btn-banner-roll-initiative"
            onClick={() => onRollSelf && onRollSelf(myCombatant.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#2d2417] hover:bg-[#3d311f] border border-[#d4af37] text-[#d4af37] text-xs font-serif font-bold transition-all shadow hover:shadow-[0_0_10px_rgba(212,175,55,0.4)] cursor-pointer"
          >
            <Dices className="w-3.5 h-3.5" />
            <span>Rolar Iniciativa</span>
          </button>
        </>
      ) : isMyTurn ? (
        <>
          <div className="flex items-center gap-2 text-amber-200 text-xs font-serif font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            <span>É o seu turno!</span>
            <span className="text-zinc-400 text-[11px] font-sans font-normal hidden sm:inline">
              ({myCombatant.name})
            </span>
          </div>

          <button
            id="btn-banner-delay-turn"
            onClick={() => onDelay && onDelay(myCombatant.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#2a1d1d] hover:bg-[#382323] border border-amber-500/60 text-amber-300 text-xs font-serif font-bold transition-all cursor-pointer shadow hover:border-amber-400"
            title="Adiar sua ação para o final ou momento oportuno"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Adiar</span>
          </button>
        </>
      ) : isDelayed ? (
        <>
          <div className="flex items-center gap-2 text-zinc-300 text-xs font-serif">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Seu turno está <strong className="text-amber-400">ADIADO</strong>.</span>
          </div>

          <button
            id="btn-banner-resume-turn"
            onClick={() => onResume && onResume(myCombatant.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#1e261d] hover:bg-[#283627] border border-emerald-500/70 text-emerald-300 text-xs font-serif font-bold transition-all cursor-pointer shadow"
            title="Intervir e agir agora na ordem de iniciativa"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span>Entrar agora</span>
          </button>
        </>
      ) : null}
    </div>
  );
};
