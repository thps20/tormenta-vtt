import React, { useState, useRef, useEffect } from 'react';
import { Send, Dices, Scroll, Eye, Flame, MessageCircle } from 'lucide-react';
import {
  hitRuleTargetLabel,
  isCombinedAttackRoll,
  type Character,
  type CharacterRollRequest,
  type ChatMessage,
  type DiceRoll,
  type Participant,
  type RollTarget,
  type Token,
} from '@tormenta-vtt/shared';
import { canEditCharacter } from '../store/characters';
import { useChat } from '../store/chat';
import { useTargets } from '../store/targets';
import { useSystemDef } from '../lib/system';
import { rollModeInfo } from '../lib/rollMode';
import { loadRollDamageWithAttack, saveRollDamageWithAttack } from '../lib/rollPreferences';
import { ApplyDamageButton } from './chat/ApplyDamageButton';
import { HandoutCardMessage } from './chat/HandoutCardMessage';
import { InitiativeBatchMessage } from './chat/InitiativeBatchMessage';
import { ItemCardMessage } from './chat/ItemCardMessage';
import { RollModeButton } from './chat/RollModeButton';
import { WhisperTargetButton } from './chat/WhisperTargetButton';
import { DamageFormula, DamageTypeBadge } from './DamageTypeBadge';
import { useHandouts } from '../store/handouts';

/** Soma dos totais das parcelas de dano — usado no bloco de dano de uma rolagem combinada (§9.13),
 *  onde `roll.total` é o total do ATAQUE, não do dano (que fica só em `roll.damage[]`). */
function sumDamage(damage: NonNullable<DiceRoll['damage']>): number {
  return damage.reduce((sum, d) => sum + d.total, 0);
}

/**
 * Sistema de alvos (docs/plano-alvos.md): uma linha por alvo de um ataque — "Acertou/Errou" (com
 * o número só quando o servidor mandou `targetValue`, ver services/chatVisibility.ts#rollTargetsForViewer
 * no servidor); "(N natural)" quando `attackAutoHit`/`attackAutoMiss` decidiu; sem regra de acerto
 * no sistema (ou alvo sem ficha), só o nome.
 */
function targetLineText(def: ReturnType<typeof useSystemDef>, roll: DiceRoll, target: RollTarget): { text: string; color: string } {
  const name = target.name;
  if (target.reason === 'auto-hit') return { text: `Acertou ${name} (${roll.natural} natural)`, color: 'text-emerald-400' };
  if (target.reason === 'auto-miss') return { text: `Errou ${name} (${roll.natural} natural)`, color: 'text-red-400' };
  if (target.hit === null) return { text: `→ ${name}`, color: 'text-zinc-400' };
  const verb = target.hit ? 'Acertou' : 'Errou';
  if (target.targetValue === undefined) return { text: `${verb} ${name}`, color: target.hit ? 'text-emerald-400' : 'text-red-400' };
  const label = def?.rolls.attackHit ? hitRuleTargetLabel(def, def.rolls.attackHit) : 'alvo';
  return { text: `${verb} ${name} (${roll.total} vs ${label} ${target.targetValue})`, color: target.hit ? 'text-emerald-400' : 'text-red-400' };
}

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
}

export const ChatTab: React.FC<ChatTabProps> = ({
  messages,
  participants,
  me,
  characters,
  tokens,
  onSendMessage,
  onRollCharacter,
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
            return (
              <div
                key={msg.id}
                id={`chat-msg-${msg.id}`}
                className="p-2.5 rounded border border-zinc-800/60 bg-black/25"
                data-visibility={msg.visibility}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-tight ${
                        isGm ? 'text-[#d4af37] font-serif' : isMe ? 'text-blue-400' : 'text-zinc-300'
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
                  <span className="text-[9px] font-mono text-zinc-600">{formatTime(msg.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500 italic">
                    <VisIcon className="w-3 h-3 shrink-0" />
                    {msg.visibility === 'gm' ? `${msg.nickname} fez uma rolagem secreta` : `${msg.nickname} fez uma rolagem própria`}
                  </span>
                  {me.role === 'gm' && (
                    <button
                      type="button"
                      id={`reveal-${msg.id}`}
                      onClick={() => void revealMessage(msg.id)}
                      title="Tornar pública para todos"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#2d2417] transition-colors cursor-pointer shrink-0"
                    >
                      <Eye className="w-3 h-3" />
                      Revelar
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // 4. DICE ROLL MESSAGE (HIGHLIGHTED) - Elegant Dark
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
            // "Rolar dano junto com o ataque" (§9.13): ataque em cima (roll.total/groups são DELE) e
            // dano embaixo, num bloco à parte — não misturado no número do header como o dano avulso.
            const combined = isCombinedAttackRoll(roll);
            const rollWhisper = whisperLabel(msg, me, participants);

            return (
              <div
                key={msg.id}
                id={`chat-msg-${msg.id}`}
                data-whisper-to={msg.whisperTo ?? undefined}
                className={`p-3 rounded border shadow-inner transition-all ${
                  rollWhisper
                    ? 'bg-purple-950/20 border-purple-700/50'
                    : isCritical
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
                    {rollWhisper && (
                      <span className="flex items-center gap-1 text-[9px] px-1 rounded bg-purple-950/50 text-purple-300 border border-purple-700/50 font-mono lowercase">
                        <MessageCircle className="w-2.5 h-2.5" />
                        {rollWhisper}
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
                      {/* Dano por tipo: uma parcela = só o selo; várias = "(7 [Fogo] + 14 [Frio])".
                          Combinado (§9.13) não mistura aqui: o dano tem bloco próprio, embaixo. */}
                      {damage && !combined && damage.length === 1 && damage[0] && <DamageTypeBadge def={def} type={damage[0].damageType} />}
                      {damage && !combined && damage.length > 1 && (
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
                    {damage && !combined && (
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

                {/* Sistema de alvos (docs/plano-alvos.md): uma linha por alvo do ataque. */}
                {roll.targets.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-zinc-800/60 space-y-0.5" data-roll-targets>
                    {roll.targets.map((t) => {
                      const { text, color } = targetLineText(def, roll, t);
                      return (
                        <div key={t.tokenId} className={`text-[11px] font-mono ${color}`}>
                          {text}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Dano combinado com o ataque (§9.13): bloco próprio, com o total/parcelas/fórmula
                    do dano (roll.total ali em cima é do ATAQUE, não deste dano) e o aviso de
                    crítico — confirmado (dado já multiplicado) ou só "possível" (o Mestre decide). */}
                {combined && damage && (
                  <div className="mt-2 pt-1.5 border-t border-zinc-800/60" data-combined-damage>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] text-zinc-400 italic">Dano</span>
                      <span className="text-xl font-serif font-bold text-amber-200">{sumDamage(damage)}</span>
                      {damage.length === 1 && damage[0] && <DamageTypeBadge def={def} type={damage[0].damageType} />}
                      {damage.length > 1 && (
                        <span className="text-[11px] font-mono text-zinc-300 flex items-center gap-1 flex-wrap">
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
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-zinc-500" data-damage-formula>
                      <DamageFormula def={def} components={damage} />
                    </div>
                    {isCritical && (
                      <div
                        className={`mt-1 flex items-center gap-1 text-[10px] font-mono ${roll.criticalConfirmed ? 'text-[#d4af37]' : 'text-amber-400'}`}
                        data-critical={roll.criticalConfirmed ? 'confirmed' : 'possible'}
                      >
                        <Flame className="w-3 h-3" />
                        {roll.criticalConfirmed ? 'Crítico confirmado! Dano já multiplicado.' : 'Possível crítico — confirme e ajuste o dano à mão.'}
                      </div>
                    )}
                  </div>
                )}

                {(damage || roll.applied.length > 0) && (
                  <div className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center justify-between gap-2 flex-wrap" data-apply-damage>
                    <ApplyDamageButton
                      messageId={msg.id}
                      roll={roll}
                      tokens={tokens}
                      characters={characters}
                      participants={participants}
                      def={def}
                      me={me}
                      onApply={applyDamage}
                      preselectTokenIds={
                        combined
                          ? roll.targets.filter((t) => t.hit !== false).map((t) => t.tokenId) // sem alvo = [] de propósito (§9.13: "Aplicar" abre vazio)
                          : roll.targets.length > 0
                            ? roll.targets.map((t) => t.tokenId)
                            : myTargetIds
                      }
                    />
                    {roll.applied.length > 0 && (
                      <span className="text-[10px] font-mono text-zinc-500" data-applied-log>
                        Aplicado:{' '}
                        {roll.applied.map((a, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && ', '}
                            <span
                              className={a.amount < 0 ? 'text-red-400' : 'text-emerald-400'}
                              // Decomposição (§3.3): bruto/ajuste calculados pelo SERVIDOR pela
                              // resposta a dano do alvo — só num tooltip, pra não inchar a linha
                              // (cards de antes desta feature têm os dois em 0: sem tooltip).
                              title={a.adjustment !== 0 ? `Bruto ${a.raw >= 0 ? '+' : ''}${a.raw} · resistência ${a.adjustment >= 0 ? '+' : ''}${a.adjustment} · aplicado ${a.amount >= 0 ? '+' : ''}${a.amount}` : undefined}
                            >
                              {a.tokenName} {a.amount >= 0 ? '+' : '−'}
                              {Math.abs(a.amount)}
                            </span>
                            {a.multiplier && a.multiplier !== '1' && ` (${a.multiplier === '0.5' ? '½' : `×${a.multiplier}`})`}
                          </React.Fragment>
                        ))}
                      </span>
                    )}
                  </div>
                )}

                {msg.visibility !== 'all' && (() => {
                  const vis = rollModeInfo(msg.visibility);
                  const VisIcon = vis.icon;
                  return (
                    <div
                      className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center justify-between gap-2 text-[10px] font-mono"
                      data-visibility={msg.visibility}
                    >
                      <span className="flex items-center gap-1 text-[#d4af37]/80">
                        <VisIcon className="w-3 h-3" />
                        <span>{msg.visibility === 'gm' ? 'Rolagem secreta: só o GM vê' : 'Rolagem própria: só você vê'}</span>
                      </span>
                      {me.role === 'gm' && (
                        <button
                          type="button"
                          id={`reveal-${msg.id}`}
                          onClick={() => void revealMessage(msg.id)}
                          title="Tornar pública para todos"
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#2d2417] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          Revelar
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          }

          // 5. STANDARD TEXT MESSAGE - Elegant Dark
          const textWhisper = whisperLabel(msg, me, participants);
          return (
            <div
              key={msg.id}
              id={`chat-msg-${msg.id}`}
              data-whisper-to={msg.whisperTo ?? undefined}
              className={`p-2.5 rounded border ${
                textWhisper
                  ? 'bg-purple-950/20 border-purple-700/50'
                  : isMe
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
                  {textWhisper && (
                    <span className="flex items-center gap-1 text-[9px] px-1 rounded bg-purple-950/50 text-purple-300 border border-purple-700/50 font-mono lowercase">
                      <MessageCircle className="w-2.5 h-2.5" />
                      {textWhisper}
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
      {/* Quebra linha em painéis estreitos (sem overflow: o popover do modo não pode ser recortado). */}
      <div className="p-2 bg-[#121212] border-t border-[#2d2417] flex items-center justify-between flex-wrap gap-1 text-[11px]">
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-serif font-bold flex items-center gap-1">
            <Dices className="w-3 h-3 text-[#d4af37]" />
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
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wide transition-colors cursor-pointer select-none ${
              rollDamageWithAttack
                ? 'text-[#d4af37] border-[#d4af37]/60 bg-[#2d2417]/60'
                : 'text-zinc-500 border-[#3d3d3d] bg-[#1a1a1a] hover:text-zinc-300'
            }`}
          >
            <Flame className="w-3 h-3" />
            Dano junto
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
            <button
              key={sides}
              onClick={() => handleQuickDice(sides)}
              title={`Rolar 1d${sides}`}
              className="px-1.5 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] border border-[#3d3d3d] hover:border-[#d4af37]/50 font-mono text-[10px] transition-colors cursor-pointer"
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
            onKeyDown={handleInputKeyDown}
            placeholder='Mensagem, /r 2d6+3 # rótulo, /gmr (secreta), /pr (pública) ou /w <nickname> (sussurro, aspas se tiver espaço)...'
            data-roll-mode={rollMode}
            className={`w-full bg-[#1a1a1a] border rounded-md px-3 py-2 text-xs focus:outline-none text-zinc-200 placeholder:text-zinc-600 ${
              whispering ? 'border-purple-500/70 focus:border-purple-400' : nonPublic ? 'border-amber-500/70 focus:border-amber-400' : 'border-[#3d3d3d] focus:border-[#d4af37]'
            }`}
          />
          {/* Indicador discreto: sussurro ativo, modo fora de "Pública" e/ou comando de dado digitado. */}
          {(isRollCommand || nonPublic || whispering) && (
            <span
              className={`absolute right-2.5 top-2 text-[10px] font-mono pointer-events-none uppercase tracking-widest ${
                whispering ? 'text-purple-400' : nonPublic ? 'text-amber-400' : 'text-[#d4af37]'
              }`}
            >
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
          className="bg-[#2d2417] border border-[#d4af37] px-3 py-2 rounded-md text-xs text-[#d4af37] font-serif font-bold hover:bg-[#3d311f] disabled:opacity-40 disabled:hover:bg-[#2d2417] transition-colors cursor-pointer flex items-center justify-center shrink-0 shadow-sm"
          title="Enviar (Enter)"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
