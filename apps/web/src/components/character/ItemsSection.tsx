import React, { useEffect, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle, ChevronDown, ChevronUp, Circle, Dices, Plus, Trash2, Zap } from "lucide-react";
import {
  buildCharacterRoll,
  createDefaultItem,
  describeActivation,
  DiceTermSchema,
  effectiveCost,
  enhancementEffect,
  isPassiveItem,
  pendingChoices,
  RollBuildError,
  saveDcFor,
  saveSkills,
  type Action,
  type Activation,
  type Character,
  type CharacterItem,
  type CharacterPatch,
  type CharacterRollRequest,
  type ComputedCharacter,
  type BuiltRoll,
  type EnhancementEffect,
  type EnhancementEffectKind,
  type EnhancementUse,
  type ItemFieldDef,
  type ItemKindDef,
  type Save,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { PALETTE_SHORTCUT_LABEL, seeBook } from "../../lib/compendium";
import { describeEffect, effectForKind, effectKindOptions } from "../../lib/enhancements";
import { newId } from "../../lib/ids";
import { useCompendium } from "../../store/compendium";
import { kindIcon } from "./kindIcons";
import { EnhancementPicker } from "./EnhancementPicker";
import { DamageFormula, EffectDamageType } from "../DamageTypeBadge";
import { NumInput, Select, TextArea, TextInput, ghostBtn, smallBtn } from "./fields";
import { AttributeBonusesEditor, AttributeChoiceField, SizeField, SkillGrantsField, summarizeField } from "./StructuredFields";

interface ItemsSectionProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  canEdit: boolean;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
  /** Usa um item ativo (custo + card no chat); `enhancements` = aprimoramentos escolhidos no popover. */
  onUseItem: (itemId: string, enhancements: EnhancementUse[]) => void;
  /** Aba (tipo de item) ativa; fica no drawer para o atalho da paleta abrir já filtrado. */
  activeTab: string;
  onActiveTabChange: (kind: string) => void;
}

/** Tipos de campo com efeito na ficha (têm editor próprio e podem pedir escolha). */
const STRUCTURED: ItemFieldDef["type"][] = ["attributeBonuses", "attributeChoice", "skillGrants", "size"];
const hasChoice = (f: ItemFieldDef) => f.type === "attributeChoice" || f.type === "skillGrants";

const ACTION_KINDS: { kind: Action["kind"]; label: string }[] = [
  { kind: "attack", label: "Ataque" },
  { kind: "damage", label: "Dano" },
  { kind: "check", label: "Teste" },
  { kind: "formula", label: "Fórmula" },
];

/** Ação nova de cada tipo, com defaults vindos do sistema (primeira perícia de ataque etc.). */
function newAction(def: SystemDefinition, kind: Action["kind"]): Action {
  const id = newId();
  const attackSkill = def.attackSkills[0] ?? def.skills[0]?.key ?? "skill";
  switch (kind) {
    case "attack":
      return { id, label: "Ataque", kind, skill: attackSkill, attributeOverride: null, bonus: 0, critRange: 20, critMult: 2 };
    case "damage":
      return { id, label: "Dano", kind, formula: "1d6", attribute: "auto", damageType: def.damageTypes[0]?.key ?? null, bonus: 0 };
    case "check":
      return { id, label: "Teste", kind, skill: def.skills[0]?.key ?? "skill", bonus: 0 };
    case "formula":
      return { id, label: "Fórmula", kind, formula: "1d20", damageType: null };
  }
}

/** Rolagem que o servidor montaria para esta ação (fórmula e parcelas de dano), só para mostrar no botão. */
function previewRoll(def: SystemDefinition, character: Character, itemId: string, actionId: string): BuiltRoll | null {
  try {
    return buildCharacterRoll(def, character, { type: "action", itemId, actionId });
  } catch (err) {
    if (err instanceof RollBuildError) return null;
    throw err;
  }
}

const optionLabel = (options: { key: string; label: string }[] | undefined, key: string) => options?.find((o) => o.key === key)?.label ?? key;

/**
 * Itens da ficha em abas por tipo (itemKinds[] do sistema). Os campos, stats de
 * equipamento e enumerações de ativação vêm todos do JSON, nunca do código.
 */
export const ItemsSection: React.FC<ItemsSectionProps> = ({ def, character, computed, canEdit, isEditMode, onPatch, onRoll, onUseItem, activeTab, onActiveTabChange: setActiveTab }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const openCompendium = useCompendium((s) => s.open);
  const lastInserted = useCompendium((s) => s.lastInserted);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Item inserido do compêndio: vai para a aba dele, rola até ele e destaca por um instante.
  useEffect(() => {
    if (!lastInserted) return;
    setActiveTab(lastInserted.kind);
    setHighlightId(lastInserted.itemId);
    const raf = requestAnimationFrame(() => document.getElementById(`item-${lastInserted.itemId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [lastInserted, setActiveTab]);

  const items = character.items;
  const setItems = (next: CharacterItem[]) => onPatch({ items: next });
  /** `extra` permite mudar outra parte da ficha no mesmo patch (ex.: tamanho da raça). */
  const patchItem = (id: string, p: Partial<CharacterItem>, extra: Omit<CharacterPatch, "items"> = {}) =>
    onPatch({ ...extra, items: items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  const currentKind = def.itemKinds.find((k) => k.key === activeTab);
  const itemsOfKind = items.filter((i) => i.kind === activeTab);
  const atLimit = currentKind?.maxCount !== undefined && itemsOfKind.length >= currentKind.maxCount;

  const addItem = () => {
    if (!currentKind) return;
    const item = createDefaultItem(def, currentKind.key, newId());
    setItems([...items, item]);
    setExpanded((prev) => ({ ...prev, [item.id]: true }));
  };

  if (def.itemKinds.length === 0) return null;

  return (
    <div className="p-4 bg-[#111] border-b border-[#2d2417]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Equipamentos e habilidades</h3>
        {isEditMode && currentKind && (
          <div className="flex items-center gap-2 flex-wrap">
            {atLimit ? (
              <span className="text-[11px] text-zinc-500 font-serif">
                {currentKind.maxCount === 1 ? `Só 1 ${currentKind.label} por ficha` : `No máximo ${currentKind.maxCount} por ficha`}
              </span>
            ) : (
              <button onClick={addItem} className={smallBtn} id="btn-add-item">
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar {currentKind.label}</span>
              </button>
            )}
            <button onClick={() => openCompendium(currentKind.key)} className={smallBtn} id="btn-open-compendium" title={`Inserir do compêndio (${PALETTE_SHORTCUT_LABEL})`}>
              <BookOpen className="w-3.5 h-3.5" />
              <span>Do compêndio</span>
            </button>
          </div>
        )}
      </div>

      {/* Abas por tipo de item */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1.5 border-b border-[#242018] mb-3">
        {def.itemKinds.map((kind, index) => {
          const Icon = kindIcon(index);
          const count = items.filter((i) => i.kind === kind.key).length;
          const isActive = activeTab === kind.key;
          return (
            <button
              key={kind.key}
              id={`item-tab-${kind.key}`}
              onClick={() => setActiveTab(kind.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-serif font-bold transition-all shrink-0 cursor-pointer ${
                isActive ? "bg-[#1e1a14] text-[#d4af37] border-b-2 border-[#d4af37]" : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181818]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{kind.label}</span>
              <span className="text-[10px] font-mono px-1 rounded bg-[#101010] text-zinc-400">{count}</span>
            </button>
          );
        })}
      </div>

      {itemsOfKind.length === 0 ? (
        <div className="py-6 text-center text-zinc-500 font-serif text-xs border border-dashed border-[#26221c] rounded">
          Nenhum item em "{currentKind?.label}".{isEditMode && " Clique no botão acima para adicionar."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {itemsOfKind.map((item) => (
            <ItemCard
              key={item.id}
              def={def}
              character={character}
              computed={computed}
              kind={currentKind}
              item={item}
              canEdit={canEdit}
              isEditMode={isEditMode}
              expanded={expanded[item.id] ?? false}
              highlighted={highlightId === item.id}
              onToggle={() => toggleExpand(item.id)}
              onPatch={(p, extra) => patchItem(item.id, p, extra)}
              onRemove={() => setItems(items.filter((i) => i.id !== item.id))}
              onRoll={(actionId) => onRoll({ type: "action", itemId: item.id, actionId })}
              onUse={(enhancements) => onUseItem(item.id, enhancements)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Cartão de item ----------------------------------------------------------

interface ItemCardProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  kind: ItemKindDef | undefined;
  item: CharacterItem;
  canEdit: boolean;
  isEditMode: boolean;
  expanded: boolean;
  /** Destaque breve (item recém-inserido do compêndio). */
  highlighted: boolean;
  onToggle: () => void;
  /** `extra` = outras partes da ficha a mudar no mesmo patch (tamanho vindo da raça). */
  onPatch: (p: Partial<CharacterItem>, extra?: Omit<CharacterPatch, "items">) => void;
  onRemove: () => void;
  onRoll: (actionId: string) => void;
  onUse: (enhancements: EnhancementUse[]) => void;
}

const ItemCard: React.FC<ItemCardProps> = ({ def, character, computed, kind, item, canEdit, isEditMode, expanded, highlighted, onToggle, onPatch, onRemove, onRoll, onUse }) => {
  const physical = kind?.physical ?? true;
  const canRoll = canEdit && !isEditMode;
  // Escolhas (atributos flexíveis, perícias da classe) ficam visíveis fora do modo edição.
  const choiceFields = kind?.fields.filter(hasChoice) ?? [];
  const pending = pendingChoices(def, item);
  const missing = pending.reduce((acc, p) => acc + p.missing, 0);
  const setField = (key: string, value: CharacterItem["fields"][string]) => onPatch({ fields: { ...item.fields, [key]: value } });

  // Ativação: só tipos com bloco de ativação e item não passivo ganham o botão "Usar".
  // Custo efetivo (com modificadores) e recurso disponível vêm do sistema, não do código.
  const passive = isPassiveItem(def, item);
  const usable = (kind?.hasActivation ?? false) && !passive;
  const cost = usable ? effectiveCost(def, character, item) : 0;
  const costResource = def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
  const available = costResource ? (character.resources[costResource.key]?.current ?? 0) + (character.resources[costResource.key]?.temp ?? 0) : 0;
  const insufficient = cost > 0 && costResource !== undefined && available < cost;
  const saveDc = !passive && item.save ? saveDcFor(def, computed, character, item) : null;
  // Com aprimoramentos (e sistema com a fórmula), o botão abre o popover de escolha; senão usa direto.
  const hasEnhancements = usable && item.enhancements.length > 0 && def.activation.enhancementCost !== undefined;
  const [pickerOpen, setPickerOpen] = useState(false);
  const use = (enhancements: EnhancementUse[]) => {
    setPickerOpen(false);
    onUse(enhancements);
  };

  return (
    <div id={`item-${item.id}`} className={`bg-[#161513] border rounded-lg transition-all ${item.equipped ? "border-[#d4af37]/60 shadow-[0_0_8px_rgba(212,175,55,0.1)]" : "border-[#292319]"} ${highlighted ? "item-flash" : ""}`}>
      <div className="p-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {physical && (
            <button
              onClick={() => onPatch({ equipped: !item.equipped })}
              disabled={!canEdit}
              className={`mt-0.5 p-0.5 rounded transition-colors cursor-pointer disabled:cursor-default ${item.equipped ? "text-[#d4af37] hover:text-amber-300" : "text-zinc-600 hover:text-zinc-400"}`}
              title={item.equipped ? "Equipado (clique para desequipar)" : "Não equipado (clique para equipar)"}
            >
              {item.equipped ? <CheckCircle className="w-4 h-4 fill-[#d4af37]/20" /> : <Circle className="w-4 h-4" />}
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isEditMode ? (
                <TextInput value={item.name} onCommit={(name) => name.trim() && onPatch({ name: name.trim() })} className="text-sm font-serif font-bold text-amber-200 w-56" maxLength={80} />
              ) : (
                <h4 className="text-sm font-serif font-bold text-zinc-100 truncate">{item.name}</h4>
              )}
              {physical && item.quantity !== 1 && <span className="text-[10px] bg-[#222] border border-zinc-700 px-1.5 py-0.5 rounded font-mono text-zinc-300">×{item.quantity}</span>}
              {item.equipped && <span className="text-[9px] uppercase tracking-wider bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40 px-1.5 rounded font-serif font-bold">Equipado</span>}
            </div>

            {/* Resumo: campos do tipo e stats de equipamento, com os rótulos do sistema */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-zinc-400 font-serif">
              {kind?.fields.map((f) => {
                const v = item.fields[f.key];
                if (v === undefined || v === "" || v === false) return null;
                const text = STRUCTURED.includes(f.type) ? summarizeField(def, f, v) : f.type === "enum" ? optionLabel(f.options, String(v)) : f.type === "boolean" ? "sim" : String(v);
                if (text === null) return null;
                return (
                  <span key={f.key} className="bg-[#1f1d19] border border-[#332b20] px-1.5 py-0.5 rounded text-zinc-300">
                    <span className="text-zinc-500">{f.label}:</span> {text}
                  </span>
                );
              })}
              {missing > 0 && (
                <span className="flex items-center gap-1 bg-amber-950/40 border border-amber-700/60 px-1.5 py-0.5 rounded text-amber-300 font-bold" title={pending.map((p) => `${p.label}: faltam ${p.missing}`).join("; ")}>
                  <AlertCircle className="w-3 h-3" /> {missing === 1 ? "falta 1 escolha" : `faltam ${missing} escolhas`}
                </span>
              )}
              {Object.entries(item.statBonuses).map(([statKey, value]) => (
                <span key={statKey} className="bg-[#241f17] border border-amber-900/50 px-1.5 py-0.5 rounded text-amber-300 font-mono font-bold">
                  {def.equipStats.find((s) => s.key === statKey)?.label ?? statKey}: {value >= 0 ? `+${value}` : value}
                </span>
              ))}
              {usable && cost > 0 && (
                <span className="bg-[#14202a] border border-sky-900/60 px-1.5 py-0.5 rounded text-sky-300 font-mono font-bold" title={cost !== item.activation?.cost ? `Custo base ${item.activation?.cost}, com modificadores ${cost}` : undefined}>
                  {cost} {costResource?.abbr ?? ""}
                </span>
              )}
              {passive && (kind?.hasActivation ?? false) && <span className="bg-[#1a1a1a] border border-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">Passivo</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isEditMode && (
            <button onClick={onRemove} className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer" title="Remover item">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={onToggle} className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#202020] transition-colors cursor-pointer" title={expanded ? "Recolher" : isEditMode ? "Editar detalhes" : "Ver detalhes"}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Botão de uso (poder/magia) + rolagens das ações, com a fórmula que o servidor vai usar */}
      {!isEditMode && (usable || item.actions.length > 0) && (
        <div className="px-3 pb-2.5 flex items-center gap-2 flex-wrap">
          {usable && (
            <div className="relative">
              <button
                onClick={() => (hasEnhancements ? setPickerOpen((v) => !v) : use([]))}
                disabled={!canRoll}
                id={`btn-use-item-${item.id}`}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-serif font-bold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  insufficient
                    ? "bg-red-950/40 hover:bg-red-950/60 border-red-800/70 hover:border-red-500 text-red-200"
                    : "bg-[#14202a] hover:bg-[#1b2c3a] border-sky-700/60 hover:border-sky-400 text-sky-100"
                }`}
                title={
                  insufficient
                    ? `${costResource?.abbr ?? "Recurso"} insuficiente: precisa de ${cost}, tem ${available}`
                    : cost > 0
                      ? `${kind?.useLabel ?? "Usar"} (custa ${cost} ${costResource?.abbr ?? ""})`
                      : kind?.useLabel ?? "Usar"
                }
              >
                <Zap className={`w-3.5 h-3.5 ${insufficient ? "text-red-400" : "text-sky-300"}`} />
                <span>{kind?.useLabel ?? "Usar"}</span>
                {cost > 0 && <span className="font-mono ml-0.5">({cost} {costResource?.abbr ?? ""})</span>}
                {hasEnhancements && <ChevronDown className="w-3 h-3 opacity-70" />}
              </button>
              {pickerOpen && hasEnhancements && (
                <EnhancementPicker def={def} character={character} item={item} useLabel={kind?.useLabel ?? "Usar"} onCast={use} onClose={() => setPickerOpen(false)} />
              )}
            </div>
          )}
          {item.actions.map((act) => {
            const built = previewRoll(def, character, item.id, act.id);
            return (
              <button
                key={act.id}
                onClick={() => onRoll(act.id)}
                disabled={!canRoll}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#221c14] hover:bg-[#33281b] border border-[#d4af37]/50 hover:border-[#d4af37] text-amber-100 text-xs font-serif font-semibold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title={built ? `Rolar ${act.label}: ${built.formula}` : `Rolar ${act.label}`}
              >
                <Dices className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>{act.label}</span>
                {/* Dano: cada parcela com o selo do tipo ("6d6 + 1 [Fogo]"); demais ações só a fórmula. */}
                {built && (
                  <span className={`font-mono font-bold ml-0.5 ${act.kind === "attack" ? "text-emerald-400" : "text-amber-300"}`}>
                    ({built.damage ? <DamageFormula def={def} components={built.damage} /> : built.formula})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Escolhas do item (fora do modo edição): chips que o dono marca sem "editar a ficha". */}
      {!isEditMode && choiceFields.length > 0 && (
        <div className="px-3 pb-2.5 space-y-1.5">
          {choiceFields.map((f) =>
            f.type === "attributeChoice" ? (
              <AttributeChoiceField key={f.key} def={def} value={item.fields[f.key]} canChoose={canEdit} isEditMode={false} onChange={(v) => setField(f.key, v)} />
            ) : (
              <SkillGrantsField key={f.key} def={def} value={item.fields[f.key]} canChoose={canEdit} isEditMode={false} onChange={(v) => setField(f.key, v)} />
            ),
          )}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-[#231e17] text-xs space-y-2 bg-[#12110f]/50">
          {isEditMode ? (
            <ItemEditor def={def} character={character} kind={kind} item={item} onPatch={onPatch} />
          ) : (
            <>
              {/* Passivo: só a descrição. Ativo: bloco de ativação + resistência com a CD calculada. */}
              {!passive && item.activation && <ActivationView def={def} activation={item.activation} />}
              {!passive && item.enhancements.length > 0 && <EnhancementsView def={def} abbr={costResource?.abbr ?? ""} enhancements={item.enhancements} />}
              {!passive && item.save && (
                <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-2 flex-wrap">
                  <span>
                    Resistência: <span className="text-zinc-200">{def.skills.find((s) => s.key === item.save?.skill)?.label ?? item.save.skill}</span>
                  </span>
                  {saveDc !== null && <span className="px-1.5 py-0.5 rounded bg-[#2d2417] border border-[#d4af37]/40 text-[#d4af37] font-bold">CD {saveDc}</span>}
                  {item.save.text && <span className="text-zinc-500 font-serif">— {item.save.text}</span>}
                </div>
              )}
              {item.description ? (
                <div className="text-zinc-400 font-serif leading-relaxed italic whitespace-pre-line">{item.description}</div>
              ) : (
                <div className="text-zinc-600 italic">{seeBook(item.page)}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// --- Ativação (poderes, magias, consumíveis) --------------------------------

/** Lista dos aprimoramentos do item (fora do modo edição). "×" marca os repetíveis. */
const EnhancementsView: React.FC<{ def: SystemDefinition; abbr: string; enhancements: CharacterItem["enhancements"] }> = ({ def, abbr, enhancements }) => (
  <ul className="p-2 rounded bg-[#181613] border border-[#2d261c] space-y-0.5 text-[11px]">
    {enhancements.map((e) => (
      <li key={e.id} className="flex gap-1.5">
        <span className="font-mono font-bold text-sky-300 shrink-0" title={e.repeatable ? "Pode ser aplicado mais de uma vez" : undefined}>
          +{e.cost} {abbr}
          {e.repeatable ? " ×" : ""}
        </span>
        {describeEffect(def, e) && <span className="shrink-0 px-1 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 font-mono text-[10px]">{describeEffect(def, e)}</span>}
        <EffectDamageType def={def} effect={enhancementEffect(e)} />
        <span className="text-zinc-300 font-serif">{e.label || <span className="text-zinc-600 italic">sem texto</span>}</span>
      </li>
    ))}
  </ul>
);

const ActivationView: React.FC<{ def: SystemDefinition; activation: Activation }> = ({ def, activation }) => {
  const a = activation;
  const d = describeActivation(def, a);
  const parts: string[] = [];
  if (d.execution) parts.push(`Execução: ${d.execution}`);
  if (d.duration) parts.push(`Duração: ${d.duration}`);
  if (d.range) parts.push(`Alcance: ${d.range}`);
  if (a.target) parts.push(`Alvo: ${a.target}`);
  if (a.area) parts.push(`Área: ${a.area}`);
  return (
    <div className="p-2 rounded bg-[#181613] border border-[#2d261c] text-zinc-300 space-y-1">
      <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400 flex-wrap">
        {a.cost > 0 && <span className="text-sky-300 font-bold" title="Antes de modificadores; o botão mostra o custo efetivo">Custo base: {a.cost}</span>}
        {parts.map((p) => (
          <span key={p}>{p}</span>
        ))}
      </div>
      {a.effect && (
        <div className="text-amber-200/90 font-serif">
          <strong>Efeito:</strong> {a.effect}
        </div>
      )}
    </div>
  );
};

// --- Editor (modo edição) ----------------------------------------------------

interface ItemEditorProps {
  def: SystemDefinition;
  character: Character;
  kind: ItemKindDef | undefined;
  item: CharacterItem;
  onPatch: (p: Partial<CharacterItem>, extra?: Omit<CharacterPatch, "items">) => void;
}

const ItemEditor: React.FC<ItemEditorProps> = ({ def, character, kind, item, onPatch }) => {
  const physical = kind?.physical ?? true;
  const scalarFields = kind?.fields.filter((f) => !STRUCTURED.includes(f.type)) ?? [];
  const structuredFields = kind?.fields.filter((f) => STRUCTURED.includes(f.type)) ?? [];
  const setField = (key: string, value: CharacterItem["fields"][string], extra?: Omit<CharacterPatch, "items">) => onPatch({ fields: { ...item.fields, [key]: value } }, extra);
  // Resistência: perícias vêm da tag do sistema; atributo null = o de conjuração da ficha.
  const saveSkillOptions = saveSkills(def).map((s) => ({ value: s.key, label: s.label }));
  const spellcastingAbbr = def.attributes.find((a) => a.key === character.spellcastingAttribute)?.abbr;
  const patchSave = (p: Partial<Save>) => {
    const base: Save = item.save ?? { skill: saveSkillOptions[0]?.value ?? "", attribute: null, bonus: 0, text: "" };
    onPatch({ save: { ...base, ...p } });
  };
  const patchAction = (id: string, p: Partial<Action>) => onPatch({ actions: item.actions.map((a) => (a.id === id ? ({ ...a, ...p } as Action) : a)) });
  const patchEnhancement = (id: string, p: Partial<CharacterItem["enhancements"][number]>) =>
    onPatch({ enhancements: item.enhancements.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const costAbbr = def.activation.resource ? (def.resources.find((r) => r.key === def.activation.resource)?.abbr ?? "") : "";
  const patchActivation = (p: Partial<Activation>) => {
    const base: Activation = item.activation ?? { cost: 0, execution: "", duration: { units: "", value: 0 }, range: { units: "", value: 0 }, target: "", area: "", effect: "" };
    onPatch({ activation: { ...base, ...p } });
  };
  const withEmpty = (options: { key: string; label: string }[]) => [{ value: "", label: "—" }, ...options.map((o) => ({ value: o.key, label: o.label }))];

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        {physical && (
          <>
            <label className="flex items-center gap-1 text-zinc-400">
              Qtd.
              <NumInput value={item.quantity} onCommit={(v) => onPatch({ quantity: Math.max(0, Math.floor(v ?? 0)) })} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Espaços
              <NumInput value={item.slots} onCommit={(v) => onPatch({ slots: Math.max(0, v ?? 0) })} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Preço
              <NumInput value={item.price} onCommit={(v) => onPatch({ price: Math.max(0, v ?? 0) })} className="w-16" />
            </label>
          </>
        )}
        {scalarFields.map((f) => (
          <label key={f.key} className="flex items-center gap-1 text-zinc-400">
            {f.label}
            {f.type === "enum" ? (
              <Select value={String(item.fields[f.key] ?? "")} onChange={(v) => onPatch({ fields: { ...item.fields, [f.key]: v } })} options={(f.options ?? []).map((o) => ({ value: o.key, label: o.label }))} />
            ) : f.type === "number" ? (
              <NumInput value={Number(item.fields[f.key] ?? 0)} onCommit={(v) => onPatch({ fields: { ...item.fields, [f.key]: v ?? 0 } })} />
            ) : f.type === "boolean" ? (
              <input type="checkbox" checked={Boolean(item.fields[f.key])} onChange={(e) => onPatch({ fields: { ...item.fields, [f.key]: e.target.checked } })} className="accent-[#d4af37]" />
            ) : (
              <TextInput value={String(item.fields[f.key] ?? "")} onCommit={(v) => onPatch({ fields: { ...item.fields, [f.key]: v } })} className="w-40" maxLength={500} />
            )}
          </label>
        ))}
      </div>

      {/* Campos com efeito na ficha: o que o item concede (bônus, escolhas, tamanho). */}
      {structuredFields.map((f) => (
        <div key={f.key} className="p-2 rounded bg-[#181613] border border-[#2d261c] space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">{f.label}:</span>
            {f.type === "attributeBonuses" && <AttributeBonusesEditor def={def} value={item.fields[f.key]} onChange={(v) => setField(f.key, v)} />}
            {f.type === "size" && <SizeField def={def} value={item.fields[f.key]} onChange={(size) => setField(f.key, size, { size })} />}
          </div>
          {f.type === "attributeChoice" && <AttributeChoiceField def={def} value={item.fields[f.key]} canChoose isEditMode onChange={(v) => setField(f.key, v)} />}
          {f.type === "skillGrants" && <SkillGrantsField def={def} value={item.fields[f.key]} canChoose isEditMode onChange={(v) => setField(f.key, v)} />}
        </div>
      ))}

      {kind && kind.statBonuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Quando equipado:</span>
          {kind.statBonuses.map((statKey) => {
            const stat = def.equipStats.find((s) => s.key === statKey);
            return (
              <label key={statKey} className="flex items-center gap-1 text-zinc-400" title={`Vazio = este item não define ${stat?.label ?? statKey}`}>
                {stat?.label ?? statKey}
                <NumInput
                  value={item.statBonuses[statKey] ?? null}
                  allowEmpty
                  placeholder="—"
                  onCommit={(v) => {
                    const next = { ...item.statBonuses };
                    if (v === null) delete next[statKey];
                    else next[statKey] = v;
                    onPatch({ statBonuses: next });
                  }}
                />
              </label>
            );
          })}
        </div>
      )}

      {kind?.hasActivation && (
        <div className="p-2 rounded bg-[#181613] border border-[#2d261c] space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">Ativação:</span>
            <label className="flex items-center gap-1 text-zinc-400">
              Custo <NumInput value={item.activation?.cost ?? 0} onCommit={(v) => patchActivation({ cost: Math.max(0, Math.floor(v ?? 0)) })} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Execução <Select value={item.activation?.execution ?? ""} onChange={(v) => patchActivation({ execution: v })} options={withEmpty(def.activation.executions)} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Duração
              <NumInput value={item.activation?.duration.value ?? 0} onCommit={(v) => patchActivation({ duration: { units: item.activation?.duration.units ?? "", value: Math.max(0, v ?? 0) } })} className="w-10" />
              <Select value={item.activation?.duration.units ?? ""} onChange={(v) => patchActivation({ duration: { units: v, value: item.activation?.duration.value ?? 0 } })} options={withEmpty(def.activation.durationUnits)} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Alcance
              <NumInput value={item.activation?.range.value ?? 0} onCommit={(v) => patchActivation({ range: { units: item.activation?.range.units ?? "", value: Math.max(0, v ?? 0) } })} className="w-10" />
              <Select value={item.activation?.range.units ?? ""} onChange={(v) => patchActivation({ range: { units: v, value: item.activation?.range.value ?? 0 } })} options={withEmpty(def.activation.rangeUnits)} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-zinc-400">
              Alvo <TextInput value={item.activation?.target ?? ""} onCommit={(v) => patchActivation({ target: v })} className="w-40" maxLength={200} />
            </label>
            <label className="flex items-center gap-1 text-zinc-400">
              Área <TextInput value={item.activation?.area ?? ""} onCommit={(v) => patchActivation({ area: v })} className="w-40" maxLength={200} />
            </label>
          </div>
          <TextArea value={item.activation?.effect ?? ""} onCommit={(v) => patchActivation({ effect: v })} placeholder="Efeito" rows={2} />
        </div>
      )}

      {/* Aprimoramentos: só quando o sistema define a fórmula do custo total (activation.enhancementCost). */}
      {kind?.hasActivation && def.activation.enhancementCost !== undefined && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">Aprimoramentos</span>
            <button
              onClick={() => onPatch({ enhancements: [...item.enhancements, { id: newId(), label: "", cost: 1, repeatable: false }] })}
              className={ghostBtn}
              id={`btn-add-enhancement-${item.id}`}
              title="Opção paga a mais ao usar (ex.: +2 PM: aumenta o dano em +1d6)"
            >
              <Plus className="w-3 h-3" /> aprimoramento
            </button>
          </div>
          {item.enhancements.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-sky-900/60" data-enhancement-row={e.id}>
              <label className="flex items-center gap-1 text-zinc-400">
                +<NumInput value={e.cost} onCommit={(v) => patchEnhancement(e.id, { cost: Math.max(0, Math.floor(v ?? 0)) })} title="Custo extra" />
                {costAbbr}
              </label>
              <TextInput value={e.label} onCommit={(label) => patchEnhancement(e.id, { label: label.trim() })} placeholder="Texto do aprimoramento" className="flex-1 min-w-40" maxLength={1000} />
              <label className="flex items-center gap-1 text-zinc-400 cursor-pointer" title="Pode ser aplicado mais de uma vez (o custo multiplica)">
                <input type="checkbox" checked={e.repeatable} onChange={(ev) => patchEnhancement(e.id, { repeatable: ev.target.checked })} className="accent-sky-500" />
                repetível
              </label>
              {/* Efeito mecânico: o importador só preenche por padrão estrito; o jogador completa aqui. */}
              <EnhancementEffectEditor def={def} effect={enhancementEffect(e)} onChange={(effect) => patchEnhancement(e.id, { effect })} />
              <button onClick={() => onPatch({ enhancements: item.enhancements.filter((x) => x.id !== e.id) })} className="p-1 rounded text-zinc-500 hover:text-red-400 cursor-pointer" title="Remover aprimoramento">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {kind?.hasSave && (
        <div className="p-2 rounded bg-[#181613] border border-[#2d261c] space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">Resistência:</span>
            {item.save ? (
              <>
                <Select value={item.save.skill} onChange={(skill) => patchSave({ skill })} options={saveSkillOptions} title="Perícia do teste de resistência" />
                <Select
                  value={item.save.attribute ?? ""}
                  onChange={(v) => patchSave({ attribute: v || null })}
                  options={[
                    { value: "", label: `padrão: ${def.activation.spellcastingLabel.toLowerCase()}${spellcastingAbbr ? ` (${spellcastingAbbr})` : ""}` },
                    ...def.attributes.map((a) => ({ value: a.key, label: a.abbr })),
                  ]}
                  title="Atributo que entra na CD (vazio = o de conjuração da ficha)"
                />
                <label className="flex items-center gap-1 text-zinc-400">
                  bônus <NumInput value={item.save.bonus} onCommit={(v) => patchSave({ bonus: Math.round(v ?? 0) })} title="Bônus fixo na CD" />
                </label>
                <button onClick={() => onPatch({ save: null })} className={ghostBtn} title="Este item não exige teste de resistência">
                  <Trash2 className="w-3 h-3" /> sem resistência
                </button>
              </>
            ) : (
              <button onClick={() => patchSave({})} className={ghostBtn} id={`btn-add-save-${item.id}`}>
                <Plus className="w-3 h-3" /> exige teste de resistência
              </button>
            )}
          </div>
          {item.save && <TextInput value={item.save.text} onCommit={(text) => patchSave({ text })} placeholder="Efeito em caso de falha/sucesso (ex.: metade do dano)" className="w-full" maxLength={500} />}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Ações</span>
          {ACTION_KINDS.map((k) => (
            <button key={k.kind} onClick={() => onPatch({ actions: [...item.actions, newAction(def, k.kind)] })} className={ghostBtn}>
              <Plus className="w-3 h-3" /> {k.label}
            </button>
          ))}
        </div>
        {item.actions.map((a) => (
          <ActionRow key={a.id} def={def} action={a} onPatch={(p) => patchAction(a.id, p)} onRemove={() => onPatch({ actions: item.actions.filter((x) => x.id !== a.id) })} />
        ))}
      </div>

      <TextArea value={item.description} onCommit={(description) => onPatch({ description })} placeholder="Descrição" rows={2} />
    </div>
  );
};

/** Dados "XdY" validados no commit (o schema não aceita outra coisa). */
const DiceInput: React.FC<{ value: string; placeholder: string; title: string; onCommit: (dice: string) => void }> = ({ value, placeholder, title, onCommit }) => (
  <TextInput value={value} onCommit={(dice) => DiceTermSchema.safeParse(dice.trim()).success && onCommit(dice.trim())} placeholder={placeholder} className="w-16 font-mono" maxLength={10} title={title} />
);

/** Unidade (do sistema) + valor opcional, para rangeSet/durationSet ("1 Dia", "Longo (90 m)"). */
const UnitsInput: React.FC<{ units: { key: string; label: string }[]; value: { units: string; value?: number }; onChange: (v: { units: string; value?: number }) => void }> = ({ units, value, onChange }) => (
  <>
    <NumInput value={value.value ?? null} allowEmpty onCommit={(n) => onChange(n === null || n <= 0 ? { units: value.units } : { units: value.units, value: n })} placeholder="n" className="w-10" title="Valor (vazio = só a unidade)" />
    <Select value={value.units} onChange={(units) => onChange({ ...value, units })} options={units.map((u) => ({ value: u.key, label: u.label }))} title="Unidade que substitui a do item" />
  </>
);

/**
 * Tipo e valor do efeito de um aprimoramento. Cada tipo tem os campos do seu
 * schema; o select lista todos os tipos (effectKindOptions).
 */
const EnhancementEffectEditor: React.FC<{ def: SystemDefinition; effect: EnhancementEffect; onChange: (effect: EnhancementEffect | undefined) => void }> = ({ def, effect, onChange }) => (
  <label className="flex items-center gap-1 text-zinc-400" title="O que muda ao conjurar com este aprimoramento">
    efeito
    <Select value={effect.kind} onChange={(kind) => onChange(effectForKind(def, kind as EnhancementEffectKind, effect))} options={effectKindOptions(def)} />
    {effect.kind === "damageDiceAdd" && (
      <>
        <DiceInput value={effect.dice} placeholder="1d6" title="Dados somados ao dano por aplicação (ex.: 1d6)" onCommit={(dice) => onChange({ ...effect, dice })} />
        {/* Sem tipo = herda o da ação (mesma parcela); com tipo = parcela separada ("+1d6 de dano de frio"). */}
        {def.damageTypes.length > 0 && (
          <Select
            value={effect.damageType ?? ""}
            onChange={(v) => onChange(v ? { kind: "damageDiceAdd", dice: effect.dice, damageType: v } : { kind: "damageDiceAdd", dice: effect.dice })}
            options={[{ value: "", label: "tipo da ação" }, ...def.damageTypes.map((d) => ({ value: d.key, label: d.label }))]}
            title="Tipo de dano dos dados extras; 'tipo da ação' soma na mesma parcela"
          />
        )}
      </>
    )}
    {effect.kind === "damageSet" && (
      <TextInput value={effect.formula} onCommit={(formula) => formula.trim() && onChange({ kind: "damageSet", formula: formula.trim() })} placeholder="10d6" className="w-24 font-mono" maxLength={200} title="Fórmula que substitui os dados do dano" />
    )}
    {effect.kind === "healDiceAdd" && <DiceInput value={effect.dice} placeholder="1d8" title="Dados somados à cura por aplicação (ex.: 1d8)" onCommit={(dice) => onChange({ kind: "healDiceAdd", dice })} />}
    {(effect.kind === "dcAdd" || effect.kind === "attackBonusAdd") && (
      <NumInput value={effect.value} onCommit={(v) => onChange({ kind: effect.kind, value: Math.trunc(v ?? 0) })} className="w-10" title={effect.kind === "dcAdd" ? "Somado à CD por aplicação" : "Somado ao ataque por aplicação"} />
    )}
    {effect.kind === "rangeSet" && <UnitsInput units={def.activation.rangeUnits} value={effect} onChange={(v) => onChange({ kind: "rangeSet", ...v })} />}
    {effect.kind === "durationSet" && <UnitsInput units={def.activation.durationUnits} value={effect} onChange={(v) => onChange({ kind: "durationSet", ...v })} />}
    {effect.kind === "areaSet" && <TextInput value={effect.text} onCommit={(text) => onChange({ kind: "areaSet", text: text.trim() })} placeholder="esfera de 6 m de raio" className="w-40" maxLength={200} title="Área que substitui a do item" />}
    {effect.kind === "targetsAdd" && <NumInput value={effect.count} onCommit={(v) => onChange({ kind: "targetsAdd", count: Math.max(1, Math.trunc(v ?? 1)) })} className="w-10" title="Alvos a mais por aplicação" />}
    {effect.kind === "text" && <TextInput value={effect.text} onCommit={(text) => onChange({ kind: "text", text: text.trim() })} placeholder="O que muda (sem automação)" className="flex-1 min-w-40" maxLength={1000} title="Texto em destaque no card do chat; o jogador aplica à mão" />}
  </label>
);

interface ActionRowProps {
  def: SystemDefinition;
  action: Action;
  onPatch: (p: Partial<Action>) => void;
  onRemove: () => void;
}

const ActionRow: React.FC<ActionRowProps> = ({ def, action, onPatch, onRemove }) => {
  const attackSkills = (def.attackSkills.length ? def.skills.filter((s) => def.attackSkills.includes(s.key)) : def.skills).map((s) => ({ value: s.key, label: s.label }));
  const allSkills = def.skills.filter((s) => !s.variants).map((s) => ({ value: s.key, label: s.label }));
  const attrOptions = def.attributes.map((a) => ({ value: a.key, label: a.abbr }));
  const kindLabel = ACTION_KINDS.find((k) => k.kind === action.kind)?.label ?? action.kind;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-[#2d2417]">
      <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider">{kindLabel}</span>
      <TextInput value={action.label} onCommit={(label) => label.trim() && onPatch({ label: label.trim() })} className="w-28" maxLength={60} />

      {action.kind === "attack" && (
        <>
          <Select value={action.skill} onChange={(skill) => onPatch({ skill })} options={attackSkills} title="Perícia do ataque" />
          <Select
            value={action.attributeOverride ?? ""}
            onChange={(v) => onPatch({ attributeOverride: v || null })}
            options={[{ value: "", label: "atributo padrão" }, ...attrOptions]}
            title="Trocar o atributo da perícia (ex.: arma ágil)"
          />
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} />
          </label>
          <label className="flex items-center gap-1 text-zinc-500">
            crítico <NumInput value={action.critRange} onCommit={(v) => onPatch({ critRange: Math.max(1, v ?? 20) })} title="Margem de crítico (natural ≥)" />
            ×<NumInput value={action.critMult} onCommit={(v) => onPatch({ critMult: Math.max(1, v ?? 2) })} className="w-8" title="Multiplicador" />
          </label>
        </>
      )}

      {action.kind === "damage" && (
        <>
          <TextInput value={action.formula} onCommit={(formula) => formula.trim() && onPatch({ formula: formula.trim() })} className="w-20 font-mono" maxLength={200} placeholder="1d8" />
          <Select
            value={action.attribute === null ? "none" : action.attribute}
            onChange={(v) => onPatch({ attribute: v === "none" ? null : v })}
            options={[{ value: "auto", label: "atributo: auto" }, { value: "none", label: "sem atributo" }, ...attrOptions.map((a) => ({ value: a.value, label: `+ ${a.label}` }))]}
            title="Atributo somado ao dano"
          />
          {def.damageTypes.length > 0 && (
            <Select value={action.damageType ?? ""} onChange={(v) => onPatch({ damageType: v || null })} options={[{ value: "", label: "tipo —" }, ...def.damageTypes.map((d) => ({ value: d.key, label: d.label }))]} />
          )}
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} />
          </label>
        </>
      )}

      {action.kind === "check" && (
        <>
          <Select value={action.skill} onChange={(skill) => onPatch({ skill })} options={allSkills} />
          <label className="flex items-center gap-1 text-zinc-500">
            bônus <NumInput value={action.bonus} onCommit={(v) => onPatch({ bonus: v ?? 0 })} />
          </label>
        </>
      )}

      {action.kind === "formula" && (
        <TextInput value={action.formula} onCommit={(formula) => formula.trim() && onPatch({ formula: formula.trim() })} className="w-48 font-mono" maxLength={200} placeholder="1d20 + {skill.luta}" />
      )}

      <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 cursor-pointer" title="Remover ação">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

