import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Search, Swords, X } from 'lucide-react';
import {
  computeCharacter,
  isHealingType,
  suggestDamage,
  type Character,
  type DamageSuggestion,
  type DiceRoll,
  type Participant,
  type SystemDefinition,
  type Token,
} from '@tormenta-vtt/shared';

/** Um alvo a enviar em token:apply-damage. */
export interface ApplyDamageTarget {
  tokenId: string;
  amount: number;
  multiplier?: '1' | '0.5' | '2' | '0';
}

interface ApplyDamageButtonProps {
  messageId: string;
  roll: DiceRoll;
  /** Tokens da cena atual. */
  tokens: Token[];
  /** Fichas visíveis (pra achar a vinculada a cada token e calcular PV atual/máximo). */
  characters: Character[];
  participants: Participant[];
  def: SystemDefinition | null;
  me: Participant;
  onApply: (messageId: string, targets: ApplyDamageTarget[]) => Promise<boolean>;
  /**
   * Sistema de alvos (docs/plano-alvos.md §3.5): ao abrir a primeira vez, marca estes tokens (só
   * os que já apareceriam na lista desta pessoa — jogador continua vendo só os próprios) com o
   * mesmo `toggle` de sempre, então a sugestão de `damageResponses` vem de brinde. Confirmar
   * continua manual; reabrir depois não marca de novo (não sobrescreve ajustes já feitos).
   */
  preselectTokenIds: string[];
}

/** Linha da lista: token + de onde vem o PV dele (ficha vinculada ou hp próprio) e os limites. */
interface TargetRow {
  token: Token;
  current: number;
  max: number;
  ownerLabel: string;
  /**
   * Sugestão pela resposta a dano da ficha vinculada (rules/damageResponse.ts). Token solto (sem
   * ficha) não tem damageResponses: sugestão neutra (×1, sem aviso) — o servidor não muda de
   * qualquer forma, isto é só o que vem PRÉ-SELECIONADO ao marcar o alvo.
   */
  suggestion: DamageSuggestion;
}

/** ×½ "reduz à metade" arredonda pra baixo; ×0 sempre dá 0 (resistiu). */
function withMultiplier(total: number, sign: 1 | -1, mult: '1' | '0.5' | '2' | '0'): number {
  if (mult === '0') return 0;
  const magnitude = mult === '0.5' ? Math.floor(total * 0.5) : mult === '2' ? total * 2 : total;
  return sign * magnitude;
}

/**
 * Botão "Aplicar" num card de dano/cura: abre um seletor de tokens da cena (GM
 * vê todos; jogador só os que possui) com busca, multi-seleção e multiplicador
 * por alvo. Confirma → token:apply-damage. O servidor valida permissão nos
 * mesmos moldes (tudo-ou-nada); aqui só filtramos pra não oferecer o que ele ia recusar.
 */
export const ApplyDamageButton: React.FC<ApplyDamageButtonProps> = ({ messageId, roll, tokens, characters, participants, def, me, onApply, preselectTokenIds }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [multipliers, setMultipliers] = useState<Record<string, '1' | '0.5' | '2' | '0' | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  // Só a primeira abertura marca os alvos sugeridos — reabrir depois não sobrescreve ajustes já feitos.
  const didPreselectRef = useRef(false);

  const damage = roll.damage ?? [];
  const isHeal = def !== null && damage.length > 0 && isHealingType(def, damage[0]?.damageType ?? null);
  const sign: 1 | -1 = isHeal ? 1 : -1;

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

  // Alvos aplicáveis: ficha vinculada com recurso tokenBar, ou token solto com hp definido.
  // Jogador só vê os que possui (evita mostrar PV alheio que ele nem poderia mexer).
  const rows = useMemo<TargetRow[]>(() => {
    if (!def) return [];
    const out: TargetRow[] = [];
    for (const token of tokens) {
      if (me.role !== 'gm' && token.ownerId !== me.id) continue;
      let current: number;
      let max: number;
      let character: Character | undefined;
      if (token.characterId) {
        if (!def.tokenBar) continue;
        character = charById.get(token.characterId);
        if (!character) continue;
        const computed = computeCharacter(def, character);
        max = computed.resources[def.tokenBar]?.max ?? 0;
        current = character.resources[def.tokenBar]?.current ?? 0;
      } else {
        if (!token.hp) continue;
        current = token.hp.current;
        max = token.hp.max;
      }
      const ownerLabel = token.ownerId ? (participants.find((p) => p.id === token.ownerId)?.nickname ?? 'Jogador') : 'GM';
      // Token solto (sem ficha) não tem damageResponses: sugestão sempre neutra pra ele.
      const suggestion = character ? suggestDamage(def, damage, character.damageResponses) : { multiplier: '1' as const, amount: roll.total, note: '' };
      out.push({ token, current, max, ownerLabel, suggestion });
    }
    return out.sort((a, b) => a.token.name.localeCompare(b.token.name));
  }, [def, tokens, charById, participants, me, damage, roll.total]);

  const filteredRows = useMemo(
    () => (search.trim() ? rows.filter((r) => r.token.name.toLowerCase().includes(search.trim().toLowerCase())) : rows),
    [rows, search],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (damage.length === 0 || rows.length === 0) return null;

  // Pré-seleciona pela sugestão da resposta a dano (rules/damageResponse.ts) ao marcar o alvo; o
  // Mestre troca o multiplicador ou digita outro valor depois, como sempre — o servidor não muda.
  const toggle = (tokenId: string) => {
    const suggestion = rows.find((r) => r.token.id === tokenId)?.suggestion;
    setAmounts((s) => {
      if (tokenId in s) {
        const { [tokenId]: _drop, ...rest } = s;
        return rest;
      }
      return { ...s, [tokenId]: suggestion ? sign * suggestion.amount : withMultiplier(roll.total, sign, '1') };
    });
    // suggestion.multiplier null (RD, ou parcelas mistas) vira "sem botão marcado": o valor já
    // ajustado (acima) fica só no campo manual, igual a quando o Mestre digita um número à mão.
    setMultipliers((s) => ({ ...s, [tokenId]: suggestion ? (suggestion.multiplier ?? undefined) : '1' }));
  };

  const setMultiplier = (tokenId: string, mult: '1' | '0.5' | '2' | '0') => {
    setAmounts((s) => ({ ...s, [tokenId]: withMultiplier(roll.total, sign, mult) }));
    setMultipliers((s) => ({ ...s, [tokenId]: mult }));
  };

  const setManualAmount = (tokenId: string, value: number) => {
    setAmounts((s) => ({ ...s, [tokenId]: value }));
    setMultipliers((s) => ({ ...s, [tokenId]: undefined }));
  };

  const selectedCount = Object.keys(amounts).length;

  const confirm = async () => {
    const targets = Object.entries(amounts).map(([tokenId, amount]) => ({ tokenId, amount, multiplier: multipliers[tokenId] }));
    if (targets.length === 0) return;
    setSubmitting(true);
    const ok = await onApply(messageId, targets);
    setSubmitting(false);
    if (ok) {
      setOpen(false);
      setAmounts({});
      setMultipliers({});
      setSearch('');
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (didPreselectRef.current) return;
          didPreselectRef.current = true;
          for (const id of preselectTokenIds) if (rows.some((r) => r.token.id === id)) toggle(id);
        }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/40 text-[10px] font-serif font-bold cursor-pointer"
        title={isHeal ? 'Aplicar cura em tokens' : 'Aplicar dano em tokens'}
      >
        {isHeal ? <Heart className="w-3 h-3" /> : <Swords className="w-3 h-3" />}
        Aplicar
      </button>

      {open && (
        <div
          ref={ref}
          className="absolute left-0 top-full mt-1 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-800/60 bg-[#141414] shadow-[0_8px_30px_rgba(0,0,0,0.7)] text-xs"
        >
          <div className="flex items-center justify-between px-2.5 py-2 border-b border-[#2d2417]">
            <span className="font-serif font-bold text-emerald-400">{isHeal ? 'Aplicar cura' : 'Aplicar dano'}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2 border-b border-[#2d2417]">
            <div className="relative">
              <Search className="w-3 h-3 text-zinc-500 absolute left-1.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar token..."
                className="w-full bg-[#0d0d0d] border border-[#2d2417] rounded px-1.5 py-1 pl-5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {filteredRows.length === 0 && <div className="p-3 text-center text-zinc-500 text-[11px]">Nenhum token</div>}
            {filteredRows.map(({ token, current, max, ownerLabel, suggestion }) => {
              const selected = token.id in amounts;
              const amount = amounts[token.id] ?? 0;
              const mult = multipliers[token.id];
              return (
                <div key={token.id} className={`px-2.5 py-1.5 border-b border-[#1f1f1f] ${selected ? 'bg-emerald-950/20' : ''}`}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selected} onChange={() => toggle(token.id)} className="accent-emerald-600" />
                    <span className="flex-1 min-w-0 truncate text-zinc-200">{token.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {current}/{max} · {ownerLabel}
                    </span>
                  </label>
                  {suggestion.note && <div className="pl-6 -mt-0.5 text-[10px] text-amber-400">{suggestion.note}</div>}
                  {selected && (
                    <div className="flex items-center gap-1 mt-1.5 pl-5">
                      {(['1', '0.5', '2', '0'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMultiplier(token.id, m)}
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer ${
                            mult === m
                              ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
                              : 'border-zinc-700 text-zinc-400 hover:border-emerald-700'
                          }`}
                        >
                          ×{m === '0.5' ? '½' : m}
                        </button>
                      ))}
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setManualAmount(token.id, Math.trunc(Number(e.target.value) || 0))}
                        className="w-16 ml-1 bg-[#0d0d0d] border border-[#2d2417] rounded px-1 py-0.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-emerald-700"
                        title="Ajuste manual"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={selectedCount === 0 || submitting}
              className="w-full py-1.5 rounded bg-emerald-900/60 border border-emerald-600 text-emerald-300 font-serif font-bold text-[11px] hover:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? 'Aplicando…' : selectedCount > 0 ? `Confirmar (${selectedCount})` : 'Confirmar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
