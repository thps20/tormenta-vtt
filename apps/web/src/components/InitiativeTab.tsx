import React, { useState } from "react";
import { Swords, ChevronRight, ChevronLeft, RotateCcw, EyeOff, Eye, Flame, Plus, Trash2 } from "lucide-react";
import type { InitiativeAddPayload, InitiativeState, InitiativeUpdatePayload, Token } from "@tormenta-vtt/shared";
import { currentEntry, sortEntries } from "../store/initiative";

interface InitiativeTabProps {
  initiative: InitiativeState | null;
  tokens: Token[];
  isGm: boolean;
  onNextTurn: () => void;
  onPrevTurn: () => void;
  onResetInitiative: () => void;
  onAddEntry: (entry: InitiativeAddPayload) => void;
  onUpdateEntry: (patch: InitiativeUpdatePayload) => void;
  onRemoveEntry: (entryId: string) => void;
  onSelectToken: (tokenId: string) => void;
  selectedTokenId: string | null;
}

/** Painel de iniciativa. Lista para todos; formulário e controles só para o GM. */
export const InitiativeTab: React.FC<InitiativeTabProps> = ({
  initiative,
  tokens,
  isGm,
  onNextTurn,
  onPrevTurn,
  onResetInitiative,
  onAddEntry,
  onUpdateEntry,
  onRemoveEntry,
  onSelectToken,
  selectedTokenId,
}) => {
  const sortedEntries = sortEntries(initiative?.entries ?? []);
  const activeEntry = currentEntry(initiative);
  const round = initiative?.round ?? 0;
  const currentIndex = initiative?.currentIndex ?? null;

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-200">
      {/* Cabeçalho */}
      <div className="p-3 bg-[#141414] border-b border-[#2d2417] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-[#d4af37]/60 bg-[#252525] flex items-center justify-center text-[#d4af37] shadow-inner">
            <Swords className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-serif font-bold text-zinc-100 uppercase tracking-widest">ORDEM DE COMBATE</div>
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
        {isGm && (
          <button
            onClick={() => {
              if (window.confirm("Limpar a iniciativa e voltar à rodada 0?")) onResetInitiative();
            }}
            title="Limpar combate (remove todas as entradas)"
            className="p-1.5 rounded text-zinc-400 hover:text-[#d4af37] hover:bg-[#252525] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedEntries.length === 0 ? (
          <div className="text-center py-10 text-zinc-600 text-xs font-serif">Nenhum combatente na iniciativa.</div>
        ) : (
          sortedEntries.map((entry, idx) => {
            const isCurrent = currentIndex === idx;
            const token = entry.tokenId ? tokens.find((t) => t.id === entry.tokenId) : null;
            const isSelected = entry.tokenId !== null && entry.tokenId === selectedTokenId;
            return (
              <div
                key={entry.id}
                id={`initiative-entry-${entry.id}`}
                onClick={() => entry.tokenId && onSelectToken(entry.tokenId)}
                className={`relative p-2.5 rounded border transition-all ${entry.tokenId ? "cursor-pointer" : ""} ${
                  isCurrent
                    ? "bg-[#222222] border-[#d4af37] shadow-lg shadow-[#d4af37]/5"
                    : isSelected
                      ? "bg-[#1e1e1e] border-[#d4af37]/60"
                      : "bg-[#161616] border-[#2d2417] opacity-75 hover:opacity-100 hover:border-[#3d3d3d]"
                }`}
              >
                {isCurrent && <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r bg-[#d4af37] shadow-sm" />}

                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Valor (GM edita inline) */}
                    {isGm ? (
                      <input
                        type="number"
                        defaultValue={entry.value}
                        key={`${entry.id}-${entry.value}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== entry.value) onUpdateEntry({ id: entry.id, value: v });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        title="Valor da iniciativa (clique para editar)"
                        className={`w-11 bg-transparent border-b border-transparent focus:border-[#d4af37] focus:outline-none font-serif font-bold text-sm text-right ${
                          isCurrent ? "text-[#d4af37]" : "text-zinc-400"
                        }`}
                      />
                    ) : (
                      <span className={`font-serif font-bold text-sm min-w-[22px] text-right ${isCurrent ? "text-[#d4af37]" : "text-zinc-500"}`}>
                        {entry.value}
                      </span>
                    )}

                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${
                        isCurrent ? "border-[#d4af37] text-[#d4af37] font-serif" : "border-zinc-700 text-zinc-300"
                      }`}
                      style={{ backgroundColor: token ? token.color : "#27272a" }}
                    >
                      {entry.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className={`text-xs font-bold truncate ${isCurrent ? "text-zinc-100" : "text-zinc-300"}`}>{entry.name}</h4>
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
                        {token ? "Token no mapa" : entry.tokenId ? "Token fora desta cena" : "Entrada manual"}
                        {entry.tiebreak !== 0 && <span className="font-mono ml-1">(desempate {entry.tiebreak})</span>}
                      </div>
                    </div>
                  </div>

                  {isGm && (
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onUpdateEntry({ id: entry.id, visible: !entry.visible })}
                        title={entry.visible ? "Ocultar dos jogadores" : "Mostrar aos jogadores"}
                        className="p-1 rounded text-zinc-500 hover:text-[#d4af37] hover:bg-[#252525] cursor-pointer"
                      >
                        {entry.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => onRemoveEntry(entry.id)}
                        title="Remover da iniciativa"
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-[#252525] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé: formulário (GM) + navegação */}
      <div className="p-3 bg-[#121212] border-t border-[#2d2417] flex flex-col gap-2">
        {isGm && <AddEntryForm tokens={tokens} onAdd={onAddEntry} />}

        {isGm && (
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevTurn}
              disabled={currentIndex === null}
              title="Voltar um turno"
              className="p-2.5 rounded bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-400 hover:text-[#d4af37] hover:border-[#d4af37] cursor-pointer disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              id="btn-next-turn"
              onClick={onNextTurn}
              disabled={sortedEntries.length === 0}
              className="flex-1 py-2.5 bg-[#2d2417] border border-[#d4af37] text-[#d4af37] text-xs font-serif font-bold uppercase tracking-wider rounded hover:bg-[#3d311f] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-40"
              title="Avançar para o próximo combatente"
            >
              <span>{currentIndex === null ? "Iniciar Combate" : "Próximo Turno"}</span>
              <ChevronRight className="w-4 h-4 text-[#d4af37]" />
            </button>
          </div>
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

/** Formulário compacto: nome (ou token), valor, desempate. */
function AddEntryForm({ tokens, onAdd }: { tokens: Token[]; onAdd: (entry: InitiativeAddPayload) => void }) {
  const [tokenId, setTokenId] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [tiebreak, setTiebreak] = useState("");

  const selectedToken = tokens.find((t) => t.id === tokenId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = (selectedToken ? selectedToken.name : name).trim();
    const v = Number(value);
    if (!finalName || !Number.isFinite(v) || value === "") return;
    onAdd({ tokenId: tokenId || null, name: finalName, value: v, tiebreak: Number(tiebreak) || 0, visible: true });
    setName("");
    setValue("");
    setTiebreak("");
    setTokenId("");
  };

  const cls = "bg-[#1a1a1a] border border-[#3d3d3d] rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-[#d4af37] placeholder:text-zinc-600";

  return (
    <form onSubmit={submit} className="grid grid-cols-[1fr_52px_44px_32px] gap-1.5 items-center">
      {tokens.length > 0 && (
        <select value={tokenId} onChange={(e) => setTokenId(e.target.value)} className={`${cls} col-span-4`} title="Adicionar a partir de um token">
          <option value="">Entrada manual (digite o nome)</option>
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={selectedToken ? selectedToken.name : name}
        onChange={(e) => setName(e.target.value)}
        disabled={!!selectedToken}
        placeholder="Nome"
        maxLength={64}
        className={`${cls} disabled:opacity-60`}
      />
      <input value={value} onChange={(e) => setValue(e.target.value)} type="number" placeholder="Ini" required className={`${cls} text-center`} title="Valor da iniciativa" />
      <input value={tiebreak} onChange={(e) => setTiebreak(e.target.value)} type="number" placeholder="+0" className={`${cls} text-center`} title="Desempate" />
      <button type="submit" title="Adicionar" className="h-full rounded bg-[#2d2417] border border-[#d4af37]/60 text-[#d4af37] hover:bg-[#3d311f] flex items-center justify-center cursor-pointer">
        <Plus className="w-4 h-4" />
      </button>
    </form>
  );
}
