import React, { useEffect, useRef, useState } from "react";
import { Eye, Swords } from "lucide-react";
import type { ChatMessage } from "@tormenta-vtt/shared";
import { rollModeInfo } from "../../lib/rollMode";
import { useChat } from "../../store/chat";
import { prefersReducedMotion, type DiceAnimationMode } from "../../lib/rollPreferences";

interface InitiativeBatchMessageProps {
  msg: ChatMessage;
  time: string;
  /** GM vê o botão Revelar (mesma regra dos outros cards de rolagem). */
  isGm: boolean;
  /** Animação de revelação (docs/SPEC.md item 3): sem física 3D aqui (lote de vários
   *  combatentes, não uma rolagem só) — "3d" também usa a transição curta do cartão. */
  animationMode: DiceAnimationMode;
  onReveal: (messageId: string) => void;
}

/**
 * Card de iniciativa em lote (combat:roll rolando mais de um combatente de uma vez,
 * ChatMessage{kind:"initiative-batch"}): cabeçalho com a rodada e uma linha por combatente.
 * O servidor já manda só as linhas que este viewer pode ver (token oculto = linha ausente,
 * não substituída), e omite fórmula/resultado de quem `visibility` não permite (mostra "rolou").
 */
export const InitiativeBatchMessage: React.FC<InitiativeBatchMessageProps> = ({ msg, time, isGm, animationMode, onReveal }) => {
  const consumeRollAnimation = useChat((s) => s.consumeRollAnimation);
  // Leitura pura (segura sob StrictMode dev, que chama o inicializador 2×) — quem de fato
  // consome (remove do set global) é o efeito abaixo, uma vez só.
  const pendingRef = useRef(useChat.getState().pendingRollAnimations.has(msg.id));
  const [revealing, setRevealing] = useState(pendingRef.current && animationMode !== "off" && !prefersReducedMotion());

  useEffect(() => {
    if (!pendingRef.current) return;
    consumeRollAnimation(msg.id);
    if (animationMode === "off" || prefersReducedMotion()) return;
    // Reagendado a cada chamada do efeito de propósito: sob StrictMode (dev) o React roda
    // monta→efeito→limpa→efeito de novo, e só o ÚLTIMO timer agendado sobrevive (os anteriores
    // são cancelados pela função de limpeza) — sem isso a animação travava ligada pra sempre.
    const t = window.setTimeout(() => setRevealing(false), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const batch = msg.initiativeBatch;
  if (!batch) return null;
  // Acionável (fica cartão) só quando o Revelar aparece (GM, rolagem não pública); pros demais é
  // uma linha de log, igual a uma rolagem simples (docs/design/DESIGN.md).
  const revealable = isGm && msg.visibility !== "all";

  return (
    <div id={`chat-msg-${msg.id}`} className={revealable ? "font-ui p-3 rounded-ui border border-border bg-surface-2" : "font-ui py-1.5 border-b border-border"}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-12 font-title font-bold uppercase tracking-tight text-text">
            Iniciativa (rodada {batch.round})
          </span>
        </div>
        <span className="text-12 font-data tabular-nums text-text-muted">{time}</span>
      </div>

      <div
        data-batch-entries
        className={revealing ? 'dice-reveal-number' : undefined}
        title={revealing ? 'Clique para revelar na hora' : undefined}
        onClick={revealing ? () => setRevealing(false) : undefined}
      >
        {batch.entries.map((e) => (
          <div
            key={e.combatantId}
            data-combatant-id={e.combatantId}
            className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0"
          >
            <span className="text-xs text-text truncate">{e.name}</span>
            {e.result !== undefined ? (
              <span className="flex items-baseline gap-2">
                {e.formula && <span className="text-12 font-data text-text-muted">{e.formula}</span>}
                <span className="text-sm font-data tabular-nums font-bold text-text">{e.result}</span>
              </span>
            ) : (
              <span className="text-12 text-text-muted italic">rolou</span>
            )}
          </div>
        ))}
      </div>

      {msg.visibility !== "all" &&
        (() => {
          const vis = rollModeInfo(msg.visibility);
          const VisIcon = vis.icon;
          return (
            <div
              className="mt-2 pt-1.5 border-t border-border flex items-center justify-between gap-2 text-12 font-ui"
              data-visibility={msg.visibility}
            >
              <span className="flex items-center gap-1 text-text-muted">
                <VisIcon className="w-3 h-3" />
                <span>{msg.visibility === "gm" ? "Rolagem secreta: só o GM vê os valores" : "Rolagem própria: só você vê os valores"}</span>
              </span>
              {isGm && (
                <button
                  type="button"
                  id={`reveal-${msg.id}`}
                  onClick={() => onReveal(msg.id)}
                  title="Tornar pública para todos"
                  className="focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui border border-accent text-accent hover:bg-surface-1 transition-colors cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  Revelar
                </button>
              )}
            </div>
          );
        })()}
    </div>
  );
};
