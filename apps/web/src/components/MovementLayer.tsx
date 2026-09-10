import React from "react";
import { Group, Label, Line, Tag, Text } from "react-konva";
import { fitsInBudget, stepCost, type SystemDefinition } from "@tormenta-vtt/shared";

const GOLD = "#d4af37";
const RED = "#ef4444";

/** "4,5" em vez de "4.500000000001" (soma de floats) — 1 casa, sem zero à toa quando é inteiro. */
function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
}

export interface MovementLayerProps {
  def: SystemDefinition;
  /** Caminho do combatente da vez (Combatant.movementPath), já convertido pra CENTRO do token —
   *  pixels do mapa. Pelo menos 1 ponto (início do turno) sempre que este layer é montado. */
  path: { x: number; y: number }[];
  /** Centro do token da vez AGORA — inclui a posição "ao vivo" durante arraste/passo de teclado. */
  current: { x: number; y: number };
  /** Orçamento do turno (unidade do grid do sistema). */
  budget: number;
  /** Gasto já confirmado (sem contar o segmento ao vivo até `current`). */
  used: number;
  diagonals: number;
  /** Lado da célula da CENA em pixels — converte o segmento ao vivo (px) em células. */
  cellSizePx: number;
  /** Trava desligada na sala (docs/plano-movimento.md §4.1): mostra só o gasto, sem "/ orçamento"
   *  nem vermelho — ninguém está sendo bloqueado, o número é só informativo. */
  limitEnabled: boolean;
  stageScale: number;
}

/**
 * Caminho percorrido no turno do combatente da vez + rótulo "gasto / orçamento" (docs/plano-movimento.md
 * §4.1). Só desenho (`listening={false}`): a régua e os gabaritos já estabeleceram esse padrão no
 * projeto (canvas de hit do Konva embaralhado com várias shapes, ver TemplateLayer). O número ao
 * vivo soma o passo em andamento (`stepCost` do último ponto confirmado até `current`) às mesmas
 * funções puras que o servidor usa pra validar — nunca reimplementa a regra aqui.
 */
export const MovementLayer: React.FC<MovementLayerProps> = ({ def, path, current, budget, used, diagonals, cellSizePx, limitEnabled, stageScale }) => {
  const k = 1 / stageScale;
  const last = path[path.length - 1] ?? current;
  const dxCells = (current.x - last.x) / cellSizePx;
  const dyCells = (current.y - last.y) / cellSizePx;
  const state = { used, diagonals };
  const step = stepCost(def, state, dxCells, dyCells);
  const liveUsed = used + (step?.cost ?? 0);
  const fits = !limitEnabled || fitsInBudget(def, budget, state, dxCells, dyCells);
  const color = fits ? GOLD : RED;
  const unit = def.grid?.unit ?? "";
  const label = limitEnabled ? `${fmt(liveUsed)} / ${fmt(budget)} ${unit}` : `${fmt(liveUsed)} ${unit}`;
  const pathPoints = path.flatMap((p) => [p.x, p.y]);

  return (
    <Group listening={false}>
      {pathPoints.length >= 4 && (
        <Line points={pathPoints} stroke={GOLD} strokeWidth={2 * k} dash={[7 * k, 5 * k]} lineCap="round" lineJoin="round" opacity={0.8} />
      )}
      {/* Segmento ao vivo: do último ponto confirmado até onde o token está agora (parado, ou em
       *  pleno arraste/passo de teclado) — some sozinho quando `current === last`. */}
      <Line points={[last.x, last.y, current.x, current.y]} stroke={color} strokeWidth={2.5 * k} dash={[7 * k, 5 * k]} lineCap="round" opacity={0.95} />
      <Label x={current.x} y={current.y - 30 * k} scaleX={k} scaleY={k}>
        <Tag fill="#1a1a1a" stroke={color} strokeWidth={1} cornerRadius={3} pointerDirection="down" pointerWidth={8} pointerHeight={6} opacity={0.95} />
        <Text text={label} fontSize={12} fontFamily="monospace" fontStyle="bold" fill={color} padding={5} />
      </Label>
    </Group>
  );
};
