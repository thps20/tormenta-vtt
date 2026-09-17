import React, { useState, useRef, useEffect } from 'react';
import { Send, Dices, Scroll, Eye, Flame, MessageCircle, Sparkles } from 'lucide-react';
import {
  addDieToFormula,
  type Character,
  type CharacterRollRequest,
  type ChatMessage,
  type MacroAction,
  type Participant,
  type Token,
} from '@tormenta-vtt/shared';
import { canEditCharacter } from '../store/characters';
import { useChat } from '../store/chat';
import { useTargets } from '../store/targets';
import { useSystemDef } from '../lib/system';
import { rollModeInfo } from '../lib/rollMode';
import {
  loadDiceAnimationMode,
  loadRollDamageWithAttack,
  saveDiceAnimationMode,
  saveRollDamageWithAttack,
  type DiceAnimationMode,
} from '../lib/rollPreferences';
import { HandoutCardMessage } from './chat/HandoutCardMessage';
import { InitiativeBatchMessage } from './chat/InitiativeBatchMessage';
import { ItemCardMessage } from './chat/ItemCardMessage';
import { RollCardMessage } from './chat/RollCardMessage';
import { RollModeButton } from './chat/RollModeButton';
import { WhisperTargetButton } from './chat/WhisperTargetButton';
import { useHandouts } from '../store/handouts';
import { pressedClass } from './MapBar';

/**
 * Rótulo do sussurro (docs/plano-narracao.md), quando `msg.whisperTo` está setado — texto e rolagem
 * usam o mesmo. Quem é autor OU alvo vê "para X"/"de X"; o GM, quando não é nenhum dos dois (um
 * sussurro entre dois jogadores — só o GM recebe essa mensagem, o gate do servidor garante isso),
 * vê o rótulo explícito "de X para Y" pedido pelo dono do projeto, pra ficar claro que ele vê.
 */
function whisperLabel(msg: ChatMessage, me: Participant, participants: Participant[]): string | null {
  if (!msg.whisperTo) return null;
  const targetName = participants.find((p) => p.id === msg.whisperTo)?.nickname ?? 'alguém';
  if (msg.participantId === me.id) return `sussurro para ${targetName}`;
  if (msg.whisperTo === me.id) return `sussurro de ${msg.nickname}`;
  return `sussurro de ${msg.nickname} para ${targetName}`;
}

interface ChatTabProps {
  messages: ChatMessage[];
  participants: Participant[];
  me: Participant;
  /** Fichas visíveis: decide se os botões do card de item ficam ativos, e o PV de tokens vinculados no seletor de "Aplicar". */
  characters: Character[];
  /** Tokens da cena atual: alvos possíveis do "Aplicar" num card de dano/cura. */
  tokens: Token[];
  onSendMessage: (text: string) => void;
  onRollCharacter: (characterId: string, request: CharacterRollRequest) => void;
  /** "Salvar como macro" (docs/SPEC.md §9.20): abre o criador de macro já com a ação travada. */
  onSaveMacro: (action: MacroAction, defaultLabel: string) => void;
}

export const ChatTab: React.FC<ChatTabProps> = ({
  messages,
  participants,
  me,
  characters,
  tokens,
  onSendMessage,
  onRollCharacter,
  onSaveMacro,
}) => {
  const currentUserId = me.id;
  // Sistema da sala: só para pintar os selos de tipo de dano (null fora de sala = selos neutros).
  const def = useSystemDef();
  // Modo de rolagem e "Revelar" vêm direto da store do chat (não passam pelo RoomPage):
  // são estado do próprio chat, e assim a ficha e os cards leem o mesmo modo.
  const rollMode = useChat((s) => s.rollMode);
  const setRollMode = useChat((s) => s.setRollMode);
  const whisperTarget = useChat((s) => s.whisperTarget);
  const setWhisperTarget = useChat((s) => s.setWhisperTarget);
  const revealMessage = useChat((s) => s.reveal);
  const applyDamage = useChat((s) => s.applyDamage);
  // "Rolar dano junto com o ataque" (§9.13): preferência por usuário, localStorage — lida aqui só
  // pro checkbox; quem decide de verdade se combina é a store (store/characters.ts#roll), que lê a
  // mesma preferência na hora de montar o pedido (não depende deste componente estar montado).
  const [rollDamageWithAttack, setRollDamageWithAttackState] = useState(loadRollDamageWithAttack);
  const setRollDamageWithAttack = (value: boolean) => {
    saveRollDamageWithAttack(value);
    setRollDamageWithAttackState(value);
  };
  // Animação de revelação da rolagem (docs/SPEC.md, item 3): "simples" (padrão), "3D" ou
  // desligada — mesmo padrão de preferência por usuário, lida pelo RollCardMessage do cartão.
  const [diceAnimationMode, setDiceAnimationModeState] = useState(loadDiceAnimationMode);
  const cycleDiceAnimationMode = () => {
    const next: Record<DiceAnimationMode, DiceAnimationMode> = { simple: '3d', '3d': 'off', off: 'simple' };
    const value = next[diceAnimationMode];
    saveDiceAnimationMode(value);
    setDiceAnimationModeState(value);
  };
  // Sistema de alvos (docs/plano-alvos.md §3.5): "Aplicar" pré-seleciona os alvos do CARD quando
  // ele tiver (roll.targets, ataque com acerto/erro); sem alvo no card, cai nos meus alvos atuais.
  const myTargetIds = useTargets((s) => s.mine);
  const openHandout = useHandouts((s) => s.openLocal);
  const [inputText, setInputText] = useState('');
  const isRollCommand = /^\/(r|roll|gmr|gr|pr)\b/i.test(inputText);
  const nonPublic = rollMode !== 'all';
  const whispering = whisperTarget !== null;
  const modeInfo = rollModeInfo(rollMode);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

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

  /**
   * Botões d4..d100 da faixa "ROLAR:" (docs/SPEC.md): ACUMULAM na fórmula do campo, nunca rolam
   * no clique — só Enter/enviar rola de verdade. Campo vazio ou sem comando de rolagem vira
   * "/r 1d{sides}"; já sendo um comando (`/r`, `/gmr`...), soma o dado na fórmula existente
   * (`addDieToFormula`, packages/shared/src/dice/parser.ts) preservando modificador e `# rótulo`.
   */
  const handleQuickDice = (sides: number) => {
    const match = /^\/(r|roll|gmr|gr|pr)\b\s*/i.exec(inputText);
    if (!match) {
      setInputText(`/r 1d${sides}`);
      chatInputRef.current?.focus();
      return;
    }
    const cmd = match[0].trimEnd();
    const rest = inputText.slice(match[0].length);
    const hashIdx = rest.indexOf('#');
    const formulaPart = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
    const label = hashIdx === -1 ? '' : ` ${rest.slice(hashIdx)}`;
    setInputText(`${cmd} ${addDieToFormula(formulaPart, sides)}${label}`);
    chatInputRef.current?.focus();
  };

  /**
   * Tab completa o nickname em "/w <início>" (docs/plano-narracao.md) — primeiro nickname da sala
   * que bate (case-insensitive), sem mexer no resto da mensagem se ela já tiver começado.
   */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Tab') return;
    // Duas formas em andamento: já dentro de aspas abertas ("/w "Ana...) ou ainda sem aspas
    // ("/w Ana..."). Nos dois casos só faz sentido completar se não houver espaço nenhum digitado
    // ainda fora de aspas (senão o usuário já está na mensagem, não no nickname).
    const quoted = /^\/w\s+"([^"]*)$/i.exec(inputText);
    const bare = /^\/w\s+(\S*)$/i.exec(inputText);
    const partial = (quoted ? quoted[1] : bare ? bare[1] : null)?.toLowerCase();
    if (partial === undefined || partial === null) return;
    const match = participants.find((p) => p.id !== me.id && p.nickname.toLowerCase().startsWith(partial));
    if (!match) return;
    e.preventDefault();
    // Nickname com espaço precisa de aspas pro parser gracioso do servidor não confundir onde ele
    // termina (docs/plano-narracao.md) — completa sempre com aspas nesse caso, mesmo se o usuário
    // não tinha aberto uma ainda.
    setInputText(match.nickname.includes(' ') ? `/w "${match.nickname}" ` : `/w ${match.nickname} `);
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
    <div className="font-ui flex flex-col h-full bg-surface-1 text-text">
      {/* Messages Stream: rolagens/mensagens simples viram linha de log (só filete); cartão fica
          reservado pro que pede uma ação (Aplicar, Revelar, usar item — docs/design/DESIGN.md). */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-thin">
        {messages.map((msg) => {
          const participant = getParticipant(msg.participantId);
          const isGm = participant?.role === 'gm';
          const isMe = msg.participantId === currentUserId;

          // 1. SYSTEM MESSAGE — nunca acionável: linha de log.
          if (msg.kind === 'system') {
            return (
              <div key={msg.id} id={`chat-msg-${msg.id}`} className="py-1.5 border-b border-border">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-title font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Scroll className="w-3 h-3" />
                    SISTEMA
                  </span>
                  <span className="text-[9px] font-data tabular-nums text-text-muted">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-text-muted italic leading-relaxed">
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
                onSaveAsMacro={(actionId) => {
                  const action = card.actions.find((a) => a.id === actionId);
                  const enhancements = (card.enhancements ?? []).map((e) => ({ id: e.id, times: e.times }));
                  onSaveMacro({ type: 'characterAction', characterId: card.characterId, itemId: card.itemId, actionId, enhancements }, action?.label ?? card.itemName);
                }}
              />
            );
          }

          // 2.1 CARD DE HANDOUT MOSTRADO PELO GM (§9.10)
          if (msg.kind === 'handout') {
            return <HandoutCardMessage key={msg.id} msg={msg} time={formatTime(msg.createdAt)} onOpen={openHandout} />;
          }

          // 2.5 CARD DE INICIATIVA EM LOTE (combat:roll com mais de um combatente)
          if (msg.kind === 'initiative-batch') {
            return (
              <InitiativeBatchMessage
                key={msg.id}
                msg={msg}
                time={formatTime(msg.createdAt)}
                isGm={me.role === 'gm'}
                animationMode={diceAnimationMode}
                onReveal={(messageId) => void revealMessage(messageId)}
              />
            );
          }

          // 3. ROLAGEM OCULTA (placeholder): o servidor manda a mensagem sem `roll`
          // pra quem não tem permissão de ver o resultado (não omite mais a mensagem
          // inteira). Some sozinha quando o Revelar troca essa mesma mensagem (mesmo id)
          // pela versão completa.
          if (msg.kind === 'roll' && !msg.roll) {
            const vis = rollModeInfo(msg.visibility);
            const VisIcon = vis.icon;
            // Acionável só pra quem vê o botão Revelar (GM); pros demais é só uma linha de log.
            const revealable = me.role === 'gm';
            return (
              <div
                key={msg.id}
                id={`chat-msg-${msg.id}`}
                className={revealable ? 'p-2.5 rounded-ui border border-border bg-surface-2' : 'py-1.5 border-b border-border'}
                data-visibility={msg.visibility}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-tight text-text">{msg.nickname}</span>
                    {isGm && <span className="text-[9px] px-1 rounded-ui bg-bg/40 border border-border text-text-muted font-bold">GM</span>}
                  </div>
                  <span className="text-[9px] font-data tabular-nums text-text-muted">{formatTime(msg.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-text-muted italic">
                    <VisIcon className="w-3 h-3 shrink-0" />
                    {msg.visibility === 'gm' ? `${msg.nickname} fez uma rolagem secreta` : `${msg.nickname} fez uma rolagem própria`}
                  </span>
                  {me.role === 'gm' && (
                    <button
                      type="button"
                      id={`reveal-${msg.id}`}
                      onClick={() => void revealMessage(msg.id)}
                      title="Tornar pública para todos"
                      className="focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui border border-accent text-accent hover:bg-surface-1 transition-colors cursor-pointer shrink-0"
                    >
                      <Eye className="w-3 h-3" />
                      Revelar
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // 4. DICE ROLL MESSAGE — cartão extraído pra RollCardMessage.tsx (hospeda o estado
          // local da animação de revelação, docs/SPEC.md item 3).
          if (msg.kind === 'roll' && msg.roll) {
            return (
              <RollCardMessage
                key={msg.id}
                def={def}
                msg={msg}
                isGm={isGm}
                time={formatTime(msg.createdAt)}
                whisperLabel={whisperLabel(msg, me, participants)}
                tokens={tokens}
                characters={characters}
                participants={participants}
                me={me}
                myTargetIds={myTargetIds}
                animationMode={diceAnimationMode}
                onApplyDamage={applyDamage}
                onReveal={(messageId) => void revealMessage(messageId)}
                onSaveMacro={onSaveMacro}
              />
            );
          }

          // 5. MENSAGEM DE TEXTO — nunca acionável: linha de log.
          const textWhisper = whisperLabel(msg, me, participants);
          return (
            <div key={msg.id} id={`chat-msg-${msg.id}`} data-whisper-to={msg.whisperTo ?? undefined} className="py-1.5 border-b border-border">
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-tight text-text">{msg.nickname}</span>
                  {isGm && <span className="text-[9px] px-1 rounded-ui bg-bg/40 border border-border text-text-muted font-bold">GM</span>}
                  {textWhisper && (
                    <span className="flex items-center gap-1 text-[9px] px-1 rounded-ui bg-bg/40 border border-border text-text-muted lowercase">
                      <MessageCircle className="w-2.5 h-2.5" />
                      {textWhisper}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-data tabular-nums text-text-muted">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              <p className="text-xs text-text leading-relaxed break-words whitespace-pre-wrap">
                {msg.text}
              </p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Dice Bar */}
      {/* Quebra linha em painéis estreitos (sem overflow: o popover do modo não pode ser recortado). */}
      <div className="p-2 bg-bg border-t border-border flex items-center justify-between flex-wrap gap-1 text-[11px]">
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-text-muted uppercase tracking-widest font-title font-bold flex items-center gap-1">
            <Dices className="w-3 h-3" />
            ROLAR:
          </span>
          <RollModeButton mode={rollMode} onChange={setRollMode} />
          <WhisperTargetButton participants={participants.filter((p) => p.id !== me.id)} target={whisperTarget} onChange={setWhisperTarget} />
          <button
            type="button"
            id="roll-damage-with-attack-btn"
            onClick={() => setRollDamageWithAttack(!rollDamageWithAttack)}
            aria-pressed={rollDamageWithAttack}
            title="Rolar dano junto com o ataque: o botão de uma ação de ataque com dano no mesmo item rola as duas numa mensagem só."
            className={`focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui border font-ui text-[10px] uppercase tracking-wide transition-colors cursor-pointer select-none ${pressedClass(rollDamageWithAttack)}`}
          >
            <Flame className="w-3 h-3" />
            Dano junto
          </button>
          <button
            type="button"
            id="dice-animation-mode-btn"
            onClick={cycleDiceAnimationMode}
            aria-pressed={diceAnimationMode !== 'off'}
            data-mode={diceAnimationMode}
            title={`Animação da rolagem: ${
              diceAnimationMode === 'simple' ? 'Simples' : diceAnimationMode === '3d' ? '3D' : 'Desligada'
            }. Clique para alternar.`}
            className={`focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui border font-ui text-[10px] uppercase tracking-wide transition-colors cursor-pointer select-none ${pressedClass(diceAnimationMode !== 'off')}`}
          >
            <Sparkles className="w-3 h-3" />
            {diceAnimationMode === 'simple' ? 'Simples' : diceAnimationMode === '3d' ? '3D' : 'Desligada'}
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
            <button
              key={sides}
              onClick={() => handleQuickDice(sides)}
              title={`Rolar 1d${sides}`}
              className="focus-ring px-1.5 py-0.5 rounded-ui bg-surface-1 hover:bg-surface-2 text-text-muted hover:text-text border border-border font-data text-[10px] transition-colors cursor-pointer"
            >
              d{sides}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input Box */}
      <form onSubmit={handleSubmit} className="p-3 bg-bg border-t border-border flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id="chat-input-field"
            ref={chatInputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder='Mensagem, /r 2d6+3 # rótulo, /gmr (secreta), /pr (pública) ou /w <nickname> (sussurro, aspas se tiver espaço)...'
            data-roll-mode={rollMode}
            className={`focus-ring w-full bg-surface-1 border rounded-ui px-3 py-2 text-xs text-text placeholder:text-text-muted ${
              whispering || nonPublic ? 'border-text-muted' : 'border-border'
            }`}
          />
          {/* Indicador discreto: sussurro ativo, modo fora de "Pública" e/ou comando de dado digitado. */}
          {(isRollCommand || nonPublic || whispering) && (
            <span className="absolute right-2.5 top-2 text-[10px] font-data pointer-events-none uppercase tracking-widest text-text-muted">
              {isRollCommand && 'DADO'}
              {isRollCommand && (nonPublic || whispering) && ' · '}
              {nonPublic && modeInfo.label}
              {nonPublic && whispering && ' · '}
              {whispering && 'SUSSURRO'}
            </span>
          )}
        </div>

        <button
          id="chat-send-btn"
          type="submit"
          disabled={!inputText.trim()}
          className="focus-ring bg-surface-2 border border-accent px-3 py-2 rounded-ui text-xs text-accent font-ui font-bold hover:bg-surface-2/80 disabled:opacity-40 disabled:hover:bg-surface-2 transition-colors cursor-pointer flex items-center justify-center shrink-0"
          title="Enviar (Enter)"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
