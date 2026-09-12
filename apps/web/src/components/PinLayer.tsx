import React from "react";
import { Circle, Group, Image as KonvaImage, Line, Path, Text } from "react-konva";
import { conditionIconDataUrl, type Pin, type PinIconDef } from "@tormenta-vtt/shared";
import { useImage } from "../lib/useImage";
import { findPinIcon } from "../lib/pinIcons";

/** Raio do pino em pixels de TELA (constante, independente do zoom — mesmo espírito do rótulo "N alvos" de TemplateLayer). */
export const PIN_RADIUS = 15;

const FILL = "#1a1712";
const STROKE = "#d4af37";

/** Ícone de imagem (moldura + montanha), traçado à mão em -8..8 pra não depender de fonte de ícone dentro do Konva. */
const IMAGE_ICON = "M -7 -5 L 7 -5 L 7 5 L -7 5 Z M -5 3 L -2 -1 L 0 1.5 L 2 -2 L 5 3 Z";
/** Ícone de texto (linhas de parágrafo). */
const TEXT_LINES = [-6, -6, 6, -6, -6, -1.5, 6, -1.5, -6, 3, 3, 3];

/**
 * Ícone de um pino de NOTA: SVG (da lista do sistema ou padrão embutido, ver lib/pinIcons.ts)
 * rasterizado com a cor do pino — mesmo mecanismo de `ConditionBadge` (VttCanvas): Konva não tem
 * DOM/CSS, então a cor precisa estar gravada no SVG antes de virar imagem (`conditionIconDataUrl`,
 * reaproveitada aqui — a função é genérica, "SVG + cor -> data URI", apesar do nome).
 */
const NotePinIcon: React.FC<{ pin: Pin & { kind: "note" }; icons: PinIconDef[] }> = ({ pin, icons }) => {
  const def = findPinIcon(icons, pin.icon);
  const color = pin.color ?? def.color;
  const url = React.useMemo(() => conditionIconDataUrl(def.icon, color), [def.icon, color]);
  const image = useImage(url);
  const size = PIN_RADIUS * 1.1;
  return image ? (
    <KonvaImage image={image} x={-size / 2} y={-size / 2} width={size} height={size} />
  ) : (
    <Text text={pin.title.charAt(0).toUpperCase()} x={-PIN_RADIUS} y={-PIN_RADIUS * 0.45} width={PIN_RADIUS * 2} align="center" fontSize={PIN_RADIUS} fontStyle="bold" fill={color} />
  );
};

/**
 * Pinos no mapa (docs/plano-narracao.md — unifica o antigo HandoutPinLayer com pino de nota):
 * ícone circular fixo na posição do pino, um por `kind` ("image"/"text" = handout, "note" = nota
 * do GM). Só desenho (`listening={false}`) — clique/apagar são detectados por GEOMETRIA em
 * VttCanvas, mesmo motivo de sempre neste projeto (canvas de hit do Konva embaralhado por proteção
 * anti-fingerprinting, docs/debug-condicoes.md) — mesmo padrão de `TemplateLayer`.
 */
export const PinLayer: React.FC<{ pins: Pin[]; icons: PinIconDef[]; selectedId?: string | null; stageScale: number }> = ({
  pins,
  icons,
  selectedId,
  stageScale,
}) => (
  <>
    {pins.map((pin) => {
      const stroke = pin.kind === "note" ? (pin.color ?? STROKE) : STROKE;
      return (
        <Group key={pin.id} x={pin.x} y={pin.y} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
          {/* Halo de seleção (docs/plano-narracao.md — pino se comporta como token): mesmo anel
           *  tracejado dourado do token/gabarito selecionado. */}
          {pin.id === selectedId && <Circle radius={PIN_RADIUS + 5} stroke="#d4af37" strokeWidth={1.5} dash={[4, 4]} />}
          <Circle radius={PIN_RADIUS} fill={FILL} stroke={stroke} strokeWidth={1.5} shadowColor="#000" shadowBlur={4} shadowOpacity={0.6} />
          {pin.kind === "image" && <Path data={IMAGE_ICON} fill={STROKE} />}
          {pin.kind === "text" && (
            <>
              {Array.from({ length: TEXT_LINES.length / 4 }, (_, i) => (
                <Line key={i} points={TEXT_LINES.slice(i * 4, i * 4 + 4)} stroke={STROKE} strokeWidth={1.5} lineCap="round" />
              ))}
            </>
          )}
          {pin.kind === "note" && <NotePinIcon pin={pin} icons={icons} />}
          {!pin.visible && <Text text="•" fontSize={18} fill="#f87171" x={PIN_RADIUS - 6} y={-PIN_RADIUS - 4} listening={false} />}
        </Group>
      );
    })}
  </>
);
