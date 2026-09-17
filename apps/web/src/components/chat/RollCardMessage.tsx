import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Eye, Flame, MessageCircle } from 'lucide-react';
import {
  hitRuleTargetLabel,
  isCombinedAttackRoll,
  summarizeDiceTypes,
  type Character,
  type ChatMessage,
  type DiceRoll,
  type MacroAction,
  type Participant,
  type RollTarget,
  type SystemDefinition,
  type Token,
} from '@tormenta-vtt/shared';
import { useChat } from '../../store/chat';
import { useDiceOverlay3D } from '../../store/diceOverlay3d';
import { rollModeInfo } from '../../lib/rollMode';
import { prefersReducedMotion, type DiceAnimationMode } from '../../lib/rollPreferences';
import { ApplyDamageButton, type ApplyDamageTarget } from './ApplyDamageButton';
import { DiceIcon } from '../icons/dice/DiceIcon';
import { DamageFormula, DamageTypeBadge } from '../DamageTypeBadge';

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
function targetLineText(def: SystemDefinition | null, roll: DiceRoll, target: RollTarget): { text: string; color: string } {
  const name = target.name;
  if (target.reason === 'auto-hit') return { text: `Acertou ${name} (${roll.natural} natural)`, color: 'text-success' };
  if (target.reason === 'auto-miss') return { text: `Errou ${name} (${roll.natural} natural)`, color: 'text-danger' };
  if (target.hit === null) return { text: `→ ${name}`, color: 'text-text-muted' };
  const verb = target.hit ? 'Acertou' : 'Errou';
  if (target.targetValue === undefined) return { text: `${verb} ${name}`, color: target.hit ? 'text-success' : 'text-danger' };
  const label = def?.rolls.attackHit ? hitRuleTargetLabel(def, def.rolls.attackHit) : 'alvo';
  return { text: `${verb} ${name} (${roll.total} vs ${label} ${target.targetValue})`, color: target.hit ? 'text-success' : 'text-danger' };
}

/** true = esta rolagem termina na animação curta do PRÓPRIO cartão (modo "simples", ou modo "3D"
 *  que falhou nesta sessão — `useDiceOverlay3D().unavailable`); false = sem animação de cartão
 *  (modo desligado, `prefers-reduced-motion`, ou 3D disponível — aí quem anima é `DiceOverlay3D`). */
function isSimpleReveal(mode: DiceAnimationMode): boolean {
  if (prefersReducedMotion()) return false;
  if (mode === 'off') return false;
  if (mode === '3d') return useDiceOverlay3D.getState().unavailable;
  return true;
}

interface RollCardMessageProps {
  def: SystemDefinition | null;
  msg: ChatMessage;
  isGm: boolean;
  time: string;
  /** Rótulo de sussurro já resolvido pelo ChatTab (mesma função usada pelas outras mensagens). */
  whisperLabel: string | null;
  tokens: Token[];
  characters: Character[];
  participants: Participant[];
  me: Participant;
  myTargetIds: string[];
  animationMode: DiceAnimationMode;
  onApplyDamage: (messageId: string, targets: ApplyDamageTarget[]) => Promise<boolean>;
  onReveal: (messageId: string) => void;
  onSaveMacro: (action: MacroAction, defaultLabel: string) => void;
}

/**
 * Cartão de uma rolagem (`ChatMessage{kind:"roll", roll: DiceRoll}`) — extraído de ChatTab.tsx
 * pra hospedar o estado local da animação de revelação (docs/SPEC.md, item 3): "simples" toca um
 * `@keyframes` de ~400ms no próprio cartão (index.css: `dice-reveal-icon`/`dice-reveal-number`);
 * "3D" só ENFILEIRA o pedido em `useDiceOverlay3D` (quem anima é a camada sobre o mapa,
 * `DiceOverlay3D.tsx`) e mostra o resultado aqui na hora, sem esperar nada. A decisão de animar
 * (uma vez só) vem de `useChat().consumeRollAnimation`, que só marca mensagens NOVAS com
 * resultado (nunca o histórico hidratado, nem upserts como "aplicar dano").
 */
export const RollCardMessage: React.FC<RollCardMessageProps> = ({
  def,
  msg,
  isGm,
  time,
  whisperLabel,
  tokens,
  characters,
  participants,
  me,
  myTargetIds,
  animationMode,
  onApplyDamage,
  onReveal,
  onSaveMacro,
}) => {
  // `roll` some quando não pode ser visto (placeholder secreto) — ChatTab já filtra isso antes de
  // montar este componente, mas os Hooks abaixo precisam rodar incondicionalmente (regra dos
  // Hooks), então a checagem "sem roll" só acontece DEPOIS deles, logo antes do JSX principal.
  const roll = msg.roll;
  const consumeRollAnimation = useChat((s) => s.consumeRollAnimation);
  // "Esta mensagem estava marcada pra animar" — decisão pura (só leitura, sem consumir), segura
  // mesmo se o StrictMode do React chamar o inicializador duas vezes em dev, já que `.has()` não
  // muda nada entre as duas chamadas.
  const pendingRef = useRef(useChat.getState().pendingRollAnimations.has(msg.id));
  const [revealing, setRevealing] = useState(pendingRef.current && isSimpleReveal(animationMode));

  useEffect(() => {
    if (!roll || !pendingRef.current) return;
    // Efeito de "one-shot" sob StrictMode (dev): monta → roda o efeito → desmonta (roda a
    // limpeza) → monta esse mesmo componente de novo → roda o efeito outra vez, SÓ em
    // desenvolvimento (React testando limpeza de efeito). `claimed` só é true na primeira
    // chamada de verdade — usado pra não enfileirar a rolagem 2× no modo 3D. Já o timer da
    // animação "simples" é reagendado em toda chamada do efeito de propósito: a chamada
    // anterior sempre limpa o timer dela antes (função de cleanup abaixo), então só o ÚLTIMO
    // agendamento sobrevive — sem isso, o cleanup do StrictMode cancelava o único timer e a
    // rolagem ficava com a animação travada pra sempre (bug real, pego testando no navegador).
    const claimed = consumeRollAnimation(msg.id);
    if (prefersReducedMotion() || animationMode === 'off') return;
    if (animationMode === '3d' && !useDiceOverlay3D.getState().unavailable) {
      if (claimed) useDiceOverlay3D.getState().enqueue({ id: msg.id, groups: roll.groups });
      return;
    }
    const t = window.setTimeout(() => setRevealing(false), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!roll) return null;

  // Parcelas de dano por tipo (só rolagens de dano da ficha; rolagens antigas não têm).
  const damage = roll.damage && roll.damage.length > 0 ? roll.damage : null;
  // Crítico a partir de critThreshold (ataques com margem ampliada); padrão = 20 natural.
  const critFrom = roll.critThreshold ?? 20;
  const isCritical = roll.groups.some((g) => g.sides === 20 && g.rolls.some((r) => r >= critFrom));
  const isFumble = roll.groups.some((g) => g.sides === 20 && g.rolls.includes(1));
  // "Rolar dano junto com o ataque" (§9.13): ataque em cima (roll.total/groups são DELE) e
  // dano embaixo, num bloco à parte — não misturado no número do header como o dano avulso.
  const combined = isCombinedAttackRoll(roll);
  // Acionável (fica cartão) quando tem Aplicar (dano) ou Revelar (segredo, só o GM);
  // rolagem simples (teste, ataque sem dano, já pública) é só uma linha de log.
  const hasApply = !!damage || roll.applied.length > 0;
  const hasReveal = msg.visibility !== 'all' && isGm;
  const actionable = hasApply || hasReveal;

  return (
    <div
      key={msg.id}
      id={`chat-msg-${msg.id}`}
      data-whisper-to={msg.whisperTo ?? undefined}
      className={actionable ? 'p-3 rounded-ui border border-border bg-surface-2' : 'py-1.5 border-b border-border'}
    >
      {/* Roll Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-tight text-text">{msg.nickname}</span>
          {isGm && <span className="text-[9px] px-1.5 py-0.2 rounded-ui bg-bg/40 border border-border text-text-muted font-bold">GM</span>}
          {whisperLabel && (
            <span className="flex items-center gap-1 text-[9px] px-1 rounded-ui bg-bg/40 border border-border text-text-muted lowercase">
              <MessageCircle className="w-2.5 h-2.5" />
              {whisperLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Só rolagem SOLTA (sem ficha) vira macro "roll" — a de ficha (atributo/perícia)
              já é ao vivo pela própria ficha, sem tipo de macro equivalente (§9.20). */}
          {!roll.characterId && (
            <button
              type="button"
              onClick={() => onSaveMacro({ type: 'roll', formula: roll.formula, label: roll.label }, roll.label || 'Rolagem')}
              title="Salvar como macro"
              className="focus-ring text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <BookmarkPlus className="w-3 h-3" />
            </button>
          )}
          <span className="text-[9px] font-data tabular-nums text-text-muted">{time}</span>
        </div>
      </div>

      {/* Roll Content Layout */}
      <div
        className="flex items-center justify-between gap-3 cursor-default"
        title={revealing ? 'Clique para revelar na hora' : undefined}
        onClick={revealing ? () => setRevealing(false) : undefined}
      >
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[11px] text-text-muted italic mb-1 truncate">{roll.label ? roll.label : 'Rolagem de dados'}</span>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-data tabular-nums font-bold tracking-tight ${revealing ? 'dice-reveal-number' : ''} ${
                isCritical ? 'text-accent' : isFumble ? 'text-danger' : 'text-text'
              }`}
            >
              {roll.total}
            </span>
            {/* Dano por tipo: uma parcela = só o selo; várias = "(7 [Fogo] + 14 [Frio])".
                Combinado (§9.13) não mistura aqui: o dano tem bloco próprio, embaixo. */}
            {damage && !combined && damage.length === 1 && damage[0] && <DamageTypeBadge def={def} type={damage[0].damageType} />}
            {damage && !combined && damage.length > 1 && (
              <span className="text-[11px] font-data tabular-nums text-text flex items-center gap-1 flex-wrap" data-damage-breakdown>
                (
                {damage.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-text-muted">+</span>}
                    <span className="font-bold text-text">{d.total}</span>
                    <DamageTypeBadge def={def} type={d.damageType} />
                  </React.Fragment>
                ))}
                )
              </span>
            )}
            <span className="text-[11px] font-data tabular-nums text-text-muted">
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
            <div className="mt-1 text-[10px] font-data text-text-muted" data-damage-formula>
              <DamageFormula def={def} components={damage} />
            </div>
          )}
        </div>

        {/* Ícone do(s) dado(s) usado(s), um por tipo presente na fórmula, com a
            contagem ("3× d6"). O d20 fica dourado (crítico) ou vermelho (falha
            crítica); os demais tipos ficam neutros mesmo numa rolagem crítica. */}
        <div className={`flex items-center gap-1.5 shrink-0 ${revealing ? 'dice-reveal-icon' : ''}`}>
          {summarizeDiceTypes(roll.groups).map(({ sides, count }) => (
            <span
              key={sides}
              className={`flex items-center gap-0.5 font-data text-[10px] ${
                sides === 20 && isCritical ? 'text-accent' : sides === 20 && isFumble ? 'text-danger' : 'text-text-muted'
              }`}
            >
              <DiceIcon sides={sides} className="w-3.5 h-3.5" />
              {count}×
            </span>
          ))}
        </div>
      </div>

      {/* Sistema de alvos (docs/plano-alvos.md): uma linha por alvo do ataque. */}
      {roll.targets.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-border space-y-0.5" data-roll-targets>
          {roll.targets.map((t) => {
            const { text, color } = targetLineText(def, roll, t);
            return (
              <div key={t.tokenId} className={`text-[11px] font-data ${color}`}>
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
        <div className="mt-2 pt-1.5 border-t border-border" data-combined-damage>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-text-muted italic">Dano</span>
            <span className="text-xl font-data tabular-nums font-bold text-text">{sumDamage(damage)}</span>
            {damage.length === 1 && damage[0] && <DamageTypeBadge def={def} type={damage[0].damageType} />}
            {damage.length > 1 && (
              <span className="text-[11px] font-data tabular-nums text-text flex items-center gap-1 flex-wrap">
                (
                {damage.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-text-muted">+</span>}
                    <span className="font-bold text-text">{d.total}</span>
                    <DamageTypeBadge def={def} type={d.damageType} />
                  </React.Fragment>
                ))}
                )
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] font-data text-text-muted" data-damage-formula>
            <DamageFormula def={def} components={damage} />
          </div>
          {isCritical && (
            <div
              className={`mt-1 flex items-center gap-1 text-[10px] font-ui ${roll.criticalConfirmed ? 'text-accent' : 'text-text'}`}
              data-critical={roll.criticalConfirmed ? 'confirmed' : 'possible'}
            >
              <Flame className="w-3 h-3" />
              {roll.criticalConfirmed ? 'Crítico confirmado! Dano já multiplicado.' : 'Possível crítico — confirme e ajuste o dano à mão.'}
            </div>
          )}
        </div>
      )}

      {(damage || roll.applied.length > 0) && (
        <div className="mt-2 pt-1.5 border-t border-border flex items-center justify-between gap-2 flex-wrap" data-apply-damage>
          <ApplyDamageButton
            messageId={msg.id}
            roll={roll}
            tokens={tokens}
            characters={characters}
            participants={participants}
            def={def}
            me={me}
            onApply={onApplyDamage}
            preselectTokenIds={
              combined
                ? roll.targets.filter((t) => t.hit !== false).map((t) => t.tokenId) // sem alvo = [] de propósito (§9.13: "Aplicar" abre vazio)
                : roll.targets.length > 0
                  ? roll.targets.map((t) => t.tokenId)
                  : myTargetIds
            }
          />
          {roll.applied.length > 0 && (
            <span className="text-[10px] font-data tabular-nums text-text-muted" data-applied-log>
              Aplicado:{' '}
              {roll.applied.map((a, i) => (
                <React.Fragment key={i}>
                  {i > 0 && ', '}
                  <span
                    className={a.amount < 0 ? 'text-danger' : 'text-success'}
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

      {msg.visibility !== 'all' &&
        (() => {
          const vis = rollModeInfo(msg.visibility);
          const VisIcon = vis.icon;
          return (
            <div className="mt-2 pt-1.5 border-t border-border flex items-center justify-between gap-2 text-[10px] font-ui" data-visibility={msg.visibility}>
              <span className="flex items-center gap-1 text-text-muted">
                <VisIcon className="w-3 h-3" />
                <span>{msg.visibility === 'gm' ? 'Rolagem secreta: só o GM vê' : 'Rolagem própria: só você vê'}</span>
              </span>
              {isGm && (
                <button
                  type="button"
                  id={`reveal-${msg.id}`}
                  onClick={() => onReveal(msg.id)}
                  title="Tornar pública para todos"
                  className="focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui border border-accent text-accent hover:bg-surface-1 transition-colors cursor-pointer"
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
};
