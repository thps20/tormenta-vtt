import React, { useEffect, useRef } from "react";
import { Layer, Rect, Circle, Line } from "react-konva";
import Konva from "konva";
import type { FogConfig, FogShape } from "@tormenta-vtt/shared";

interface FogLayerProps {
  fog: FogConfig;
  map: { width: number; height: number };
  /** GM enxerga através da névoa (50%); jogador vê preto opaco. */
  isGm: boolean;
  /** Forma que o GM está desenhando agora (ainda não enviada); desenhada por cima das demais. */
  draft?: FogShape | null;
}

/** Opacidade da névoa para o GM. Jogador: 1. */
const GM_FOG_OPACITY = 0.5;
const FOG_COLOR = "#000";

/**
 * Camada da névoa. Fica acima do mapa e dos tokens que o usuário não controla, e
 * abaixo dos que controla (ver VttCanvas). Desenho: retângulo preto do mapa (se a
 * base é "hidden") e, em ordem, cada shape: `reveal` apaga com destination-out,
 * `hide` pinta preto de novo. A última shape que cobre um ponto decide, igual a
 * `isPointRevealed` no shared.
 *
 * A opacidade do GM vai no elemento <canvas> da Layer (CSS), não nas shapes: com
 * opacidade por shape, o destination-out a 50% só apagaria metade da névoa e as
 * áreas ocultas sobrepostas ficariam mais escuras que as outras. Cada Layer do
 * Konva é um <canvas> próprio, então isso é barato e exato.
 */
export const FogLayer: React.FC<FogLayerProps> = ({ fog, map, isGm, draft = null }) => {
  const layerRef = useRef<Konva.Layer>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.getNativeCanvasElement().style.opacity = String(isGm ? GM_FOG_OPACITY : 1);
  }, [isGm, fog.enabled]);

  if (!fog.enabled) return null;

  return (
    <Layer id="fog-layer" ref={layerRef} listening={false}>
      {fog.base === "hidden" && <Rect x={0} y={0} width={map.width} height={map.height} fill={FOG_COLOR} />}
      {fog.shapes.map((shape) => (
        <FogShapeNode key={shape.id} shape={shape} />
      ))}
      {draft && <FogShapeNode shape={draft} />}
    </Layer>
  );
};

/** Uma shape da névoa. `reveal` recorta a camada (destination-out); `hide` pinta por cima. */
const FogShapeNode: React.FC<{ shape: FogShape }> = ({ shape }) => {
  const op: GlobalCompositeOperation = shape.mode === "reveal" ? "destination-out" : "source-over";
  switch (shape.kind) {
    case "circle":
      return <Circle x={shape.cx} y={shape.cy} radius={shape.r} fill={FOG_COLOR} globalCompositeOperation={op} />;
    case "rect":
      return <Rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={FOG_COLOR} globalCompositeOperation={op} />;
    case "polygon":
      return <Line points={shape.points} closed fill={FOG_COLOR} globalCompositeOperation={op} />;
    case "stroke":
      // Pontas e junções redondas: é o que faz o traço parecer um círculo que seguiu o mouse.
      return <Line points={shape.points} stroke={FOG_COLOR} strokeWidth={shape.width} lineCap="round" lineJoin="round" globalCompositeOperation={op} />;
  }
};
