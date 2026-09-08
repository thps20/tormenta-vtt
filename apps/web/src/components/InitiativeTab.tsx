import React, { useState } from "react";
import { Swords, ChevronRight, ChevronLeft, EyeOff, Flame, X, Clock, RotateCcw } from "lucide-react";
import type { Combat, CombatAddPayload, CombatRollPayload, CombatSetInitiativePayload, CombatStartPayload, Participant, Token } from "@tormenta-vtt/shared";
import { activeCombatant } from "../store/combat";

export interface CombatActions {
  start: (payload: CombatStartPayload) => void;
  addCombatants: (payload: CombatAddPayload) => void;
  remove: (combatantIds: string[]) => void;
  roll: (payload: CombatRollPayload) => void;
  setInitiative: (payload: CombatSetInitiativePayload) => void;
  setSurprised: (combatantId: string, surprised: boolean) => void;
  next: () => void;
  prev: () => void;
  reorder: (combatantIds: string[]) => void;
  delay: (combatantId: string) => void;
  resume: (combatantId: string) => void;
  end: (clear?: boolean) => void;
}

interface InitiativeTabProps {
  combat: Combat | null;
  /** Cena ativa: precisa pra `combat:start`. null = sem cena (não deveria aparecer nesse estado). */
  activeSceneId: string | null;
  isGm: boolean;
  me: Participant;
  tokens: Token[];
  /** Seleção atual do mapa (Selecionar): "iniciar"/"adicionar" usam os tokens já selecionados lá. */
  selectedIds: string[];
  onSelectToken: (tokenId: string) => void;
  selectedTokenId: string | null;
  centerOnActiveTurn: boolean;
  onToggleCenterOnActiveTurn: () => void;
  actions: CombatActions;
}

/** Painel do modo de combate. Lista para todos; controles do GM abaixo. UI mínima (SPEC §3.5/§9). */
export const InitiativeTab: React.FC<InitiativeTabProps> = ({
  combat,
  activeSceneId,
  isGm,
  me,
  tokens,
  selectedIds,
  onSelectToken,
  selectedTokenId,
  centerOnActiveTurn,
  onToggleCenterOnActiveTurn,
  actions,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const combatants = combat?.combatants ?? [];
  const active = activeCombatant(combat);
  const statusLabel =
    combat?.status === "rolling" ? "Rolando iniciativa" : combat?.status === "ended" ? "Combate encerrado" : active ? `Turno de ${active.name}` : null;

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-200">
      {/* Cabeçalho */}
      <div className="p-3 bg-[#141414] border-b border-[#2d2417] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded border border-[#d4af37]/60 bg-[#252525] flex items-center justify-center text-[#d4af37] shadow-inner shrink-0">
            <Swords className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-serif font-bold text-zinc-100 uppercase tracking-widest">Modo de combate</div>
            <div className="text-[11px] text-[#d4af37] font-serif font-semibold mt-0.5 truncate">
              {combat ? (
                <>
                  Rodada <span className="font-bold font-mono">{combat.round}</span>
                  {statusLabel && <span className="text-zinc-400 ml-1 font-sans font-normal">• {statusLabel}</span>}
                </>
              ) : (
                <span className="text-zinc-500 font-sans font-normal">Nenhum combate nesta cena</span>
              )}
            </div>
          </div>
        </div>
        {isGm && combat && (
          <label className="flex items-center gap-1 text-[10px] text-zinc-400 shrink-0 cursor-pointer" title="Centralizar o mapa no token da vez">
            <input type="checkbox" checked={centerOnActiveTurn} onChange={onToggleCenterOnActiveTurn} className="cursor-pointer" />
            Centralizar
          </label>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!combat ? (
          <div className="text-center py-10 text-zinc-600 text-xs font-serif px-4">
            {isGm ? "Selecione tokens no mapa (ferramenta Selecionar) e clique em \"Iniciar combate\"." : "O GM ainda não iniciou um combate."}
          </div>
        ) : combatants.length === 0 ? (
          <div className="text-center py-10 text-zinc-600 text-xs font-serif">Nenhum combatente.</div>
        ) : (
          combatants.map((c) => {
            const isActive = combat.activeCombatantId === c.id;
            const isSelected = c.tokenId === selectedTokenId;
            const mine = c.ownerId === me.id;
            return (
              <div
                key={c.id}
                draggable={isGm}
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => isGm && e.preventDefault()}
                onDrop={() => {
                  if (isGm && dragId && dragId !== c.id) {
                    const ids = combatants.map((x) => x.id);
                    const from = ids.indexOf(dragId);
                    const to = ids.indexOf(c.id);
                    ids.splice(to, 0, ...ids.splice(from, 1));
                    actions.reorder(ids);
                  }
                  setDragId(null);
                }}
                onClick={() => onSelectToken(c.tokenId)}
                className={`relative p-2.5 rounded border cursor-pointer transition-all ${
                  isActive
                    ? "bg-[#222222] border-[#d4af37] shadow-lg shadow-[#d4af37]/5"
                    : isSelected
                      ? "bg-[#1e1e1e] border-[#d4af37]/60"
                      : c.rolled
                        ? "bg-[#161616] border-[#2d2417] hover:border-[#3d3d3d]"
                        : "bg-[#161616] border-[#2d2417] opacity-60"
                }`}
              >
                {isActive && <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r bg-[#d4af37] shadow-sm" />}
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isGm ? (
                      <input
                        type="number"
                        defaultValue={c.initiative ?? ""}
                        key={`${c.id}-${c.initiative}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== c.initiative) actions.setInitiative({ combatantId: c.id, initiative: v });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        placeholder="—"
                        title="Valor da iniciativa (clique para editar)"
                        className={`w-11 bg-transparent border-b border-transparent focus:border-[#d4af37] focus:outline-none font-serif font-bold text-sm text-right ${
                          isActive ? "text-[#d4af37]" : "text-zinc-400"
                        }`}
                      />
                    ) : (
                      // O servidor só manda o valor pro jogador ver do PRÓPRIO combatente, e mesmo assim
                      // não se a última rolagem foi às cegas (aí é null igual "não vejo o de ninguém").
                      <span
                        className={`font-serif font-bold text-sm min-w-[22px] text-right ${isActive ? "text-[#d4af37]" : "text-zinc-500"}`}
                        title={c.initiative !== null ? "Sua iniciativa" : undefined}
                      >
                        {c.initiative !== null ? c.initiative : c.rolled ? "✓" : "…"}
                      </span>
                    )}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border border-zinc-700 text-zinc-100"
                      style={{ backgroundColor: c.color }}
                    >
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className={`text-xs font-bold truncate ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>{c.name}</h4>
                        {isActive && (
                          <span className="text-[9px] text-[#d4af37] border border-[#d4af37]/40 bg-[#2d2417] px-1 rounded font-serif font-bold shrink-0">
                            TURNO
                          </span>
                        )}
                        {c.delayed && (
                          <span className="text-[9px] text-zinc-400 border border-zinc-600 px-1 rounded shrink-0 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> adiado
                          </span>
                        )}
                        {c.surprised && (
                          <span className="text-[9px] text-amber-400 border border-amber-700/50 px-1 rounded shrink-0" title="Surpreso: pula turnos no início do combate">
                            surpreso
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {!c.rolled ? "Sem iniciativa" : c.bonus !== null ? `bônus ${c.bonus >= 0 ? "+" : ""}${c.bonus}` : " "}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {isActive && (
                      <button
                        onClick={() => actions.delay(c.id)}
                        title="Adiar o turno"
                        className="p-1 rounded text-zinc-500 hover:text-[#d4af37] hover:bg-[#252525] cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {c.delayed && (mine || isGm) && (
                      <button
                        onClick={() => actions.resume(c.id)}
                        title="Entrar agora"
                        className="p-1 rounded text-zinc-500 hover:text-[#d4af37] hover:bg-[#252525] cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isGm && (
                      <>
                        <button
                          onClick={() => actions.setSurprised(c.id, !c.surprised)}
                          title="Marcar/desmarcar surpresa"
                          className="p-1 rounded text-zinc-500 hover:text-amber-400 hover:bg-[#252525] cursor-pointer"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => actions.remove([c.id])}
                          title="Remover do combate"
                          className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-[#252525] cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé: ações do GM, rolar a própria, navegação */}
      <div className="p-3 bg-[#121212] border-t border-[#2d2417] flex flex-col gap-2">
        {isGm && (
          <div className="flex flex-wrap gap-1.5">
            {!combat ? (
              <button
                disabled={selectedIds.length === 0 || !activeSceneId}
                onClick={() => activeSceneId && actions.start({ sceneId: activeSceneId, tokenIds: selectedIds })}
                className="flex-1 py-1.5 px-2 bg-[#2d2417] border border-[#d4af37] text-[#d4af37] text-[11px] font-serif font-bold uppercase tracking-wide rounded hover:bg-[#3d311f] disabled:opacity-40 cursor-pointer"
              >
                Iniciar combate ({selectedIds.length} selecionados)
              </button>
            ) : (
              <>
                <button
                  disabled={selectedIds.length === 0}
                  onClick={() => actions.addCombatants({ tokenIds: selectedIds })}
                  className="py-1 px-2 bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-300 text-[10px] rounded hover:border-[#d4af37] disabled:opacity-40 cursor-pointer"
                >
                  + Selecionados
                </button>
                <button
                  onClick={() => actions.roll({ scope: "npcs" })}
                  className="py-1 px-2 bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-300 text-[10px] rounded hover:border-[#d4af37] cursor-pointer"
                >
                  Rolar NPCs
                </button>
                <button
                  onClick={() => actions.roll({ scope: "missing" })}
                  className="py-1 px-2 bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-300 text-[10px] rounded hover:border-[#d4af37] cursor-pointer"
                >
                  Rolar todos que faltam
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Encerrar o combate e limpar a lista?")) actions.end(true);
                  }}
                  className="py-1 px-2 bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-500 text-[10px] rounded hover:border-red-500 hover:text-red-400 cursor-pointer ml-auto"
                >
                  Encerrar
                </button>
              </>
            )}
          </div>
        )}

        {!isGm && combat && (
          <button
            onClick={() => actions.roll({ scope: "self" })}
            className="w-full py-1.5 px-2 bg-[#2d2417] border border-[#d4af37]/60 text-[#d4af37] text-[11px] font-serif font-bold rounded hover:bg-[#3d311f] cursor-pointer"
          >
            Rolar minha iniciativa
          </button>
        )}

        {isGm && combat && (
          <div className="flex items-center gap-2">
            <button
              onClick={actions.prev}
              disabled={combat.status !== "active"}
              title="Voltar um turno"
              className="p-2.5 rounded bg-[#1f1f1f] border border-[#3d3d3d] text-zinc-400 hover:text-[#d4af37] hover:border-[#d4af37] cursor-pointer disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={actions.next}
              disabled={combat.status === "ended"}
              className="flex-1 py-2.5 bg-[#2d2417] border border-[#d4af37] text-[#d4af37] text-xs font-serif font-bold uppercase tracking-wider rounded hover:bg-[#3d311f] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-40"
              title="Avançar para o próximo combatente"
            >
              <span>{combat.status === "rolling" ? "Iniciar Turnos" : "Próximo Turno"}</span>
              <ChevronRight className="w-4 h-4 text-[#d4af37]" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 font-mono">
          <span className="flex items-center gap-1">
            <Flame className="w-3 h-3 text-[#d4af37]" />
            {combatants.length} combatentes
          </span>
          <span>Clique para focar no mapa</span>
        </div>
      </div>
    </div>
  );
};
