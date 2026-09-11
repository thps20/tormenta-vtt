import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Eye, EyeOff, MoreVertical, Plus, Users, X } from "lucide-react";
import { computeCharacter, type Character, type ConditionDef, type PartyEntry, type SystemDefinition, type Token } from "@tormenta-vtt/shared";

const MENU_WIDTH = 176;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface PartyViewProps {
  isGm: boolean;
  /** Já filtrado/ordenado pelo servidor pra este cliente (SPEC §9.15) — jogador nunca recebe entrada oculta. */
  entries: PartyEntry[];
  /** Todas as fichas que este cliente conhece (GM: da sala inteira; jogador: só PCs) — dá nome/PV/PM
   *  de cada entrada e, pro GM, quem falta no grupo pro botão "+ Adicionar". */
  characters: Character[];
  /** Tokens do mapa que este cliente está vendo, já filtrados por visibilidade/névoa. */
  tokens: Token[];
  def: SystemDefinition;
  activeTurnTokenId: string | null;
  onOpenCharacter: (characterId: string) => void;
  /** Preferência "mostrar visão de grupo" (por usuário, padrão ligada). */
  expanded: boolean;
  onToggleExpanded: () => void;
  // Gerenciamento do grupo (GM só, mas os componentes internos já conferem isGm antes de chamar).
  onAdd: (characterId: string) => void;
  onRemove: (characterId: string) => void;
  onSetHidden: (characterId: string, hidden: boolean) => void;
  onReorder: (characterIds: string[]) => void;
}

/**
 * Faixa fina no topo do painel lateral com os personagens de jogador "de relance": avatar, PV/PM,
 * condições e quem está na vez. O chip é por FICHA (`kind: "pc"`), gerenciado pelo Mestre
 * (`Room.party`, SPEC §9.15) — só some se a ficha for apagada ou removida do grupo; token (se
 * houver um vinculado no mapa visto) só empresta cor/condições/turno. Some junto com o painel (fica
 * dentro do `<aside>` do SidePanel); o chevron aqui do lado é uma preferência À PARTE, por usuário
 * (padrão aberta) — não mexe na régua de abrir/fechar o painel inteiro.
 *
 * Não lê NENHUMA regra concreta do sistema: `def.tokenBar` diz qual recurso é a barra principal
 * (PV em T20), `def.resources[]` dá os demais (PM...) — outro sistema com outros recursos funciona
 * sem mudar este componente.
 */
export const PartyView: React.FC<PartyViewProps> = ({
  isGm,
  entries,
  characters,
  tokens,
  def,
  activeTurnTokenId,
  onOpenCharacter,
  expanded,
  onToggleExpanded,
  onAdd,
  onRemove,
  onSetHidden,
  onReorder,
}) => {
  const characterById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const conditionByKey = useMemo(() => new Map(def.conditions.map((c) => [c.key, c])), [def.conditions]);
  // Um token por ficha (a que este cliente vê no mapa atual): dá cor, avatar de token, condições e
  // turno. Ficha sem token visível aqui (ainda não entrou neste mapa, ou está oculta) só perde esses
  // extras — continua na lista, com PV/PM normalmente.
  const tokenByCharacterId = useMemo(() => {
    const out = new Map<string, Token>();
    for (const t of tokens) if (t.characterId && !out.has(t.characterId)) out.set(t.characterId, t);
    return out;
  }, [tokens]);
  // PCs da sala fora do grupo — só o GM usa (botão "+ Adicionar"); pro jogador `characters` já só
  // tem PC, então isso seria "os que não estão no meu grupo visível", sem sentido pra ele.
  const missingPcs = useMemo(() => {
    if (!isGm) return [];
    const inGroup = new Set(entries.map((e) => e.characterId));
    return characters.filter((c) => c.kind === "pc" && !inGroup.has(c.id));
  }, [isGm, characters, entries]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!isGm || !draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const order = entries.map((e) => e.characterId);
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      onReorder(next);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  if (entries.length === 0 && missingPcs.length === 0) return null;

  return (
    <div id="party-view" className="shrink-0 border-b border-[#2d2417] bg-[#141414]">
      <button
        id="btn-party-view-toggle"
        onClick={onToggleExpanded}
        title={expanded ? "Recolher visão de grupo" : "Mostrar visão de grupo"}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-serif font-bold tracking-widest uppercase text-zinc-500 hover:text-zinc-300 cursor-pointer"
      >
        <Users className="w-3 h-3 text-[#d4af37]" />
        Grupo
        <span className="ml-auto">{expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
      </button>

      {expanded && (
        <div className="flex gap-1.5 px-1.5 pb-1.5 overflow-x-auto">
          {entries.map((entry) => {
            const character = characterById.get(entry.characterId);
            if (!character) return null;
            return (
              <PartyChip
                key={entry.characterId}
                isGm={isGm}
                entry={entry}
                character={character}
                token={tokenByCharacterId.get(character.id) ?? null}
                def={def}
                conditionByKey={conditionByKey}
                isActiveTurn={activeTurnTokenId !== null && tokenByCharacterId.get(character.id)?.id === activeTurnTokenId}
                isDragTarget={dragOverId === entry.characterId && draggedId !== entry.characterId}
                onOpen={() => onOpenCharacter(character.id)}
                onDragStart={() => isGm && setDraggedId(entry.characterId)}
                onDragOver={() => isGm && draggedId && draggedId !== entry.characterId && setDragOverId(entry.characterId)}
                onDrop={() => handleDrop(entry.characterId)}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                onHide={() => onSetHidden(character.id, true)}
                onShow={() => onSetHidden(character.id, false)}
                onRemove={() => onRemove(character.id)}
              />
            );
          })}
          {isGm && missingPcs.length > 0 && <AddToPartyButton candidates={missingPcs} onAdd={onAdd} />}
        </div>
      )}
    </div>
  );
};

const PartyChip: React.FC<{
  isGm: boolean;
  entry: PartyEntry;
  character: Character;
  token: Token | null;
  def: SystemDefinition;
  conditionByKey: Map<string, ConditionDef>;
  isActiveTurn: boolean;
  isDragTarget: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onHide: () => void;
  onShow: () => void;
  onRemove: () => void;
}> = ({ isGm, entry, character, token, def, conditionByKey, isActiveTurn, isDragTarget, onOpen, onDragStart, onDragOver, onDrop, onDragEnd, onHide, onShow, onRemove }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const ringColor = token?.color ?? "#3d3d3d";
  const conditions = (token?.conditions ?? [])
    .map((cond) => conditionByKey.get(cond.key))
    .filter((c): c is ConditionDef => c !== undefined);
  const shownConditions = conditions.slice(0, 3);
  const extraConditions = conditions.length - shownConditions.length;

  const mainBar = def.tokenBar ? resourceValues(def, computed, character, def.tokenBar) : null;
  // Todo recurso do sistema ALÉM do principal (PM em T20): mesma barra da principal, só menor — só
  // omite quando o máximo é 0 (personagem que nem chegou a definir esse recurso ainda).
  const otherBars = def.resources
    .filter((r) => r.key !== def.tokenBar)
    .map((r) => ({ resourceKey: r.key, values: resourceValues(def, computed, character, r.key) }))
    .filter((r) => r.values.max > 0);

  return (
    <div
      id={`party-chip-${character.id}`}
      draggable={isGm}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={character.name}
      className={`w-[104px] shrink-0 flex flex-col gap-1 p-1.5 rounded border cursor-pointer text-left ${
        isDragTarget ? "border-[#d4af37] bg-[#1e1a15]" : "border-[#2d2417] bg-black/20 hover:bg-[#1e1a15] hover:border-[#d4af37]/50"
      } ${entry.hidden ? "opacity-45" : ""}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <div
          className="relative w-6 h-6 rounded-full bg-[#252525] flex items-center justify-center text-[10px] font-serif font-bold text-[#d4af37] shrink-0"
          style={{ boxShadow: `0 0 0 1.5px ${ringColor}` }}
        >
          {character.imageUrl ? (
            <img src={character.imageUrl} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            character.name.charAt(0).toUpperCase()
          )}
          {isActiveTurn && (
            <span
              title="Na vez"
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#d4af37] border border-black animate-pulse"
            />
          )}
        </div>
        <span className="flex-1 min-w-0 text-[10px] font-semibold text-zinc-200 truncate">{character.name}</span>
        {isGm && (
          <ChipMenuButton
            open={menuOpen}
            onToggle={() => setMenuOpen((v) => !v)}
            onClose={() => setMenuOpen(false)}
            hidden={entry.hidden}
            onHide={onHide}
            onShow={onShow}
            onRemove={onRemove}
          />
        )}
      </div>

      {mainBar && <ResourceBar {...mainBar} />}
      {otherBars.map(({ resourceKey, values }) => (
        <SecondaryResourceBar key={resourceKey} {...values} />
      ))}

      {(shownConditions.length > 0 || entry.hidden) && (
        <div className="flex items-center gap-1">
          {entry.hidden && <EyeOff className="w-3 h-3 text-zinc-500 shrink-0" />}
          {shownConditions.map((c) => (
            <span key={c.key} title={c.description || c.label} className="w-3 h-3 shrink-0 [&>svg]:w-full [&>svg]:h-full" style={{ color: c.color }} dangerouslySetInnerHTML={{ __html: c.icon }} />
          ))}
          {extraConditions > 0 && <span className="text-[8px] text-zinc-500 font-mono">+{extraConditions}</span>}
        </div>
      )}
    </div>
  );
};

/** Botão "⋯" de cada chip: popover em portal (document.body, position:fixed) — a faixa rola
 *  horizontalmente (`overflow-x-auto`), um menu `absolute` normal seria cortado nela. */
const ChipMenuButton: React.FC<{
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  hidden: boolean;
  onHide: () => void;
  onShow: () => void;
  onRemove: () => void;
}> = ({ open, onToggle, onClose, hidden, onHide, onShow, onRemove }) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: clamp(r.left, 4, window.innerWidth - MENU_WIDTH - 4), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose]);

  return (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={onToggle}
        title="Opções do grupo"
        className="p-0.5 rounded text-zinc-500 hover:text-[#d4af37] hover:bg-[#2c2419] cursor-pointer"
      >
        <MoreVertical className="w-3 h-3" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: MENU_WIDTH, visibility: pos ? "visible" : "hidden" }}
            className="z-50 bg-[#1e1a15] border border-[#d4af37]/70 rounded shadow-2xl p-1 flex flex-col gap-0.5"
          >
            {hidden ? (
              <MenuItem
                icon={Eye}
                label="Mostrar no grupo"
                onClick={() => {
                  onShow();
                  onClose();
                }}
              />
            ) : (
              <MenuItem
                icon={EyeOff}
                label="Ocultar do grupo"
                onClick={() => {
                  onHide();
                  onClose();
                }}
              />
            )}
            <div className="h-px bg-[#2d2417] my-0.5" />
            <MenuItem
              icon={X}
              label="Remover do grupo"
              danger
              onClick={() => {
                onRemove();
                onClose();
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
};

/** "+ Adicionar ao grupo": mesma ideia de portal do menu acima, listando os PCs de fora. */
const AddToPartyButton: React.FC<{ candidates: Character[]; onAdd: (characterId: string) => void }> = ({ candidates, onAdd }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: clamp(r.left, 4, window.innerWidth - MENU_WIDTH - 4), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        id="btn-add-to-party"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Adicionar personagem ao grupo"
        className="w-[104px] h-full min-h-[64px] flex flex-col items-center justify-center gap-1 rounded border border-dashed border-[#3d3d3d] text-zinc-500 hover:text-[#d4af37] hover:border-[#d4af37]/50 cursor-pointer"
      >
        <Plus className="w-4 h-4" />
        <span className="text-[9px] font-serif">Adicionar</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: MENU_WIDTH, visibility: pos ? "visible" : "hidden" }}
            className="z-50 max-h-64 overflow-y-auto bg-[#1e1a15] border border-[#d4af37]/70 rounded shadow-2xl p-1 flex flex-col gap-0.5"
          >
            {candidates.map((c) => (
              <MenuItem
                key={c.id}
                icon={Plus}
                label={c.name}
                onClick={() => {
                  onAdd(c.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs font-serif transition-colors cursor-pointer flex items-center gap-2 truncate ${
        danger ? "text-red-300 hover:bg-red-950/60" : "text-zinc-200 hover:bg-[#2d2417] hover:text-amber-200"
      }`}
    >
      <Icon className={`w-3 h-3 shrink-0 ${danger ? "text-red-400" : "text-[#d4af37]"}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

interface ResourceValues {
  abbr: string;
  current: number;
  max: number;
  temp: number;
  /** Cor fixa do recurso (`SystemDefinition.resources[].color`, ex.: PM azul em T20) — ausente = a
   *  barra usa a régua por faixa de % (só a PRINCIPAL, PV, usa essa régua de qualquer jeito). */
  color?: string;
}

function resourceValues(def: SystemDefinition, computed: ReturnType<typeof computeCharacter>, character: Character, key: string): ResourceValues {
  const resDef = def.resources.find((r) => r.key === key);
  const entry = character.resources[key];
  return {
    abbr: resDef?.abbr ?? key,
    current: entry?.current ?? 0,
    max: computed.resources[key]?.max ?? 0,
    temp: resDef?.hasTemp ? (entry?.temp ?? 0) : 0,
    color: resDef?.color,
  };
}

/** Verde acima de 50%, dourado acima de 25%, vermelho abaixo disso — mesma convenção da barra do
 *  token no mapa (VttCanvas). Só para quem NÃO tem `color` fixa configurada (ver ResourceBar). */
function rampColor(current: number, max: number): string {
  const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  return percent > 50 ? "#10b981" : percent > 25 ? "#d4af37" : "#ef4444";
}

/**
 * Barra do recurso PRINCIPAL (PV em T20): fininha com número por cima, cor pela régua de %
 * (`rampColor`) — "quanto falta pra zerar importa", então a cor SEMPRE reage ao nível, mesmo se o
 * sistema tiver configurado uma `color` fixa pra esse recurso (não devia; a UI ignora de propósito).
 * Temporário só entra no texto ("+N"). `title` repete o texto pro hover.
 */
const ResourceBar: React.FC<ResourceValues> = ({ abbr, current, max, temp }) => {
  const color = rampColor(current, max);
  const text = `${abbr} ${current}/${max}${temp > 0 ? ` +${temp}` : ""}`;
  return (
    <div title={text} className="relative w-full h-3 rounded bg-[#0c0c0c] border border-[#2d2417] overflow-hidden">
      <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0)}%`, backgroundColor: color }} />
      <span className="relative z-10 flex items-center justify-center h-full text-[8px] font-mono font-bold text-zinc-100">{text}</span>
    </div>
  );
};

/**
 * Barra de um recurso SECUNDÁRIO (PM em T20): fina (4px), sem número por cima — não cabe nesse
 * espaço, o `title` mostra o texto exato no hover ("PM 6/9"). Cor: a `color` do recurso no JSON do
 * sistema se houver (PM é azul, não é "vida" — ficar baixo nele não é a mesma urgência de PV, então
 * não usa a régua vermelha); sem `color` configurada, cai na mesma régua por % da principal.
 */
const SecondaryResourceBar: React.FC<ResourceValues> = ({ abbr, current, max, temp, color }) => {
  const barColor = color ?? rampColor(current, max);
  const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  const text = `${abbr} ${current}/${max}${temp > 0 ? ` +${temp}` : ""}`;
  return (
    <div title={text} className="w-full h-1 rounded-sm bg-[#0c0c0c] border border-[#2d2417] overflow-hidden">
      <div className="h-full rounded-sm" style={{ width: `${percent}%`, backgroundColor: barColor }} />
    </div>
  );
};
