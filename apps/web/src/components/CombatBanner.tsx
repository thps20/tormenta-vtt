import React from 'react';
import { Swords, Dices, Clock, Play } from 'lucide-react';
import type { Combat } from '@tormenta-vtt/shared';
import { FLOAT_SURFACE, MOTION } from './MapBar';

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
 * (precisa rolar > é o meu turno > estou adiado), ver docs/plano-combate.md. Cada estado tem um
 * só elemento dourado: a ação principal (Rolar, Entrar agora) ou o marcador do turno.
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

  // Ação principal do estado (dourado cheio, o único da faixa) e ação secundária (neutra).
  const primaryBtn = `focus-ring flex items-center gap-1.5 h-8 px-3 rounded-ui bg-accent hover:bg-accent/90 text-bg text-13 font-semibold cursor-pointer ${MOTION}`;
  const secondaryBtn = `focus-ring flex items-center gap-1.5 h-8 px-3 rounded-ui border border-border bg-surface-2 hover:border-text-muted text-13 font-medium text-text cursor-pointer ${MOTION}`;

  return (
    <div
      id="combat-top-banner"
      role="status"
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 pl-4 pr-2 py-2 ${FLOAT_SURFACE}`}
    >
      {needsRoll ? (
        <>
          <div className="flex items-center gap-2 text-14 text-text">
            <Swords className="w-4 h-4 text-text-muted" />
            <span>Combate iniciado — role sua iniciativa</span>
          </div>

          <button id="btn-banner-roll-initiative" onClick={() => onRollSelf && onRollSelf(myCombatant.id)} className={primaryBtn}>
            <Dices className="w-3.5 h-3.5" />
            <span>Rolar Iniciativa</span>
          </button>
        </>
      ) : isMyTurn ? (
        <>
          <div className="flex items-center gap-2 text-14">
            <span className="w-2.5 h-2.5 rounded-full bg-accent inline-block" aria-hidden />
            <span className="font-semibold text-text">É o seu turno!</span>
            <span className="text-text-muted hidden sm:inline">({myCombatant.name})</span>
          </div>

          <button
            id="btn-banner-delay-turn"
            onClick={() => onDelay && onDelay(myCombatant.id)}
            className={secondaryBtn}
            title="Adiar sua ação para o final ou momento oportuno"
          >
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span>Adiar</span>
          </button>
        </>
      ) : isDelayed ? (
        <>
          <div className="flex items-center gap-2 text-14 text-text">
            <Clock className="w-4 h-4 text-text-muted" />
            <span>Seu turno está <strong className="font-semibold">ADIADO</strong>.</span>
          </div>

          <button
            id="btn-banner-resume-turn"
            onClick={() => onResume && onResume(myCombatant.id)}
            className={primaryBtn}
            title="Intervir e agir agora na ordem de iniciativa"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Entrar agora</span>
          </button>
        </>
      ) : null}
    </div>
  );
};
