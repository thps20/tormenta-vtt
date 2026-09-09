import React, { useState } from "react";
import { Heart, Minus, Plus, ScrollText, Swords, User, X } from "lucide-react";
import { signed } from "../lib/system";
import { DamageTypeBadge } from "./DamageTypeBadge";
import type { Character, ComputedCharacter, ConditionDef, SystemDefinition, Token, TokenCondition } from "@tormenta-vtt/shared";

/**
 * Contrato completo em docs/tipos-ficha-rapida.md. `onOpenTokenInspector` é um acréscimo desta
 * implementação mínima (o botão "Token" do card) — não faz parte do contrato pensado pro AI
 * Studio, que provavelmente não vai precisar de um TokenInspector separado.
 */
export interface NpcQuickCardProps {
  token: Token;
  character: Character;
  computed: ComputedCharacter;
  def: SystemDefinition;
  conditions: ConditionDef[];
  activeConditions: TokenCondition[];
  onHpChange: (delta: number) => void;
  onRoll: (ref: { itemId: string; actionId: string }) => void;
  onUseItem: (itemId: string) => void;
  onToggleCondition: (key: string) => void;
  onOpenFullSheet: () => void;
  onOpenTokenInspector: () => void;
  onClose: () => void;
}

/**
 * Ficha rápida de um NPC: abre no clique simples em token NPC do GM, no lugar do TokenInspector
 * genérico (botão "Token" leva pra ele — nome, cor, dono, imagem, apagar). Versão MÍNIMA: a UI de
 * verdade vem do AI Studio sobre o contrato de docs/tipos-ficha-rapida.md; aqui só o essencial pra
 * jogar sem abrir a ficha completa (nome/ND/tipo, PV, derivados, ataques, itens ativos, condições).
 */
export const NpcQuickCard: React.FC<NpcQuickCardProps> = ({
  token,
  character,
  computed,
  def,
  conditions,
  activeConditions,
  onHpChange,
  onRoll,
  onUseItem,
  onToggleCondition,
  onOpenFullSheet,
  onOpenTokenInspector,
  onClose,
}) => {
  const [delta, setDelta] = useState("");

  const creatures = def.creatures;
  const typeValue = creatures ? character.traits[creatures.typeField] : undefined;
  const typeLabel = creatures ? (def.traitFields.find((f) => f.key === creatures.typeField)?.options?.find((o) => o.key === typeValue)?.label ?? typeValue) : undefined;
  const nd = creatures ? character.traits[creatures.ndField] : undefined;

  const tokenBar = def.tokenBar;
  const hp = tokenBar ? character.resources[tokenBar] : undefined;
  const hpMax = tokenBar ? (computed.resources[tokenBar]?.max ?? 0) : 0;

  const attackItems = character.items.filter((i) => !i.activation && i.actions.length > 0);
  const abilityItems = character.items.filter((i) => i.activation !== null);

  const applyDelta = (n: number) => {
    if (n !== 0) onHpChange(n);
    setDelta("");
  };

  return (
    <div
      id="npc-quick-card"
      className="absolute bottom-4 right-4 z-10 w-72 max-h-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-[#141414] border border-[#2d2417] shadow-2xl text-xs"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2d2417]">
        <div className="min-w-0">
          <div className="font-serif font-bold text-[#d4af37] truncate">{token.name}</div>
          <div className="text-[10px] text-zinc-500 flex flex-wrap gap-x-1.5">
            {nd && <span>ND {nd}</span>}
            {typeLabel && <span>· {typeLabel}</span>}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Fechar">
          <X className="w-4 h-4" />
        </button>
      </div>

      {tokenBar && hp && (
        <div className="px-3 py-2 border-b border-[#2d2417] space-y-1.5">
          <div className="flex items-center gap-2">
            <Heart className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="font-mono text-zinc-100">
              {hp.current}/{hpMax}
              {hp.temp > 0 && <span className="text-emerald-400"> (+{hp.temp})</span>}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => applyDelta(-1)} className="p-0.5 rounded border border-zinc-700 text-zinc-300 hover:border-red-600 cursor-pointer" title="-1 PV">
                <Minus className="w-3 h-3" />
              </button>
              <button onClick={() => applyDelta(1)} className="p-0.5 rounded border border-zinc-700 text-zinc-300 hover:border-emerald-600 cursor-pointer" title="+1 PV">
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyDelta(Math.trunc(Number(delta) || 0))}
              placeholder="dano/cura"
              className="w-full bg-[#0d0d0d] border border-[#2d2417] rounded px-1.5 py-0.5 text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-[#d4af37]"
              title="Negativo tira PV, positivo cura"
            />
            <button
              onClick={() => applyDelta(Math.trunc(Number(delta) || 0))}
              className="px-2 py-0.5 rounded border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#2d2417] cursor-pointer shrink-0"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}

      {def.derived.length > 0 && (
        <div className="px-3 py-2 border-b border-[#2d2417] flex flex-wrap gap-x-3 gap-y-0.5">
          {def.derived.map((d) => (
            <span key={d.key} className="text-zinc-300">
              <span className="text-zinc-500">{d.abbr ?? d.label}:</span> {computed.derived[d.key] ?? 0}
            </span>
          ))}
        </div>
      )}

      {attackItems.length > 0 && (
        <div className="px-3 py-2 border-b border-[#2d2417] space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
            <Swords className="w-3 h-3" /> Ataques
          </div>
          {attackItems.map((item) =>
            item.actions.map((a) => (
              <button
                key={a.id}
                onClick={() => onRoll({ itemId: item.id, actionId: a.id })}
                className="w-full flex items-center justify-between px-1.5 py-1 rounded hover:bg-[#1e1a14] cursor-pointer text-left"
                title={`${item.name} — ${a.label}`}
              >
                <span className="text-zinc-200 truncate">{item.name}</span>
                {a.kind === "damage" ? <DamageTypeBadge def={def} type={a.damageType} /> : <span className="text-[10px] text-zinc-500">{a.label}</span>}
              </button>
            )),
          )}
        </div>
      )}

      {abilityItems.length > 0 && (
        <div className="px-3 py-2 border-b border-[#2d2417] space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
            <ScrollText className="w-3 h-3" /> Poderes e habilidades
          </div>
          {abilityItems.map((item) => (
            <button key={item.id} onClick={() => onUseItem(item.id)} className="w-full text-left px-1.5 py-1 rounded hover:bg-[#1e1a14] cursor-pointer text-zinc-200 truncate">
              {item.name}
            </button>
          ))}
        </div>
      )}

      {conditions.length > 0 && (
        <div className="px-3 py-2 border-b border-[#2d2417] flex flex-wrap gap-1">
          {conditions.map((c) => {
            const active = activeConditions.some((a) => a.key === c.key);
            return (
              <button
                key={c.key}
                onClick={() => onToggleCondition(c.key)}
                title={c.label}
                className={`w-6 h-6 flex items-center justify-center rounded border cursor-pointer [&>svg]:w-3.5 [&>svg]:h-3.5 ${
                  active ? "bg-[#2d2417] border-[#d4af37]" : "border-zinc-700 opacity-50 hover:opacity-100"
                }`}
                style={{ color: c.color }}
                dangerouslySetInnerHTML={{ __html: c.icon }}
              />
            );
          })}
        </div>
      )}

      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={onOpenTokenInspector}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 cursor-pointer"
          title="Nome, cor, dono, imagem, apagar"
        >
          <User className="w-3.5 h-3.5" /> Token
        </button>
        <button
          onClick={onOpenFullSheet}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded bg-[#d4af37] text-zinc-950 font-bold hover:bg-amber-300 cursor-pointer"
        >
          Ficha completa
        </button>
      </div>
    </div>
  );
};
