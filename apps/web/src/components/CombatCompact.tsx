import React, { useEffect, useRef } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, ListOrdered, Swords } from 'lucide-react';
import type { Combat } from '@tormenta-vtt/shared';

interface CombatCompactProps {
  combat: Combat;
  viewer: 'gm' | 'player';
  /** Token selecionado no mapa: a linha dele ganha contorno, igual ao painel completo. */
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string) => void;
  onNext: () => void;
  onPrev: () => void;
  /** Leva para a aba Iniciativa (gestão completa: reordenar, editar valor, adicionar, encerrar). */
  onOpenManagement: () => void;
}

/**
 * Iniciativa encaixada acima do chat, na mesma coluna, enquanto há combate no mapa visto
 * (docs/critique-arquitetura-mesa.md, piso comum): no combate o Mestre precisa ler a rolagem e
 * passar o turno ao mesmo tempo, sem trocar de aba. Só leitura + Anterior/Próximo (GM, atalho N /
 * Shift+N); tudo que é gestão continua na aba Iniciativa (`CombatPanel`). A lista é a mesma ordem
 * que o servidor mandou (ver comentário de `sortedCombatants` no `CombatPanel`) e rola sozinha até
 * quem está na vez.
 */
export const CombatCompact: React.FC<CombatCompactProps> = ({ combat, viewer, selectedTokenId, onSelectToken, onNext, onPrev, onOpenManagement }) => {
  const listRef = useRef<HTMLOListElement>(null);
  const active = combat.combatants.find((c) => c.id === combat.activeCombatantId) ?? null;
  const statusText = combat.status === 'rolling' ? 'Rolando iniciativa' : active ? `Vez de ${active.name}` : 'Combate em andamento';

  // Mantém a linha da vez visível quando o turno anda (sem rolar a página inteira: só a lista).
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [combat.activeCombatantId]);

  return (
    <section id="combat-compact" aria-label="Iniciativa" className="font-ui shrink-0 border-b border-border bg-surface-1 text-text">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        <Swords className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className="text-12 font-title font-bold uppercase tracking-wider shrink-0">Rodada {combat.round}</span>
          {/* aria-live: quem usa leitor de tela ouve a troca de turno sem sair do chat. */}
          <span className="text-12 text-text-muted truncate" aria-live="polite" title={statusText}>
            {statusText}
          </span>
        </div>
        <button
          id="btn-combat-compact-manage"
          type="button"
          onClick={onOpenManagement}
          title="Gerenciar combate (aba Iniciativa)"
          className="focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui text-12 text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
        >
          <ListOrdered className="w-3.5 h-3.5" aria-hidden />
          Gerenciar
        </button>
      </div>

      {viewer === 'gm' && (
        <div className="grid grid-cols-[auto_1fr] gap-1.5 px-3 pb-2">
          <button
            id="btn-combat-compact-prev"
            type="button"
            onClick={onPrev}
            disabled={combat.status !== 'active'}
            title="Voltar para o combatente anterior (Shift+N)"
            aria-label="Anterior"
            aria-keyshortcuts="Shift+N"
            className="focus-ring flex items-center justify-center h-8 px-2.5 rounded-ui bg-surface-2 hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed border border-border text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {/* Único dourado do bloco: a ação principal do combate (docs/design/DESIGN.md). */}
          <button
            id="btn-combat-compact-next"
            type="button"
            onClick={onNext}
            title="Avançar para o próximo combatente (N)"
            aria-keyshortcuts="N"
            className="focus-ring flex items-center justify-center gap-1.5 h-8 px-3 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-accent text-accent text-12 font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Próximo
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <ol ref={listRef} className="max-h-[min(10.5rem,24vh)] overflow-y-auto scrollbar-thin px-1.5 pb-1.5 space-y-px">
        {combat.combatants.map((c) => {
          const isActive = c.id === combat.activeCombatantId;
          const noInitiative = c.initiative === null && !c.rolled;
          return (
            <li key={c.id}>
              <button
                type="button"
                id={`combat-compact-row-${c.id}`}
                data-active={isActive}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelectToken(c.tokenId)}
                title={`${c.name}${isActive ? ' (na vez)' : ''} — selecionar no mapa`}
                className={`focus-ring w-full flex items-center gap-2 h-7 px-1.5 rounded-ui border text-left cursor-pointer transition-colors ${
                  isActive ? 'bg-surface-2 border-accent' : selectedTokenId === c.tokenId ? 'border-text-muted' : 'border-transparent hover:bg-surface-2'
                } ${noInitiative ? 'opacity-60' : ''}`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#71717a' }} aria-hidden />
                <span className={`flex-1 min-w-0 truncate text-12 ${isActive ? 'font-bold text-text' : 'text-text'}`}>{c.name}</span>
                {c.surprised && <AlertTriangle className="w-3 h-3 text-danger shrink-0" aria-label="Surpreso" />}
                {c.delayed && <Clock className="w-3 h-3 text-text-muted shrink-0" aria-label="Adiado" />}
                <span className="w-7 text-right text-12 font-data tabular-nums font-bold text-text-muted shrink-0">
                  {c.initiative !== null ? c.initiative : c.rolled ? '✓' : '—'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
