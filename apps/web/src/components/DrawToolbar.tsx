import React from "react";
import { ArrowRight, Circle, Eye, EyeOff, Minus, Pencil, Square, Trash2, Type, Users } from "lucide-react";
import { DRAWING_MAX_STROKE_WIDTH, DRAWING_MIN_STROKE_WIDTH, DRAWING_WARN_PER_SCENE, type DrawingKind } from "@tormenta-vtt/shared";
import { DRAWING_COLORS } from "../store/tools";
import { BarCount, BarDivider, BarSegmented, BarTextButton, BarToggle, FLOAT_SURFACE } from "./MapBar";

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
 * Painel secundário do modo Desenho (SPEC §9.17), à direita da barra de ferramentas — mesmas
 * peças visuais de `MapBar.tsx` que a `FogToolbar.tsx`: forma do traço, paleta de cor, espessura, preenchimento (só
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
      // Quebra em duas linhas em vez de passar por baixo do painel lateral (são até ~20 controles).
      className={`absolute top-4 left-[4.25rem] z-10 flex flex-wrap items-center gap-1 p-1 max-w-[calc(100%-5.25rem)] ${FLOAT_SURFACE}`}
    >
      <BarSegmented items={KINDS} value={drawKind} onChange={onDrawKind} idPrefix="draw-kind" />
      <BarDivider />
      <div className="flex items-center gap-0.5 px-0.5" role="group" aria-label="Cor do traço">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Cor ${c}`}
            aria-pressed={drawColor === c}
            onClick={() => onDrawColor(c)}
            className="focus-ring group grid place-items-center w-6 h-6 rounded-full cursor-pointer"
          >
            <span
              style={{ backgroundColor: c }}
              className={`block w-4 h-4 rounded-full transition-shadow duration-150 ease-out ${
                drawColor === c ? "ring-2 ring-text ring-offset-2 ring-offset-surface-1" : "ring-1 ring-black/40 group-hover:ring-text-muted"
              }`}
            />
          </button>
        ))}
      </div>
      <BarDivider />
      <label className="flex items-center gap-1.5 px-1.5 font-data text-12 text-text-muted" title={isText ? "Tamanho do texto" : "Espessura do traço"}>
        <input
          id="draw-stroke-width"
          type="range"
          min={DRAWING_MIN_STROKE_WIDTH}
          max={DRAWING_MAX_STROKE_WIDTH}
          step={1}
          value={strokeWidth}
          onChange={(e) => onStrokeWidth(Number(e.target.value))}
          className="focus-ring w-16 accent-text cursor-pointer"
        />
        <span className="w-6 text-right tabular-nums">{strokeWidth}</span>
      </label>
      {isClosedShape && (
        <>
          <BarDivider />
          <label className="flex items-center gap-1.5 h-7 px-1.5 text-12 font-medium text-text-muted hover:text-text cursor-pointer" title="Preencher a forma com a cor escolhida">
            <input id="draw-filled" type="checkbox" checked={filled} onChange={(e) => onFilled(e.target.checked)} className="focus-ring w-3.5 h-3.5 accent-text cursor-pointer" />
            Preencher
          </label>
        </>
      )}
      {isGm && (
        <>
          <BarDivider />
          <BarToggle id="draw-visible" pressed={visible} title="Visibilidade do PRÓXIMO traço que você desenhar" onClick={() => onVisible(!visible)}>
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {visible ? "Todos veem" : "Só o GM"}
          </BarToggle>
        </>
      )}
      <BarDivider />
      <BarTextButton id="draw-clear-mine" title="Apaga só os traços que você desenhou neste mapa" onClick={onClearMine}>
        <Trash2 className="w-3.5 h-3.5" />
        Limpar meus
      </BarTextButton>
      {isGm && (
        <BarTextButton id="draw-clear-all" title="Apaga todos os traços deste mapa, de qualquer dono" onClick={onClearAll}>
          <Trash2 className="w-3.5 h-3.5" />
          Limpar tudo
        </BarTextButton>
      )}
      {isGm ? (
        <>
          <BarDivider />
          <BarToggle
            id="draw-player-permission"
            pressed={playerDrawingEnabled}
            title={playerDrawingEnabled ? "Jogadores podem desenhar (clique para desligar)" : "Jogadores NÃO podem desenhar (clique para ligar)"}
            onClick={onTogglePlayerDrawing}
          >
            <Users className="w-3.5 h-3.5" />
            Jogadores {playerDrawingEnabled ? "podem" : "não podem"} desenhar
          </BarToggle>
        </>
      ) : (
        !playerDrawingEnabled && (
          <>
            <BarDivider />
            <span className="text-12 text-text px-1.5">O Mestre desativou o desenho para jogadores</span>
          </>
        )
      )}
      <BarCount warn={drawingCount > DRAWING_WARN_PER_SCENE} title="Traços neste mapa">
        {drawingCount} {drawingCount === 1 ? "traço" : "traços"}
      </BarCount>
    </div>
  );
};
