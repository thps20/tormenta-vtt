import React from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Swords, Users } from 'lucide-react';
import { ChatTab } from './ChatTab';
import { CombatPanel, type CombatPanelCallbacks } from './CombatPanel';
import { CharactersTab } from './CharactersTab';
import type { Character, CharacterCreatePayload, CharacterRollRequest, ChatMessage, Combat, ConditionDef, Participant, Token } from '@tormenta-vtt/shared';

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
  centerOnActiveTurn: boolean;
  onToggleCenterOnActiveTurn: () => void;
  tokens: Token[];
  /** conditions[] do sistema da sala, pro CombatPanel resolver ícone/cor/duração da linha do combatente. */
  conditions: ConditionDef[];
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
  /** Botões de ação nos cards de item do chat (dano, cura) rolam pela ficha. */
  onRollCharacter: (characterId: string, request: CharacterRollRequest) => void;
  /** Recolher/expandir (\ ou Ctrl+B, preferência lembrada por usuário — ver Table em RoomPage.tsx). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mensagens chegadas desde que o painel recolheu; 0 quando expandido. Badge da alça recolhida. */
  unreadMessages: number;
  /** Badge "é seu turno" na alça recolhida. */
  isMyTurn: boolean;
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
  centerOnActiveTurn,
  onToggleCenterOnActiveTurn,
  tokens,
  conditions,
  isGm,
  onSendMessage,
  onSelectToken,
  selectedTokenId,
  me,
  characters,
  onOpenCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onRollCharacter,
  collapsed,
  onToggleCollapsed,
  unreadMessages,
  isMyTurn,
}) => {
  const setActiveTab = onTabChange;

  const tabs: TabDef[] = [
    { id: 'chat', label: 'Chat', Icon: MessageSquare, badge: String(messages.length) },
    { id: 'initiative', label: 'Iniciativa', Icon: Swords, badge: `R${combat?.round ?? 0}` },
    { id: 'characters', label: 'Fichas', Icon: Users, badge: String(characters.length) },
  ];

  // Recolhido: o canvas ocupa a largura toda e sobra só esta alça fina, com os badges que
  // avisam por que talvez valha reabrir (mensagem não lida, é o seu turno).
  if (collapsed) {
    return (
      <aside
        id="vtt-sidepanel-collapsed"
        className="w-7 shrink-0 h-full bg-[#1a1a1a] border-l border-[#2d2417] flex flex-col items-center py-2 gap-2 select-none z-10"
      >
        <button
          id="btn-sidepanel-expand"
          onClick={onToggleCollapsed}
          title="Mostrar painel lateral (\ ou Ctrl+B)"
          className="p-1 rounded text-zinc-500 hover:text-[#d4af37] hover:bg-[#242424] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {isMyTurn && <span title="É o seu turno" className="w-2.5 h-2.5 rounded-full bg-[#d4af37] animate-pulse shrink-0" />}
        {unreadMessages > 0 && (
          <span
            title={`${unreadMessages} mensagem${unreadMessages === 1 ? '' : 's'} não lida${unreadMessages === 1 ? '' : 's'}`}
            className="min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#d4af37] text-black text-[9px] font-mono font-bold shrink-0"
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
      className="relative w-80 md:w-96 bg-[#1a1a1a] border-l border-[#2d2417] flex flex-col h-full shrink-0 select-none z-10 shadow-2xl"
    >
      <button
        id="btn-sidepanel-collapse"
        onClick={onToggleCollapsed}
        title="Recolher painel lateral (\ ou Ctrl+B)"
        className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 p-1 rounded-full bg-[#1e1a15] border border-[#2d2417] text-zinc-500 hover:text-[#d4af37] hover:border-[#d4af37]/50 transition-colors cursor-pointer shadow"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      {/* Tab Navigation Header - Elegant Dark Style. `@container` deixa cada TabButton decidir, pela
          própria largura disponível, entre ícone+rótulo e só ícone (com tooltip e badge no canto). */}
      <div className="flex h-11 border-b border-[#2d2417] bg-[#141414] shrink-0 @container">
        {tabs.map((tab) => (
          <TabButton key={tab.id} id={`tab-btn-${tab.id}`} tab={tab} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} />
        ))}
      </div>

      {/* Tab Content Container */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'chat' ? (
          <ChatTab
            messages={messages}
            participants={participants}
            me={me}
            characters={characters}
            tokens={tokens}
            onSendMessage={onSendMessage}
            onRollCharacter={onRollCharacter}
          />
        ) : activeTab === 'characters' ? (
          <CharactersTab
            characters={characters}
            participants={participants}
            me={me}
            onOpen={onOpenCharacter}
            onCreate={onCreateCharacter}
            onDelete={onDeleteCharacter}
          />
        ) : (
          <CombatPanel
            combat={combat}
            viewer={isGm ? 'gm' : 'player'}
            meId={me.id}
            sceneId={activeSceneId}
            tokens={tokens}
            conditions={conditions}
            movementLimitEnabled={movementLimitEnabled}
            selectedTokenIds={selectedIds}
            onSelectToken={onSelectToken}
            selectedTokenId={selectedTokenId}
            centerOnActiveTurn={centerOnActiveTurn}
            onToggleCenterOnActiveTurn={onToggleCenterOnActiveTurn}
            {...combatCallbacks}
          />
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
    onClick={onClick}
    title={`${label} (${badge})`}
    className={`relative flex-1 min-w-0 flex items-center justify-center gap-2 px-1 text-xs font-serif font-bold tracking-widest uppercase transition-all cursor-pointer ${
      active
        ? 'border-b-2 border-[#d4af37] bg-[#222222] text-[#d4af37]'
        : 'border-b border-[#2d2417] text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'
    }`}
  >
    <Icon className="w-3.5 h-3.5 shrink-0" />
    <span className="hidden @[350px]:inline truncate">{label}</span>
    <span
      className={`hidden @[350px]:inline-block shrink-0 text-[10px] font-mono px-1.5 py-0.2 rounded ${
        active ? 'bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40' : 'bg-zinc-800 text-zinc-500'
      }`}
    >
      {badge}
    </span>
    <span
      className={`flex @[350px]:hidden absolute top-0.5 right-1.5 min-w-[15px] h-[15px] px-0.5 items-center justify-center rounded-full text-[8px] font-mono leading-none ${
        active ? 'bg-[#d4af37] text-black' : 'bg-zinc-700 text-zinc-300'
      }`}
    >
      {badge}
    </span>
  </button>
);
