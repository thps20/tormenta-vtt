import React, { useState } from "react";
import { ClipboardList, Play } from "lucide-react";
import type { Pin } from "@tormenta-vtt/shared";
import { ensurePrepLibraries, usePrepRunner } from "../lib/usePrepRunner";
import { usePrep } from "../store/prep";
import { PrepRunDialog } from "./PrepRunDialog";

export interface PrepNextStepCardProps {
  sceneId: string;
  getViewportCenter: () => { x: number; y: number };
  onOpenNotePin: (pin: Pin & { kind: "note" }) => void;
  /** Abre a gaveta de Preparo (edição completa) — o título do card é o atalho pra ela. */
  onOpenPrep: () => void;
}

/**
 * "Próximo passo" no topo do painel lateral, só GM (docs/SPEC.md §9.28): uma linha com o primeiro
 * passo ainda não usado do mapa VISTO e o botão Iniciar, que executa exatamente como a gaveta de
 * Preparo executa (mesmo `PrepRunDialog`, mesmo hook). Sem passo pendente — ou sem preparo nenhum —
 * o card não aparece: é a ponte entre preparar e jogar, não mais uma caixa fixa ocupando altura.
 */
export const PrepNextStepCard: React.FC<PrepNextStepCardProps> = ({ sceneId, getViewportCenter, onOpenNotePin, onOpenPrep }) => {
  // `loadLibraries: false`: este card monta em toda sessão de GM e só precisa dos passos. As quatro
  // bibliotecas que resolvem referência são carregadas no clique de Iniciar (`ensurePrepLibraries`),
  // senão todo item apareceria como "Apagado do acervo" por a lista local estar vazia.
  const { steps, runItemsOf, runOneOf } = usePrepRunner({ sceneId, getViewportCenter, onOpenNotePin, loadLibraries: false });
  const [runOpen, setRunOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const next = steps.find((s) => !s.used) ?? null;
  if (!next) return null;

  const handleStart = async () => {
    setPreparing(true);
    await ensurePrepLibraries();
    setPreparing(false);
    setRunOpen(true);
  };

  return (
    <div id="prep-next-step" className="font-ui shrink-0 flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-surface-1">
      <button
        id="btn-prep-next-open"
        type="button"
        onClick={onOpenPrep}
        title={`Abrir o Preparo deste mapa (Shift+P) — passo: ${next.title}`}
        className="focus-ring flex items-center gap-1.5 min-w-0 flex-1 px-1 py-0.5 rounded-ui text-left text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <ClipboardList className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="text-12 uppercase tracking-wider font-title font-bold shrink-0">Próximo passo</span>
        <span className="text-12 text-text truncate">{next.title}</span>
      </button>
      <button
        id="btn-prep-next-run"
        type="button"
        onClick={() => void handleStart()}
        disabled={preparing}
        title={`Iniciar "${next.title}": executa os itens automáticos deste passo`}
        className="focus-ring flex items-center gap-1 h-6 px-2 rounded-ui border border-accent bg-surface-2 hover:bg-surface-2/80 text-accent text-12 font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 shrink-0"
      >
        <Play className="w-3 h-3" aria-hidden />
        Iniciar
      </button>

      {runOpen && (
        <PrepRunDialog
          items={runItemsOf(next)}
          runOne={(itemId) => runOneOf(next, itemId)}
          onFinished={(ranAtLeastOnce) => {
            setRunOpen(false);
            if (ranAtLeastOnce) void usePrep.getState().updateStep(next.id, { used: true });
          }}
        />
      )}
    </div>
  );
};
