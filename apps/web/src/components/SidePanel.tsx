import React from 'react';
import { MessageSquare, Swords, Users } from 'lucide-react';
import { ChatTab } from './ChatTab';
import { InitiativeTab } from './InitiativeTab';
import { CharactersTab } from './CharactersTab';
import type {
  Character,
  CharacterCreatePayload,
  CharacterRollRequest,
  ChatMessage,
  InitiativeAddPayload,
  InitiativeState,
  InitiativeUpdatePayload,
  Participant,
  Token,
} from '@tormenta-vtt/shared';

export type SidePanelTab = 'chat' | 'initiative' | 'characters';

interface SidePanelProps {
  /** Aba ativa (controlada pela página, para outros botões poderem abrir uma aba). */
  activeTab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  messages: ChatMessage[];
  participants: Participant[];
  currentUserId: string;
  initiative: InitiativeState | null;
  tokens: Token[];
  isGm: boolean;
  onSendMessage: (text: string) => void;
  onNextTurn: () => void;
  onPrevTurn: () => void;
  onResetInitiative: () => void;
  onAddEntry: (entry: InitiativeAddPayload) => void;
  onUpdateEntry: (patch: InitiativeUpdatePayload) => void;
  onRemoveEntry: (entryId: string) => void;
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

export const SidePanel: React.FC<SidePanelProps> = ({
  activeTab,
  onTabChange,
  messages,
  participants,
  currentUserId,
  initiative,
  tokens,
  isGm,
  onSendMessage,
  onNextTurn,
  onPrevTurn,
  onResetInitiative,
  onAddEntry,
  onUpdateEntry,
  onRemoveEntry,
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

  return (
    <aside
      id="vtt-sidepanel"
      className="w-80 md:w-96 bg-[#1a1a1a] border-l border-[#2d2417] flex flex-col h-full shrink-0 select-none z-10 shadow-2xl"
    >
      {/* Tab Navigation Header - Elegant Dark Style */}
      <div className="flex h-11 border-b border-[#2d2417] bg-[#141414] shrink-0">
        <button
          id="tab-btn-chat"
          onClick={() => setActiveTab('chat')}
          className={`flex-1 flex items-center justify-center gap-2 text-xs font-serif font-bold tracking-widest uppercase transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'border-b-2 border-[#d4af37] bg-[#222222] text-[#d4af37]'
              : 'border-b border-[#2d2417] text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              activeTab === 'chat'
                ? 'bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40'
                : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {messages.length}
          </span>
        </button>

        <button
          id="tab-btn-initiative"
          onClick={() => setActiveTab('initiative')}
          className={`flex-1 flex items-center justify-center gap-2 text-xs font-serif font-bold tracking-widest uppercase transition-all cursor-pointer ${
            activeTab === 'initiative'
              ? 'border-b-2 border-[#d4af37] bg-[#222222] text-[#d4af37]'
              : 'border-b border-[#2d2417] text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span>Iniciativa</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              activeTab === 'initiative'
                ? 'bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40'
                : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            R{initiative?.round ?? 0}
          </span>
        </button>

        <button
          id="tab-btn-characters"
          onClick={() => setActiveTab('characters')}
          className={`flex-1 flex items-center justify-center gap-2 text-xs font-serif font-bold tracking-widest uppercase transition-all cursor-pointer ${
            activeTab === 'characters'
              ? 'border-b-2 border-[#d4af37] bg-[#222222] text-[#d4af37]'
              : 'border-b border-[#2d2417] text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Fichas</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              activeTab === 'characters'
                ? 'bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40'
                : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {characters.length}
          </span>
        </button>
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
          <InitiativeTab
            initiative={initiative}
            tokens={tokens}
            isGm={isGm}
            onNextTurn={onNextTurn}
            onPrevTurn={onPrevTurn}
            onResetInitiative={onResetInitiative}
            onAddEntry={onAddEntry}
            onUpdateEntry={onUpdateEntry}
            onRemoveEntry={onRemoveEntry}
            onSelectToken={onSelectToken}
            selectedTokenId={selectedTokenId}
          />
        )}
      </div>
    </aside>
  );
};
