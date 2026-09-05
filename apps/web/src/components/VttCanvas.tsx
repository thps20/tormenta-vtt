import React, { useRef, useState, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Circle, Text, Group, Line, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { ZoomIn, ZoomOut, Maximize2, Magnet, Grid as GridIcon, Info, Shield, User } from "lucide-react";
import type { Participant, Scene, Token } from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";
import { clampToMap, gridLines, snapToGrid } from "../lib/grid";
import { useImage } from "../lib/useImage";

/** Tamanho padrão quando a cena ainda não tem mapa. */
export const DEFAULT_MAP = { width: 1600, height: 1100 };

interface VttCanvasProps {
  scene: Scene;
  tokens: Token[];
  participants: Participant[];
  me: Participant;
  activeTurnTokenId: string | null;
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string | null) => void;
  /** Durante o arraste (throttled na store). */
  onTokenMoveLive: (tokenId: string, x: number, y: number) => void;
  /** Ao soltar: posição final (com snap). */
  onTokenMoveEnd: (tokenId: string, x: number, y: number) => void;
}

/** GM move tudo; jogador só o que possui (mesma regra do servidor). */
export function canControl(me: Participant, token: Token): boolean {
  return me.role === "gm" || token.ownerId === me.id;
}

export const VttCanvas: React.FC<VttCanvasProps> = ({
  scene,
  tokens,
  participants,
  me,
  activeTurnTokenId,
  selectedTokenId,
  onSelectToken,
  onTokenMoveLive,
  onTokenMoveEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

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
    const fitScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 1.0);
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

  // Centraliza no token selecionado (ex.: clique na iniciativa).
  useEffect(() => {
    if (!selectedTokenId) return;
    const t = tokens.find((tk) => tk.id === selectedTokenId);
    if (t && dimensions.width > 0) {
      setStagePos({
        x: dimensions.width / 2 - (t.x + t.width / 2) * stageScale,
        y: dimensions.height / 2 - (t.y + t.height / 2) * stageScale,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTokenId]);

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

  const selectedToken = tokens.find((t) => t.id === selectedTokenId) ?? null;
  const setCursor = (cursor: string) => {
    if (stageRef.current) stageRef.current.container().style.cursor = cursor;
  };

  return (
    <div
      ref={containerRef}
      id="vtt-canvas-container"
      className="relative flex-1 h-full w-full bg-stone-950 overflow-hidden cursor-crosshair select-none"
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable
        onWheel={handleWheel}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setStagePos({ x: e.target.x(), y: e.target.y() });
        }}
        onClick={(e) => {
          if (e.target === stageRef.current || e.target.name() === "map-background") onSelectToken(null);
        }}
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
              draggable={canControl(me, token)}
              isSelected={token.id === selectedTokenId}
              isActiveTurn={token.id === activeTurnTokenId}
              onSelect={() => onSelectToken(token.id)}
              onCursor={setCursor}
              onDragMove={(x, y) => onTokenMoveLive(token.id, x, y)}
              onDragEnd={(node) => {
                let pos = { x: node.x(), y: node.y() };
                if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
                pos = clampToMap(pos.x, pos.y, token, map);
                node.position(pos);
                onTokenMoveEnd(token.id, pos.x, pos.y);
              }}
            />
          ))}
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
      </div>

      {/* Inspetor do token selecionado */}
      {selectedToken && (
        <div id="token-inspector-overlay" className="absolute top-4 left-4 z-10 w-64 p-3 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-200">
          <div className="flex items-center justify-between border-b border-[#2d2417] pb-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-4 h-4 rounded-full border border-[#d4af37] shrink-0" style={{ backgroundColor: selectedToken.color }} />
              <span className="text-xs font-serif font-bold text-[#d4af37] tracking-wide truncate">{selectedToken.name}</span>
            </div>
            <button onClick={() => onSelectToken(null)} className="text-zinc-500 hover:text-zinc-200 text-xs px-1 cursor-pointer">
              ✕
            </button>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                Posição:
              </span>
              <span className="font-mono text-zinc-300 text-[11px]">
                {Math.round(selectedToken.x)}, {Math.round(selectedToken.y)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#d4af37]" />
                Dono:
              </span>
              <span className="text-zinc-300 text-[11px] font-medium">
                {selectedToken.ownerId
                  ? (participants.find((p) => p.id === selectedToken.ownerId)?.nickname ?? "Jogador")
                  : "Apenas GM"}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-10 hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a]/95 border border-[#2d2417] text-[11px] text-zinc-400 shadow-xl pointer-events-none">
        <Info className="w-3.5 h-3.5 text-[#d4af37]" />
        <span>Arraste tokens para mover • Arraste o fundo para navegar • Scroll = zoom</span>
      </div>
    </div>
  );
};

// --- Token ------------------------------------------------------------------

interface TokenNodeProps {
  token: Token;
  draggable: boolean;
  isSelected: boolean;
  isActiveTurn: boolean;
  onSelect: () => void;
  onCursor: (cursor: string) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (node: Konva.Node) => void;
}

const TokenNode: React.FC<TokenNodeProps> = ({ token, draggable, isSelected, isActiveTurn, onSelect, onCursor, onDragMove, onDragEnd }) => {
  const image = useImage(assetUrl(token.imageUrl));
  const radius = Math.min(token.width, token.height) / 2;
  const cx = token.width / 2;
  const cy = token.height / 2;
  const highlight = isSelected || isActiveTurn;

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
      onMouseEnter={() => onCursor(draggable ? "grab" : "default")}
      onMouseLeave={() => onCursor("crosshair")}
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
    >
      {isActiveTurn && (
        <Circle x={cx} y={cy} radius={radius + 8} stroke="#d4af37" strokeWidth={2.5} dash={[6, 4]} shadowColor="#d4af37" shadowBlur={14} shadowOpacity={0.9} />
      )}
      {isSelected && !isActiveTurn && <Circle x={cx} y={cy} radius={radius + 6} stroke="#d4af37" strokeWidth={1.5} dash={[4, 4]} />}

      <Circle x={cx} y={cy + 3} radius={radius} fill="rgba(0, 0, 0, 0.6)" />
      <Circle x={cx} y={cy} radius={radius} fill="#141414" stroke={highlight ? "#d4af37" : token.color} strokeWidth={3} shadowColor="#000" shadowBlur={8} shadowOpacity={0.7} />

      {image ? (
        // Imagem recortada em círculo.
        <Group clipFunc={(ctx) => ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2, false)}>
          <KonvaImage image={image} x={0} y={0} width={token.width} height={token.height} />
        </Group>
      ) : (
        <>
          <Circle x={cx} y={cy} radius={Math.max(1, radius - 4)} fill={token.color} opacity={0.16} />
          <Text x={0} y={cy - radius * 0.4} width={token.width} text={token.name.charAt(0).toUpperCase()} align="center" fontSize={radius * 0.8} fontFamily="serif" fontStyle="bold" fill="#e0e0e0" listening={false} />
        </>
      )}

      {/* Nome abaixo do token */}
      <Group y={token.height + 4} listening={false}>
        <Rect x={cx - 42} y={0} width={84} height={15} fill="#0c0c0c" stroke="#2d2417" strokeWidth={1} cornerRadius={2} opacity={0.94} />
        <Text x={cx - 42} y={2} width={84} text={token.name} align="center" fontSize={9} fontFamily="sans-serif" fontStyle="bold" fill="#e0e0e0" ellipsis wrap="none" />
      </Group>
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
