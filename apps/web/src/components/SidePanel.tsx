import React from 'react';
import { MessageSquare, Swords, Users } from 'lucide-react';
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
}) => {
  const setActiveTab = onTabChange;

  const tabs: TabDef[] = [
    { id: 'chat', label: 'Chat', Icon: MessageSquare, badge: String(messages.length) },
    { id: 'initiative', label: 'Iniciativa', Icon: Swords, badge: `R${combat?.round ?? 0}` },
    { id: 'characters', label: 'Fichas', Icon: Users, badge: String(characters.length) },
  ];

  return (
    <aside
      id="vtt-sidepanel"
      className="w-80 md:w-96 bg-[#1a1a1a] border-l border-[#2d2417] flex flex-col h-full shrink-0 select-none z-10 shadow-2xl"
    >
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
