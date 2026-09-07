import React, { useState, useRef, useEffect } from 'react';
import { Send, Dices, Scroll, ShieldAlert } from 'lucide-react';
import type { Character, CharacterRollRequest, ChatMessage, Participant } from '@tormenta-vtt/shared';
import { canEditCharacter } from '../store/characters';
import { useSystemDef } from '../lib/system';
import { ItemCardMessage } from './chat/ItemCardMessage';
import { DamageFormula, DamageTypeBadge } from './DamageTypeBadge';

interface ChatTabProps {
  messages: ChatMessage[];
  participants: Participant[];
  me: Participant;
  /** Fichas visíveis: decide se os botões do card de item ficam ativos. */
  characters: Character[];
  onSendMessage: (text: string) => void;
  onRollCharacter: (characterId: string, request: CharacterRollRequest) => void;
}

export const ChatTab: React.FC<ChatTabProps> = ({
  messages,
  participants,
  me,
  characters,
  onSendMessage,
  onRollCharacter,
}) => {
  const currentUserId = me.id;
  // Sistema da sala: só para pintar os selos de tipo de dano (null fora de sala = selos neutros).
  const def = useSystemDef();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    // Limpa o input já; se o servidor recusar, um toast avisa.
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleQuickDice = (sides: number) => {
    onSendMessage(`/r 1d${sides}`);
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const getParticipant = (participantId: string) => {
    return participants.find((p) => p.id === participantId);
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-200">
      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {messages.map((msg) => {
          const participant = getParticipant(msg.participantId);
          const isGm = participant?.role === 'gm';
          const isMe = msg.participantId === currentUserId;

          // 1. SYSTEM MESSAGE - Elegant Dark
          if (msg.kind === 'system') {
            return (
              <div
                key={msg.id}
                id={`chat-msg-${msg.id}`}
                className="my-1.5 p-2.5 rounded bg-black/30 border border-zinc-800/60 shadow-inner"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-serif font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Scroll className="w-3 h-3 text-[#d4af37]" />
                    SISTEMA
                  </span>
                  <span className="text-[9px] font-mono text-zinc-600">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 italic leading-relaxed">
                  {msg.text}
                </div>
              </div>
            );
          }

          // 2. CARD DE ITEM USADO (poder, magia) com botões de ação
          if (msg.kind === 'item' && msg.item) {
            const card = msg.item;
            const character = characters.find((c) => c.id === card.characterId);
            const canAct = character !== undefined && canEditCharacter(me, character);
            return (
              <ItemCardMessage
                key={msg.id}
                def={def}
                msg={msg}
                card={card}
                isGm={isGm}
                isMe={isMe}
                time={formatTime(msg.createdAt)}
                canAct={canAct}
                onRoll={(actionId) =>
                  // Reenvia os aprimoramentos da conjuração: o servidor monta a fórmula com os efeitos escolhidos.
                  onRollCharacter(card.characterId, { type: 'action', itemId: card.itemId, actionId, enhancements: (card.enhancements ?? []).map((e) => ({ id: e.id, times: e.times })) })
                }
              />
            );
          }

          // 3. DICE ROLL MESSAGE (HIGHLIGHTED) - Elegant Dark
          if (msg.kind === 'roll' && msg.roll) {
            const roll = msg.roll;
            // Parcelas de dano por tipo (só rolagens de dano da ficha; rolagens antigas não têm).
            const damage = roll.damage && roll.damage.length > 0 ? roll.damage : null;
            // Crítico a partir de critThreshold (ataques com margem ampliada); padrão = 20 natural.
            const critFrom = roll.critThreshold ?? 20;
            const isCritical =
              roll.groups.some((g) => g.sides === 20 && g.rolls.some((r) => r >= critFrom));
            const isFumble =
              roll.groups.some((g) => g.sides === 20 && g.rolls.includes(1));

            return (
              <div
                key={msg.id}
                id={`chat-msg-${msg.id}`}
                className={`p-3 rounded border shadow-inner transition-all ${
                  isCritical
                    ? 'bg-[#2d2417]/40 border-[#d4af37] shadow-[#d4af37]/10'
                    : isFumble
                    ? 'bg-red-950/20 border-red-900/50'
                    : 'bg-black/35 border-zinc-800/60'
                }`}
              >
                {/* Roll Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-tight ${
                        isGm
                          ? 'text-[#d4af37] font-serif'
                          : isMe
                          ? 'text-blue-400'
                          : 'text-zinc-300'
                      }`}
                    >
                      {msg.nickname}
                    </span>
                    {isGm && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40 font-serif font-bold">
                        GM
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-zinc-600">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>

                {/* Roll Content Layout */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[11px] text-zinc-400 italic mb-1 truncate">
                      {roll.label ? roll.label : 'Rolagem de dados'}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-serif font-bold tracking-tight ${
                          isCritical
                            ? 'text-[#d4af37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]'
                            : isFumble
                            ? 'text-red-400'
                            : 'text-[#d4af37]'
                        }`}
                      >
                        {roll.total}
                      </span>
                      {/* Dano por tipo: uma parcela = só o selo; várias = "(7 [Fogo] + 14 [Frio])". */}
                      {damage && damage.length === 1 && damage[0] && <DamageTypeBadge def={def} type={damage[0].damageType} />}
                      {damage && damage.length > 1 && (
                        <span className="text-[11px] font-mono text-zinc-300 flex items-center gap-1 flex-wrap" data-damage-breakdown>
                          (
                          {damage.map((d, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <span className="text-zinc-500">+</span>}
                              <span className="font-bold text-amber-200">{d.total}</span>
                              <DamageTypeBadge def={def} type={d.damageType} />
                            </React.Fragment>
                          ))}
                          )
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-zinc-500">
                        {roll.groups.map((g) => `[${g.rolls.join(', ')}]`).join(' ')}
                        {roll.modifier !== 0 && (
                          <span>
                            {' '}
                            {roll.modifier > 0 ? `+ ${roll.modifier}` : `- ${Math.abs(roll.modifier)}`}
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Fórmula do dano com o selo de cada parcela: "6d6 + 1 [Fogo] + 4d6 [Frio]". */}
                    {damage && (
                      <div className="mt-1 text-[10px] font-mono text-zinc-500" data-damage-formula>
                        <DamageFormula def={def} components={damage} />
                      </div>
                    )}
                  </div>

                  {/* Elegant Rhombus Dice Badge */}
                  <div className="w-10 h-10 border border-[#d4af37]/40 bg-[#2d2417]/40 flex items-center justify-center rounded transform rotate-45 shrink-0 shadow-sm">
                    <span className="-rotate-45 text-[11px] text-[#d4af37] font-serif font-bold tracking-tighter">
                      {roll.groups[0] ? `${roll.groups[0].count}d${roll.groups[0].sides}` : 'd20'}
                    </span>
                  </div>
                </div>

                {roll.secret && (
                  <div className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center gap-1 text-[10px] text-[#d4af37]/80 font-mono">
                    <ShieldAlert className="w-3 h-3" />
                    <span>Rolagem secreta: só você e o GM veem</span>
                  </div>
                )}
              </div>
            );
          }

          // 4. STANDARD TEXT MESSAGE - Elegant Dark
          return (
            <div
              key={msg.id}
              id={`chat-msg-${msg.id}`}
              className={`p-2.5 rounded border ${
                isMe
                  ? 'bg-black/40 border-[#2d2417] ml-3'
                  : 'bg-black/25 border-zinc-800/50 mr-3'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-tight ${
                      isGm
                        ? 'text-[#d4af37] font-serif'
                        : isMe
                        ? 'text-blue-400'
                        : 'text-zinc-300'
                    }`}
                  >
                    {msg.nickname}
                  </span>
                  {isGm && (
                    <span className="text-[9px] px-1 rounded bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40 font-serif font-bold">
                      GM
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-mono text-zinc-600">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed break-words whitespace-pre-wrap">
                {msg.text}
              </p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Dice Bar - Elegant Dark */}
      <div className="p-2 bg-[#121212] border-t border-[#2d2417] flex items-center justify-between gap-1 overflow-x-auto text-[11px]">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-serif font-bold pl-1 flex items-center gap-1">
          <Dices className="w-3 h-3 text-[#d4af37]" />
          ROLAR:
        </span>
        <div className="flex items-center gap-1">
          {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
            <button
              key={sides}
              onClick={() => handleQuickDice(sides)}
              title={`Rolar 1d${sides}`}
              className="px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] border border-[#3d3d3d] hover:border-[#d4af37]/50 font-mono text-[10px] transition-colors cursor-pointer"
            >
              d{sides}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input Box - Elegant Dark */}
      <form
        onSubmit={handleSubmit}
        className="p-3 bg-[#121212] border-t border-[#2d2417] flex items-center gap-2"
      >
        <div className="relative flex-1">
          <input
            id="chat-input-field"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Mensagem, /r 2d6+3 # rótulo ou /gr (secreto)..."
            className="w-full bg-[#1a1a1a] border border-[#3d3d3d] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#d4af37] text-zinc-200 placeholder:text-zinc-600"
          />
          {/^\/(r|gr|roll)\b/i.test(inputText) && (
            <span className="absolute right-2.5 top-2 text-[10px] text-[#d4af37] font-mono pointer-events-none uppercase tracking-widest">
              DADO
            </span>
          )}
        </div>

        <button
          id="chat-send-btn"
          type="submit"
          disabled={!inputText.trim()}
          className="bg-[#2d2417] border border-[#d4af37] px-3 py-2 rounded-md text-xs text-[#d4af37] font-serif font-bold hover:bg-[#3d311f] disabled:opacity-40 disabled:hover:bg-[#2d2417] transition-colors cursor-pointer flex items-center justify-center shrink-0 shadow-sm"
          title="Enviar (Enter)"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
