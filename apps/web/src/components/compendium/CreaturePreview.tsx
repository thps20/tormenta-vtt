import React, { useMemo } from "react";
import { Eye, EyeOff, ScrollText } from "lucide-react";
import {
  characterTiebreakBonus,
  computeCharacter,
  entryToCharacter,
  hitRuleTargetPath,
  type ComputedCharacter,
  type CompendiumCreatureEntry,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { DamageTypeBadge } from "../DamageTypeBadge";

/** Quantidade e toggle "invisível ao soltar" (controlados pela paleta: Enter solta, ver CompendiumPalette). */
export interface CreatureSpawnControls {
  count: number;
  onCountChange: (n: number) => void;
  invisible: boolean;
  onInvisibleChange: (v: boolean) => void;
}

interface CreaturePreviewProps {
  def: SystemDefinition;
  entry: CompendiumCreatureEntry;
  /** Ausente fora do contexto "map" (ex.: jogador consultando): esconde quantidade/toggle. */
  spawn?: CreatureSpawnControls;
  /** "Ver bloco completo" (§9.5): abre a ficha inteira em modo leitura, sem soltar no mapa. */
  onOpenFullSheet?: () => void;
}

/** Só entra na comparação `preview` de useMemo; um id fixo basta (não muda nada da ficha). */
const PREVIEW_ID = () => "preview";

/** Um stat da linha compacta (label vem do JSON do sistema — nunca hardcoded, regra nº 1). */
interface QuickStat {
  label: string;
  value: number;
}

/** Resolve `{kind, key}` (attr/derived/resource) contra a ficha computada — mesmo formato de
 *  `resolveTargetPlaceholder` (rules/targets.ts), só que devolve o rótulo junto. */
function statByPath(def: SystemDefinition, computed: ComputedCharacter, kind: string, key: string): QuickStat | null {
  if (kind === "derived") {
    const d = def.derived.find((x) => x.key === key);
    const v = computed.derived[key];
    return d && v !== undefined ? { label: d.label, value: v } : null;
  }
  if (kind === "attr") {
    const a = def.attributes.find((x) => x.key === key);
    const v = computed.attributes[key];
    return a && v !== undefined ? { label: a.label, value: v } : null;
  }
  if (kind === "resource") {
    const r = def.resources.find((x) => x.key === key);
    const v = computed.resources[key]?.max;
    return r && v !== undefined ? { label: r.label, value: v } : null;
  }
  return null;
}

/**
 * Linha compacta: PV (via `tokenBar`, o recurso que o sistema declara como barra de vida), Defesa
 * (via `rolls.attackHit`, a mesma fórmula que decide acerto — o stat do ALVO que ela referencia É a
 * defesa do sistema, qualquer que seja o nome/chave dele) e Deslocamento (via `movement.derived`).
 * Nenhuma chave concreta hardcoded — sistema sem um desses blocos simplesmente não mostra aquele
 * stat, em vez de inventar um valor.
 */
function quickStats(def: SystemDefinition, computed: ComputedCharacter): QuickStat[] {
  const stats: QuickStat[] = [];
  if (def.tokenBar) {
    const pv = statByPath(def, computed, "resource", def.tokenBar);
    if (pv) stats.push(pv);
  }
  const hitRule = def.rolls.attackHit ?? def.rolls.attackAutoHit;
  const targetPath = hitRule ? hitRuleTargetPath(hitRule) : null;
  if (targetPath) {
    const defense = statByPath(def, computed, targetPath.kind, targetPath.key);
    if (defense) stats.push(defense);
  }
  if (def.movement) {
    const movement = statByPath(def, computed, "derived", def.movement.derived);
    if (movement) stats.push(movement);
  }
  return stats;
}

/**
 * Resumo compacto de um bloco de monstro: cabeçalho (ND/tamanho/tipo), PV/Defesa/Deslocamento/
 * Iniciativa numa linha só, e ataques (um por linha: nome do item, fórmula de dano, selo do tipo).
 * Nada de atributos/perícias/CD/resistências/poderes/descrição aqui — isso é o "bloco completo"
 * (`onOpenFullSheet`, `CreatureFullSheet.tsx`), aberto pelo botão ou duplo clique na lista. Com
 * `spawn` (GM, contexto "map"): quantidade (1..20) e toggle "invisível ao soltar" no rodapé — soltar
 * em si é só Enter/Ctrl+Enter/arrastar (CompendiumPalette), sem botão aqui.
 */
export const CreaturePreview: React.FC<CreaturePreviewProps> = ({ def, entry, spawn, onOpenFullSheet }) => {
  const sheet = entry.sheet;
  const character = useMemo(() => entryToCharacter(def, entry, PREVIEW_ID).data, [def, entry]);
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const initiative = useMemo(() => characterTiebreakBonus(def, character), [def, character]);
  const stats = useMemo(() => quickStats(def, computed), [def, computed]);

  const creatures = def.creatures;
  const typeValue = creatures ? sheet.traits[creatures.typeField] : undefined;
  const typeLabel = creatures ? (def.traitFields.find((f) => f.key === creatures.typeField)?.options?.find((o) => o.key === typeValue)?.label ?? typeValue) : undefined;
  const nd = creatures ? sheet.traits[creatures.ndField] : undefined;
  const sizeLabel = def.sizes.find((s) => s.key === sheet.size)?.label;

  const attackItems = sheet.items.filter((i) => !i.activation && i.actions.length > 0);

  return (
    <div className="p-2 space-y-1.5 text-xs" id="creature-preview">
      <div>
        <div className="text-sm font-serif font-bold text-amber-200 leading-tight">{entry.name}</div>
        <div className="text-[10px] text-zinc-500 font-serif flex flex-wrap gap-x-1.5">
          {nd && <span>ND {nd}</span>}
          {sizeLabel && <span>· {sizeLabel}</span>}
          {typeLabel && <span>· {typeLabel}</span>}
        </div>
      </div>

      {/* Ordem pedida: PV, Defesa, Deslocamento (quando o sistema declara cada um) e Iniciativa por último. */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] font-serif">
        {stats.map((s) => (
          <span key={s.label} className="text-zinc-200">
            {s.value} <span className="text-zinc-500">{s.label}</span>
          </span>
        ))}
        <span className="text-zinc-200">
          {signed(initiative)} <span className="text-zinc-500">Iniciativa</span>
        </span>
      </div>

      {attackItems.length > 0 && (
        <div className="space-y-0.5">
          {attackItems.map((item) => {
            const damage = item.actions.find((a) => a.kind === "damage");
            return (
              <div key={item.name} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-zinc-200 font-serif shrink-0">{item.name}</span>
                {damage && damage.kind === "damage" && (
                  <>
                    <span className="text-zinc-400 font-mono">
                      {damage.formula}
                      {damage.bonus ? ` ${signed(damage.bonus)}` : ""}
                    </span>
                    <DamageTypeBadge def={def} type={damage.damageType} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(spawn || onOpenFullSheet) && (
        <div className="flex items-center gap-2 pt-1.5 mt-0.5 border-t border-[#2d2417]">
          {spawn && (
            <>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 font-serif">
                Qtd.
                <input
                  id="creature-spawn-count"
                  type="number"
                  min={1}
                  max={20}
                  value={spawn.count}
                  onChange={(e) => spawn.onCountChange(Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  className="w-10 bg-[#0f0e0c] border border-zinc-700 rounded px-1 py-0.5 text-zinc-100 text-[11px]"
                />
              </label>
              <button
                id="creature-spawn-invisible"
                onClick={() => spawn.onInvisibleChange(!spawn.invisible)}
                title="Invisível ao soltar (só o GM vê até revelar)"
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-serif cursor-pointer transition-colors ${
                  spawn.invisible ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37]" : "bg-[#0f0e0c] border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                {spawn.invisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                Invisível
              </button>
            </>
          )}
          {onOpenFullSheet && (
            <button
              id="creature-open-full-sheet"
              onClick={onOpenFullSheet}
              title="Ver bloco completo (duplo clique na lista faz o mesmo)"
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-[#d4af37] hover:text-[#d4af37] text-[10px] font-serif cursor-pointer transition-colors"
            >
              <ScrollText className="w-3 h-3" />
              Ver bloco completo
            </button>
          )}
        </div>
      )}
    </div>
  );
};
