import React from 'react';
import { Dices } from 'lucide-react';

interface DiceIconProps {
  /** Lados do dado (`DiceGroupResult.sides`). Fórmulas fora do jogo padrão (ex. `1d3`) não têm
   *  sólido desenhado e caem no ícone genérico `Dices` do lucide. */
  sides: number;
  className?: string;
  /** Tamanho real em px do SVG renderizado. Só decide se os números aparecem nas faces — abaixo
   *  de 32px viram ruído (pedido do dono); acima disso, cada face visível mostra um número. Sem
   *  este prop, nunca mostra número (é o caso do ícone pequeno no cartão de rolagem). */
  size?: number;
}

type Point = readonly [number, number];

interface Face {
  /** Vértices do polígono da face, em ordem (contorno fechado). */
  points: readonly Point[];
  /** Número ilustrativo da face — não é o resultado de uma rolagem real, é só o desenho de
   *  "como esse dado é numerado" (pedido do dono: números fixos nas faces, não o resultado). */
  number: number;
}

const CENTER: Point = [12, 12];

/** Traço fino e uniforme (currentColor, sem preenchimento) — a cor (neutro/crítico/falha) é
 *  decidida por quem usa o ícone: um `className`/`style` com `text-accent` ou `text-danger` no
 *  elemento pai, e o SVG herda via `currentColor`. */
const STROKE = 1.4;

function facePath(points: readonly Point[]): string {
  return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

function centroid(points: readonly Point[]): Point {
  const x = points.reduce((sum, [px]) => sum + px, 0) / points.length;
  const y = points.reduce((sum, [, py]) => sum + py, 0) / points.length;
  return [x, y];
}

/** Ângulo (em graus, 0 = topo, sentido horário) do centro da face até o centro do desenho —
 *  usado pra girar o número "no sentido da face", como um dado fotografado de verdade: face perto
 *  do topo fica quase reta, faces mais pro lado inclinam. Amortecido (0.35×, até ±28°) pra não
 *  virar de cabeça pra baixo nas faces de baixo, o que ficaria ilegível num ícone pequeno. */
function faceRotation(face: Face, center: Point = CENTER): number {
  const [cx, cy] = centroid(face.points);
  const [ox, oy] = center;
  const dx = cx - ox;
  const dy = cy - oy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return 0;
  let bearing = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = topo, 90 = direita, ±180 = baixo
  if (bearing > 180) bearing -= 360;
  return Math.max(-28, Math.min(28, bearing * 0.35));
}

function Faces({ faces }: { faces: readonly Face[] }) {
  return (
    <>
      {faces.map((f, i) => (
        <path key={i} d={facePath(f.points)} />
      ))}
    </>
  );
}

function FaceNumbers({ faces, fontSize }: { faces: readonly Face[]; fontSize: number }) {
  return (
    <>
      {faces.map((f, i) => {
        const [cx, cy] = centroid(f.points);
        const rotation = faceRotation(f);
        return (
          <text
            key={i}
            x={cx}
            y={cy}
            transform={`rotate(${rotation.toFixed(1)} ${cx} ${cy})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={fontSize}
            fontFamily="var(--font-data)"
            stroke="none"
            fill="currentColor"
          >
            {f.number}
          </text>
        );
      })}
    </>
  );
}

// Coordenadas de cada sólido: desenho técnico de frente, simétrico, com TODAS as arestas
// internas que separam as faces reais (não uma silhueta genérica) — pedido do dono. Cada face é
// um polígono próprio (as arestas compartilhadas saem duplicadas no traço, sem efeito visível
// num traço de 1.4px). Números são ilustrativos (a numeração real de cada tipo de dado), só
// aparecem com `size >= 32`.

/** Tetraedro (d4): 3 faces triangulares visíveis, encontrando o vértice de trás no meio. */
const D4_FACES: Face[] = [
  { points: [[12, 3], [21, 20], [12, 14]], number: 2 },
  { points: [[21, 20], [3, 20], [12, 14]], number: 4 },
  { points: [[3, 20], [12, 3], [12, 14]], number: 1 },
];

/** Cubo (d6) em perspectiva isométrica: hexágono + garfo até o centro = 3 losangos (as 3 faces
 *  visíveis de um cubo olhado de vértice — nunca dá pra ver mais que 3 faces de uma vez). */
const D6_HEX: readonly [Point, Point, Point, Point, Point, Point] = [
  [12, 4], [20, 8.5], [20, 15.5], [12, 20], [4, 15.5], [4, 8.5],
];
const [D6_T, D6_TR, D6_BR, D6_B, D6_BL, D6_TL] = D6_HEX;
const D6_FACES: Face[] = [
  { points: [D6_T, D6_TR, D6_BR, CENTER], number: 6 },
  { points: [D6_BR, D6_B, D6_BL, CENTER], number: 3 },
  { points: [D6_BL, D6_TL, D6_T, CENTER], number: 1 },
];

/** Octaedro (d8): losango + as duas diagonais = 4 faces triangulares (as 4 visíveis olhando de
 *  vértice, a outra metade do sólido fica atrás). */
const D8_T: Point = [12, 2];
const D8_R: Point = [22, 12];
const D8_B: Point = [12, 22];
const D8_L: Point = [2, 12];
const D8_FACES: Face[] = [
  { points: [D8_T, D8_R, CENTER], number: 8 },
  { points: [D8_R, D8_B, CENTER], number: 3 },
  { points: [D8_B, D8_L, CENTER], number: 6 },
  { points: [D8_L, D8_T, CENTER], number: 1 },
];

/** Trapezoedro pentagonal (d10): mesma lógica do cubo (hexágono + garfo = 3 faces), só que o
 *  hexágono é alongado/estreito — a "pedra" pontuda característica do d10, não um cubo. */
const D10_HEX: readonly [Point, Point, Point, Point, Point, Point] = [
  [12, 2.5], [17.6, 7.8], [17.6, 16.2], [12, 21.5], [6.4, 16.2], [6.4, 7.8],
];
const [D10_T, D10_TR, D10_BR, D10_B, D10_BL, D10_TL] = D10_HEX;
const D10_FACES: Face[] = [
  { points: [D10_T, D10_TR, D10_BR, CENTER], number: 9 },
  { points: [D10_BR, D10_B, D10_BL, CENTER], number: 0 },
  { points: [D10_BL, D10_TL, D10_T, CENTER], number: 4 },
];

/** Dodecaedro (d12): pentágono central + 5 pentágonos ao redor (cada um dividindo uma aresta com
 *  o do meio e uma aresta com cada vizinho) — as faces pentagonais de verdade, não triângulos.
 *  Coordenadas calculadas à mão (raio 3.7/7/8.8 a cada 72°/36°, ver PR) e deixadas literais, pra
 *  não depender de trig em runtime nem arredondar diferente a cada build. */
const D12_C: readonly Point[] = [[12, 8.3], [15.52, 10.86], [14.18, 14.99], [9.82, 14.99], [8.48, 10.86]];
const D12_N: readonly Point[] = [[12, 5.0], [18.66, 9.84], [16.12, 17.66], [7.88, 17.66], [5.34, 9.84]];
const D12_A: readonly Point[] = [[17.17, 4.88], [20.37, 14.72], [12, 20.8], [3.63, 14.72], [6.83, 4.88]];
function d12Petal(k: number): readonly Point[] {
  const k1 = (k + 1) % 5;
  return [D12_C[k]!, D12_C[k1]!, D12_N[k1]!, D12_A[k]!, D12_N[k]!];
}
const D12_FACES: Face[] = [
  { points: D12_C, number: 12 },
  { points: d12Petal(0), number: 1 },
  { points: d12Petal(1), number: 2 },
  { points: d12Petal(2), number: 3 },
  { points: d12Petal(3), number: 4 },
  { points: d12Petal(4), number: 5 },
];

/** Icosaedro (d20): hexágono + triângulo central + as arestas de ligação — um hexágono
 *  inteiramente triangulado (face central + 9 ao redor, todas fechadas), a face de frente em
 *  destaque no meio e as faces ao redor completas, igual à referência de um d20 de contorno. */
const D20_P: readonly [Point, Point, Point, Point, Point, Point] = [
  [12, 2.5], [20.23, 7.25], [20.23, 16.75], [12, 21.5], [3.77, 16.75], [3.77, 7.25],
];
const [D20_P0, D20_P1, D20_P2, D20_P3, D20_P4, D20_P5] = D20_P;
const D20_C0: Point = [12, 16.2];
const D20_C1: Point = [8.36, 9.9];
const D20_C2: Point = [15.64, 9.9];
const D20_FACES: Face[] = [
  { points: [D20_C0, D20_C1, D20_C2], number: 20 },
  { points: [D20_P0, D20_P1, D20_C2], number: 9 },
  { points: [D20_P0, D20_C2, D20_C1], number: 5 },
  { points: [D20_P0, D20_C1, D20_P5], number: 13 },
  { points: [D20_P1, D20_P2, D20_C2], number: 17 },
  { points: [D20_P2, D20_C2, D20_C0], number: 3 },
  { points: [D20_P2, D20_C0, D20_P3], number: 11 },
  { points: [D20_P3, D20_P4, D20_C0], number: 1 },
  { points: [D20_P4, D20_C0, D20_C1], number: 15 },
  { points: [D20_P4, D20_C1, D20_P5], number: 7 },
];

/** d10 em miniatura (coordenadas locais, origem no centro do próprio desenho) — reusado 2× pelo
 *  d100: um atrás/à esquerda (dezena) e um à frente/à direita (unidade). */
const D10_LOCAL: readonly [Point, Point, Point, Point, Point, Point] = [
  [0, -9.5], [5.6, -4.2], [5.6, 4.2], [0, 9.5], [-5.6, 4.2], [-5.6, -4.2],
];
const [D10L_T, D10L_TR, D10L_BR, D10L_B, D10L_BL, D10L_TL] = D10_LOCAL;
function d100Mini(cx: number, cy: number, scale: number): { faces: Face[]; center: Point } {
  const tr = ([x, y]: Point): Point => [cx + x * scale, cy + y * scale];
  const center = tr([0, 0]);
  const faces: Face[] = [
    { points: [tr(D10L_T), tr(D10L_TR), tr(D10L_BR), center], number: 0 },
    { points: [tr(D10L_BR), tr(D10L_B), tr(D10L_BL), center], number: 0 },
    { points: [tr(D10L_BL), tr(D10L_TL), tr(D10L_T), center], number: 0 },
  ];
  return { faces, center };
}

const DIE_DATA: Record<number, { faces: readonly Face[]; fontSize: number }> = {
  4: { faces: D4_FACES, fontSize: 6.5 },
  6: { faces: D6_FACES, fontSize: 5.5 },
  8: { faces: D8_FACES, fontSize: 5 },
  10: { faces: D10_FACES, fontSize: 5.5 },
  12: { faces: D12_FACES, fontSize: 4 },
  20: { faces: D20_FACES, fontSize: 3.8 },
};

const commonSvgProps = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: STROKE,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * Ícone do dado por tipo, desenhado como o sólido geométrico real visto de frente — todas as
 * arestas internas que separam as faces ficam visíveis (não é uma silhueta genérica). Traço fino
 * e uniforme em `currentColor`, sem preenchimento nem sombra; os números (ilustrativos, a
 * numeração real do tipo de dado — não o resultado de uma rolagem) só aparecem com `size >= 32`,
 * girados de leve conforme a posição da face (pedido do dono, "como um dado real").
 */
export const DiceIcon: React.FC<DiceIconProps> = ({ sides, className, size }) => {
  const showNumber = size !== undefined && size >= 32;
  const svgProps = { ...commonSvgProps, className, ...(size !== undefined ? { width: size, height: size } : {}) };

  if (sides === 100) {
    const back = d100Mini(9, 9, 0.62);
    const front = d100Mini(15.5, 15.5, 0.62);
    return (
      <svg {...svgProps}>
        <Faces faces={back.faces} />
        <Faces faces={front.faces} />
        {showNumber && (
          <>
            <text x={back.center[0]} y={back.center[1]} textAnchor="middle" dominantBaseline="central" fontSize={5} fontFamily="var(--font-data)" stroke="none" fill="currentColor">
              7
            </text>
            <text x={front.center[0]} y={front.center[1]} textAnchor="middle" dominantBaseline="central" fontSize={5} fontFamily="var(--font-data)" stroke="none" fill="currentColor">
              0
            </text>
          </>
        )}
      </svg>
    );
  }

  const die = DIE_DATA[sides];
  if (!die) return <Dices className={className} size={size} />;

  return (
    <svg {...svgProps}>
      <Faces faces={die.faces} />
      {showNumber && <FaceNumbers faces={die.faces} fontSize={die.fontSize} />}
    </svg>
  );
};
