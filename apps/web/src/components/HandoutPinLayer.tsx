import React from "react";
import { Circle, Group, Line, Path, Text } from "react-konva";
import type { HandoutPin } from "@tormenta-vtt/shared";

/** Raio do pino em pixels de TELA (constante, independente do zoom — mesmo espírito do rótulo "N alvos" de TemplateLayer). */
export const HANDOUT_PIN_RADIUS = 15;

const FILL = "#1a1712";
const STROKE = "#d4af37";

/** Ícone de imagem (moldura + montanha), traçado à mão em -8..8 pra não depender de fonte de ícone dentro do Konva. */
const IMAGE_ICON = "M -7 -5 L 7 -5 L 7 5 L -7 5 Z M -5 3 L -2 -1 L 0 1.5 L 2 -2 L 5 3 Z";
/** Ícone de texto (linhas de parágrafo). */
const TEXT_LINES = [-6, -6, 6, -6, -6, -1.5, 6, -1.5, -6, 3, 3, 3];

/**
 * Pinos de handout fixados no mapa (§9.10): ícone circular fixo (imagem ou texto) na posição do
 * pino. Só desenho (`listening={false}`) — clique/apagar são detectados por GEOMETRIA em
 * VttCanvas, mesmo motivo de sempre neste projeto (canvas de hit do Konva embaralhado por
 * proteção anti-fingerprinting, docs/debug-condicoes.md) — mesmo padrão de `TemplateLayer`.
 */
export const HandoutPinLayer: React.FC<{ pins: HandoutPin[]; stageScale: number }> = ({ pins, stageScale }) => (
  <>
    {pins.map((pin) => (
      <Group key={pin.id} x={pin.x} y={pin.y} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
        <Circle radius={HANDOUT_PIN_RADIUS} fill={FILL} stroke={STROKE} strokeWidth={1.5} shadowColor="#000" shadowBlur={4} shadowOpacity={0.6} />
        {pin.kind === "image" ? (
          <Path data={IMAGE_ICON} fill={STROKE} />
        ) : (
          <>
            {Array.from({ length: TEXT_LINES.length / 4 }, (_, i) => (
              <Line key={i} points={TEXT_LINES.slice(i * 4, i * 4 + 4)} stroke={STROKE} strokeWidth={1.5} lineCap="round" />
            ))}
          </>
        )}
        {!pin.visible && (
          <Text text="•" fontSize={18} fill="#f87171" x={HANDOUT_PIN_RADIUS - 6} y={-HANDOUT_PIN_RADIUS - 4} listening={false} />
        )}
      </Group>
    ))}
  </>
);
