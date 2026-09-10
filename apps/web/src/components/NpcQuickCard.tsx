import React, { useEffect, useRef, useState } from "react";
import { Anchor, Check, FileText, Heart, Info, Plus, Shield, SlidersHorizontal, Sparkles, Swords, Trash2, X, Zap } from "lucide-react";
import { formatArea, type Character, type CharacterItem, type ComputedCharacter, type ConditionDef, type SystemDefinition, type Token, type TokenCondition } from "@tormenta-vtt/shared";
import { DamageTypeBadge } from "./DamageTypeBadge";

/**
 * Contrato completo em docs/tipos-ficha-rapida.md. `onOpenTokenInspector` e `onDelete` são
 * acréscimos desta implementação (botões "Token" e a lixeira do cabeçalho) — não fazem parte do
 * contrato pensado pro AI Studio. `onDelete` é a MESMA função do atalho Delete/Backspace do canvas
 * (ver lib/useDeleteSelectionShortcut): decide sozinha se apaga direto ou confirma antes; o card só
 * chama, sem duplicar a regra.
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
  onDelete: () => void;
  onClose: () => void;
}

/** Posição arrastada do card, em pixels do contêiner do canvas (offsetParent). null = posição padrão. */
interface QuickCardPos {
  x: number;
  y: number;
}

/** Lembrada por aba (sessionStorage): ao reabrir o card na mesma sessão, volta pra onde ficou. */
const QUICK_CARD_POS_KEY = "tvtt:npcQuickCardPos";

function loadQuickCardPos(): QuickCardPos | null {
  try {
    const raw = sessionStorage.getItem(QUICK_CARD_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuickCardPos>;
    return typeof parsed.x === "number" && typeof parsed.y === "number" ? { x: parsed.x, y: parsed.y } : null;
  } catch {
    return null;
  }
}

function saveQuickCardPos(pos: QuickCardPos | null): void {
  try {
    if (pos) sessionStorage.setItem(QUICK_CARD_POS_KEY, JSON.stringify(pos));
    else sessionStorage.removeItem(QUICK_CARD_POS_KEY);
  } catch {
    /* ignora (aba anônima etc.) */
  }
}

/** "Imune"/"Vulnerável" ganham prioridade sobre RD/½ (não faz sentido combinar); null = nada ativo. */
function damageResponseLabel(resp: { reduction: number; half: boolean; immune: boolean; vulnerable: boolean }): string | null {
  if (resp.immune) return "Imune";
  if (resp.vulnerable) return "Vulnerável";
  const parts: string[] = [];
  if (resp.reduction > 0) parts.push(`RD ${resp.reduction}`);
  if (resp.half) parts.push("½");
  return parts.length > 0 ? parts.join(" + ") : null;
}

/**
 * Ficha rápida de um NPC: abre no clique simples em token NPC do GM, no lugar do TokenInspector
 * genérico (botão "Token" leva pra ele — nome, cor, dono, imagem, apagar). `character`/`computed` vêm
 * de `computeCharacter(def, character)` — a MESMA função que a ficha completa usa, então os valores
 * nunca divergem. Nada aqui hardcoda um rótulo ("Defesa", "PV") ou uma chave ("pv", "nd") fora do JSON
 * do sistema (Regra nº 1 do CLAUDE.md); ver docs/plano-ficha-rapida-ui.md pro raciocínio de cada ponto.
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
  onDelete,
  onClose,
}) => {
  const [deltaInput, setDeltaInput] = useState("");
  const [isConditionsOpen, setIsConditionsOpen] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // ----- Arrastar pelo cabeçalho (pointer events; ver docs no topo do arquivo) -----
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<QuickCardPos | null>(loadQuickCardPos);
  /** pointerId em arraste + de onde o ponteiro pegou o card, pra não "saltar" ao começar. */
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  /** Nunca deixa o card sumir da área visível do canvas (offsetParent = contêiner do VttCanvas). */
  const clampPos = (x: number, y: number): QuickCardPos => {
    const parent = cardRef.current?.offsetParent as HTMLElement | null;
    const card = cardRef.current;
    if (!parent || !card) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - card.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - card.offsetHeight);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  };

  // Reclampa ao montar (a posição salva pode vir de uma janela com outro tamanho) e sempre que o
  // contêiner do canvas mudar de tamanho (ex.: painel lateral abre/fecha, resize da janela).
  useEffect(() => {
    const parent = cardRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const reclamp = () => setPos((p) => (p ? clampPos(p.x, p.y) : p));
    reclamp();
    const observer = new ResizeObserver(reclamp);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return; // não inicia arraste clicando nos ícones
    const card = cardRef.current;
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    dragRef.current = { pointerId: e.pointerId, offsetX: e.clientX - cardRect.left, offsetY: e.clientY - cardRect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const parent = cardRef.current?.offsetParent as HTMLElement | null;
    if (!drag || drag.pointerId !== e.pointerId || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    setPos(clampPos(e.clientX - parentRect.left - drag.offsetX, e.clientY - parentRect.top - drag.offsetY));
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    // Lê a posição final do próprio DOM (já aplicada pelo último pointermove) em vez de confiar no
    // estado "pos" capturado no closure deste handler, que pode estar um render atrás.
    const card = cardRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!card || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    saveQuickCardPos({ x: cardRect.left - parentRect.left, y: cardRect.top - parentRect.top });
  };

  /** Botão "encaixar": volta pra posição padrão (bottom-4 right-4) e esquece a posição arrastada. */
  const dockToDefault = () => {
    setPos(null);
    saveQuickCardPos(null);
  };

  // ----- Cabeçalho: ND/tipo (só existem se o sistema tiver creatures) e tamanho -----
  const creatures = def.creatures;
  const ndValue = creatures ? character.traits[creatures.ndField] : undefined;
  const typeValue = creatures ? character.traits[creatures.typeField] : undefined;
  const typeFieldDef = creatures ? def.traitFields.find((f) => f.key === creatures.typeField) : undefined;
  const typeLabel = typeFieldDef ? (typeFieldDef.options?.find((o) => o.key === typeValue)?.label ?? typeValue) : typeValue;
  const sizeDef = def.sizes.find((s) => s.key === character.size);
  const sizeLabel = sizeDef?.label ?? character.size ?? undefined;

  // ----- PV (tokenBar): sempre da FICHA vinculada, nunca de token.hp (isso é só pra token sem ficha) -----
  const tokenBar = def.tokenBar;
  const barDef = tokenBar ? def.resources.find((r) => r.key === tokenBar) : undefined;
  const barLabel = barDef?.abbr ?? barDef?.label;
  const hpEntry = tokenBar ? character.resources[tokenBar] : undefined;
  const currentHp = hpEntry?.current ?? 0;
  const tempHp = hpEntry?.temp ?? 0;
  const maxHp = tokenBar ? computed.resources[tokenBar]?.max ?? 0 : 0;
  const hpPercent = Math.max(0, Math.min(100, Math.round((currentHp / (maxHp || 1)) * 100)));
  const secondaryResources = tokenBar ? def.resources.filter((r) => r.key !== tokenBar) : [];

  // ----- Derivados: valor já final de computeCharacter, sem inferir unidade pelo nome da chave -----
  const derivedStats = def.derived;

  // ----- Resistências/imunidades/vulnerabilidades: character.damageResponses = { all, byType } -----
  const damageResponseChips: { key: string; label: string; color?: string }[] = [];
  const generalLabel = damageResponseLabel(character.damageResponses.all);
  if (generalLabel) damageResponseChips.push({ key: "all", label: `${generalLabel} (geral)` });
  for (const [typeKey, resp] of Object.entries(character.damageResponses.byType)) {
    const label = damageResponseLabel(resp);
    if (!label) continue;
    const dt = def.damageTypes.find((t) => t.key === typeKey);
    damageResponseChips.push({ key: typeKey, label: `${label} ${dt?.label ?? typeKey}`, color: dt?.color });
  }

  // ----- Itens: ataque = ação sem bloco de ativação; poder/habilidade = tem bloco de ativação -----
  const attackItems = character.items.filter((item) => item.activation === null && item.actions.length > 0);
  const abilityItems = character.items.filter((item) => item.activation !== null);

  const handleApplyDelta = () => {
    const delta = parseInt(deltaInput.trim(), 10);
    if (!isNaN(delta) && delta !== 0) {
      onHpChange(delta);
      setDeltaInput("");
    }
  };

  const handleKeyDownDelta = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleApplyDelta();
  };

  return (
    <div
      ref={cardRef}
      id="npc-quick-card"
      className={`absolute ${pos ? "" : "bottom-4 right-4"} w-[360px] max-w-[calc(100vw-2rem)] bg-[#14120f] border border-[#3d311f] rounded-lg shadow-2xl text-zinc-200 flex flex-col max-h-[calc(100vh-5.5rem)] select-none z-30`}
      style={{
        boxShadow: "0 12px 36px -4px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(212, 175, 55, 0.15)",
        ...(pos ? { left: pos.x, top: pos.y } : {}),
      }}
    >
      {/* ----------------- CABEÇALHO (arrastável: pega aqui e solta em qualquer ponto) ----------------- */}
      <div
        className="px-3 py-2.5 bg-[#1a1713] border-b border-[#2d2417] flex items-center justify-between gap-2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20 shadow-sm" style={{ backgroundColor: token.color }} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-serif font-bold text-amber-100 text-sm truncate max-w-[170px]" title={token.name}>
                {token.name}
              </span>
              {ndValue && (
                <span
                  id="npc-nd-badge"
                  className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-950/60 text-amber-300 border border-amber-800/60 leading-tight"
                >
                  ND {ndValue}
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {sizeLabel}
              {sizeLabel && typeLabel && " • "}
              {typeLabel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {pos && (
            <button
              id="npc-btn-dock"
              onClick={dockToDefault}
              title="Encaixar (voltar à posição padrão)"
              className="p-1.5 rounded text-zinc-500 hover:text-amber-300 hover:bg-[#25201a] border border-transparent hover:border-[#3d311f] transition-all cursor-pointer"
            >
              <Anchor className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            id="npc-btn-full-sheet"
            onClick={onOpenFullSheet}
            title="Ficha completa"
            className="p-1.5 rounded text-zinc-400 hover:text-amber-300 hover:bg-[#25201a] border border-transparent hover:border-[#3d311f] transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            id="npc-btn-token-inspector"
            onClick={onOpenTokenInspector}
            title="Token (Inspetor)"
            className="p-1.5 rounded text-zinc-400 hover:text-amber-300 hover:bg-[#25201a] border border-transparent hover:border-[#3d311f] transition-all cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            id="npc-btn-delete"
            onClick={onDelete}
            title="Apagar token"
            className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            id="npc-btn-close"
            onClick={onClose}
            title="Fechar"
            className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 transition-all cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ----------------- CORPO ROLÁVEL ----------------- */}
      <div className="overflow-y-auto flex-1 p-3 space-y-3 custom-scrollbar text-xs">
        {/* ----------------- PV & RECURSOS ----------------- */}
        {tokenBar && (
          <section id="npc-section-resources" className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500/20" />
                <span className="font-serif tracking-wide">{barLabel}</span>
                <span className="font-mono text-amber-200">
                  {currentHp}/{maxHp}
                </span>
                {tempHp > 0 && (
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-700/50">+{tempHp}</span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {secondaryResources.map((res) => {
                  const cur = character.resources[res.key]?.current ?? 0;
                  const max = computed.resources[res.key]?.max ?? 0;
                  return (
                    <span
                      key={res.key}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/50 text-cyan-300 border border-cyan-800/40"
                      title={res.label}
                    >
                      {res.abbr}: {cur}/{max}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-[#2d2417]">
              <div
                className={`h-full transition-all duration-200 ${hpPercent > 50 ? "bg-emerald-600" : hpPercent > 20 ? "bg-amber-600" : "bg-red-600"}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-1 pt-0.5">
              <div className="flex items-center gap-1">
                <button
                  id="npc-hp-sub-5"
                  onClick={() => onHpChange(-5)}
                  className="px-1.5 py-1 rounded bg-[#1e1b16] hover:bg-[#2a241d] active:bg-[#14120f] border border-[#3d311f] text-zinc-300 hover:text-red-300 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Dano -5"
                >
                  -5
                </button>
                <button
                  id="npc-hp-sub-1"
                  onClick={() => onHpChange(-1)}
                  className="px-1.5 py-1 rounded bg-[#1e1b16] hover:bg-[#2a241d] active:bg-[#14120f] border border-[#3d311f] text-zinc-300 hover:text-red-300 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Dano -1"
                >
                  -1
                </button>
                <button
                  id="npc-hp-add-1"
                  onClick={() => onHpChange(1)}
                  className="px-1.5 py-1 rounded bg-[#1e1b16] hover:bg-[#2a241d] active:bg-[#14120f] border border-[#3d311f] text-zinc-300 hover:text-emerald-300 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Cura +1"
                >
                  +1
                </button>
                <button
                  id="npc-hp-add-5"
                  onClick={() => onHpChange(5)}
                  className="px-1.5 py-1 rounded bg-[#1e1b16] hover:bg-[#2a241d] active:bg-[#14120f] border border-[#3d311f] text-zinc-300 hover:text-emerald-300 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Cura +5"
                >
                  +5
                </button>
              </div>

              <div className="flex items-center gap-1">
                <input
                  id="npc-hp-delta-input"
                  type="text"
                  placeholder="± delta"
                  value={deltaInput}
                  onChange={(e) => setDeltaInput(e.target.value)}
                  onKeyDown={handleKeyDownDelta}
                  className="w-16 px-1.5 py-0.5 rounded bg-[#1a1713] border border-[#3d311f] text-amber-200 text-center font-mono text-[11px] focus:outline-none focus:border-[#d4af37]"
                />
                <button
                  id="npc-hp-delta-btn"
                  onClick={handleApplyDelta}
                  disabled={!deltaInput.trim()}
                  className="p-1 rounded bg-[#25201a] hover:bg-[#352c22] disabled:opacity-40 border border-[#3d311f] text-amber-400 hover:text-amber-200 transition-colors cursor-pointer"
                  title="Aplicar delta (+ Enter)"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ----------------- DERIVADOS & RESISTÊNCIAS ----------------- */}
        <section id="npc-section-derived" className="space-y-1.5 pt-1 border-t border-[#25201a]">
          <div className="flex items-center gap-1.5 flex-wrap">
            {derivedStats.map((d) => (
              <div key={d.key} className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1b1814] border border-[#342a1b] text-zinc-300 font-mono text-[11px]">
                <Shield className="w-3 h-3 text-[#d4af37]" />
                <span className="text-zinc-400 font-sans font-medium">{d.abbr ?? d.label}:</span>
                <span className="font-bold text-amber-200">{computed.derived[d.key] ?? 0}</span>
              </div>
            ))}
          </div>

          {damageResponseChips.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              {damageResponseChips.map((chip) => {
                const color = chip.color ?? "#a1a1aa";
                return (
                  <span
                    key={chip.key}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border"
                    style={{ backgroundColor: `${color}26`, borderColor: `${color}66`, color }}
                  >
                    {chip.label}
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* ----------------- ATAQUES ----------------- */}
        {attackItems.length > 0 && (
          <section id="npc-section-attacks" className="space-y-1.5 pt-1 border-t border-[#25201a]">
            <div className="flex items-center gap-1 text-[11px] font-serif font-bold text-amber-200 uppercase tracking-wider">
              <Swords className="w-3 h-3 text-amber-400" />
              <span>Ataques</span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5 custom-scrollbar">
              {attackItems.map((item: CharacterItem) => (
                <div key={item.id} className="p-1.5 rounded bg-[#1a1713] border border-[#2d2417] space-y-1">
                  <div className="text-zinc-300 font-serif font-semibold text-[11px]">{item.name}</div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.actions.map((act) => {
                      const isAttack = act.kind === "attack";
                      const isDamage = act.kind === "damage";

                      let formulaText = "";
                      if (isAttack) formulaText = act.bonus >= 0 ? `+${act.bonus}` : `${act.bonus}`;
                      else if (isDamage) formulaText = act.formula;

                      return (
                        <button
                          key={act.id}
                          id={`npc-roll-${item.id}-${act.id}`}
                          onClick={() => onRoll({ itemId: item.id, actionId: act.id })}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#241f19] hover:bg-[#332b21] active:bg-[#1a1713] border border-[#3d311f] hover:border-[#d4af37]/60 text-zinc-200 text-[11px] transition-all cursor-pointer group"
                        >
                          <span className="text-zinc-400 group-hover:text-amber-300 font-serif">{act.label}</span>
                          {formulaText && <span className="font-mono font-bold text-amber-200">{formulaText}</span>}

                          {isAttack && (
                            <span className="text-[9px] font-mono text-zinc-500 group-hover:text-zinc-400">
                              ({act.critRange}/x{act.critMult})
                            </span>
                          )}

                          {isDamage && act.damageType !== null && <DamageTypeBadge def={def} type={act.damageType} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ----------------- HABILIDADES / PODERES ----------------- */}
        {abilityItems.length > 0 && (
          <section id="npc-section-abilities" className="space-y-1.5 pt-1 border-t border-[#25201a]">
            <div className="flex items-center gap-1 text-[11px] font-serif font-bold text-amber-200 uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Habilidades</span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5 custom-scrollbar">
              {abilityItems.map((item: CharacterItem) => {
                const activation = item.activation;
                if (!activation) return null;

                const execDef = def.activation.executions.find((e) => e.key === activation.execution);
                const isPassive = execDef?.passive ?? false;

                if (isPassive) {
                  return (
                    <div key={item.id} className="p-1.5 rounded bg-[#181612] border border-[#262015] flex items-center justify-between gap-1 group relative">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-serif font-medium text-zinc-300 text-[11px] truncate">{item.name}</span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/40">Passivo</span>
                      </div>

                      <div className="relative" onMouseEnter={() => setActiveTooltip(item.id)} onMouseLeave={() => setActiveTooltip(null)}>
                        <button type="button" className="p-0.5 text-zinc-500 hover:text-amber-300 transition-colors" title={item.description}>
                          <Info className="w-3.5 h-3.5" />
                        </button>

                        {activeTooltip === item.id && item.description && (
                          <div className="absolute right-0 bottom-full mb-1 w-56 p-2 rounded bg-[#1e1a14] border border-[#d4af37]/40 shadow-xl text-zinc-300 text-[11px] leading-relaxed z-50 pointer-events-none">
                            <p className="font-semibold text-amber-200 mb-0.5">{item.name}</p>
                            <p>{item.description}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                const execLabel = execDef?.label ?? activation.execution;
                const cost = activation.cost;
                const costResourceDef = def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
                const costUnit = costResourceDef?.abbr ?? costResourceDef?.label;
                const areaText = formatArea(def, activation.area);

                return (
                  <div key={item.id} className="p-1.5 rounded bg-[#1a1713] border border-[#2d2417] flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-serif font-medium text-zinc-200 text-[11px] truncate">{item.name}</span>
                        {execLabel && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950/40 text-amber-300 border border-amber-800/30">{execLabel}</span>
                        )}
                        {cost > 0 && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-800/40">
                            {cost}
                            {costUnit ? ` ${costUnit}` : ""}
                          </span>
                        )}
                        {areaText && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-800/60 text-zinc-300 border border-zinc-700/40" title="Área">
                            {areaText}
                          </span>
                        )}
                      </div>
                      {item.description && <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{item.description}</p>}
                    </div>

                    <button
                      id={`npc-use-${item.id}`}
                      onClick={() => onUseItem(item.id)}
                      className="px-2 py-1 rounded bg-[#2b2317] hover:bg-[#3d3120] active:bg-[#1a1713] border border-[#d4af37]/40 hover:border-[#d4af37] text-amber-300 hover:text-amber-100 font-serif font-semibold text-[10px] tracking-wide transition-all cursor-pointer shrink-0"
                    >
                      Usar
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ----------------- CONDIÇÕES ----------------- */}
        <section id="npc-section-conditions" className="space-y-1.5 pt-1 border-t border-[#25201a]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px] font-serif font-bold text-amber-200 uppercase tracking-wider">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Condições</span>
              {activeConditions.length > 0 && <span className="text-[10px] font-mono text-zinc-400">({activeConditions.length})</span>}
            </div>

            <div className="relative">
              <button
                id="npc-btn-toggle-conditions-menu"
                onClick={() => setIsConditionsOpen(!isConditionsOpen)}
                className={`p-1 rounded border transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-serif ${
                  isConditionsOpen ? "bg-[#3d311f] text-amber-200 border-[#d4af37]" : "bg-[#1e1b16] text-zinc-300 hover:text-amber-300 border-[#3d311f] hover:bg-[#28221a]"
                }`}
                title="Adicionar ou remover condição"
              >
                <Plus className="w-3 h-3" />
                <span>Condição</span>
              </button>

              {isConditionsOpen && (
                <div
                  id="npc-conditions-dropdown"
                  className="absolute right-0 bottom-full mb-1 w-52 p-1 rounded bg-[#1a1713] border border-[#d4af37]/40 shadow-2xl z-50 max-h-56 overflow-y-auto custom-scrollbar space-y-0.5"
                >
                  <div className="px-2 py-1 text-[10px] font-serif font-bold text-zinc-400 border-b border-[#2d2417] uppercase tracking-wider">Alternar Condição</div>
                  {conditions.map((cond: ConditionDef) => {
                    const isActive = activeConditions.some((ac) => ac.key === cond.key);
                    return (
                      <button
                        key={cond.key}
                        id={`npc-toggle-cond-${cond.key}`}
                        onClick={() => onToggleCondition(cond.key)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-[11px] transition-colors cursor-pointer ${
                          isActive ? "bg-amber-950/40 text-amber-200 border border-amber-700/40" : "text-zinc-300 hover:bg-[#25201a] hover:text-white border border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            style={{ color: cond.color }}
                            className="shrink-0 flex items-center [&>svg]:w-3.5 [&>svg]:h-3.5"
                            dangerouslySetInnerHTML={{ __html: cond.icon }}
                          />
                          <span className="truncate">{cond.label}</span>
                        </div>
                        {isActive && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {activeConditions.length > 0 ? (
            <div className="flex items-center gap-1 flex-wrap">
              {activeConditions.map((tc) => {
                const condDef = conditions.find((c) => c.key === tc.key);
                const color = condDef?.color ?? "#f59e0b";
                const label = condDef?.label ?? tc.key;

                return (
                  <div
                    key={tc.key}
                    id={`npc-active-cond-${tc.key}`}
                    className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[10px] font-mono border transition-all"
                    style={{ backgroundColor: `${color}22`, borderColor: `${color}66`, color }}
                  >
                    {condDef && <span className="shrink-0 flex items-center [&>svg]:w-3 [&>svg]:h-3" dangerouslySetInnerHTML={{ __html: condDef.icon }} />}
                    <span>{label}</span>
                    {tc.expiresRound != null && <span className="text-[9px] opacity-80">({tc.expiresRound} rod.)</span>}
                    <button
                      onClick={() => onToggleCondition(tc.key)}
                      className="ml-0.5 p-0.5 rounded hover:bg-black/30 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                      title={`Remover ${label}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] text-zinc-500 italic py-0.5">Nenhuma condição ativa.</div>
          )}
        </section>
      </div>
    </div>
  );
};
