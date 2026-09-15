import React, { useState } from 'react';
import {
  Swords,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Dices,
  UserPlus,
  Users,
  AlertTriangle,
  Clock,
  Play,
  Trash2,
  Edit2,
  Check,
  X,
  GripVertical,
  ShieldAlert,
  FastForward,
  CheckCircle2,
  RotateCcw,
  Crosshair,
} from 'lucide-react';
import type { Combat, Combatant, ConditionDef, RollVisibility, Token, TokenCondition } from '@tormenta-vtt/shared';

/** "4,5" — 1 casa, sem zero à toa (docs/plano-movimento.md §4.3). */
function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
}

/**
 * Callbacks do painel, um por ação de UI. Cada um reempacota seus argumentos no payload de um
 * evento combat:* (ver `packages/shared/src/schemas/payloads.ts`) — não é um contrato de rede em
 * si (por isso vive aqui, não em `shared`), só a forma que esse componente espera receber.
 */
export interface CombatPanelCallbacks {
  onStart: (sceneId: string, tokenIds: string[]) => void;
  onRoll: (scope: 'self' | 'one' | 'npcs' | 'missing', combatantId?: string, visibility?: RollVisibility) => void;
  onSetInitiative: (combatantId: string, initiative: number | null, bonus?: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onReorder: (combatantIds: string[]) => void;
  onAdd: (tokenIds: string[]) => void;
  onRemove: (combatantIds: string[]) => void;
  onDelay: (combatantId: string) => void;
  onResume: (combatantId: string) => void;
  /** Sem evento combat:skip no servidor: só aparece pro combatente ativo e vira combat:next. */
  onSkip: (combatantId: string) => void;
  onSetSurprised: (combatantId: string, surprised: boolean) => void;
  onEnd: (clear?: boolean) => void;
  /** Orçamento/gasto de deslocamento à mão (docs/plano-movimento.md §4.3). budget undefined = não
   *  mexe nele; null = "voltar a seguir a ficha"; used undefined = não mexe no gasto. */
  onSetMovement: (combatantId: string, patch: { budget?: number | null; used?: number }) => void;
  /** Liga/desliga a trava de deslocamento NA SALA ("ignorar limite"). */
  onToggleMovementLimit: () => void;
  /** Liga/desliga "Rolar iniciativa dos NPCs ao iniciar o combate" NA SALA (§3.5). */
  onToggleAutoRollNpcInitiative: () => void;
}

interface CombatPanelProps extends Partial<CombatPanelCallbacks> {
  combat: Combat | null;
  viewer: 'gm' | 'player';
  meId: string;
  /** Mapa visitado: precisa pra `combat:start`. null = sem mapa (esconde/desabilita "Iniciar combate"). */
  sceneId: string | null;
  selectedTokenIds?: string[];
  onSelectToken?: (tokenId: string) => void;
  selectedTokenId?: string | null;
  /** Preferência (por usuário) de centralizar o mapa no token da vez. */
  centerOnActiveTurn: boolean;
  onToggleCenterOnActiveTurn: () => void;
  /** Tokens da sala (pra resolver as condições do token de cada combatente, ver Combatant.tokenId). */
  tokens: Token[];
  /** conditions[] do sistema da sala, pra resolver ícone/cor/duração de cada condição. */
  conditions: ConditionDef[];
  /** Trava de deslocamento da SALA (docs/plano-movimento.md §4.3) — todos veem o estado; só o GM muda. */
  movementLimitEnabled: boolean;
  /** "Rolar iniciativa dos NPCs ao iniciar o combate" (§3.5) — todos veem o estado; só o GM muda. */
  autoRollNpcInitiativeEnabled: boolean;
  /** Sistema de alvos (docs/plano-alvos.md): meus alvos (ícone de mira na linha do combatente),
   *  os ids que ALGUM outro participante mira (já filtrado pela opção — vazio quando desligada;
   *  sem nome de quem, só "alguém mira"), e as duas preferências por usuário. */
  myTargetTokenIds: string[];
  othersTargetTokenIds: string[];
  showOtherTargets: boolean;
  onToggleShowOtherTargets: () => void;
  clearTargetsOnTurnEnd: boolean;
  onToggleClearTargetsOnTurnEnd: () => void;
}

export const CombatPanel: React.FC<CombatPanelProps> = ({
  combat,
  viewer,
  meId,
  sceneId,
  selectedTokenIds = [],
  onSelectToken,
  selectedTokenId,
  centerOnActiveTurn,
  onToggleCenterOnActiveTurn,
  tokens,
  conditions,
  movementLimitEnabled,
  autoRollNpcInitiativeEnabled,
  myTargetTokenIds,
  othersTargetTokenIds,
  showOtherTargets,
  onToggleShowOtherTargets,
  clearTargetsOnTurnEnd,
  onToggleClearTargetsOnTurnEnd,
  onStart,
  onRoll,
  onSetInitiative,
  onNext,
  onPrev,
  onReorder,
  onAdd,
  onRemove,
  onDelay,
  onResume,
  onSkip,
  onSetSurprised,
  onEnd,
  onSetMovement,
  onToggleMovementLimit,
  onToggleAutoRollNpcInitiative,
}) => {
  // State for GM end combat dialog
  const [showEndOptions, setShowEndOptions] = useState(false);

  // State for line menu dropdown (combatantId of open menu)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // State for inline editing of initiative value
  const [editingCombatantId, setEditingCombatantId] = useState<string | null>(null);
  const [editInitValue, setEditInitValue] = useState<string>('');

  // Drag and Drop state (for GM reordering)
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Pra cada combatente resolver as condições do TOKEN dele (Combatant não carrega conditions —
  // só tokenId) nas definições cheias (ícone, cor). Combat.round pro número de rodadas restantes.
  const tokenById = new Map(tokens.map((t) => [t.id, t]));
  const conditionByKey = new Map(conditions.map((c) => [c.key, c]));
  const combatRound = combat?.round ?? null;

  // -------------------------------------------------------------
  // Case 1: No combat active
  // -------------------------------------------------------------
  if (!combat || (combat.status === 'ended' && combat.combatants.length === 0)) {
    return (
      <div className="font-ui flex flex-col items-center justify-center h-full p-6 text-center bg-surface-1 select-none text-text">
        <div className="w-14 h-14 rounded-full border border-border bg-surface-2 flex items-center justify-center text-text-muted mb-4">
          <Swords className="w-7 h-7" />
        </div>

        {viewer === 'gm' ? (
          <div className="flex flex-col items-center max-w-xs">
            <h3 className="text-base font-title font-bold text-text mb-1.5">
              Iniciar Encontro
            </h3>
            <p className="text-xs text-text-muted mb-5 leading-relaxed font-ui">
              Selecione tokens no mapa ou inicie o combate diretamente para organizar turnos e iniciativa.
            </p>

            <button
              id="btn-start-combat"
              onClick={() => sceneId && onStart && onStart(sceneId, selectedTokenIds)}
              disabled={!sceneId}
              className="focus-ring flex items-center gap-2 px-5 py-2.5 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-accent text-accent text-xs font-ui font-bold tracking-wide uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Swords className="w-4 h-4" />
              <span>
                Iniciar combate{' '}
                {selectedTokenIds.length > 0 && `(${selectedTokenIds.length} tokens)`}
              </span>
            </button>
            {!sceneId ? (
              <span className="text-[10px] text-text-muted mt-2 font-ui">
                Nenhum mapa ativo.
              </span>
            ) : (
              selectedTokenIds.length === 0 && (
                <span className="text-[10px] text-text-muted mt-2 font-ui">
                  Dica: selecione tokens no mapa para adicioná-los automaticamente.
                </span>
              )
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <h3 className="text-sm font-title font-bold text-text-muted mb-1 uppercase tracking-wider">
              Nenhum combate ativo
            </h3>
            <p className="text-xs text-text-muted font-ui max-w-[220px]">
              O Mestre ainda não iniciou a ordem de combate. Aguarde o chamado às armas.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Active combatant
  const activeCombatant = combat.combatants.find(
    (c) => c.id === combat.activeCombatantId
  );

  // Separate combatants into main list and "SEM INICIATIVA" (placed at end).
  // A ordem é sempre a que o servidor mandou: `sortCombatants` (packages/shared/src/rules/combat.ts)
  // roda a CADA emissão de combat:updated, "rolling" ou "active" — maior iniciativa primeiro,
  // desempate por bônus, quem não rolou no fim — então a lista já reordena sozinha a cada
  // iniciativa que chega, sem esperar o primeiro "Próximo". Reordenar de novo aqui pelo campo
  // `order` (posição de entrada/arraste, só usado como desempate final no servidor) jogava fora
  // essa ordem e prendia a lista na ordem de entrada até o GM arrastar manualmente.
  const sortedCombatants = combat.combatants;
  const withInitiative = sortedCombatants.filter(
    (c) => c.initiative !== null || c.rolled
  );
  const withoutInitiative = sortedCombatants.filter(
    (c) => c.initiative === null && !c.rolled
  );

  // Handlers for drag-and-drop reorder
  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (viewer !== 'gm') return;
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (viewer !== 'gm') return;
    e.preventDefault();
    if (draggedId && draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    if (viewer !== 'gm' || !draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    e.preventDefault();

    const currentOrder = sortedCombatants.map((c) => c.id);
    const sourceIdx = currentOrder.indexOf(draggedId);
    const targetIdx = currentOrder.indexOf(targetId);

    if (sourceIdx !== -1 && targetIdx !== -1) {
      const newOrder = [...currentOrder];
      newOrder.splice(sourceIdx, 1);
      newOrder.splice(targetIdx, 0, draggedId);
      if (onReorder) {
        onReorder(newOrder);
      }
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // Status subtitle text
  let statusText = '';
  if (combat.status === 'rolling') {
    statusText = 'Rolando iniciativa';
  } else if (combat.status === 'active') {
    statusText = activeCombatant
      ? `Turno de ${activeCombatant.name}`
      : 'Combate em andamento';
  } else {
    statusText = 'Encerrado';
  }

  return (
    <div
      id="combat-panel"
      className="font-ui flex flex-col h-full bg-surface-1 text-text select-none overflow-hidden relative"
      onClick={() => {
        // Close menus on outside click
        if (openMenuId) setOpenMenuId(null);
      }}
    >
      {/* ------------------------------------------------------------- */}
      {/* Header: Rodada, Status, Centralizar, Botões Anterior/Próximo e Encerrar */}
      {/* ------------------------------------------------------------- */}
      <div className="p-3 bg-surface-1 border-b border-border flex flex-col gap-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-ui border border-border bg-surface-2 flex items-center justify-center text-text-muted shrink-0">
              <Swords className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-title font-bold text-text uppercase tracking-wider">
                  Rodada {combat.round}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-ui font-ui font-bold tracking-wide uppercase border ${
                    combat.status === 'active'
                      ? 'bg-success/15 border-success/50 text-success'
                      : combat.status === 'rolling'
                      ? 'bg-surface-2 border-border text-text'
                      : 'bg-surface-2 border-border text-text-muted'
                  }`}
                >
                  {combat.status === 'active'
                    ? 'Ativo'
                    : combat.status === 'rolling'
                    ? 'Rolando'
                    : 'Fim'}
                </span>
              </div>
              <div
                className="text-[11px] text-text-muted truncate max-w-[170px]"
                title={statusText}
              >
                {statusText}
              </div>
            </div>
          </div>

          {/* GM Encerrar Button with Options */}
          {viewer === 'gm' && (
            <div className="relative">
              <button
                id="btn-combat-end"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEndOptions(!showEndOptions);
                }}
                className="focus-ring px-2.5 py-1 text-[11px] font-ui font-bold rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-danger/50 text-danger transition-colors cursor-pointer"
                title="Opções de encerramento do combate"
              >
                Encerrar
              </button>

              {showEndOptions && (
                <div
                  id="menu-combat-end-options"
                  className="absolute right-0 top-full mt-1.5 w-44 bg-surface-1 border border-border rounded-ui shadow-float z-50 p-1 flex flex-col gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    id="btn-end-keep-order"
                    onClick={() => {
                      setShowEndOptions(false);
                      onEnd && onEnd(false);
                    }}
                    className="focus-ring w-full text-left px-2.5 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span>Manter visível</span>
                    <span className="text-[10px] text-text-muted">Pausar</span>
                  </button>
                  <button
                    id="btn-end-clear"
                    onClick={() => {
                      setShowEndOptions(false);
                      onEnd && onEnd(true);
                    }}
                    className="focus-ring w-full text-left px-2.5 py-1.5 rounded-ui text-xs text-danger hover:bg-danger/15 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span>Apagar combate</span>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Centralizar no token da vez: preferência de cada usuário (GM e jogador). */}
        <label
          className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none"
          title="Centralizar o mapa no token da vez"
        >
          <input
            type="checkbox"
            checked={centerOnActiveTurn}
            onChange={onToggleCenterOnActiveTurn}
            className="cursor-pointer accent-text"
          />
          Centralizar no token da vez
        </label>

        {/* Sistema de alvos (docs/plano-alvos.md): duas preferências por usuário, mesmo padrão de
         *  "Centralizar no token da vez" acima. */}
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none" title="Mostrar quem os outros participantes estão mirando">
          <input type="checkbox" checked={showOtherTargets} onChange={onToggleShowOtherTargets} className="cursor-pointer accent-text" />
          Mostrar alvos dos outros
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none" title="Limpar meus alvos quando meu turno terminar">
          <input type="checkbox" checked={clearTargetsOnTurnEnd} onChange={onToggleClearTargetsOnTurnEnd} className="cursor-pointer accent-text" />
          Limpar meus alvos ao fim do meu turno
        </label>

        {/* "Rolar iniciativa dos NPCs ao iniciar o combate" (§3.5): opção da sala, só o GM vê/muda —
         *  combat:start/combat:add rolam sozinhos, num card em lote, quem entra sem dono. */}
        {viewer === 'gm' && (
          <label
            className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none"
            title="combat:start e combat:add rolam sozinhos a iniciativa dos combatentes sem dono"
          >
            <input
              type="checkbox"
              checked={autoRollNpcInitiativeEnabled}
              onChange={onToggleAutoRollNpcInitiative}
              className="cursor-pointer accent-text"
            />
            Rolar iniciativa dos NPCs ao iniciar o combate
          </label>
        )}

        {/* Trava de deslocamento (docs/plano-movimento.md §4.3): GM liga/desliga na sala; jogador
         *  só vê o estado. "Ignorar" = interruptor LIGADO quando movementLimitEnabled é false. */}
        {viewer === 'gm' ? (
          <label
            className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none"
            title="Vale para a sala, até reiniciar o servidor"
          >
            <input
              type="checkbox"
              checked={!movementLimitEnabled}
              onChange={onToggleMovementLimit}
              className="cursor-pointer accent-text"
            />
            Ignorar limite de movimento
          </label>
        ) : (
          !movementLimitEnabled && (
            <div className="text-[10px] text-text-muted font-ui italic">Limite de movimento desligado pelo Mestre</div>
          )
        )}

        {/* Big Turn Navigation Buttons: Anterior & Próximo (grandes, os mais usados). Só "Próximo"
         *  leva o dourado — é a ação principal do combate; "Anterior" fica neutro (secundária,
         *  docs/design/DESIGN.md: um só destaque por vista). */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            id="btn-combat-prev"
            onClick={onPrev}
            disabled={combat.status === 'ended'}
            className="focus-ring flex items-center justify-center gap-1.5 py-2 px-3 rounded-ui bg-surface-2 hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed border border-border text-text-muted hover:text-text text-xs font-ui font-bold uppercase tracking-wider transition-all cursor-pointer"
            title="Voltar para o combatente anterior"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <button
            id="btn-combat-next"
            onClick={onNext}
            disabled={combat.status === 'ended'}
            className="focus-ring flex items-center justify-center gap-1.5 py-2 px-3 rounded-ui bg-surface-2 hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed border border-accent text-accent text-xs font-ui font-bold uppercase tracking-wider transition-all cursor-pointer"
            title="Avançar para o próximo combatente"
          >
            <span>Próximo</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* GM Toolbar: Adicionar selecionados, Rolar NPCs, Rolar faltam   */}
      {/* ------------------------------------------------------------- */}
      {viewer === 'gm' && combat.status !== 'ended' && (
        <div className="px-3 py-1.5 bg-surface-1 border-b border-border flex items-center justify-between gap-1 overflow-x-auto shrink-0">
          <button
            id="btn-gm-add-selected"
            onClick={() => onAdd && onAdd(selectedTokenIds)}
            disabled={selectedTokenIds.length === 0}
            className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui bg-surface-2 hover:bg-surface-2/80 disabled:opacity-40 disabled:cursor-not-allowed border border-border text-text text-[11px] font-ui transition-colors whitespace-nowrap cursor-pointer"
            title="Adicionar tokens selecionados como reforços"
          >
            <UserPlus className="w-3 h-3 text-text-muted" />
            <span>+ Selecionados {selectedTokenIds.length > 0 && `(${selectedTokenIds.length})`}</span>
          </button>

          <button
            id="btn-gm-roll-npcs"
            onClick={() => onRoll && onRoll('npcs')}
            className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-border text-text text-[11px] font-ui transition-colors whitespace-nowrap cursor-pointer"
            title="Rolar iniciativa de todos os NPCs sem iniciativa"
          >
            <Dices className="w-3 h-3 text-text-muted" />
            <span>Rolar NPCs</span>
          </button>

          <button
            id="btn-gm-roll-missing"
            onClick={() => onRoll && onRoll('missing')}
            className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-border text-text text-[11px] font-ui transition-colors whitespace-nowrap cursor-pointer"
            title="Rolar iniciativa para todos os combatentes que ainda faltam"
          >
            <Users className="w-3 h-3 text-text-muted" />
            <span>Rolar que faltam</span>
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* Combatants List                                               */}
      {/* ------------------------------------------------------------- */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 scrollbar-thin">
        {/* Active / Rolled Combatants */}
        {withInitiative.map((combatant) => {
          const isActive = combat.activeCombatantId === combatant.id;
          const isMine = combatant.ownerId === meId;
          const isTargetSelected = selectedTokenId === combatant.tokenId;
          const isEditing = editingCombatantId === combatant.id;
          const isBeingDragged = draggedId === combatant.id;
          const isDragTarget = dragOverId === combatant.id;

          return (
            <div
              key={combatant.id}
              id={`combatant-${combatant.id}`}
              draggable={viewer === 'gm'}
              onDragStart={(e) => handleDragStart(e, combatant.id)}
              onDragOver={(e) => handleDragOver(e, combatant.id)}
              onDrop={(e) => handleDrop(e, combatant.id)}
              onDragEnd={handleDragEnd}
              onClick={() => {
                if (combatant.tokenId && onSelectToken) {
                  onSelectToken(combatant.tokenId);
                }
              }}
              className={`group relative p-2 rounded-ui transition-all select-none border cursor-pointer ${
                isActive
                  ? 'bg-surface-2 border-accent'
                  : isTargetSelected
                  ? 'bg-surface-2 border-text-muted'
                  : 'bg-surface-1 border-border hover:bg-surface-2'
              } ${isBeingDragged ? 'opacity-40 scale-98' : ''} ${
                isDragTarget ? 'border-t-2 border-t-accent bg-surface-2' : ''
              }`}
            >
              {/* Active Turn Left Ribbon */}
              {isActive && <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-7 rounded-r bg-accent" />}

              <div className="flex items-center justify-between gap-2">
                {/* Left Side: Drag handle (GM), Color dot, Name, Badges */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {viewer === 'gm' && (
                    <div
                      className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text shrink-0"
                      title="Arrastar para reordenar"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  )}

                  {/* Bolinha da cor */}
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-bg/50"
                    style={{ backgroundColor: combatant.color || '#e11d48' }}
                  />

                  {/* Nome e marcadores */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-title font-bold truncate text-text" title={combatant.name}>
                        {combatant.name}
                      </span>

                      {/* Condições do token deste combatente (ícone + rodadas restantes, ver
                          ConditionMenu/VttCanvas — mesma fonte, Token.conditions). */}
                      <ConditionRowIcons
                        conditions={tokenById.get(combatant.tokenId)?.conditions ?? []}
                        conditionByKey={conditionByKey}
                        combatRound={combatRound}
                      />

                      {/* Sistema de alvos (docs/plano-alvos.md): mira vermelha = meu alvo; neutra =
                          de outro participante (só com "Mostrar alvos dos outros" ligado). */}
                      {(myTargetTokenIds.includes(combatant.tokenId) || othersTargetTokenIds.includes(combatant.tokenId)) && (
                        <span title={myTargetTokenIds.includes(combatant.tokenId) ? 'Seu alvo' : 'Alvo de outro participante'} className="shrink-0">
                          <Crosshair className={`w-3 h-3 ${myTargetTokenIds.includes(combatant.tokenId) ? 'text-danger' : 'text-text-muted'}`} />
                        </span>
                      )}

                      {/* Turn indicator */}
                      {isActive && (
                        <span className="text-[9px] font-title font-bold px-1.5 py-0.2 rounded-ui bg-accent text-bg shrink-0 tracking-wider">
                          TURNO
                        </span>
                      )}

                      {/* Surpreso Badge */}
                      {combatant.surprised && (
                        <span
                          className="text-[9px] font-ui font-bold px-1 py-0.2 rounded-ui bg-danger/15 border border-danger/50 text-danger flex items-center gap-0.5 shrink-0"
                          title="Combatente surpreso"
                        >
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>SURPRESO</span>
                        </span>
                      )}

                      {/* Adiado Badge */}
                      {combatant.delayed && (
                        <span
                          className="text-[9px] font-ui font-bold px-1 py-0.2 rounded-ui bg-surface-2 border border-border text-text flex items-center gap-0.5 shrink-0"
                          title="Ação adiada"
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>ADIADO</span>
                        </span>
                      )}

                      {/* Added in a later round */}
                      {combatant.addedRound > 0 && (
                        <span
                          className="text-[8px] font-data tabular-nums px-1 rounded-ui bg-surface-2 text-text-muted shrink-0"
                          title={`Entrou na rodada ${combatant.addedRound}`}
                        >
                          +R{combatant.addedRound}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Initiative value / Roll status / Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Inline editing for GM */}
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="number"
                        value={editInitValue}
                        onChange={(e) => setEditInitValue(e.target.value)}
                        className="focus-ring w-12 h-6 px-1 text-xs font-data tabular-nums font-bold bg-bg border border-accent text-accent rounded-ui text-center"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = editInitValue === '' ? null : Number(editInitValue);
                            onSetInitiative &&
                              onSetInitiative(combatant.id, val, combatant.bonus ?? undefined);
                            setEditingCombatantId(null);
                          } else if (e.key === 'Escape') {
                            setEditingCombatantId(null);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const val = editInitValue === '' ? null : Number(editInitValue);
                          onSetInitiative &&
                            onSetInitiative(combatant.id, val, combatant.bonus ?? undefined);
                          setEditingCombatantId(null);
                        }}
                        className="focus-ring p-1 rounded-ui bg-surface-2 text-success hover:text-success/80 border border-success/50 cursor-pointer"
                        title="Confirmar valor"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setEditingCombatantId(null)}
                        className="focus-ring p-1 rounded-ui bg-surface-2 text-text-muted hover:text-text border border-border cursor-pointer"
                        title="Cancelar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : combatant.initiative !== null ? (
                    /* Valor de iniciativa à direita quando initiative != null */
                    <div className="flex items-center gap-1">
                      <span
                        className="font-data tabular-nums font-bold text-sm min-w-[24px] text-right text-text"
                        title={
                          combatant.bonus !== null
                            ? `Iniciativa: ${combatant.initiative} (Bônus: ${
                                combatant.bonus >= 0 ? `+${combatant.bonus}` : combatant.bonus
                              })`
                            : `Iniciativa: ${combatant.initiative}`
                        }
                      >
                        {combatant.initiative}
                      </span>
                    </div>
                  ) : combatant.rolled ? (
                    /* Ícone de "já rolou" quando rolled && initiative == null (jogador olhando os outros) */
                    <div
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-ui bg-surface-2 border border-border text-text-muted text-[10px] font-ui"
                      title="Já rolou iniciativa (valor oculto)"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      <span className="hidden sm:inline">Rolado</span>
                    </div>
                  ) : null}

                  {/* Player Actions on their own row */}
                  {viewer === 'player' && isMine && (
                    <div
                      className="flex items-center gap-1 ml-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!combatant.rolled && (
                        <button
                          id={`btn-player-roll-${combatant.id}`}
                          onClick={() => onRoll && onRoll('self', combatant.id)}
                          className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-accent text-accent text-[10px] font-ui font-bold transition-all cursor-pointer"
                          title="Rolar minha iniciativa"
                        >
                          <Dices className="w-3 h-3" />
                          <span>Rolar</span>
                        </button>
                      )}

                      {/* Adiar no próprio turno */}
                      {isActive && !combatant.delayed && (
                        <button
                          id={`btn-player-delay-${combatant.id}`}
                          onClick={() => onDelay && onDelay(combatant.id)}
                          className="focus-ring flex items-center gap-1 px-2 py-0.5 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-border text-text text-[10px] font-ui transition-colors cursor-pointer"
                          title="Adiar turno"
                        >
                          <Clock className="w-3 h-3" />
                          <span>Adiar</span>
                        </button>
                      )}

                      {/* Entrar agora se adiado */}
                      {combatant.delayed && (
                        <button
                          id={`btn-player-resume-${combatant.id}`}
                          onClick={() => onResume && onResume(combatant.id)}
                          className="focus-ring flex items-center gap-1 px-2 py-0.5 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-success/60 text-success text-[10px] font-ui transition-colors cursor-pointer"
                          title="Agir agora"
                        >
                          <Play className="w-3 h-3" />
                          <span>Entrar</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* GM Actions Menu (⋯) */}
                  {viewer === 'gm' && (
                    <div
                      className="relative ml-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        id={`btn-gm-menu-${combatant.id}`}
                        onClick={() =>
                          setOpenMenuId(openMenuId === combatant.id ? null : combatant.id)
                        }
                        className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                        title="Ações do GM"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {openMenuId === combatant.id && (
                        <div
                          id={`menu-gm-combatant-${combatant.id}`}
                          className="absolute right-0 top-full mt-1 w-44 bg-surface-1 border border-border rounded-ui shadow-float z-50 p-1 flex flex-col gap-0.5"
                        >
                          {/* Editar Valor */}
                          <button
                            onClick={() => {
                              setEditingCombatantId(combatant.id);
                              setEditInitValue(
                                combatant.initiative !== null
                                  ? String(combatant.initiative)
                                  : ''
                              );
                              setOpenMenuId(null);
                            }}
                            className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <Edit2 className="w-3 h-3 text-text-muted" />
                            <span>Editar valor</span>
                          </button>

                          {/* Rolar este combatente se não rolou */}
                          {!combatant.rolled && (
                            <button
                              onClick={() => {
                                onRoll && onRoll('one', combatant.id);
                                setOpenMenuId(null);
                              }}
                              className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui transition-colors cursor-pointer flex items-center gap-2"
                            >
                              <Dices className="w-3 h-3 text-text-muted" />
                              <span>Rolar iniciativa</span>
                            </button>
                          )}

                          {/* Marcar / Desmarcar Surpresa */}
                          <button
                            onClick={() => {
                              onSetSurprised &&
                                onSetSurprised(combatant.id, !combatant.surprised);
                              setOpenMenuId(null);
                            }}
                            className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <ShieldAlert className="w-3 h-3 text-danger" />
                            <span>
                              {combatant.surprised
                                ? 'Desmarcar surpresa'
                                : 'Marcar surpresa'}
                            </span>
                          </button>

                          {/* Adiar ou Reativar */}
                          <button
                            onClick={() => {
                              if (combatant.delayed) {
                                onResume && onResume(combatant.id);
                              } else {
                                onDelay && onDelay(combatant.id);
                              }
                              setOpenMenuId(null);
                            }}
                            className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui transition-colors cursor-pointer flex items-center gap-2"
                          >
                            {combatant.delayed ? (
                              <>
                                <Play className="w-3 h-3 text-success" />
                                <span>Reativar (Entrar)</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3 text-text-muted" />
                                <span>Adiar turno</span>
                              </>
                            )}
                          </button>

                          {/* Pular turno: só faz sentido pro combatente ativo (vira combat:next
                              na store — não existe evento de "pular" no servidor, ver docs/plano-combate.md). */}
                          {isActive && (
                            <button
                              onClick={() => {
                                onSkip && onSkip(combatant.id);
                                setOpenMenuId(null);
                              }}
                              className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui transition-colors cursor-pointer flex items-center gap-2"
                            >
                              <FastForward className="w-3 h-3 text-text-muted" />
                              <span>Pular turno</span>
                            </button>
                          )}

                          <div className="h-px bg-border my-0.5" />

                          {/* Remover */}
                          <button
                            onClick={() => {
                              onRemove && onRemove([combatant.id]);
                              setOpenMenuId(null);
                            }}
                            className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-danger hover:bg-danger/15 font-ui transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Remover</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Orçamento de deslocamento do turno (docs/plano-movimento.md §4.3): barra fina +
                  gasto/orçamento, só do combatente da VEZ e só quando o sistema tem `movement`
                  (movementBudget != null). GM ganha o campo de orçamento à mão + botão de zerar. */}
              {isActive && combatant.movementBudget !== null && (
                <div className="mt-2 pt-2 border-t border-border flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <div
                    className="flex-1 h-1 rounded-full bg-bg overflow-hidden"
                    title={`Deslocamento: ${fmt1(combatant.movementUsed)} / ${fmt1(combatant.movementBudget)}`}
                  >
                    <div
                      className={`h-full transition-all ${combatant.movementUsed >= combatant.movementBudget ? 'bg-danger' : 'bg-accent'}`}
                      style={{ width: `${combatant.movementBudget > 0 ? Math.min(100, (combatant.movementUsed / combatant.movementBudget) * 100) : 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-data tabular-nums text-text-muted shrink-0">
                    {fmt1(combatant.movementUsed)}/{fmt1(combatant.movementBudget)}
                  </span>
                  {viewer === 'gm' && (
                    <>
                      <input
                        key={`movement-budget-${combatant.id}-${combatant.movementBudget}`}
                        type="number"
                        defaultValue={combatant.movementBudget}
                        placeholder="ficha"
                        title="Orçamento de deslocamento do turno (vazio = volta a seguir a ficha)"
                        className="focus-ring w-12 h-5 px-1 text-[10px] font-data tabular-nums bg-bg border border-border text-text rounded-ui text-center"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          onSetMovement && onSetMovement(combatant.id, { budget: raw === '' ? null : Number(raw) });
                        }}
                      />
                      <button
                        onClick={() => onSetMovement && onSetMovement(combatant.id, { used: 0 })}
                        title="Zerar o gasto do turno"
                        className="focus-ring p-0.5 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ------------------------------------------------------------- */}
        {/* Marcador "SEM INICIATIVA" (linha cinza no fim)                */}
        {/* ------------------------------------------------------------- */}
        {withoutInitiative.length > 0 && (
          <div className="pt-2">
            <div className="flex items-center gap-2 my-2 px-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-title font-bold uppercase tracking-widest text-text-muted">
                SEM INICIATIVA ({withoutInitiative.length})
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-1.5">
              {withoutInitiative.map((combatant) => {
                const isMine = combatant.ownerId === meId;
                const isTargetSelected = selectedTokenId === combatant.tokenId;
                const isEditing = editingCombatantId === combatant.id;

                return (
                  <div
                    key={combatant.id}
                    id={`combatant-unrolled-${combatant.id}`}
                    draggable={viewer === 'gm'}
                    onDragStart={(e) => handleDragStart(e, combatant.id)}
                    onDragOver={(e) => handleDragOver(e, combatant.id)}
                    onDrop={(e) => handleDrop(e, combatant.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (combatant.tokenId && onSelectToken) {
                        onSelectToken(combatant.tokenId);
                      }
                    }}
                    className={`group p-2 rounded-ui transition-all select-none border opacity-75 hover:opacity-100 cursor-pointer ${
                      isTargetSelected ? 'bg-surface-2 border-text-muted' : 'bg-surface-1 border-border hover:bg-surface-2'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {viewer === 'gm' && (
                          <div
                            className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text shrink-0"
                            title="Arrastar para reordenar"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>
                        )}

                        <div
                          className="w-3.5 h-3.5 rounded-full shrink-0 border border-bg/40"
                          style={{ backgroundColor: combatant.color || '#71717a' }}
                        />

                        <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                          <span
                            className="text-xs font-title text-text-muted truncate"
                            title={combatant.name}
                          >
                            {combatant.name}
                          </span>
                          <ConditionRowIcons
                            conditions={tokenById.get(combatant.tokenId)?.conditions ?? []}
                            conditionByKey={conditionByKey}
                            combatRound={combatRound}
                          />
                          {(myTargetTokenIds.includes(combatant.tokenId) || othersTargetTokenIds.includes(combatant.tokenId)) && (
                            <span title={myTargetTokenIds.includes(combatant.tokenId) ? 'Seu alvo' : 'Alvo de outro participante'} className="shrink-0">
                              <Crosshair className={`w-3 h-3 ${myTargetTokenIds.includes(combatant.tokenId) ? 'text-danger' : 'text-text-muted'}`} />
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Inline editing for GM */}
                        {isEditing ? (
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="number"
                              value={editInitValue}
                              onChange={(e) => setEditInitValue(e.target.value)}
                              className="focus-ring w-12 h-6 px-1 text-xs font-data tabular-nums font-bold bg-bg border border-accent text-accent rounded-ui text-center"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val =
                                    editInitValue === '' ? null : Number(editInitValue);
                                  onSetInitiative &&
                                    onSetInitiative(
                                      combatant.id,
                                      val,
                                      combatant.bonus ?? undefined
                                    );
                                  setEditingCombatantId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingCombatantId(null);
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                const val =
                                  editInitValue === '' ? null : Number(editInitValue);
                                onSetInitiative &&
                                  onSetInitiative(
                                    combatant.id,
                                    val,
                                    combatant.bonus ?? undefined
                                  );
                                setEditingCombatantId(null);
                              }}
                              className="focus-ring p-1 rounded-ui bg-surface-2 text-success hover:text-success/80 border border-success/50 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingCombatantId(null)}
                              className="focus-ring p-1 rounded-ui bg-surface-2 text-text-muted hover:text-text border border-border cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : viewer === 'player' && isMine ? (
                          /* Jogador: só "Rolar minha iniciativa" (na própria linha, quando !rolled) */
                          <button
                            id={`btn-player-roll-unrolled-${combatant.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRoll && onRoll('self', combatant.id);
                            }}
                            className="focus-ring flex items-center gap-1 px-2.5 py-1 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-accent text-accent text-xs font-ui font-bold transition-all cursor-pointer"
                          >
                            <Dices className="w-3 h-3" />
                            <span>Rolar minha iniciativa</span>
                          </button>
                        ) : viewer === 'gm' ? (
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              id={`btn-gm-roll-single-${combatant.id}`}
                              onClick={() => onRoll && onRoll('one', combatant.id)}
                              className="focus-ring flex items-center gap-1 px-2 py-0.5 rounded-ui bg-surface-2 hover:bg-surface-2/80 border border-border text-text text-[10px] font-ui cursor-pointer"
                              title="Rolar iniciativa"
                            >
                              <Dices className="w-3 h-3 text-text-muted" />
                              <span>Rolar</span>
                            </button>

                            <button
                              id={`btn-gm-menu-unrolled-${combatant.id}`}
                              onClick={() =>
                                setOpenMenuId(
                                  openMenuId === combatant.id ? null : combatant.id
                                )
                              }
                              className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>

                            {openMenuId === combatant.id && (
                              <div
                                className="absolute right-2 mt-1 w-40 bg-surface-1 border border-border rounded-ui shadow-float z-50 p-1 flex flex-col gap-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={() => {
                                    setEditingCombatantId(combatant.id);
                                    setEditInitValue('');
                                    setOpenMenuId(null);
                                  }}
                                  className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-text hover:bg-surface-2 font-ui flex items-center gap-2"
                                >
                                  <Edit2 className="w-3 h-3 text-text-muted" />
                                  <span>Definir valor</span>
                                </button>
                                <button
                                  onClick={() => {
                                    onRemove && onRemove([combatant.id]);
                                    setOpenMenuId(null);
                                  }}
                                  className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-xs text-danger hover:bg-danger/15 font-ui flex items-center gap-2"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Remover</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] font-ui text-text-muted italic">
                            Aguardando rolagem
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Footer info: Total combatentes                                */}
      {/* ------------------------------------------------------------- */}
      <div className="px-3 py-2 bg-surface-1 border-t border-border flex items-center justify-between text-[11px] text-text-muted font-ui shrink-0">
        <div className="flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-text-muted" />
          <span>{combat.combatants.length} combatentes</span>
        </div>

        <span className="text-[10px] text-text-muted">
          {viewer === 'gm' ? 'Arraste para reordenar' : 'Visão do Jogador'}
        </span>
      </div>
    </div>
  );
};

/**
 * Ícones de condição de UMA linha do painel — mesma fonte que o badge do token no mapa
 * (`Token.conditions`, ver `VttCanvas`/`ConditionMenu`), só que em DOM em vez de Konva. Condição
 * com duração ganha um selinho com as rodadas restantes, igual ao badge do token; tooltip por
 * extenso ("Atordoado · 2 rodadas").
 */
const ConditionRowIcons: React.FC<{
  conditions: TokenCondition[];
  conditionByKey: Map<string, ConditionDef>;
  combatRound: number | null;
}> = ({ conditions, conditionByKey, combatRound }) => {
  if (conditions.length === 0) return null;
  return (
    <div className="flex items-center gap-1 shrink-0">
      {conditions.map((cond) => {
        const def = conditionByKey.get(cond.key);
        if (!def) return null;
        const roundsLeft = cond.expiresRound !== undefined && combatRound !== null ? Math.max(0, cond.expiresRound - combatRound) : undefined;
        const title = roundsLeft !== undefined ? `${def.label} · ${roundsLeft} rodada${roundsLeft === 1 ? '' : 's'}` : def.label;
        return (
          <span key={cond.key} title={title} className="relative inline-flex w-3.5 h-3.5 shrink-0" style={{ color: def.color }}>
            <span className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: def.icon }} />
            {roundsLeft !== undefined && (
              <span className="absolute -bottom-1 -right-1 min-w-[10px] h-[10px] px-[2px] rounded-full bg-bg border border-border text-[7px] leading-[9px] text-center text-text-muted font-data tabular-nums font-bold">
                {roundsLeft}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
};
