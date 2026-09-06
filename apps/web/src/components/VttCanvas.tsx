import React, { useRef, useState, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Circle, Text, Group, Line, Image as KonvaImage, Transformer } from "react-konva";
import Konva from "konva";
import { ZoomIn, ZoomOut, Maximize2, Magnet, Grid as GridIcon, Info, Plus } from "lucide-react";
import type { Character, Participant, Scene, Token, TokenPatch } from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";
import { clampToMap, gridLines, snapToGrid } from "../lib/grid";
import { useImage } from "../lib/useImage";
import type { ToolMode } from "../store/tools";
import { TokenInspector } from "./TokenInspector";

/** Tamanho padrão quando a cena ainda não tem mapa. */
export const DEFAULT_MAP = { width: 1600, height: 1100 };

interface VttCanvasProps {
  scene: Scene;
  /** Ferramenta em vigor (ver store/tools): decide quem responde ao arraste. */
  mode: ToolMode;
  tokens: Token[];
  participants: Participant[];
  me: Participant;
  activeTurnTokenId: string | null;
  selectedTokenId: string | null;
  /** Pedido externo de centralizar num token (clique na iniciativa). */
  focusRequest: { tokenId: string; nonce: number } | null;
  onSelectToken: (tokenId: string | null) => void;
  /** Durante o arraste (throttled na store). */
  onTokenMoveLive: (tokenId: string, x: number, y: number) => void;
  /** Ao soltar / redimensionar / editar: patch com ack e reversão. */
  onTokenPatch: (patch: TokenPatch) => void;
  /** GM: criar token no ponto (pixels do mapa) com o tamanho de uma célula. */
  onTokenCreate: (pos: { x: number; y: number }, size: number) => void;
  onTokenDelete: (tokenId: string) => void;
  /** Fichas que o usuário pode vincular a um token (ver TokenInspector). */
  linkableCharacters: Character[];
  onLinkCharacter: (tokenId: string, characterId: string | null) => void;
  onOpenCharacter: (characterId: string) => void;
  /** Barra de vida por token (tokenBar do sistema, lida da ficha vinculada). */
  tokenBars: Record<string, TokenBar>;
}

/** Atual/máximo do recurso que o sistema aponta como barra do token. */
export interface TokenBar {
  current: number;
  max: number;
  temp: number;
}

/** Texto de ajuda do canto superior direito, por ferramenta. */
const MODE_HINTS: Record<ToolMode, string> = {
  select: "Arraste tokens para mover • Espaço + arrastar = navegar • Scroll = zoom",
  pan: "Arraste para navegar pelo mapa • Scroll = zoom",
  ruler: "Clique e arraste para medir • Scroll = zoom",
  fog: "Névoa: em breve",
  draw: "Desenho: em breve",
};

/** Largura da borda do círculo do token (pixels do mapa). */
const BODY_STROKE = 3;

/** Raio do círculo do token em pixels do mapa (o token é desenhado a partir de width/height). */
function tokenRadius(t: { width: number; height: number }): number {
  return Math.min(t.width, t.height) / 2;
}

/** GM move tudo; jogador só o que possui (mesma regra do servidor). */
export function canControl(me: Participant, token: Token): boolean {
  return me.role === "gm" || token.ownerId === me.id;
}

export const VttCanvas: React.FC<VttCanvasProps> = ({
  scene,
  mode,
  tokens,
  participants,
  me,
  activeTurnTokenId,
  selectedTokenId,
  focusRequest,
  onSelectToken,
  onTokenMoveLive,
  onTokenPatch,
  onTokenCreate,
  onTokenDelete,
  linkableCharacters,
  onLinkCharacter,
  onOpenCharacter,
  tokenBars,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 40, y: 30 });
  // Preferências locais de visualização (não vão ao servidor).
  const [snapEnabled, setSnapEnabled] = useState(scene.grid.snap);
  const [gridVisible, setGridVisible] = useState(true);

  const mapImage = useImage(assetUrl(scene.mapUrl));
  const mapWidth = scene.mapWidth ?? DEFAULT_MAP.width;
  const mapHeight = scene.mapHeight ?? DEFAULT_MAP.height;
  const map = useMemo(() => ({ width: mapWidth, height: mapHeight }), [mapWidth, mapHeight]);

  useEffect(() => {
    setSnapEnabled(scene.grid.snap);
  }, [scene.grid.snap]);

  // Acompanha o tamanho do container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => setDimensions({ width: container.clientWidth, height: container.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const fitToScreen = () => {
    const scaleX = (dimensions.width - 60) / mapWidth;
    const scaleY = (dimensions.height - 60) / mapHeight;
    // Mapas pequenos podem ser ampliados até 2x para os tokens não ficarem minúsculos.
    const fitScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 2.0);
    setStageScale(fitScale);
    setStagePos({
      x: Math.max(20, (dimensions.width - mapWidth * fitScale) / 2),
      y: Math.max(20, (dimensions.height - mapHeight * fitScale) / 2),
    });
  };

  // Centraliza quando o container ou o mapa mudam de tamanho.
  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, mapWidth, mapHeight]);

  // Centraliza no token quando pedido de fora (clique na iniciativa).
  useEffect(() => {
    if (!focusRequest) return;
    const t = tokens.find((tk) => tk.id === focusRequest.tokenId);
    if (t && dimensions.width > 0) {
      setStagePos({
        x: dimensions.width / 2 - (t.x + t.width / 2) * stageScale,
        y: dimensions.height / 2 - (t.y + t.height / 2) * stageScale,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  // Liga o Transformer (alças de redimensionar) ao token selecionado, se pudermos controlá-lo.
  const selectedToken = tokens.find((t) => t.id === selectedTokenId) ?? null;
  const canResize = selectedToken !== null && canControl(me, selectedToken);
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = canResize && selectedToken ? stage.findOne<Konva.Group>(`#token-group-${selectedToken.id}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [canResize, selectedToken, tokens]);

  /** Ponto do mapa no centro da viewport (para criar tokens onde o GM está olhando). */
  const viewportCenter = () => ({
    x: (dimensions.width / 2 - stagePos.x) / stageScale,
    y: (dimensions.height / 2 - stagePos.y) / stageScale,
  });

  const handleCreateToken = () => {
    const size = scene.grid.type === "square" ? scene.grid.cellSize : 70;
    const c = viewportCenter();
    let pos = { x: c.x - size / 2, y: c.y - size / 2 };
    if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
    pos = findFreeSpot(pos, size, tokens, map);
    onTokenCreate(pos, size);
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const scaleBy = 1.1;
    const newScale = Math.max(0.1, Math.min(3, e.evt.deltaY < 0 ? stageScale * scaleBy : stageScale / scaleBy));
    const mousePointTo = { x: (pointer.x - stagePos.x) / stageScale, y: (pointer.y - stagePos.y) / stageScale };
    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const handleZoom = (direction: "in" | "out" | "reset") => {
    if (direction === "reset") return fitToScreen();
    const newScale = Math.max(0.1, Math.min(3, stageScale * (direction === "in" ? 1.2 : 0.833)));
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const stagePoint = { x: (centerX - stagePos.x) / stageScale, y: (centerY - stagePos.y) / stageScale };
    setStageScale(newScale);
    setStagePos({ x: centerX - stagePoint.x * newScale, y: centerY - stagePoint.y * newScale });
  };

  const lines = useMemo(() => (gridVisible ? gridLines(scene.grid, map) : []), [gridVisible, scene.grid, map]);

  const setCursor = (cursor: string) => {
    if (stageRef.current) stageRef.current.container().style.cursor = cursor;
  };

  /**
   * Token sob o ponteiro, por geometria (distância ao centro de cada token), em vez do canvas
   * de hit do Konva. O canvas de hit depende de `getImageData`, que navegadores e extensões com
   * proteção contra fingerprinting embaralham; aí o Konva "não vê" shape nenhuma sob o mouse.
   * O último da lista é desenhado por cima, então tem prioridade.
   */
  const tokenAtPointer = (): Token | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!stage || !p) return null;
    const mx = (p.x - stage.x()) / stage.scaleX();
    const my = (p.y - stage.y()) / stage.scaleY();
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (!t) continue;
      const r = tokenRadius(t) + BODY_STROKE;
      const dx = mx - (t.x + t.width / 2);
      const dy = my - (t.y + t.height / 2);
      if (dx * dx + dy * dy <= r * r) return t;
    }
    return null;
  };

  const tokenGroup = (tokenId: string) => stageRef.current?.findOne<Konva.Group>(`#token-group-${tokenId}`) ?? null;

  /** O canvas de hit do Konva já entregou o evento ao Group deste token? */
  const hitLandedOnToken = (target: Konva.Node, tokenId: string): boolean => {
    const g = tokenGroup(tokenId);
    return g !== null && (target === g || g.isAncestorOf(target));
  };

  /** Cursor conforme o modo; no modo Selecionar, "grab" sobre um token que posso mover. */
  const handleStageMouseMove = () => {
    if (Konva.isDragging()) return; // no meio de um arraste não mexemos em nada
    if (mode === "pan") return setCursor("grab");
    if (mode !== "select") return setCursor("crosshair");
    const over = tokenAtPointer();
    setCursor(over && canControl(me, over) ? "grab" : "default");
  };

  /** Se o canvas de hit não reconheceu o token sob o ponteiro, repassa o mousedown ao Group para o Konva iniciar o drag dele. */
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "select") return;
    const t = tokenAtPointer();
    if (!t || hitLandedOnToken(e.target, t.id)) return;
    tokenGroup(t.id)?.fire("mousedown", { evt: e.evt, pointerId: e.pointerId }, false);
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "select") return;
    const t = tokenAtPointer();
    if (t) {
      // Se o hit tivesse acertado, o Group já teria tratado o clique (e cancelado o bubble).
      if (!hitLandedOnToken(e.target, t.id)) onSelectToken(t.id);
      return;
    }
    if (e.target === stageRef.current || e.target.name() === "map-background") onSelectToken(null);
  };

  return (
    <div
      ref={containerRef}
      id="vtt-canvas-container"
      className={`relative flex-1 h-full w-full bg-stone-950 overflow-hidden select-none ${mode === "pan" ? "cursor-grab" : mode === "select" ? "cursor-default" : "cursor-crosshair"}`}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={mode === "pan"}
        onWheel={handleWheel}
        onDragStart={(e) => {
          if (e.target === stageRef.current) setCursor("grabbing");
        }}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setCursor("grab");
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onMouseMove={handleStageMouseMove}
        onMouseDown={handleStageMouseDown}
        onClick={handleStageClick}
      >
        {/* Camada 1: mapa + grid */}
        <Layer id="map-layer">
          <Rect x={-20} y={-20} width={mapWidth + 40} height={mapHeight + 40} fill="#080808" stroke="#1a1a1a" strokeWidth={4} />
          {mapImage ? (
            <KonvaImage name="map-background" image={mapImage} x={0} y={0} width={mapWidth} height={mapHeight} />
          ) : (
            <Rect name="map-background" x={0} y={0} width={mapWidth} height={mapHeight} fill="#121212" stroke="#2d2417" strokeWidth={3} />
          )}
          {lines.map((points, i) => (
            <Line key={i} points={points} stroke={scene.grid.color} strokeWidth={1} listening={false} />
          ))}
        </Layer>

        {/* Camada 2: tokens */}
        <Layer id="tokens-layer">
          {tokens.map((token) => (
            <TokenNode
              key={token.id}
              token={token}
              bar={tokenBars[token.id] ?? null}
              draggable={mode === "select" && canControl(me, token)}
              isSelected={token.id === selectedTokenId}
              isActiveTurn={token.id === activeTurnTokenId}
              onSelect={() => mode === "select" && onSelectToken(token.id)}
              onCursor={setCursor}
              onDragMove={(x, y) => onTokenMoveLive(token.id, x, y)}
              onDragEnd={(node) => {
                let pos = { x: node.x(), y: node.y() };
                if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
                pos = clampToMap(pos.x, pos.y, token, map);
                node.position(pos);
                onTokenPatch({ id: token.id, x: pos.x, y: pos.y });
              }}
              onTransformEnd={(node) => {
                // O Transformer altera scaleX/scaleY do Group; convertemos em width/height reais
                // e zeramos a escala, porque o token é desenhado a partir de width/height.
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scale({ x: 1, y: 1 });
                const min = 8;
                let width = Math.max(min, token.width * scaleX);
                let height = Math.max(min, token.height * scaleY);
                if (snapEnabled && scene.grid.type === "square") {
                  const cells = Math.max(1, Math.round(width / scene.grid.cellSize));
                  width = height = cells * scene.grid.cellSize;
                }
                let pos = { x: node.x(), y: node.y() };
                if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
                pos = clampToMap(pos.x, pos.y, { width, height }, map);
                node.position(pos);
                onTokenPatch({ id: token.id, x: pos.x, y: pos.y, width, height });
              }}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            keepRatio
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            anchorStroke="#d4af37"
            anchorFill="#1a1a1a"
            anchorSize={8}
            borderStroke="#d4af37"
            borderDash={[4, 4]}
            ignoreStroke
          />
        </Layer>
      </Stage>

      {/* HUD inferior esquerdo: zoom, snap, grid */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-300">
        <HudButton title="Aproximar (+)" onClick={() => handleZoom("in")}>
          <ZoomIn className="w-4 h-4" />
        </HudButton>
        <HudButton title="Afastar (-)" onClick={() => handleZoom("out")}>
          <ZoomOut className="w-4 h-4" />
        </HudButton>
        <HudButton title="Ajustar mapa à tela" onClick={() => handleZoom("reset")}>
          <Maximize2 className="w-4 h-4" />
        </HudButton>
        <div className="w-[1px] h-4 bg-[#2d2417] mx-0.5" />
        <HudToggle active={snapEnabled} title={`Grudar no grid: ${snapEnabled ? "ativado" : "desativado"}`} onClick={() => setSnapEnabled(!snapEnabled)}>
          <Magnet className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[10px] font-serif font-bold uppercase tracking-wider">Snap</span>
        </HudToggle>
        <HudToggle active={gridVisible} title={`Exibir grid: ${gridVisible ? "visível" : "oculto"}`} onClick={() => setGridVisible(!gridVisible)}>
          <GridIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[10px] font-serif font-bold uppercase tracking-wider">Grid</span>
        </HudToggle>
        <span className="text-[10px] font-mono text-zinc-400 px-1.5 border-l border-[#2d2417]">{Math.round(stageScale * 100)}%</span>
        {me.role === "gm" && (
          <>
            <div className="w-[1px] h-4 bg-[#2d2417] mx-0.5" />
            <button
              id="btn-new-token"
              onClick={handleCreateToken}
              title="Novo token no centro da tela"
              className="flex items-center gap-1 px-2 py-1 rounded bg-[#2d2417] border border-[#d4af37]/60 text-[#d4af37] hover:bg-[#3d311f] text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Token
            </button>
          </>
        )}
      </div>

      {selectedToken && (
        <TokenInspector
          token={selectedToken}
          participants={participants}
          me={me}
          onPatch={onTokenPatch}
          onDelete={() => onTokenDelete(selectedToken.id)}
          onClose={() => onSelectToken(null)}
          linkableCharacters={linkableCharacters}
          onLinkCharacter={(characterId) => onLinkCharacter(selectedToken.id, characterId)}
          onOpenCharacter={onOpenCharacter}
        />
      )}

      {!selectedToken && (
      <div className="absolute top-4 right-4 z-10 hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a]/95 border border-[#2d2417] text-[11px] text-zinc-400 shadow-xl pointer-events-none">
        <Info className="w-3.5 h-3.5 text-[#d4af37]" />
        <span>{MODE_HINTS[mode]}</span>
      </div>
      )}
    </div>
  );
};

/**
 * Evita empilhar tokens novos no mesmo ponto (só o de cima receberia cliques):
 * anda em espiral pelas células vizinhas até achar uma sem token.
 */
function findFreeSpot(
  start: { x: number; y: number },
  size: number,
  tokens: Token[],
  map: { width: number; height: number },
): { x: number; y: number } {
  const occupied = (x: number, y: number) =>
    tokens.some((t) => Math.abs(t.x - x) < size * 0.75 && Math.abs(t.y - y) < size * 0.75);
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let r = 1; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push([dx, dy]);
  }
  for (const [dx, dy] of offsets) {
    const p = clampToMap(start.x + dx * size, start.y + dy * size, { width: size, height: size }, map);
    if (!occupied(p.x, p.y)) return p;
  }
  return clampToMap(start.x, start.y, { width: size, height: size }, map);
}

// --- Token ------------------------------------------------------------------

interface TokenNodeProps {
  token: Token;
  bar: TokenBar | null;
  draggable: boolean;
  isSelected: boolean;
  isActiveTurn: boolean;
  onSelect: () => void;
  /** Cursor durante o arraste (fora dele o Stage decide por geometria). */
  onCursor: (cursor: string) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (node: Konva.Node) => void;
  onTransformEnd: (node: Konva.Node) => void;
}

const TokenNode: React.FC<TokenNodeProps> = ({ token, bar, draggable, isSelected, isActiveTurn, onSelect, onCursor, onDragMove, onDragEnd, onTransformEnd }) => {
  const image = useImage(assetUrl(token.imageUrl));
  const radius = tokenRadius(token);
  const cx = token.width / 2;
  const cy = token.height / 2;
  const highlight = isSelected || isActiveTurn;

  // Barra de vida acima do token: verde > 50%, dourada > 25%, vermelha abaixo.
  const barWidth = Math.max(52, token.width);
  const barHeight = 5;
  const barPercent = bar && bar.max > 0 ? Math.min(100, Math.max(0, (bar.current / bar.max) * 100)) : 0;
  const barColor = barPercent > 50 ? "#10b981" : barPercent > 25 ? "#d4af37" : "#ef4444";

  return (
    <Group
      id={`token-group-${token.id}`}
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.visible ? 1 : 0.45}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onCursor("grabbing");
      }}
      onDragMove={(e) => onDragMove(e.target.x(), e.target.y())}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        onCursor("grab");
        onDragEnd(e.target);
      }}
      onTransformEnd={(e) => onTransformEnd(e.target)}
    >
      {/*
        Tudo abaixo é só desenho (listening={false}). Quem recebe o mouse é o círculo de hit
        invisível no FIM do Group. Motivo: o Konva só dispara `click` quando o mousedown e o
        mouseup caem na MESMA shape. Com várias shapes empilhadas (fundo, tinta, imagem), um
        clique cujo mouse anda 1–2 px sobre a fronteira entre duas delas se perde; e o hit de
        cada shape (ex.: anel do turno com raio+8) fazia a área clicável não bater com o círculo.
      */}
      {isActiveTurn && (
        <Circle x={cx} y={cy} radius={radius + 8} stroke="#d4af37" strokeWidth={2.5} dash={[6, 4]} shadowColor="#d4af37" shadowBlur={14} shadowOpacity={0.9} listening={false} />
      )}
      {isSelected && !isActiveTurn && <Circle x={cx} y={cy} radius={radius + 6} stroke="#d4af37" strokeWidth={1.5} dash={[4, 4]} listening={false} />}

      <Circle x={cx} y={cy + 3} radius={radius} fill="rgba(0, 0, 0, 0.6)" listening={false} />
      <Circle x={cx} y={cy} radius={radius} fill="#141414" stroke={highlight ? "#d4af37" : token.color} strokeWidth={BODY_STROKE} shadowColor="#000" shadowBlur={8} shadowOpacity={0.7} listening={false} />

      {image ? (
        // Imagem recortada em círculo.
        <Group clipFunc={(ctx) => ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2, false)} listening={false}>
          <KonvaImage image={image} x={0} y={0} width={token.width} height={token.height} />
        </Group>
      ) : (
        <>
          <Circle x={cx} y={cy} radius={Math.max(1, radius - 4)} fill={token.color} opacity={0.16} listening={false} />
          <Text x={0} y={cy - radius * 0.4} width={token.width} text={token.name.charAt(0).toUpperCase()} align="center" fontSize={radius * 0.8} fontFamily="serif" fontStyle="bold" fill="#e0e0e0" listening={false} />
        </>
      )}

      {bar && (
        <Group x={cx - barWidth / 2} y={-12} listening={false}>
          <Rect x={0} y={0} width={barWidth} height={barHeight} fill="#0c0c0c" stroke="#2d2417" strokeWidth={1} cornerRadius={2} />
          <Rect x={0.5} y={0.5} width={Math.max(0, (barWidth - 1) * (barPercent / 100))} height={barHeight - 1} fill={barColor} cornerRadius={1.5} />
          <Text
            x={0}
            y={-9}
            width={barWidth}
            text={`${bar.current}/${bar.max}${bar.temp > 0 ? ` +${bar.temp}` : ""}`}
            align="center"
            fontSize={8.5}
            fontFamily="monospace"
            fontStyle="bold"
            fill="#a1a1aa"
          />
        </Group>
      )}

      {/* Nome abaixo do token. O Rect é a única shape com hit aqui (também serve para arrastar). */}
      <Group y={token.height + 4}>
        <Rect x={cx - 42} y={0} width={84} height={15} fill="#0c0c0c" stroke="#2d2417" strokeWidth={1} cornerRadius={2} opacity={0.94} />
        <Text x={cx - 42} y={2} width={84} text={token.name} align="center" fontSize={9} fontFamily="sans-serif" fontStyle="bold" fill="#e0e0e0" ellipsis wrap="none" listening={false} />
      </Group>

      {/*
        Área de hit do token para o canvas de hit do Konva: um único círculo, invisível, com a
        mesma geometria que `tokenAtPointer` usa (raio + BODY_STROKE; metade é a borda, metade é
        folga, porque o canvas de hit não tem anti-aliasing). Último filho = por cima de tudo.
        `fill="transparent"` não desenha nada, mas deixa explícito que a área conta como preenchida.
      */}
      <Circle name="token-hit" x={cx} y={cy} radius={radius + BODY_STROKE} fill="transparent" />
    </Group>
  );
};

// --- HUD helpers -------------------------------------------------------------

function HudButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="p-1.5 rounded hover:bg-[#252525] hover:text-[#d4af37] transition-colors cursor-pointer">
      {children}
    </button>
  );
}

function HudToggle({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 text-xs ${
        active ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "hover:bg-[#252525] text-zinc-400"
      }`}
    >
      {children}
    </button>
  );
}
