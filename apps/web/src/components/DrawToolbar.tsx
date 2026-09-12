import React from "react";
import { ArrowRight, Circle, Eye, EyeOff, Minus, Pencil, Square, Trash2, Type, Users } from "lucide-react";
import { DRAWING_MAX_STROKE_WIDTH, DRAWING_MIN_STROKE_WIDTH, DRAWING_WARN_PER_SCENE, type DrawingKind } from "@tormenta-vtt/shared";
import { DRAWING_COLORS } from "../store/tools";

interface DrawToolbarProps {
  isGm: boolean;
  drawKind: DrawingKind;
  drawColor: string;
  strokeWidth: number;
  filled: boolean;
  /** Visibilidade do PRÓXIMO traço que o GM criar ("todos" padrão, ou "só GM" — SPEC §9.17). Não
   *  aparece pro jogador: o servidor sempre força `true` no traço dele. */
  visible: boolean;
  /** Quantos traços já existem no mapa atual — só pro aviso âmbar (o servidor recusa acima do máximo). */
  drawingCount: number;
  /** "Jogadores podem desenhar" da sala (só o GM vê/mexe o toggle; jogador vê um aviso quando está desligado). */
  playerDrawingEnabled: boolean;
  onDrawKind: (kind: DrawingKind) => void;
  onDrawColor: (color: string) => void;
  onStrokeWidth: (width: number) => void;
  onFilled: (filled: boolean) => void;
  onVisible: (visible: boolean) => void;
  onTogglePlayerDrawing: () => void;
  onClearMine: () => void;
  onClearAll: () => void;
}

const KINDS: Array<{ value: DrawingKind; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: "pen", label: "Caneta", Icon: Pencil },
  { value: "line", label: "Linha", Icon: Minus },
  { value: "rect", label: "Retângulo", Icon: Square },
  { value: "ellipse", label: "Elipse", Icon: Circle },
  { value: "arrow", label: "Seta", Icon: ArrowRight },
  { value: "text", label: "Texto", Icon: Type },
];

/**
 * Painel secundário do modo Desenho (SPEC §9.17), à direita da barra de ferramentas — mesmo
 * molde visual de `FogToolbar.tsx`: forma do traço, paleta de cor, espessura, preenchimento (só
 * formas fechadas), "Limpar meus"/"Limpar tudo" (GM) e o toggle "jogadores podem desenhar" (GM).
 * Jogador vê um aviso somente-leitura quando o GM desligou o toggle (não trava a ferramenta em si,
 * só a criação de traço novo — mover/apagar os que ele já tinha continua liberado).
 */
export const DrawToolbar: React.FC<DrawToolbarProps> = ({
  isGm,
  drawKind,
  drawColor,
  strokeWidth,
  filled,
  visible,
  drawingCount,
  playerDrawingEnabled,
  onDrawKind,
  onDrawColor,
  onStrokeWidth,
  onFilled,
  onVisible,
  onTogglePlayerDrawing,
  onClearMine,
  onClearAll,
}) => {
  const isClosedShape = drawKind === "rect" || drawKind === "ellipse";
  const isText = drawKind === "text";

  return (
    <div
      id="draw-toolbar"
      role="toolbar"
      aria-label="Ferramentas de desenho"
      className="absolute top-4 left-[4.25rem] z-10 flex items-center gap-1.5 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-300"
    >
      <Segmented items={KINDS} value={drawKind} onChange={onDrawKind} idPrefix="draw-kind" />
      <Divider />
      <div className="flex items-center gap-1 px-0.5" role="group" aria-label="Cor do traço">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-pressed={drawColor === c}
            onClick={() => onDrawColor(c)}
            style={{ backgroundColor: c }}
            className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${drawColor === c ? "ring-2 ring-[#d4af37] ring-offset-1 ring-offset-[#1a1a1a] scale-110" : "hover:scale-110"}`}
          />
        ))}
      </div>
      <Divider />
      <label className="flex items-center gap-1.5 px-1.5 text-[10px] font-mono text-zinc-400" title={isText ? "Tamanho do texto" : "Espessura do traço"}>
        <input
          id="draw-stroke-width"
          type="range"
          min={DRAWING_MIN_STROKE_WIDTH}
          max={DRAWING_MAX_STROKE_WIDTH}
          step={1}
          value={strokeWidth}
          onChange={(e) => onStrokeWidth(Number(e.target.value))}
          className="w-16 accent-[#d4af37]"
        />
        <span className="w-6 text-right tabular-nums">{strokeWidth}</span>
      </label>
      {isClosedShape && (
        <>
          <Divider />
          <label className="flex items-center gap-1 px-1 text-[10px] font-serif font-bold uppercase tracking-wider text-zinc-400 cursor-pointer" title="Preencher a forma com a cor escolhida">
            <input id="draw-filled" type="checkbox" checked={filled} onChange={(e) => onFilled(e.target.checked)} className="accent-[#d4af37]" />
            Preencher
          </label>
        </>
      )}
      {isGm && (
        <>
          <Divider />
          <button
            id="draw-visible"
            type="button"
            aria-pressed={visible}
            title="Visibilidade do PRÓXIMO traço que você desenhar"
            onClick={() => onVisible(!visible)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
              visible ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "bg-[#252525] text-zinc-400 border border-[#3d3d3d]"
            }`}
          >
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {visible ? "Todos veem" : "Só o GM"}
          </button>
        </>
      )}
      <Divider />
      <TextButton id="draw-clear-mine" title="Apaga só os traços que você desenhou neste mapa" onClick={onClearMine}>
        <Trash2 className="w-3.5 h-3.5" />
        Limpar meus
      </TextButton>
      {isGm && (
        <TextButton id="draw-clear-all" title="Apaga todos os traços deste mapa, de qualquer dono" onClick={onClearAll}>
          <Trash2 className="w-3.5 h-3.5" />
          Limpar tudo
        </TextButton>
      )}
      {isGm ? (
        <>
          <Divider />
          <button
            id="draw-player-permission"
            type="button"
            aria-pressed={playerDrawingEnabled}
            title={playerDrawingEnabled ? "Jogadores podem desenhar (clique para desligar)" : "Jogadores NÃO podem desenhar (clique para ligar)"}
            onClick={onTogglePlayerDrawing}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
              playerDrawingEnabled ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "text-zinc-400 border border-transparent hover:bg-[#252525]"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Jogadores {playerDrawingEnabled ? "podem" : "não podem"} desenhar
          </button>
        </>
      ) : (
        !playerDrawingEnabled && (
          <>
            <Divider />
            <span className="text-[10px] font-serif uppercase tracking-wider text-amber-400 px-1.5">O Mestre desativou o desenho para jogadores</span>
          </>
        )
      )}
      <span
        className={`text-[10px] font-mono px-1.5 tabular-nums ${drawingCount > DRAWING_WARN_PER_SCENE ? "text-amber-400" : "text-zinc-500"}`}
        title="Traços neste mapa"
      >
        {drawingCount} {drawingCount === 1 ? "traço" : "traços"}
      </span>
    </div>
  );
};

function Divider() {
  return <div className="w-[1px] h-5 bg-[#2d2417] mx-0.5" />;
}

function Segmented<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
}: {
  items: Array<{ value: T; label: string; Icon: React.ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (v: T) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {items.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          id={`${idPrefix}-${v}`}
          type="button"
          aria-pressed={value === v}
          title={label}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
            value === v ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "text-zinc-400 border border-transparent hover:bg-[#252525] hover:text-[#d4af37]"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function TextButton({ id, title, onClick, children }: { id: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider text-zinc-400 hover:bg-[#252525] hover:text-[#d4af37] cursor-pointer transition-colors"
    >
      {children}
    </button>
  );
}
