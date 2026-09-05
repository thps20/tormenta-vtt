import React from 'react';
import { Swords, ChevronRight, RotateCcw, EyeOff, Flame } from 'lucide-react';
import type { InitiativeState, Token } from '@tormenta-vtt/shared';
import { currentEntry, sortEntries } from '../store/initiative';

interface InitiativeTabProps {
  initiative: InitiativeState | null;
  tokens: Token[];
  isGm: boolean;
  onNextTurn: () => void;
  onResetInitiative: () => void;
  onSelectToken: (tokenId: string) => void;
  selectedTokenId: string | null;
}

export const InitiativeTab: React.FC<InitiativeTabProps> = ({
  initiative,
  tokens,
  isGm,
  onNextTurn,
  onResetInitiative,
  onSelectToken,
  selectedTokenId,
}) => {
  const sortedEntries = sortEntries(initiative?.entries ?? []);
  const activeEntry = currentEntry(initiative);
  const round = initiative?.round ?? 0;
  const currentIndex = initiative?.currentIndex ?? null;

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-200">
      {/* Header: Combat Info & Actions */}
      <div className="p-3 bg-[#141414] border-b border-[#2d2417] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-[#d4af37]/60 bg-[#252525] flex items-center justify-center text-[#d4af37] shadow-inner">
            <Swords className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-serif font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-1.5">
              <span>ORDEM DE COMBATE</span>
            </div>
            <div className="text-[11px] text-[#d4af37] font-serif font-semibold mt-0.5">
              Rodada <span className="font-bold font-mono">{round}</span>
              {activeEntry && (
                <span className="text-zinc-400 ml-1 font-sans font-normal">
                  • Turno de <strong className="text-zinc-200">{activeEntry.name}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {isGm && (
            <button
              onClick={() => {
                if (window.confirm('Limpar a iniciativa e voltar à rodada 0?')) onResetInitiative();
              }}
              title="Limpar combate (remove todas as entradas)"
              className="p-1.5 rounded text-zinc-400 hover:text-[#d4af37] hover:bg-[#252525] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Entries List - Elegant Dark */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
        {sortedEntries.length === 0 ? (
          <div className="text-center py-10 text-zinc-600 text-xs font-serif">
            Nenhum combatente na iniciativa.
          </div>
        ) : (
          sortedEntries.map((entry, idx) => {
            const isCurrent = currentIndex === idx;
            const token = entry.tokenId ? tokens.find((t) => t.id === entry.tokenId) : null;
            const isSelected = entry.tokenId && entry.tokenId === selectedTokenId;

            return (
              <div
                key={entry.id}
                id={`initiative-entry-${entry.id}`}
                onClick={() => {
                  if (entry.tokenId) onSelectToken(entry.tokenId);
                }}
                className={`relative p-2.5 rounded border transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-[#222222] border-[#d4af37] shadow-lg shadow-[#d4af37]/5'
                    : isSelected
                    ? 'bg-[#1e1e1e] border-[#d4af37]/60'
                    : 'bg-[#161616] border-[#2d2417] opacity-75 hover:opacity-100 hover:border-[#3d3d3d]'
                }`}
              >
                {/* Active Turn Gold Ribbon */}
                {isCurrent && (
                  <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r bg-[#d4af37] shadow-sm" />
                )}

                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Initiative Value Badge */}
                    <span
                      className={`font-serif font-bold text-sm min-w-[22px] text-right ${
                        isCurrent ? 'text-[#d4af37]' : 'text-zinc-500'
                      }`}
                    >
                      {entry.value}
                    </span>

                    {/* Token Avatar */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${
                        isCurrent
                          ? 'border-[#d4af37] text-[#d4af37] bg-zinc-800 font-serif'
                          : 'border-zinc-700 text-zinc-400 bg-zinc-800'
                      }`}
                      style={{
                        backgroundColor: token ? token.color : '#27272a',
                      }}
                    >
                      {entry.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4
                          className={`text-xs font-bold truncate ${
                            isCurrent ? 'text-zinc-100' : 'text-zinc-300'
                          }`}
                        >
                          {entry.name}
                        </h4>
                        {isCurrent && (
                          <span className="text-[9px] text-[#d4af37] border border-[#d4af37]/40 bg-[#2d2417] px-1 rounded font-serif font-bold shrink-0">
                            TURNO
                          </span>
                        )}
                        {!entry.visible && (
                          <span title="Oculto dos jogadores">
                            <EyeOff className="w-3 h-3 text-zinc-600 shrink-0" />
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {token ? 'Token no mapa' : entry.tokenId ? 'Token fora desta cena' : 'Entrada manual'}
                      </div>
                    </div>
                  </div>

                  {/* Tiebreak score */}
                  <div className="text-right shrink-0">
                    <span className="text-[9px] font-mono text-zinc-600">
                      +{entry.tiebreak}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Bar: Next Turn Big Button (GM) */}
      <div className="p-3 bg-[#121212] border-t border-[#2d2417] flex flex-col gap-2">
        {isGm && (
          <button
            id="btn-next-turn"
            onClick={onNextTurn}
            disabled={sortedEntries.length === 0}
            className="w-full py-2.5 bg-[#2d2417] border border-[#d4af37] text-[#d4af37] text-xs font-serif font-bold uppercase tracking-wider rounded hover:bg-[#3d311f] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-40"
            title="Avançar para o próximo combatente"
          >
            <span>{currentIndex === null ? 'Iniciar Combate' : 'Próximo Turno'}</span>
            <ChevronRight className="w-4 h-4 text-[#d4af37]" />
          </button>
        )}

        <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 font-mono">
          <span className="flex items-center gap-1">
            <Flame className="w-3 h-3 text-[#d4af37]" />
            {sortedEntries.length} combatentes
          </span>
          <span>Clique para focar no mapa</span>
        </div>
      </div>
    </div>
  );
};
