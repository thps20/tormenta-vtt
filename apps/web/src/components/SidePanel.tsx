import React from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Swords, Users } from 'lucide-react';
import { ChatTab } from './ChatTab';
import { CombatPanel, type CombatPanelCallbacks } from './CombatPanel';
import { CombatCompact } from './CombatCompact';
import { CharactersTab } from './CharactersTab';
import type { PlaceOnMapController } from '../lib/placeOnMap';
import { PartyView } from './PartyView';
import { TabErrorBoundary } from './TabErrorBoundary';
import type { Character, CharacterCreatePayload, CharacterRollRequest, ChatMessage, Combat, ConditionDef, MacroAction, Participant, PartyEntry, SystemDefinition, Token } from '@tormenta-vtt/shared';

export type SidePanelTab = 'chat' | 'initiative' | 'characters';

interface SidePanelProps {
  /** Aba ativa (controlada pela página, para outros botões poderem abrir uma aba). */
  activeTab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  messages: ChatMessage[];
  participants: Participant[];
  currentUserId: string;
  combat: Combat | null;
  activeSceneId: string | null;
  selectedIds: string[];
  combatCallbacks: CombatPanelCallbacks;
  /** Trava de deslocamento da SALA (docs/plano-movimento.md §4.3), pro CombatPanel mostrar o interruptor do GM. */
  movementLimitEnabled: boolean;
  /** "Rolar iniciativa dos NPCs ao iniciar o combate" (§3.5), pro CombatPanel mostrar o interruptor do GM. */
  autoRollNpcInitiativeEnabled: boolean;
  centerOnActiveTurn: boolean;
  onToggleCenterOnActiveTurn: () => void;
  /** Sistema de alvos (docs/plano-alvos.md), pro CombatPanel: ícone de mira + as duas preferências. */
  myTargetTokenIds: string[];
  othersTargetTokenIds: string[];
  showOtherTargets: boolean;
  onToggleShowOtherTargets: () => void;
  clearTargetsOnTurnEnd: boolean;
  onToggleClearTargetsOnTurnEnd: () => void;
  tokens: Token[];
  /** conditions[] do sistema da sala, pro CombatPanel resolver ícone/cor/duração da linha do combatente. */
  conditions: ConditionDef[];
  /** Definição completa do sistema, pra Visão de grupo (PV/PM, condições) — null enquanto carrega. */
  systemDef: SystemDefinition | null;
  /** Token de quem está agindo agora no mapa visto, pra Visão de grupo acender o ícone de turno. */
  activeTurnTokenId: string | null;
  /** Preferência "mostrar visão de grupo" (por usuário, padrão ligada — ver RoomPage). */
  partyViewExpanded: boolean;
  onTogglePartyView: () => void;
  /** Grupo gerenciado pelo Mestre (SPEC §9.15), já filtrado pra este cliente — ver store/party.ts. */
  party: PartyEntry[];
  onAddToParty: (characterId: string) => void;
  onRemoveFromParty: (characterId: string) => void;
  onSetPartyHidden: (characterId: string, hidden: boolean) => void;
  onReorderParty: (characterIds: string[]) => void;
  isGm: boolean;
  onSendMessage: (text: string) => void;
  onSelectToken: (tokenId: string) => void;
  selectedTokenId: string | null;
  // Fichas
  me: Participant;
  characters: Character[];
  onOpenCharacter: (characterId: string) => void;
  onCreateCharacter: (payload: CharacterCreatePayload) => void;
  onDeleteCharacter: (characterId: string) => void;
  /** "Colocar no mapa" a partir da lista de fichas (SPEC §9.30). */
  placeOnMap?: PlaceOnMapController;
  /** Botões de ação nos cards de item do chat (dano, cura) rolam pela ficha. */
  onRollCharacter: (characterId: string, request: CharacterRollRequest) => void;
  /** "Salvar como macro" (docs/SPEC.md §9.20): abre o criador de macro já com a ação travada. */
  onSaveMacro: (action: MacroAction, defaultLabel: string) => void;
  /** Recolher/expandir (\ ou Ctrl+B, preferência lembrada por usuário — ver Table em RoomPage.tsx). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mensagens chegadas desde que o painel recolheu; 0 quando expandido. Badge da alça recolhida. */
  unreadMessages: number;
  /** Badge "é seu turno" na alça recolhida. */
  isMyTurn: boolean;
  /** Card "Próximo passo" (docs/SPEC.md §9.28), montado pela página — só GM, e só quando há um
   *  passo pendente no preparo do mapa visto (o próprio card devolve null quando não há). */
  prepNextStep?: React.ReactNode;
}

/** Uma aba, com o rótulo e a contagem já formatados em texto pra virar tooltip/rodapé do ícone. */
interface TabDef {
  id: SidePanelTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge: string;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  activeTab,
  onTabChange,
  messages,
  participants,
  currentUserId,
  combat,
  activeSceneId,
  selectedIds,
  combatCallbacks,
  movementLimitEnabled,
  autoRollNpcInitiativeEnabled,
  centerOnActiveTurn,
  onToggleCenterOnActiveTurn,
  myTargetTokenIds,
  othersTargetTokenIds,
  showOtherTargets,
  onToggleShowOtherTargets,
  clearTargetsOnTurnEnd,
  onToggleClearTargetsOnTurnEnd,
  tokens,
  conditions,
  systemDef,
  activeTurnTokenId,
  partyViewExpanded,
  onTogglePartyView,
  party,
  onAddToParty,
  onRemoveFromParty,
  onSetPartyHidden,
  onReorderParty,
  isGm,
  onSendMessage,
  onSaveMacro,
  onSelectToken,
  selectedTokenId,
  me,
  characters,
  onOpenCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  placeOnMap,
  onRollCharacter,
  collapsed,
  onToggleCollapsed,
  unreadMessages,
  isMyTurn,
  prepNextStep,
}) => {
  const setActiveTab = onTabChange;
  // Combate em andamento no mapa visto: a iniciativa compacta encaixa acima do chat.
  const combatLive = combat !== null && combat.status !== 'ended';

  const tabs: TabDef[] = [
    { id: 'chat', label: 'Chat', Icon: MessageSquare, badge: String(messages.length) },
    // Rodada só com combate em andamento ("R0" sem combate não dizia nada).
    { id: 'initiative', label: 'Iniciativa', Icon: Swords, badge: combatLive && combat ? `R${combat.round}` : '' },
    { id: 'characters', label: 'Fichas', Icon: Users, badge: String(characters.length) },
  ];

  // Recolhido: o canvas ocupa a largura toda e sobra só esta alça fina, com os badges que
  // avisam por que talvez valha reabrir (mensagem não lida, é o seu turno).
  if (collapsed) {
    return (
      <aside
        id="vtt-sidepanel-collapsed"
        className="font-ui w-7 shrink-0 h-full bg-surface-1 border-l border-border flex flex-col items-center py-2 gap-2 select-none z-10"
      >
        <button
          id="btn-sidepanel-expand"
          onClick={onToggleCollapsed}
          title="Mostrar painel lateral (\ ou Ctrl+B)"
          className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {isMyTurn && <span title="É o seu turno" className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse shrink-0" />}
        {unreadMessages > 0 && (
          <span
            title={`${unreadMessages} mensagem${unreadMessages === 1 ? '' : 's'} não lida${unreadMessages === 1 ? '' : 's'}`}
            className="min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-accent text-bg text-12 leading-none font-data tabular-nums font-bold shrink-0"
          >
            {unreadMessages > 99 ? '99+' : unreadMessages}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      id="vtt-sidepanel"
      className="font-ui relative w-80 md:w-96 bg-surface-1 border-l border-border flex flex-col h-full shrink-0 select-none z-10"
    >
      <button
        id="btn-sidepanel-collapse"
        onClick={onToggleCollapsed}
        title="Recolher painel lateral (\ ou Ctrl+B)"
        className="focus-ring absolute -left-3 top-1/2 -translate-y-1/2 z-20 p-1 rounded-full bg-surface-1 border border-border text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer shadow-float"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {/* Visão de grupo (SPEC §3.6): os PCs da sala de relance, sempre visível, qualquer que seja a
          aba aberta abaixo. Preferência própria (partyViewExpanded) — não é a mesma coisa que
          recolher o painel inteiro (some junto por estar dentro deste <aside>). */}
      {systemDef && (
        <PartyView
          placeOnMap={placeOnMap}
          isGm={isGm}
          entries={party}
          characters={characters}
          tokens={tokens}
          def={systemDef}
          activeTurnTokenId={activeTurnTokenId}
          onOpenCharacter={onOpenCharacter}
          expanded={partyViewExpanded}
          onToggleExpanded={onTogglePartyView}
          onAdd={onAddToParty}
          onRemove={onRemoveFromParty}
          onSetHidden={onSetPartyHidden}
          onReorder={onReorderParty}
        />
      )}

      {/* "Próximo passo" do preparo: ponte entre preparar e jogar, acima das abas pra valer em
          qualquer uma delas (docs/SPEC.md §9.28). */}
      {prepNextStep}

      {/* Tab Navigation Header - Elegant Dark Style. `@container` deixa cada TabButton decidir, pela
          própria largura disponível, entre ícone+rótulo e só ícone (com tooltip e badge no canto). */}
      <div
        role="tablist"
        aria-label="Painel lateral"
        className="flex h-11 border-b border-border bg-surface-1 shrink-0 @container"
        onKeyDown={(e) => {
          // Padrão WAI-ARIA de abas: setas/Home/End trocam de aba e levam o foco junto.
          const index = tabs.findIndex((t) => t.id === activeTab);
          const last = tabs.length - 1;
          const next =
            e.key === 'ArrowRight' ? (index >= last ? 0 : index + 1)
            : e.key === 'ArrowLeft' ? (index <= 0 ? last : index - 1)
            : e.key === 'Home' ? 0
            : e.key === 'End' ? last
            : null;
          const tab = next === null ? undefined : tabs[next];
          if (!tab) return;
          e.preventDefault();
          e.stopPropagation(); // setas não podem chegar ao atalho de mover token (listener da janela)
          setActiveTab(tab.id);
          document.getElementById(`tab-btn-${tab.id}`)?.focus();
        }}
      >
        {tabs.map((tab) => (
          <TabButton key={tab.id} id={`tab-btn-${tab.id}`} tab={tab} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} />
        ))}
      </div>

      {/* Tab Content Container. Cada aba tem o próprio TabErrorBoundary (não um só ao redor do
          bloco inteiro): um erro de render numa aba não pode derrubar as outras nem a sala toda. */}
      <div id="sidepanel-tabpanel" role="tabpanel" aria-labelledby={`tab-btn-${activeTab}`} className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === 'chat' ? (
          <TabErrorBoundary label="Chat">
            {combatLive && combat && (
              <CombatCompact
                combat={combat}
                viewer={isGm ? 'gm' : 'player'}
                selectedTokenId={selectedTokenId}
                onSelectToken={onSelectToken}
                onNext={combatCallbacks.onNext}
                onPrev={combatCallbacks.onPrev}
                onOpenManagement={() => setActiveTab('initiative')}
              />
            )}
            <div className="flex-1 min-h-0">
            <ChatTab
              messages={messages}
              participants={participants}
              me={me}
              characters={characters}
              tokens={tokens}
              onSendMessage={onSendMessage}
              onRollCharacter={onRollCharacter}
              onSaveMacro={onSaveMacro}
            />
            </div>
          </TabErrorBoundary>
        ) : activeTab === 'characters' ? (
          <TabErrorBoundary label="Fichas">
            <CharactersTab
              placeOnMap={placeOnMap}
              characters={characters}
              participants={participants}
              me={me}
              onOpen={onOpenCharacter}
              onCreate={onCreateCharacter}
              onDelete={onDeleteCharacter}
            />
          </TabErrorBoundary>
        ) : (
          <TabErrorBoundary label="Iniciativa">
            <CombatPanel
              combat={combat}
              viewer={isGm ? 'gm' : 'player'}
              meId={me.id}
              sceneId={activeSceneId}
              tokens={tokens}
              conditions={conditions}
              movementLimitEnabled={movementLimitEnabled}
              autoRollNpcInitiativeEnabled={autoRollNpcInitiativeEnabled}
              selectedTokenIds={selectedIds}
              onSelectToken={onSelectToken}
              selectedTokenId={selectedTokenId}
              centerOnActiveTurn={centerOnActiveTurn}
              onToggleCenterOnActiveTurn={onToggleCenterOnActiveTurn}
              myTargetTokenIds={myTargetTokenIds}
              othersTargetTokenIds={othersTargetTokenIds}
              showOtherTargets={showOtherTargets}
              onToggleShowOtherTargets={onToggleShowOtherTargets}
              clearTargetsOnTurnEnd={clearTargetsOnTurnEnd}
              onToggleClearTargetsOnTurnEnd={onToggleClearTargetsOnTurnEnd}
              {...combatCallbacks}
            />
          </TabErrorBoundary>
        )}
      </div>
    </aside>
  );
};

/**
 * Um botão de aba: ícone + rótulo + badge inline quando cabe (`@[350px]:`, largura do próprio header
 * de abas — que é sempre 320 ou 384 px, os dois estados fixos do SidePanel); abaixo disso, só o
 * ícone (com `title` de tooltip) e o badge encolhe para um selo sobreposto no canto superior direito
 * do ícone. `min-w-0`/`truncate` no rótulo garantem que texto nunca é cortado por estourar a largura.
 */
const TabButton: React.FC<{ id: string; tab: TabDef; active: boolean; onClick: () => void }> = ({ id, tab: { label, Icon, badge }, active, onClick }) => (
  <button
    id={id}
    type="button"
    role="tab"
    aria-selected={active}
    aria-controls="sidepanel-tabpanel"
    tabIndex={active ? 0 : -1}
    onClick={onClick}
    title={badge ? `${label} (${badge})` : label}
    className={`focus-ring relative flex-1 min-w-0 flex items-center justify-center gap-2 px-1 text-xs font-title font-bold tracking-widest uppercase transition-all cursor-pointer ${
      active ? 'border-b-2 border-accent bg-surface-2 text-accent' : 'border-b border-border text-text-muted hover:text-text hover:bg-surface-2'
    }`}
  >
    <Icon className="w-3.5 h-3.5 shrink-0" />
    <span className="hidden @[350px]:inline truncate">{label}</span>
    {badge && (
      <span
        className={`hidden @[350px]:inline-block shrink-0 text-12 font-data tabular-nums px-1.5 py-0.2 rounded-ui ${
          active ? 'bg-bg text-accent border border-accent/40' : 'bg-surface-2 text-text-muted'
        }`}
      >
        {badge}
      </span>
    )}
    {badge && (
      <span
        className={`flex @[350px]:hidden absolute top-0.5 right-0.5 min-w-4 h-4 px-1 items-center justify-center rounded-full text-12 font-data tabular-nums leading-none ${
          active ? 'bg-accent text-bg' : 'bg-surface-2 text-text'
        }`}
      >
        {badge}
      </span>
    )}
  </button>
);
