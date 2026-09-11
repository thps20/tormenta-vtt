import React, { useMemo } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { computeCharacter, type Character, type ConditionDef, type SystemDefinition, type Token } from "@tormenta-vtt/shared";

interface PartyViewProps {
  /** Fichas kind="pc" da sala (NPC nunca entra aqui — já existe a ficha rápida do Mestre pra eles). */
  characters: Character[];
  /** Tokens do mapa que este cliente está vendo, já filtrados por visibilidade/névoa (mesma lista do canvas). */
  tokens: Token[];
  def: SystemDefinition;
  /** Token de quem está agindo agora (combate do mapa visto), pra acender o ícone de turno. */
  activeTurnTokenId: string | null;
  onOpenCharacter: (characterId: string) => void;
  /** Preferência "mostrar visão de grupo" (por usuário, padrão ligada). */
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * Faixa fina no topo do painel lateral com os personagens de jogador "de relance": avatar, PV/PM,
 * condições e quem está na vez. Some junto com o painel (fica dentro do `<aside>` do SidePanel);
 * o chevron aqui do lado é uma preferência À PARTE, por usuário (padrão aberta) — não mexe na régua
 * de abrir/fechar o painel inteiro.
 *
 * Não lê NENHUMA regra concreta do sistema: `def.tokenBar` diz qual recurso é a barra principal
 * (PV em T20), `def.resources[]` dá os demais (PM...) — outro sistema com outros recursos funciona
 * sem mudar este componente.
 */
export const PartyView: React.FC<PartyViewProps> = ({ characters, tokens, def, activeTurnTokenId, onOpenCharacter, expanded, onToggleExpanded }) => {
  const pcs = useMemo(() => characters.filter((c) => c.kind === "pc"), [characters]);
  const conditionByKey = useMemo(() => new Map(def.conditions.map((c) => [c.key, c])), [def.conditions]);
  // Um token por ficha (a que este cliente vê no mapa atual): dá cor, avatar de token, condições e
  // turno. Ficha sem token visível aqui (ainda não entrou neste mapa, ou está oculta) só perde esses
  // extras — continua na lista, com PV/PM normalmente.
  const tokenByCharacterId = useMemo(() => {
    const out = new Map<string, Token>();
    for (const t of tokens) if (t.characterId && !out.has(t.characterId)) out.set(t.characterId, t);
    return out;
  }, [tokens]);

  if (pcs.length === 0) return null;

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
          {pcs.map((c) => (
            <PartyChip
              key={c.id}
              character={c}
              token={tokenByCharacterId.get(c.id) ?? null}
              def={def}
              conditionByKey={conditionByKey}
              isActiveTurn={activeTurnTokenId !== null && tokenByCharacterId.get(c.id)?.id === activeTurnTokenId}
              onOpen={() => onOpenCharacter(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const PartyChip: React.FC<{
  character: Character;
  token: Token | null;
  def: SystemDefinition;
  conditionByKey: Map<string, ConditionDef>;
  isActiveTurn: boolean;
  onOpen: () => void;
}> = ({ character, token, def, conditionByKey, isActiveTurn, onOpen }) => {
  const computed = useMemo(() => computeCharacter(def, character), [def, character]);
  const ringColor = token?.color ?? "#3d3d3d";
  const conditions = (token?.conditions ?? [])
    .map((cond) => conditionByKey.get(cond.key))
    .filter((c): c is ConditionDef => c !== undefined);
  const shownConditions = conditions.slice(0, 3);
  const extraConditions = conditions.length - shownConditions.length;

  const mainBar = def.tokenBar ? resourceValues(def, computed, character, def.tokenBar) : null;
  const otherBars = def.resources.filter((r) => r.key !== def.tokenBar).map((r) => resourceValues(def, computed, character, r.key));

  return (
    <button
      id={`party-chip-${character.id}`}
      onClick={onOpen}
      title={character.name}
      className="w-[104px] shrink-0 flex flex-col gap-1 p-1.5 rounded border border-[#2d2417] bg-black/20 hover:bg-[#1e1a15] hover:border-[#d4af37]/50 cursor-pointer text-left"
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
      </div>

      {mainBar && <ResourceBar {...mainBar} />}
      {otherBars.length > 0 && (
        <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
          {otherBars.map((r) => (
            <span key={r.key} className="text-[8.5px] font-mono text-zinc-500">
              {r.abbr} {r.current}/{r.max}
            </span>
          ))}
        </div>
      )}

      {shownConditions.length > 0 && (
        <div className="flex items-center gap-0.5">
          {shownConditions.map((c) => (
            <span key={c.key} title={c.description || c.label} className="w-3 h-3 shrink-0 [&>svg]:w-full [&>svg]:h-full" style={{ color: c.color }} dangerouslySetInnerHTML={{ __html: c.icon }} />
          ))}
          {extraConditions > 0 && <span className="text-[8px] text-zinc-500 font-mono">+{extraConditions}</span>}
        </div>
      )}
    </button>
  );
};

interface ResourceValues {
  key: string;
  abbr: string;
  current: number;
  max: number;
  temp: number;
}

function resourceValues(def: SystemDefinition, computed: ReturnType<typeof computeCharacter>, character: Character, key: string): ResourceValues {
  const resDef = def.resources.find((r) => r.key === key);
  const entry = character.resources[key];
  return {
    key,
    abbr: resDef?.abbr ?? key,
    current: entry?.current ?? 0,
    max: computed.resources[key]?.max ?? 0,
    temp: resDef?.hasTemp ? (entry?.temp ?? 0) : 0,
  };
}

/** Barra fininha com número por cima, mesma convenção de cor do token no mapa (VttCanvas): verde
 *  acima de 50%, dourado acima de 25%, vermelho abaixo disso. Temporário só entra no texto ("+N"). */
const ResourceBar: React.FC<ResourceValues> = ({ abbr, current, max, temp }) => {
  const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  const color = percent > 50 ? "#10b981" : percent > 25 ? "#d4af37" : "#ef4444";
  return (
    <div className="relative w-full h-3 rounded bg-[#0c0c0c] border border-[#2d2417] overflow-hidden">
      <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${percent}%`, backgroundColor: color }} />
      <span className="relative z-10 flex items-center justify-center h-full text-[8px] font-mono font-bold text-zinc-200">
        {abbr} {current}/{max}
        {temp > 0 ? ` +${temp}` : ""}
      </span>
    </div>
  );
};
