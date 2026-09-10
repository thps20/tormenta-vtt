import React, { forwardRef, useRef, useState, useEffect, useImperativeHandle, useMemo } from "react";
import { Stage, Layer, Rect, Circle, Text, Group, Line, Label, Tag, Image as KonvaImage, Transformer } from "react-konva";
import Konva from "konva";
import { ZoomIn, ZoomOut, Maximize2, Magnet, Grid as GridIcon, Info, Plus } from "lucide-react";
import {
  applyResourceDelta,
  computeCharacter,
  conditionIconDataUrl,
  creatureColor,
  DEFAULT_MAP_SIZE,
  findFreeCells,
  measureDistance,
  pointInTemplate,
  tokensInTemplate,
  type Character,
  type CharacterPatch,
  type CharacterRollRequest,
  type Combat,
  type CompendiumEntry,
  type ConditionDef,
  type FogShape,
  type GridConfig,
  type Handout,
  type HandoutPin,
  type Participant,
  type Ruler,
  type Scene,
  type SystemDefinition,
  type Template,
  type TemplateShape,
  type Token,
  type TokenCondition,
  type TokenPatch,
} from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";
import { cellAt, cellCenter, cellRect, cellToPoint, clampToMap, effectiveCellSize, gridLines, snapToCellCenter, snapToGrid, snapToVertexOrCenter, tokensInBox, type Box } from "../lib/grid";
import { conditionLayout, conditionSlotAtPoint, isOverflowSlot, CONDITION_COUNTER_RADIUS } from "../lib/conditionLayout";
import {
  cellCountFromPixels,
  cellsFromSizeUnits,
  newLineFromAnchorCell,
  newSquareFromAnchorCell,
  newTemplate,
  pixelsToUnit,
  roundAngleToStep,
  roundToHalfCell,
  templateCoveredCells,
  templateSizePx,
} from "../lib/templates";
import { useImage } from "../lib/useImage";
import { newId } from "../lib/ids";
import { DROP_TARGET_ATTR, registerDropTarget } from "../lib/dropTargets";
import { useCompendium } from "../store/compendium";
import { canMoveNow, movementBudgetFallback } from "../store/combat";
import { toast } from "../store/ui";
import type { FogToolMode, FogToolShape, RemoteRuler, ToolMode } from "../store/tools";
import { TokenInspector } from "./TokenInspector";
import { NpcQuickCard } from "./NpcQuickCard";
import { ConditionMenu } from "./ConditionMenu";
import { FogLayer } from "./FogLayer";
import { TemplateLayer } from "./TemplateLayer";
import { HandoutPinLayer, HANDOUT_PIN_RADIUS } from "./HandoutPinLayer";
import { MovementLayer } from "./MovementLayer";

/** Tamanho padrão quando a cena ainda não tem mapa (shared: o servidor usa o mesmo, ver compendium:spawn-creature). */
export const DEFAULT_MAP = DEFAULT_MAP_SIZE;

/** Métodos imperativos expostos por ref: quem monta o canvas (RoomPage) às vezes precisa de um
 *  dado dele sem virar prop (ex.: onde soltar uma criatura do compêndio ao apertar Enter). */
export interface VttCanvasHandle {
  /** Ponto do mapa (pixels) no centro da viewport agora — mesmo cálculo do botão "novo token". */
  getViewportCenter: () => { x: number; y: number };
}

interface VttCanvasProps {
  scene: Scene;
  /** Ferramenta em vigor (ver store/tools): decide quem responde ao arraste. */
  mode: ToolMode;
  tokens: Token[];
  participants: Participant[];
  me: Participant;
  activeTurnTokenId: string | null;
  /** Combate da cena (round/status), pro campo de duração do ConditionMenu e pro badge de rodadas
   *  restantes no token. null = sem combate na cena. */
  combat: Combat | null;
  /** Trava de orçamento de deslocamento da SALA (docs/plano-movimento.md §4.1) — desligada: sem
   *  bloqueio de arraste/teclado, MovementLayer mostra só o gasto (sem vermelho). */
  movementLimitEnabled: boolean;
  /** Único selecionado (inspector, redimensionar); null com 0 ou vários. */
  selectedTokenId: string | null;
  /** Todos os selecionados (anel dourado, movimento em grupo). */
  selectedIds: string[];
  /** Pedido externo de centralizar num token (clique na iniciativa). */
  focusRequest: { tokenId: string; nonce: number } | null;
  /** Esc: muda a cada pedido de cancelar o gesto em andamento (caixa de seleção, régua). */
  cancelNonce: number;
  /** Régua: a minha, as dos outros (já filtradas pela cena) e o sistema, que diz quanto vale uma célula. */
  ruler: Ruler | null;
  remoteRulers: RemoteRuler[];
  systemDef: SystemDefinition | null;
  onRulerUpdate: (ruler: Ruler) => void;
  onRulerClear: () => void;
  onSelectToken: (tokenId: string | null) => void;
  /** Caixa de seleção: substitui a seleção pelos tokens dentro dela. */
  onSelectMany: (tokenIds: string[]) => void;
  /** Shift+clique: entra/sai da seleção. */
  onToggleSelect: (tokenId: string) => void;
  /** Durante o arraste (throttled na store). */
  onTokenMoveLive: (tokenId: string, x: number, y: number) => void;
  /** Ao soltar / redimensionar / editar: patch com ack e reversão. */
  onTokenPatch: (patch: TokenPatch) => void;
  /** Arraste em grupo ao soltar (2+ tokens selecionados movidos juntos): um patch por token, mas
   *  UMA chamada só (token:update-many), pra virar uma entrada de histórico só — ver handleTokenDragEnd. */
  onTokenPatchMany: (patches: TokenPatch[]) => void;
  /** GM: criar token no ponto (pixels do mapa) com o tamanho de uma célula. */
  onTokenCreate: (pos: { x: number; y: number }, size: number) => void;
  onTokenDelete: (tokenId: string) => void;
  /**
   * Apaga os tokens selecionados agora (mesma função do atalho Delete/Backspace — ver
   * lib/useDeleteSelectionShortcut). Usada pelo botão de lixeira do NpcQuickCard; o TokenInspector
   * continua com seu próprio onDelete/confirmação (token único, por id).
   */
  onDeleteSelected: () => void;
  /** Fichas que o usuário pode vincular a um token (ver TokenInspector). */
  linkableCharacters: Character[];
  onLinkCharacter: (tokenId: string, characterId: string | null) => void;
  onOpenCharacter: (characterId: string) => void;
  /** Duplo clique num token vinculado a uma ficha (padrão Foundry): RoomPage decide se o usuário
   *  pode vê-la e abre. Token sem ficha: não é chamado. */
  onTokenOpenSheet: (tokenId: string) => void;
  /**
   * Ficha rápida do NPC (docs/plano-criaturas.md §3, docs/tipos-ficha-rapida.md): clique simples
   * num token NPC do GM abre o NpcQuickCard no lugar do TokenInspector. Patch raso de recurso
   * (PV), rolagem de ação e uso de item — os mesmos três caminhos que a ficha completa já usa.
   */
  onCharacterPatch: (characterId: string, patch: CharacterPatch) => void;
  onCharacterRoll: (characterId: string, request: CharacterRollRequest) => void;
  onCharacterUseItem: (characterId: string, itemId: string) => void;
  /** Barra de vida por token (tokenBar do sistema, lida da ficha vinculada). */
  tokenBars: Record<string, TokenBar>;
  /** Modo Névoa (GM): o que desenhar e com qual forma. null para jogadores. */
  fogTool: FogTool | null;
  /** Forma pronta (pincel solto, retângulo solto, polígono fechado), em pixels do mapa. */
  onFogShape: (shape: FogShape) => void;
  /**
   * Solta uma criatura do compêndio no ponto (pixels do mapa) — arrastar da paleta contextual até
   * o mapa (docs/plano-criaturas.md §2.4). GM only; ausente = o mapa não aceita o drop (a paleta
   * segue funcionando por Enter/botão, que usam o centro da viewport em vez do ponto de soltura).
   */
  onSpawnCreature?: (entryId: string, point: { x: number; y: number }, opts: { count: number; visible: boolean }) => void;
  /**
   * "Definir ponto de chegada" (docs/plano-mapas.md §9): true entre o clique no menu do card do
   * mapa e o próximo clique no canvas, que grava o ponto (`onPickArrival`) em vez do comportamento
   * normal da ferramenta atual. GM only.
   */
  arrivalPickMode?: boolean;
  onPickArrival?: (point: { x: number; y: number }) => void;

  /** Gabaritos de área de efeito da cena visitada (docs/plano-gabaritos.md). */
  templates: Template[];
  /** Modo Área ligado (null = sistema não declara `templates`, a ferramenta nem existe). */
  templateTool: TemplateTool | null;
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string | null) => void;
  /** Clique de origem (círculo/quadrado) ou 2º clique confirmando a rotação (cone/linha). */
  onTemplateCreate: (template: Template) => void;
  /** Durante mover/girar um gabarito selecionado: aplica local e emite com throttle (eco `live`). */
  onTemplateLive: (template: Template) => void;
  /** Ao soltar: patch final do gesto, com ack. `dragFrom` (x/y/rotation do mousedown) só quando um
   *  gesto de mover/girar terminou — pro histórico do GM saber o "antes" de verdade (docs/plano-gabaritos.md §4). */
  onTemplateCommit: (template: Template, dragFrom?: { x: number; y: number; rotation: number }) => void;

  /** Pinos de handout fixados na cena visitada (docs/SPEC.md §9.10), já filtrados por quem pode ver. */
  handoutPins: HandoutPin[];
  /** Clique num pino, modo Selecionar (qualquer um): abre o overlay local. */
  onOpenHandoutPin: (pin: HandoutPin) => void;
  /** Botão direito num pino, modo Selecionar: apaga (entra no desfazer do GM). GM only; ausente = jogador. */
  onDeleteHandoutPin?: (pin: HandoutPin) => void;
  /**
   * Arrastar um card da biblioteca de handouts até o mapa fixa um pino no ponto (pixels do mapa) —
   * mesmo mecanismo de soltar criatura do compêndio (§9.5), registrado no mesmo alvo "mapa" (o
   * elemento aceita os dois arrastos ao mesmo tempo, ver lib/dropTargets.ts). GM only; ausente = o
   * mapa não aceita o drop.
   */
  onHandoutDrop?: (handout: Handout, point: { x: number; y: number }) => void;
}

/** Forma + tamanho (metros) escolhidos na TemplateToolbar, e a sobrescrita de ângulo/largura de um preset. */
export interface TemplateTool {
  shape: TemplateShape;
  sizeUnits: number;
  angleOverride?: number;
  widthOverride?: number;
}

export interface FogTool {
  mode: FogToolMode;
  shape: FogToolShape;
  /** Diâmetro do pincel em pixels do mapa. */
  brushSize: number;
}

/** Atual/máximo do recurso que o sistema aponta como barra do token. */
export interface TokenBar {
  current: number;
  max: number;
  temp: number;
}

/** Texto de ajuda do canto superior direito, por ferramenta. */
const MODE_HINTS: Record<ToolMode, string> = {
  select: "Arraste tokens para mover • Duplo clique = ficha • Espaço + arrastar = navegar • Scroll = zoom",
  pan: "Arraste para navegar pelo mapa • Scroll = zoom",
  ruler: "Clique e arraste para medir • Scroll = zoom",
  fog: "Névoa: escolha Revelar/Ocultar e uma forma no painel • Scroll = zoom",
  template: "Clique e arraste para definir tamanho/direção (Alt/Shift soltam o snap) • Clique parado usa o tamanho da barra • Scroll = zoom",
  draw: "Desenho: em breve",
};

/** Ajuda específica de cada forma da névoa. */
const FOG_HINTS: Record<FogToolShape, string> = {
  brush: "Arraste para pintar • Tamanho do pincel no painel • Ctrl+Z desfaz",
  rect: "Arraste para desenhar um retângulo • Ctrl+Z desfaz",
  polygon: "Clique para adicionar vértices • Duplo clique fecha • Esc cancela",
};

/** Largura da borda do círculo do token (pixels do mapa). */
const BODY_STROKE = 3;

/** Alças de redimensionar habilitadas no Transformer (sem cantos de rotação: `rotateEnabled={false}`). */
const RESIZE_ANCHOR_NAMES = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** Id do alvo de soltura do mapa (lib/dropTargets) — só criaturas do compêndio, ver docs/plano-criaturas.md §2.4. */
const MAP_DROP_TARGET = "map";

/** Raio do círculo do token em pixels do mapa (o token é desenhado a partir de width/height). */
function tokenRadius(t: { width: number; height: number }): number {
  return Math.min(t.width, t.height) / 2;
}

/** GM move tudo; jogador só o que possui (mesma regra do servidor). */
export function canControl(me: Participant, token: Token): boolean {
  return me.role === "gm" || token.ownerId === me.id;
}

/** GM move/gira/apaga qualquer gabarito; jogador só os seus (mesma regra do servidor). */
export function canControlTemplate(me: Participant, template: Template): boolean {
  return me.role === "gm" || template.ownerId === me.id;
}

/** Clique sem arrasto em quadrado/linha com grid ativo (docs/plano-gabaritos.md §8): segue a mesma
 *  regra do arrasto — o campo de tamanho da barra vira uma contagem de células, quadrado cresce pra
 *  baixo/direita a partir da célula clicada, linha aponta pra direita a partir dela. */
function buildClickCellTemplate(
  templateTool: Pick<TemplateTool, "shape" | "sizeUnits">,
  anchorCell: { col: number; row: number },
  grid: GridConfig,
  def: SystemDefinition,
  ownerId: string,
): Template {
  const cells = cellsFromSizeUnits(templateTool.sizeUnits, def);
  if (templateTool.shape === "square") {
    return newSquareFromAnchorCell(anchorCell, { col: anchorCell.col + cells - 1, row: anchorCell.row + cells - 1 }, grid, ownerId);
  }
  return newLineFromAnchorCell(anchorCell, 0, cells, grid, ownerId);
}

export const VttCanvas = forwardRef<VttCanvasHandle, VttCanvasProps>(({
  scene,
  mode,
  tokens,
  participants,
  me,
  activeTurnTokenId,
  combat,
  movementLimitEnabled,
  selectedTokenId,
  selectedIds,
  focusRequest,
  cancelNonce,
  ruler,
  remoteRulers,
  systemDef,
  onRulerUpdate,
  onRulerClear,
  onSelectToken,
  onSelectMany,
  onToggleSelect,
  onTokenMoveLive,
  onTokenPatch,
  onTokenPatchMany,
  onTokenCreate,
  onTokenDelete,
  onDeleteSelected,
  linkableCharacters,
  onLinkCharacter,
  onOpenCharacter,
  onTokenOpenSheet,
  onCharacterPatch,
  onCharacterRoll,
  onCharacterUseItem,
  tokenBars,
  fogTool,
  onFogShape,
  onSpawnCreature,
  arrivalPickMode,
  onPickArrival,
  templates,
  templateTool,
  selectedTemplateId,
  onSelectTemplate,
  onTemplateCreate,
  handoutPins,
  onOpenHandoutPin,
  onDeleteHandoutPin,
  onHandoutDrop,
  onTemplateLive,
  onTemplateCommit,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 40, y: 30 });
  // Preferências locais de visualização (não vão ao servidor).
  const [snapEnabled, setSnapEnabled] = useState(scene.grid.snap);
  const [gridVisible, setGridVisible] = useState(true);

  // Menu de condições: botão direito no token, ou botão "Condições" do TokenInspector. Posição já
  // em pixels do container (não do mapa), pra desenhar por cima de tudo sem depender do zoom/pan.
  const [conditionMenu, setConditionMenu] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  const CONDITION_MENU_WIDTH = 232;
  const CONDITION_MENU_HEIGHT = 320;
  /**
   * Ancorado ao LADO do token (não no ponto do clique): um popover que nasce em cima do próprio
   * token esconde as condições que ele acabou de marcar (bug real, achado ao vivo — o popover
   * ficava sobre a linha de baixo da coluna de badges, e o hover não alcançava o Konva por baixo
   * dele). À direita se couber, senão à esquerda; sempre alinhado ao topo do token.
   */
  const openConditionMenuAt = (token: Token) => {
    if (!canControl(me, token)) return;
    const rect = tokenGroup(token.id)?.getClientRect();
    if (!rect) return;
    const fitsRight = rect.x + rect.width + 8 + CONDITION_MENU_WIDTH <= dimensions.width;
    const x = fitsRight ? rect.x + rect.width + 8 : rect.x - 8 - CONDITION_MENU_WIDTH;
    const y = Math.min(rect.y, dimensions.height - CONDITION_MENU_HEIGHT);
    setConditionMenu({ tokenId: token.id, x: Math.max(4, x), y: Math.max(4, y) });
  };

  // Fora do modo Selecionar não calculamos hover de badge; sem isso um tooltip aberto ficaria preso
  // na tela ao trocar de ferramenta (nenhum mousemove novo o limparia).
  useEffect(() => setConditionTooltip(null), [mode]);

  // Caixa de seleção (modo Selecionar, arraste no mapa vazio), em pixels do mapa.
  const [selectionBox, setSelectionBox] = useState<Box | null>(null);
  /** Ponto onde o mousedown caiu no mapa vazio; a caixa só aparece depois de mover alguns pixels. */
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Um arraste de caixa acabou de terminar: o `click` que o Konva dispara em seguida não deve limpar a seleção. */
  const boxJustEndedRef = useRef(false);
  /** Arraste em grupo: posição inicial do líder e dos outros selecionados que eu controlo. */
  const groupDragRef = useRef<{
    leader: { x: number; y: number };
    /** Posição do líder ANTES do gesto (token.x/y no dragStart — nunca a "ao vivo"), mandada como
     *  `dragFrom` no patch final: os ecos de moveLive já escreveram no banco durante o arraste, então
     *  o "antes" que o servidor leria sozinho seria só o penúltimo tick, não o início do gesto
     *  (docs/plano-desfazer.md §3). */
    leaderOrigin: { x: number; y: number };
    others: Array<{ token: Token; x: number; y: number }>;
  } | null>(null);
  /** Ponto inicial da régua em andamento (pixels do mapa). */
  const rulerStartRef = useRef<{ x: number; y: number } | null>(null);

  /** Último mousedown num token (id + instante), pro duplo clique por geometria (ver registerTokenClick). */
  const lastTokenMouseDownRef = useRef<{ tokenId: string; time: number } | null>(null);
  const DOUBLE_CLICK_MS = 300;

  // --- Névoa (GM): gesto em andamento. Nada vai ao servidor antes de soltar/fechar.
  /** Pincel: pontos [x1,y1,x2,y2,...] acumulados no arrasto (já decimados). null = não está pintando. */
  const brushPointsRef = useRef<number[] | null>(null);
  /** Retângulo: canto onde o mousedown caiu. */
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Polígono: vértices confirmados por clique. */
  const [polygonPoints, setPolygonPoints] = useState<number[]>([]);
  /** Forma sendo desenhada, para preview na camada de névoa (mesma composição da forma final). */
  const [fogDraft, setFogDraft] = useState<FogShape | null>(null);
  /** Ponteiro em pixels do mapa (círculo do pincel e linha elástica do polígono). */
  const [fogPointer, setFogPointer] = useState<{ x: number; y: number } | null>(null);

  // --- Gabaritos de área de efeito (docs/plano-gabaritos.md §5/§8): gesto de criar em andamento.
  /** Duas famílias de gesto (§8): "cell" — quadrado/linha com grid ativo, SEMPRE um conjunto de
   *  células inteiras, nunca geometria livre; a âncora é a CÉLULA sob o cursor no mousedown (não um
   *  ponto). "free" — círculo/cone sempre, e quadrado/linha quando o grid está inativo ou Alt solta
   *  o snap; a origem já é um ponto (com ou sem snap contínuo, conforme a forma). `startPointer` é
   *  sempre o ponteiro CRU do mousedown, só pra medir a distância arrastada e decidir clique×arrasto. */
  const templateCreateRef = useRef<
    | { kind: "cell"; shape: "square" | "line"; anchorCell: { col: number; row: number }; startPointer: { x: number; y: number } }
    | { kind: "free"; shape: TemplateShape; origin: { x: number; y: number }; startPointer: { x: number; y: number } }
    | null
  >(null);
  /** O gabarito calculado ao vivo durante o arrasto — já o `Template` pronto (renderizado como
   *  rascunho + rótulo, e usado direto ao soltar se o gesto virou mesmo um arrasto). */
  const [templateDraftLive, setTemplateDraftLive] = useState<Template | null>(null);
  /** Arrastando o CORPO do gabarito selecionado (modo Selecionar): delta do ponteiro desde o início. */
  const templateDragRef = useRef<{ id: string; startPointer: { x: number; y: number }; startTemplate: Template } | null>(null);
  /** Arrastando a ALÇA de rotação do gabarito selecionado. */
  const templateRotateRef = useRef<{ id: string; startTemplate: Template } | null>(null);

  const cancelGestures = () => {
    boxStartRef.current = null;
    setSelectionBox(null);
    if (rulerStartRef.current) {
      rulerStartRef.current = null;
      onRulerClear();
    }
    brushPointsRef.current = null;
    rectStartRef.current = null;
    setPolygonPoints([]);
    setFogDraft(null);
    templateCreateRef.current = null;
    setTemplateDraftLive(null);
    templateDragRef.current = null;
    templateRotateRef.current = null;
  };

  // Esc cancela a caixa/régua em andamento.
  useEffect(() => {
    cancelGestures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelNonce]);

  // Trocar de ferramenta no meio de um gesto também o descarta.
  useEffect(() => {
    cancelGestures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  // Ficha rápida do NPC (docs/plano-criaturas.md §3): clique simples num token NPC do GM mostra o
  // NpcQuickCard no lugar do TokenInspector. O botão "Token" do card força o inspector genérico
  // até trocar de seleção — reselecionar o mesmo token volta pra ficha rápida.
  const [forceInspector, setForceInspector] = useState(false);
  useEffect(() => setForceInspector(false), [selectedTokenId]);
  const selectedCharacter = selectedToken?.characterId ? linkableCharacters.find((c) => c.id === selectedToken.characterId) : undefined;
  const showQuickCard = me.role === "gm" && selectedCharacter?.kind === "npc" && !forceInspector;
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
  useImperativeHandle(ref, () => ({ getViewportCenter: viewportCenter }));

  const handleCreateToken = () => {
    const size = effectiveCellSize(scene.grid);
    const c = viewportCenter();
    let pos = { x: c.x - size / 2, y: c.y - size / 2 };
    if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
    pos = findFreeSpot(pos, scene.grid, tokens, map);
    onTokenCreate(pos, size);
  };

  /** Ponto de TELA (clientX/Y — arrasto vem de fora do Konva, da paleta do compêndio) em pixels do mapa. */
  const mapPointFromClient = (point: { x: number; y: number }): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    const stage = stageRef.current;
    if (!rect || !stage) return { x: 0, y: 0 };
    return { x: (point.x - rect.left - stage.x()) / stage.scaleX(), y: (point.y - rect.top - stage.y()) / stage.scaleY() };
  };

  // Alvo de soltura "mapa": só criaturas do compêndio (docs/plano-criaturas.md §2.4), só quando o
  // RoomPage ligou onSpawnCreature (GM, com cena). A quantidade/toggle vêm da store (a paleta e o
  // fantasma abaixo leem o mesmo estado).
  useEffect(() => {
    if (!onSpawnCreature) return;
    return registerDropTarget<CompendiumEntry>({
      id: MAP_DROP_TARGET,
      accepts: (entry) => entry.type === "creature",
      onDrop: (entry, point) => {
        if (entry.type !== "creature") return;
        const { spawnCount, spawnInvisible } = useCompendium.getState();
        onSpawnCreature(entry.id, mapPointFromClient(point), { count: spawnCount, visible: !spawnInvisible });
      },
    });
  }, [onSpawnCreature]);

  // Segundo alvo de soltura no MESMO id "map" (docs/SPEC.md §9.10): arrastar um card da biblioteca
  // de handouts fixa um pino no ponto. `accepts` distingue pelo formato do payload (Handout não tem
  // `type`), então os dois registros no id "map" convivem sem se atrapalhar (lib/dropTargets.ts).
  useEffect(() => {
    if (!onHandoutDrop) return;
    return registerDropTarget<Handout>({
      id: MAP_DROP_TARGET,
      accepts: (entry) => typeof entry === "object" && entry !== null && "kind" in entry && (entry.kind === "image" || entry.kind === "text"),
      onDrop: (handout, point) => onHandoutDrop(handout, mapPointFromClient(point)),
    });
  }, [onHandoutDrop]);

  // Fantasma de soltura: N retângulos de célula, na cor do tipo da criatura, seguindo o arrasto —
  // MESMA findFreeCells que o servidor roda ao criar, então onde você vê é onde os tokens caem.
  const dragEntry = useCompendium((s) => (s.drag ? s.entries.find((e) => e.id === s.drag?.entryId) : undefined));
  const dragOverMap = useCompendium((s) => s.drag?.targetId === MAP_DROP_TARGET);
  const dragPoint = useCompendium((s) => s.drag?.point ?? null);
  const spawnCount = useCompendium((s) => s.spawnCount);
  const creatureGhost = useMemo(() => {
    if (!dragOverMap || !dragPoint || !dragEntry || dragEntry.type !== "creature" || !systemDef) return null;
    const cellSize = effectiveCellSize(scene.grid);
    const cellsPerSide = Math.max(1, Math.round(systemDef.sizes.find((s) => s.key === dragEntry.sheet.size)?.tokenCells ?? 1));
    const bounds = { cols: Math.max(1, Math.ceil(map.width / cellSize)), rows: Math.max(1, Math.ceil(map.height / cellSize)) };
    const occupied = tokens.map((t) => cellRect(t, scene.grid));
    const start = cellAt(mapPointFromClient(dragPoint), scene.grid);
    const cells = findFreeCells({ start, cells: cellsPerSide, count: spawnCount, occupied, bounds });
    return { color: creatureColor(systemDef, dragEntry), size: cellsPerSide * cellSize, cells: cells.map((c) => cellToPoint(c, scene.grid)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragOverMap, dragPoint, dragEntry, systemDef, scene.grid, tokens, map.width, map.height, spawnCount, stagePos.x, stagePos.y, stageScale]);

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
    const p = pointerMapPos();
    if (!p) return null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (!t) continue;
      const r = tokenRadius(t) + BODY_STROKE;
      const dx = p.x - (t.x + t.width / 2);
      const dy = p.y - (t.y + t.height / 2);
      if (dx * dx + dy * dy <= r * r) return t;
    }
    return null;
  };

  /**
   * Alça de redimensionar (`Konva.Transformer`) sob o ponteiro, por GEOMETRIA — mesmo motivo de
   * `tokenAtPointer`: cada alça é um `Rect` interno pequeno da própria lib, e um mousedown nela só
   * inicia o resize se `getIntersection` acertar exatamente aquela shape (medido em
   * docs/auditoria-hit-canvas.md: com o hit sabotado, nenhum arrasto de alça mudava o tamanho).
   * `anchor.getClientRect()` já vem no mesmo espaço de `stage.getPointerPosition()` (pixels "de
   * tela" do Stage, antes de desfazer pan/zoom) — não precisa de `pointerMapPos()` aqui.
   */
  const resizeAnchorAtPointer = (): Konva.Rect | null => {
    if (!canResize) return null;
    const tr = transformerRef.current;
    const pointer = stageRef.current?.getPointerPosition();
    if (!tr || !pointer) return null;
    for (const name of RESIZE_ANCHOR_NAMES) {
      const anchor = tr.findOne<Konva.Rect>(`.${name}`);
      if (!anchor) continue;
      const r = anchor.getClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      // Folga além do próprio desenho (a alça tem uns 8px; +6 de folga, como o token-hit faz
      // com o círculo do token — metade é a borda, metade é margem de erro do clique).
      const radius = Math.max(r.width, r.height) / 2 + 6;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      if (dx * dx + dy * dy <= radius * radius) return anchor;
    }
    return null;
  };

  /**
   * Badge de condição sob o ponteiro, por GEOMETRIA (mesmo motivo de `tokenAtPointer`: o canvas de
   * hit do Konva é embaralhado por proteção anti-fingerprinting e o mouseenter simplesmente não
   * dispara — ver docs/debug-token.md). Devolve o tooltip pronto, ou null. Último token da lista
   * primeiro: é o desenhado por cima.
   */
  const conditionTooltipAtPointer = (): ConditionTooltip | null => {
    const p = pointerMapPos();
    if (!p) return null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (!t || t.conditions.length === 0) continue;
      const entries = t.conditions
        .map((cond) => ({ cond, def: conditionByKey.get(cond.key) }))
        .filter((e): e is { cond: (typeof t.conditions)[number]; def: ConditionDef } => e.def !== undefined);
      if (entries.length === 0) continue;

      const layout = conditionLayout(t.width, t.height, stageScale, entries.length);
      const slot = conditionSlotAtPoint(layout, p.x - t.x, p.y - t.y, stageScale);
      if (slot === null) continue;

      if (layout.mode === "counter") {
        const text = entries.map((e) => e.def.label + roundsSuffix(e.cond.expiresRound, badgeCombatRound)).join("\n");
        return { key: `${t.id}:__counter`, x: t.x + layout.cx, y: t.y + layout.cy, anchorRadius: layout.screenRadius, text };
      }
      const pos = layout.slots[slot];
      if (!pos) continue;
      const anchorRadius = layout.r * stageScale;
      if (isOverflowSlot(layout, slot)) {
        const text = entries.slice(layout.visibleCount).map((e) => e.def.label + roundsSuffix(e.cond.expiresRound, badgeCombatRound)).join("\n");
        return { key: `${t.id}:__overflow`, x: t.x + pos.x, y: t.y + pos.y, anchorRadius, text };
      }
      const entry = entries[slot];
      if (!entry) continue;
      const label = entry.def.label + roundsSuffix(entry.cond.expiresRound, badgeCombatRound);
      return {
        key: `${t.id}:${entry.def.key}`,
        x: t.x + pos.x,
        y: t.y + pos.y,
        anchorRadius,
        text: entry.def.description ? `${label}\n${entry.def.description}` : label,
      };
    }
    return null;
  };

  /** Ponteiro em pixels do mapa (desfaz pan e zoom do Stage). */
  const pointerMapPos = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!stage || !p) return null;
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  };

  const tokenGroup = (tokenId: string) => stageRef.current?.findOne<Konva.Group>(`#token-group-${tokenId}`) ?? null;

  /** O canvas de hit do Konva já entregou o evento ao Group deste token? */
  const hitLandedOnToken = (target: Konva.Node, tokenId: string): boolean => {
    const g = tokenGroup(tokenId);
    return g !== null && (target === g || g.isAncestorOf(target));
  };

  /** Ponto da régua: centro da célula quando há grid e o snap está ligado; senão, livre. */
  const rulerPoint = (p: { x: number; y: number }) => (snapEnabled ? snapToCellCenter(p.x, p.y, scene.grid) : p);

  // --- Névoa ------------------------------------------------------------------
  const fogActive = mode === "fog" && fogTool !== null;
  const round = (v: number) => Math.round(v);
  const fogMode = fogTool?.mode ?? "reveal";

  /** Pincel: círculo no clique único, traço (polilinha com largura) no arrasto. Coordenadas inteiras: JSON menor. */
  const brushShape = (points: number[]): FogShape | null => {
    const width = fogTool?.brushSize ?? 0;
    if (points.length < 2) return null;
    if (points.length === 2) return { id: newId(), mode: fogMode, kind: "circle", cx: round(points[0] ?? 0), cy: round(points[1] ?? 0), r: width / 2 };
    return { id: newId(), mode: fogMode, kind: "stroke", points: points.map(round), width };
  };

  const rectShape = (a: { x: number; y: number }, b: { x: number; y: number }): FogShape | null => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (width < 1 || height < 1) return null;
    return { id: newId(), mode: fogMode, kind: "rect", x: round(x), y: round(y), width: round(width) || 1, height: round(height) || 1 };
  };

  const polygonShape = (points: number[]): FogShape | null =>
    points.length >= 6 ? { id: newId(), mode: fogMode, kind: "polygon", points: points.map(round) } : null;

  const fogMouseDown = (p: { x: number; y: number }) => {
    if (!fogTool) return;
    if (fogTool.shape === "brush") {
      brushPointsRef.current = [p.x, p.y];
      setFogDraft(brushShape(brushPointsRef.current));
    } else if (fogTool.shape === "rect") {
      rectStartRef.current = p;
      setFogDraft(null);
    }
    // Polígono: vértices entram no click (o duplo clique fecha; ver fogDblClick).
  };

  const fogMouseMove = (p: { x: number; y: number }) => {
    if (!fogTool) return;
    setFogPointer(p);
    const pts = brushPointsRef.current;
    if (fogTool.shape === "brush" && pts) {
      // Decimação: só guarda o ponto se andou o bastante (fração do pincel, mínimo 2 px de tela).
      const lx = pts[pts.length - 2] ?? p.x;
      const ly = pts[pts.length - 1] ?? p.y;
      const minStep = Math.max(2 / stageScale, fogTool.brushSize / 8);
      if (Math.hypot(p.x - lx, p.y - ly) < minStep) return;
      pts.push(p.x, p.y);
      setFogDraft(brushShape(pts));
      return;
    }
    if (fogTool.shape === "rect" && rectStartRef.current) {
      setFogDraft(rectShape(rectStartRef.current, p));
      return;
    }
    if (fogTool.shape === "polygon" && polygonPoints.length >= 4) {
      // Com 2+ vértices, o preview mostra o polígono fechado até o ponteiro.
      setFogDraft(polygonShape([...polygonPoints, p.x, p.y]));
    }
  };

  /** Soltou: pincel e retângulo viram uma shape e vão ao servidor (uma emissão por gesto). */
  const fogMouseUp = () => {
    if (!fogTool) return;
    const pts = brushPointsRef.current;
    if (pts) {
      brushPointsRef.current = null;
      const shape = brushShape(pts);
      if (shape) onFogShape(shape);
    }
    const start = rectStartRef.current;
    if (start) {
      rectStartRef.current = null;
      const p = pointerMapPos();
      const shape = p ? rectShape(start, p) : null;
      if (shape) onFogShape(shape);
    }
    setFogDraft(null);
  };

  /** Polígono: cada clique adiciona um vértice (ignorando cliques em cima do último, como os do duplo clique). */
  const fogClick = (p: { x: number; y: number }) => {
    if (!fogTool || fogTool.shape !== "polygon") return;
    const lx = polygonPoints[polygonPoints.length - 2];
    const ly = polygonPoints[polygonPoints.length - 1];
    if (lx !== undefined && ly !== undefined && Math.hypot(p.x - lx, p.y - ly) * stageScale < 4) return;
    setPolygonPoints([...polygonPoints, p.x, p.y]);
  };

  /** Duplo clique fecha o polígono (mínimo 3 vértices); com menos, descarta. */
  const fogDblClick = () => {
    if (!fogTool || fogTool.shape !== "polygon") return;
    const shape = polygonShape(polygonPoints);
    setPolygonPoints([]);
    setFogDraft(null);
    if (shape) onFogShape(shape);
  };

  // --- Gabaritos de área de efeito (docs/plano-gabaritos.md) --------------------------------
  const templateActive = mode === "template" && templateTool !== null;

  /** Gabarito sob o ponteiro, por GEOMETRIA (mesmo motivo de tokenAtPointer: gabarito não tem hit
   *  do Konva, `listening={false}` na TemplateLayer). O de cima (último da lista) primeiro. */
  const templateAtPointer = (): Template | null => {
    const p = pointerMapPos();
    if (!p) return null;
    for (let i = templates.length - 1; i >= 0; i--) {
      const t = templates[i];
      if (t && pointInTemplate(p, t)) return t;
    }
    return null;
  };

  /**
   * Pino de handout sob o ponteiro, por GEOMETRIA (mesmo motivo de tokenAtPointer/templateAtPointer:
   * `HandoutPinLayer` é só desenho, `listening={false}`, docs/SPEC.md §9.10). Raio constante em
   * pixels de TELA (o pino não muda de tamanho com o zoom), por isso divide por stageScale em vez
   * de multiplicar como os outros hit-tests em pixels do mapa. O de cima (último da lista) primeiro.
   */
  const handoutPinAtPointer = (): HandoutPin | null => {
    const p = pointerMapPos();
    if (!p) return null;
    const r = HANDOUT_PIN_RADIUS / stageScale;
    for (let i = handoutPins.length - 1; i >= 0; i--) {
      const pin = handoutPins[i];
      if (!pin) continue;
      const dx = p.x - pin.x;
      const dy = p.y - pin.y;
      if (dx * dx + dy * dy <= r * r) return pin;
    }
    return null;
  };

  /** Ponto da alça de rotação de um gabarito: na ponta do cone/linha, ou um pouco além da borda do
   *  quadrado. Círculo não gira (giro não muda nada visualmente) — sem alça. */
  const templateRotateHandlePoint = (t: Template): { x: number; y: number } | null => {
    if (t.shape === "circle") return null;
    const dist = (t.shape === "square" ? t.side / 2 : t.length) + 20 / stageScale;
    return { x: t.x + Math.cos(t.rotation) * dist, y: t.y + Math.sin(t.rotation) * dist };
  };

  /** A alça do gabarito SELECIONADO está sob o ponteiro? (só ele tem alça desenhada). */
  const templateRotateHandleAtPointer = (): Template | null => {
    const selected = templates.find((t) => t.id === selectedTemplateId);
    if (!selected) return null;
    const handle = templateRotateHandlePoint(selected);
    const p = pointerMapPos();
    if (!handle || !p) return null;
    const hitRadius = 10 / stageScale;
    const dx = p.x - handle.x;
    const dy = p.y - handle.y;
    return dx * dx + dy * dy <= hitRadius * hitRadius ? selected : null;
  };

  /** Cursor conforme o modo; no modo Selecionar, "grab" sobre um token que posso mover. Também estica a caixa de seleção e a régua. */
  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (Konva.isDragging()) return; // no meio de um arraste não mexemos em nada
    if (mode === "pan") return setCursor("grab");
    if (fogActive) {
      setCursor("crosshair");
      const p = pointerMapPos();
      if (p) fogMouseMove(p);
      return;
    }
    if (mode === "ruler") {
      setCursor("crosshair");
      const start = rulerStartRef.current;
      const p = pointerMapPos();
      if (start && p) onRulerUpdate({ start, end: rulerPoint(p) });
      return;
    }
    if (templateActive) {
      setCursor("crosshair");
      const gesture = templateCreateRef.current;
      const p = pointerMapPos();
      if (gesture && p && systemDef) {
        const grid = scene.grid;
        const cellSizePx = effectiveCellSize(grid);
        if (gesture.kind === "cell") {
          // Quadrado/linha com grid ativo: SEMPRE um conjunto de células inteiras, nunca geometria
          // livre (docs/plano-gabaritos.md §8) — Alt não solta aqui (é decidido no mousedown: Alt
          // segurado nem entra nesse "kind", cai direto no ramo "free" abaixo).
          if (gesture.shape === "square") {
            setTemplateDraftLive(newSquareFromAnchorCell(gesture.anchorCell, cellAt(p, grid), grid, me.id));
          } else {
            const anchorCenter = cellCenter(gesture.anchorCell, grid);
            const rawAngle = Math.atan2(p.y - anchorCenter.y, p.x - anchorCenter.x);
            const direction = roundAngleToStep(rawAngle, 45); // só eixos/diagonais, pra percorrer células inteiras
            const distancePx = Math.hypot(p.x - anchorCenter.x, p.y - anchorCenter.y);
            const cells = cellCountFromPixels(distancePx, cellSizePx, direction);
            setTemplateDraftLive(newLineFromAnchorCell(gesture.anchorCell, direction, cells, grid, me.id));
          }
          return;
        }
        // "free": círculo/cone sempre; quadrado/linha quando o grid está inativo ou Alt solta o snap.
        // Alt solta o snap o tempo todo do arrasto, não só na origem (docs/plano-gabaritos.md §7).
        const gridActive = snapEnabled && grid.type !== "none" && !e.evt.altKey;
        let sizeUnits = pixelsToUnit(Math.hypot(p.x - gesture.origin.x, p.y - gesture.origin.y), systemDef, cellSizePx);
        let rotation = 0;
        if (gesture.shape === "cone") {
          rotation = Math.atan2(p.y - gesture.origin.y, p.x - gesture.origin.x);
          if (gridActive) {
            sizeUnits = roundToHalfCell(sizeUnits, systemDef); // regra do centro decide as células, meia célula basta
            if (!e.evt.shiftKey) rotation = roundAngleToStep(rotation, 15);
          }
        } else if (gesture.shape === "line") {
          rotation = Math.atan2(p.y - gesture.origin.y, p.x - gesture.origin.x); // livre: sem grid, sem passo
        }
        setTemplateDraftLive(
          newTemplate({
            shape: gesture.shape,
            origin: gesture.origin,
            sizeUnits,
            rotationOverride: rotation,
            angleOverride: templateTool?.angleOverride,
            widthOverride: templateTool?.widthOverride,
            ownerId: me.id,
            def: systemDef,
            cellSizePx,
          }),
        );
      }
      return;
    }
    if (mode !== "select") return setCursor("crosshair");
    if (templateRotateRef.current) {
      const { id } = templateRotateRef.current;
      const current = templates.find((t) => t.id === id);
      const p = pointerMapPos();
      if (current && p) onTemplateLive({ ...current, rotation: Math.atan2(p.y - current.y, p.x - current.x) });
      return;
    }
    if (templateDragRef.current) {
      const { startPointer, startTemplate } = templateDragRef.current;
      const p = pointerMapPos();
      if (p) onTemplateLive({ ...startTemplate, x: startTemplate.x + (p.x - startPointer.x), y: startTemplate.y + (p.y - startPointer.y) });
      return;
    }
    const start = boxStartRef.current;
    if (start) {
      const p = pointerMapPos();
      // Só vira caixa depois de andar alguns pixels de tela; antes disso é um clique.
      if (p && (selectionBox || Math.hypot(p.x - start.x, p.y - start.y) * stageScale > 4)) {
        setSelectionBox({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
      }
      return;
    }
    const over = tokenAtPointer();
    setCursor(over && canControl(me, over) ? "grab" : "default");
    // Tooltip da condição: por geometria, aqui, e não por mouseenter do badge (ver
    // conditionTooltipAtPointer). Só troca o estado quando muda de badge, pra não repintar a cada
    // pixel de movimento.
    const tip = conditionTooltipAtPointer();
    setConditionTooltip((cur) => (cur?.key === tip?.key && cur?.x === tip?.x && cur?.y === tip?.y ? cur : tip));
  };

  /**
   * Duplo clique num token, por GEOMETRIA (não pelo `dblclick` nativo do Konva: como ele só dispara
   * quando os DOIS cliques acertam a mesma shape pelo canvas de hit, o mesmo embaralhamento
   * anti-fingerprinting que quebra hover/clique de token quebraria isto também — ver
   * docs/debug-condicoes.md). Mora no `onMouseDown` do Stage, que roda sempre (é o handler do
   * próprio Stage, não depende do hit chegar num Group): dois mousedown no mesmo token dentro da
   * janela contam como duplo clique. Token com ficha (que o usuário pode ver — RoomPage decide):
   * abre a ficha. Sem ficha: nada — o primeiro clique já selecionou e mostra o TokenInspector.
   */
  const registerTokenClick = (token: Token) => {
    const now = performance.now();
    const last = lastTokenMouseDownRef.current;
    const isDoubleClick = last !== null && last.tokenId === token.id && now - last.time <= DOUBLE_CLICK_MS;
    // Um terceiro clique rápido não vira "outro duplo clique": exige um mousedown novo primeiro.
    lastTokenMouseDownRef.current = isDoubleClick ? null : { tokenId: token.id, time: now };
    if (isDoubleClick && token.characterId) onTokenOpenSheet(token.id);
  };

  /**
   * Modo Selecionar: sobre uma alça de redimensionar, repassa o mousedown pra ela; sobre um token,
   * repassa pro Group — nos dois casos, só se o canvas de hit não reconheceu (pra o Konva iniciar o
   * drag/resize normalmente a partir daí); no mapa vazio, começa a caixa de seleção.
   */
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    if (fogActive) {
      const p = pointerMapPos();
      if (p) fogMouseDown(p);
      return;
    }
    if (mode === "ruler") {
      const p = pointerMapPos();
      if (!p) return;
      const start = rulerPoint(p);
      rulerStartRef.current = start;
      onRulerUpdate({ start, end: start });
      return;
    }
    if (templateActive && templateTool && systemDef) {
      const p = pointerMapPos();
      if (!p) return;
      const grid = scene.grid;
      const gridActive = snapEnabled && grid.type !== "none" && !e.evt.altKey;
      // Quadrado/linha com grid ativo: SEMPRE um conjunto de células inteiras, nunca geometria livre
      // (docs/plano-gabaritos.md §8) — a âncora é a CÉLULA sob o cursor, não um ponto.
      if (gridActive && (templateTool.shape === "square" || templateTool.shape === "line")) {
        const anchorCell = cellAt(p, grid);
        templateCreateRef.current = { kind: "cell", shape: templateTool.shape, anchorCell, startPointer: p };
        setTemplateDraftLive(buildClickCellTemplate(templateTool, anchorCell, grid, systemDef, me.id));
        return;
      }
      // "Livre": círculo/cone sempre; quadrado/linha quando o grid está inativo ou Alt solta o snap.
      // Origem por forma (Alt solta): círculo só no CENTRO da célula (a regra do centro decide as
      // células, não precisa de vértice); cone entre vértice/centro (o mais perto); quadrado/linha
      // aqui não recebem snap de origem (já caíram fora do ramo "célula" acima).
      let origin = p;
      if (gridActive) {
        if (templateTool.shape === "circle") origin = snapToCellCenter(p.x, p.y, grid);
        else if (templateTool.shape === "cone") origin = snapToVertexOrCenter(p.x, p.y, grid);
      }
      templateCreateRef.current = { kind: "free", shape: templateTool.shape, origin, startPointer: p };
      setTemplateDraftLive(
        newTemplate({
          shape: templateTool.shape,
          origin,
          sizeUnits: templateTool.sizeUnits,
          angleOverride: templateTool.angleOverride,
          widthOverride: templateTool.widthOverride,
          ownerId: me.id,
          def: systemDef,
          cellSizePx: effectiveCellSize(grid),
        }),
      );
      return;
    }
    if (mode !== "select") return;
    const rotateTarget = templateRotateHandleAtPointer();
    if (rotateTarget) {
      templateRotateRef.current = { id: rotateTarget.id, startTemplate: rotateTarget };
      return;
    }
    // Alça de redimensionar tem prioridade sobre o token: geometricamente ela fica na borda dele,
    // então "sobre o token" também é "sobre a alça" perto dos cantos.
    const anchor = resizeAnchorAtPointer();
    if (anchor) {
      if (e.target !== anchor && !anchor.isAncestorOf(e.target)) anchor.fire("mousedown", { evt: e.evt, pointerId: e.pointerId }, false);
      return;
    }
    const t = tokenAtPointer();
    if (t) {
      registerTokenClick(t);
      if (!hitLandedOnToken(e.target, t.id)) tokenGroup(t.id)?.fire("mousedown", { evt: e.evt, pointerId: e.pointerId }, false);
      return;
    }
    const tmpl = templateAtPointer();
    if (tmpl && canControlTemplate(me, tmpl)) {
      onSelectTemplate(tmpl.id);
      onSelectToken(null);
      const p = pointerMapPos();
      if (p) templateDragRef.current = { id: tmpl.id, startPointer: p, startTemplate: tmpl };
      return;
    }
    boxStartRef.current = pointerMapPos();
  };

  /** Soltou o mouse: fecha a régua (some) ou a caixa de seleção (seleciona o que está dentro). */
  const handleStageMouseUp = () => {
    if (templateCreateRef.current && templateTool && systemDef) {
      const gesture = templateCreateRef.current;
      const draft = templateDraftLive;
      templateCreateRef.current = null;
      setTemplateDraftLive(null);
      const p = pointerMapPos();
      // Só conta como arrasto depois de andar alguns pixels de TELA (mesmo limiar da caixa de
      // seleção); um clique parado usa o tamanho da barra — assim os presets continuam funcionando
      // (escolhe o preset, clica), docs/plano-gabaritos.md §5/§8.
      const dragged = !!p && Math.hypot(p.x - gesture.startPointer.x, p.y - gesture.startPointer.y) * stageScale > 4;
      if (dragged && draft) {
        // O rascunho já É o Template calculado ao vivo no último mousemove — reusa direto.
        onTemplateCreate(draft);
      } else if (gesture.kind === "cell") {
        onTemplateCreate(buildClickCellTemplate(templateTool, gesture.anchorCell, scene.grid, systemDef, me.id));
      } else {
        onTemplateCreate(
          newTemplate({
            shape: gesture.shape,
            origin: gesture.origin,
            sizeUnits: templateTool.sizeUnits,
            angleOverride: templateTool.angleOverride,
            widthOverride: templateTool.widthOverride,
            ownerId: me.id,
            def: systemDef,
            cellSizePx: effectiveCellSize(scene.grid),
          }),
        );
      }
      return;
    }
    if (templateRotateRef.current) {
      const { id, startTemplate } = templateRotateRef.current;
      templateRotateRef.current = null;
      const current = templates.find((t) => t.id === id);
      if (current) onTemplateCommit(current, { x: startTemplate.x, y: startTemplate.y, rotation: startTemplate.rotation });
      return;
    }
    if (templateDragRef.current) {
      const { id, startTemplate } = templateDragRef.current;
      templateDragRef.current = null;
      const current = templates.find((t) => t.id === id);
      if (current) onTemplateCommit(current, { x: startTemplate.x, y: startTemplate.y, rotation: startTemplate.rotation });
      return;
    }
    if (fogActive) return fogMouseUp();
    if (rulerStartRef.current) {
      rulerStartRef.current = null;
      onRulerClear();
      return;
    }
    finishSelectionBox();
  };

  /** Fim da caixa de seleção: seleciona os tokens dentro dela. Sem caixa (clique parado), o `click` cuida. */
  const finishSelectionBox = () => {
    const start = boxStartRef.current;
    boxStartRef.current = null;
    if (!start || !selectionBox) return;
    onSelectMany(tokensInBox(tokens, selectionBox).map((t) => t.id));
    setSelectionBox(null);
    boxJustEndedRef.current = true;
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (arrivalPickMode) {
      const p = pointerMapPos();
      if (p && e.evt.button === 0) onPickArrival?.(p);
      return;
    }
    if (fogActive) {
      const p = pointerMapPos();
      if (p && e.evt.button === 0) fogClick(p);
      return;
    }
    if (mode !== "select") return;
    if (boxJustEndedRef.current) {
      boxJustEndedRef.current = false;
      return;
    }
    const t = tokenAtPointer();
    if (t) {
      // Se o hit tivesse acertado, o Group já teria tratado o clique (e cancelado o bubble).
      if (!hitLandedOnToken(e.target, t.id)) selectByClick(t.id, e.evt.shiftKey);
      return;
    }
    // Pino de handout (§9.10): qualquer um (GM ou jogador) clica pra abrir — sem seleção, sem
    // Transformer, só abre o overlay local. `HandoutPinLayer` é listening={false}, então o hit do
    // Konva nunca "aterrissa" nele; sempre passa por aqui, por geometria.
    const pin = handoutPinAtPointer();
    if (pin) {
      onOpenHandoutPin(pin);
      return;
    }
    if (e.target === stageRef.current || e.target.name() === "map-background") {
      onSelectToken(null);
      // Só limpa a seleção de gabarito se o clique NÃO foi em cima de um (mousedown já selecionou
      // e talvez começado a arrastar; o `click` que o Konva dispara em seguida não deve desfazer).
      if (!templateAtPointer()) onSelectTemplate(null);
    }
  };

  /**
   * Botão direito: abre o ConditionMenu por geometria quando o hit não aterrissou no token —
   * mesmo motivo e mesmo fallback de `handleStageClick`. Sem isto, `onContextMenu` só existe no
   * Group do próprio token (TokenNode) e nunca dispara com o canvas de hit embaralhado (medido em
   * docs/auditoria-hit-canvas.md: popover nunca abria).
   */
  const handleStageContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (mode !== "select") return;
    const t = tokenAtPointer();
    if (t) {
      // Se o hit tivesse acertado, o onContextMenu do Group já teria aberto o menu (que confere
      // canControl por dentro, igual ao clique).
      if (!hitLandedOnToken(e.target, t.id)) openConditionMenuAt(t);
      return;
    }
    // Botão direito num pino apaga direto (GM only — entra no desfazer, sem confirmação: Ctrl+Z
    // corrige um clique errado tão fácil quanto um confirm() teria custado, §9.10).
    if (!onDeleteHandoutPin) return;
    const pin = handoutPinAtPointer();
    if (pin) onDeleteHandoutPin(pin);
  };

  /** Clique num token: seleciona só ele; com Shift, entra/sai da seleção atual. Token e gabarito
   *  nunca ficam selecionados juntos (evita ambiguidade no Delete e nas alças). */
  const selectByClick = (tokenId: string, additive: boolean) => {
    onSelectTemplate(null);
    if (additive) onToggleSelect(tokenId);
    else onSelectToken(tokenId);
  };

  /** Snap (se ligado) + limites do mapa para uma posição final de token. */
  const settle = (x: number, y: number, size: { width: number; height: number }) => {
    let pos = { x, y };
    if (snapEnabled) pos = snapToGrid(pos.x, pos.y, scene.grid);
    return clampToMap(pos.x, pos.y, size, map);
  };

  // --- Arraste em grupo: o token arrastado (líder) puxa os outros selecionados que eu controlo.
  const handleTokenDragStart = (token: Token, node: Konva.Node, additive: boolean) => {
    setConditionTooltip(null); // arrastando não há hover; senão o balão fica pendurado
    const leaderOrigin = { x: token.x, y: token.y };
    if (!selectedIds.includes(token.id)) {
      // Padrão Foundry: arrastar um token não selecionado já o seleciona (Shift entra na seleção
      // atual, senão troca por só ele) — assim o teclado (setas/WASD, que só move o que está
      // selecionado) já funciona logo depois de um arraste, sem precisar de um clique à parte antes
      // (docs/fix-movimento-turno.md). O arraste em si continua só deste token: os outros da seleção
      // (se entrou com Shift numa seleção que já tinha alguém) só se movem juntos no PRÓXIMO arraste.
      selectByClick(token.id, additive);
      groupDragRef.current = { leader: { x: node.x(), y: node.y() }, leaderOrigin, others: [] };
      return;
    }
    if (selectedIds.length < 2) {
      // Token só, já selecionado: ainda guarda leaderOrigin, é o único dado que handleTokenDragEnd precisa.
      groupDragRef.current = { leader: { x: node.x(), y: node.y() }, leaderOrigin, others: [] };
      return;
    }
    const others = selectedIds
      .filter((id) => id !== token.id)
      .map((id) => tokens.find((t) => t.id === id))
      .filter((t): t is Token => t !== undefined && canControl(me, t))
      .map((t) => ({ token: t, x: t.x, y: t.y }));
    groupDragRef.current = { leader: { x: node.x(), y: node.y() }, leaderOrigin, others };
  };

  const handleTokenDragMove = (token: Token, node: Konva.Node) => {
    onTokenMoveLive(token.id, node.x(), node.y());
    const g = groupDragRef.current;
    if (!g) return;
    const dx = node.x() - g.leader.x;
    const dy = node.y() - g.leader.y;
    for (const o of g.others) {
      const pos = { x: o.x + dx, y: o.y + dy };
      tokenGroup(o.token.id)?.position(pos);
      onTokenMoveLive(o.token.id, pos.x, pos.y);
    }
  };

  /** Se o destino estoura o orçamento de deslocamento do combatente da vez, devolve a âncora em vez
   *  do destino (docs/plano-movimento.md §4.2) — o servidor aceita (custo zero) e o broadcast
   *  recoloca o token pra todo mundo. Toast só uma vez por gesto, mesmo em arraste de grupo. */
  const clampToMovementBudget = (tok: Token, dest: { x: number; y: number }, warnRef: { warned: boolean }): { x: number; y: number } => {
    if (!systemDef) return dest;
    const cellSizePx = effectiveCellSize(scene.grid);
    const fallback = movementBudgetFallback(systemDef, combat, movementLimitEnabled, cellSizePx, tok.id, dest);
    if (!fallback) return dest;
    if (!warnRef.warned) {
      toast(`Deslocamento insuficiente (restam ${Math.round(fallback.remaining * 10) / 10} ${fallback.unit})`);
      warnRef.warned = true;
    }
    return { x: fallback.x, y: fallback.y };
  };

  const handleTokenDragEnd = (token: Token, node: Konva.Node) => {
    const g = groupDragRef.current;
    groupDragRef.current = null;
    const dx = node.x() - (g?.leader.x ?? node.x());
    const dy = node.y() - (g?.leader.y ?? node.y());
    const warnRef = { warned: false };
    const pos = clampToMovementBudget(token, settle(node.x(), node.y(), token), warnRef);
    node.position(pos);
    const patches: TokenPatch[] = [{ id: token.id, x: pos.x, y: pos.y, dragFrom: g?.leaderOrigin ?? { x: token.x, y: token.y } }];
    for (const o of g?.others ?? []) {
      const p = clampToMovementBudget(o.token, settle(o.x + dx, o.y + dy, o.token), warnRef);
      tokenGroup(o.token.id)?.position(p);
      patches.push({ id: o.token.id, x: p.x, y: p.y, dragFrom: { x: o.x, y: o.y } });
    }
    // 2+ tokens (arraste em grupo): uma chamada só (token:update-many), pra virar UMA entrada de
    // histórico em vez de uma por token (docs/plano-desfazer.md §3). Um token só: patch normal.
    if (patches.length > 1) onTokenPatchMany(patches);
    else onTokenPatch(patches[0]!);
  };

  // Partição das camadas de tokens (ver comentário no JSX). Ordem por zIndex é mantida dentro de cada uma.
  const tokensAboveFog = tokens.filter((t) => canControl(me, t));
  const tokensBelowFog = tokens.filter((t) => !canControl(me, t));

  // Pra cada token resolver `conditions[].key` nas definições cheias (ícone, cor, descrição).
  const conditionByKey = useMemo(() => new Map((systemDef?.conditions ?? []).map((c) => [c.key, c])), [systemDef]);

  // A duração do ConditionMenu (marcar/editar) só faz sentido com combate de verdade em andamento
  // — "ended" esconde o campo (vira permanente). Já o badge de rodadas restantes usa a rodada do
  // combate mesmo "ended" sem clear (fica congelado no valor de quando encerrou).
  const menuCombatRound = combat && combat.status !== "ended" ? combat.round : null;
  const badgeCombatRound = combat?.round ?? null;

  // --- Orçamento de deslocamento (docs/plano-movimento.md §4.1): caminho + rótulo do combatente da
  // VEZ, só quando o sistema declara `movement` e o combate está com turno ativo. `path`/`current`
  // já em CENTRO do token (visual), não canto superior esquerdo (como Combatant.movementPath grava).
  const movementDisplay = useMemo(() => {
    if (!systemDef?.movement || !systemDef.grid || combat?.status !== "active" || !combat.activeCombatantId) return null;
    const active = combat.combatants.find((c) => c.id === combat.activeCombatantId);
    if (!active || active.movementBudget === null || active.movementPath.length === 0) return null;
    const activeToken = tokens.find((t) => t.id === active.tokenId);
    if (!activeToken) return null;
    const center = (p: { x: number; y: number }) => ({ x: p.x + activeToken.width / 2, y: p.y + activeToken.height / 2 });
    return {
      def: systemDef,
      path: active.movementPath.map(center),
      current: center(activeToken),
      budget: active.movementBudget,
      used: active.movementUsed,
      diagonals: active.movementDiagonals,
      cellSizePx: effectiveCellSize(scene.grid),
      limitEnabled: movementLimitEnabled,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat, tokens, systemDef, scene.grid, movementLimitEnabled]);

  // --- Gabaritos de área de efeito: preview durante a colocação, contagem/destaque de alvos e a
  // alça de rotação do selecionado (docs/plano-gabaritos.md).
  // `templateDraftLive` já É o Template pronto (mousedown/mousemove montam ele direto — ver §7/§8);
  // sem derivação nenhuma aqui, só o nome que o resto do componente já usava.
  const templateDraft = templateDraftLive;

  /** Rótulo ao vivo do rascunho: tamanho na unidade do sistema + contagem de alvos (docs/plano-gabaritos.md §5). */
  const templateDraftLabel = useMemo(() => {
    if (!templateDraft || !systemDef) return null;
    const cellSizePx = effectiveCellSize(scene.grid);
    const size = Math.round(pixelsToUnit(templateSizePx(templateDraft), systemDef, cellSizePx) * 10) / 10;
    const unit = systemDef.grid?.unit ?? "";
    const count = tokensInTemplate(tokens, templateDraft, cellSizePx).size;
    return `${size}${unit ? ` ${unit}` : ""} • ${count} ${count === 1 ? "alvo" : "alvos"}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateDraft, systemDef, scene.grid, tokens]);

  const templateTargets = useMemo(() => {
    const cellSizePx = effectiveCellSize(scene.grid);
    const counts: Record<string, number> = {};
    const highlightedIds = new Set<string>();
    for (const t of templates) {
      const ids = tokensInTemplate(tokens, t, cellSizePx);
      counts[t.id] = ids.size;
      for (const id of ids) highlightedIds.add(id);
    }
    return { counts, highlighted: tokens.filter((t) => highlightedIds.has(t.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, tokens, scene.grid]);

  /** Preenchimento por célula (docs/plano-gabaritos.md §5): além do contorno geométrico, marca as
   *  células cujo centro cai dentro — todo mundo vê o mesmo resultado discreto. Só com grid ("none"
   *  não tem célula pra pintar), gabaritos reais e o rascunho durante o arrasto. */
  const templateCoveredCellsById = useMemo(() => {
    if (scene.grid.type === "none") return {};
    const map: Record<string, { x: number; y: number }[]> = {};
    for (const t of templates) map[t.id] = templateCoveredCells(t, scene.grid);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, scene.grid]);

  const templateDraftCoveredCells = useMemo(() => {
    if (!templateDraft || scene.grid.type === "none") return [];
    return templateCoveredCells(templateDraft, scene.grid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateDraft, scene.grid]);

  const templateRotateHandle = useMemo(() => {
    const selected = templates.find((t) => t.id === selectedTemplateId);
    return selected ? templateRotateHandlePoint(selected) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selectedTemplateId, stageScale]);

  // Tooltip da condição em hover: mora AQUI (e é desenhado na última camada) porque dentro do Group
  // do token qualquer token desenhado depois pintava por cima dele. Ver ConditionTooltipLayerContent.
  const [conditionTooltip, setConditionTooltip] = useState<ConditionTooltip | null>(null);

  const renderToken = (token: Token) => (
    <TokenNode
      key={token.id}
      token={token}
      bar={tokenBars[token.id] ?? null}
      conditionByKey={conditionByKey}
      combatRound={badgeCombatRound}
      stageScale={stageScale}
      draggable={mode === "select" && canControl(me, token) && canMoveNow(combat, token, me) === "ok"}
      selectable={mode === "select"}
      isSelected={selectedIds.includes(token.id)}
      isActiveTurn={token.id === activeTurnTokenId}
      onSelect={(additive) => selectByClick(token.id, additive)}
      onCursor={setCursor}
      onDragStart={(node, additive) => handleTokenDragStart(token, node, additive)}
      onDragMove={(node) => handleTokenDragMove(token, node)}
      onDragEnd={(node) => handleTokenDragEnd(token, node)}
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
      onContextMenu={() => openConditionMenuAt(token)}
    />
  );

  return (
    <div
      ref={containerRef}
      id="vtt-canvas-container"
      {...(onSpawnCreature || onHandoutDrop ? { [DROP_TARGET_ATTR]: MAP_DROP_TARGET } : {})}
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
        onMouseUp={handleStageMouseUp}
        onMouseLeave={() => {
          handleStageMouseUp();
          setFogPointer(null);
          setConditionTooltip(null);
        }}
        onClick={handleStageClick}
        onDblClick={() => fogActive && fogDblClick()}
        onContextMenu={handleStageContextMenu}
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

        {/*
          Camadas 2 a 4: tokens que NÃO controlo → névoa → tokens que controlo (+ Transformer).
          Assim a névoa cobre os tokens alheios, mas os meus ficam sempre visíveis. Para o GM,
          que controla tudo, todos os tokens ficam acima da névoa (que ele vê a 50%).
        */}
        <Layer id="tokens-layer-below-fog">{tokensBelowFog.map(renderToken)}</Layer>

        <FogLayer fog={scene.fog} map={map} isGm={me.role === "gm"} draft={fogActive ? fogDraft : null} />

        <Layer id="tokens-layer">
          {tokensAboveFog.map(renderToken)}
          {/* Ponto de chegada (docs/plano-mapas.md §9): pino só pro GM, não é token, não entra em nenhuma lista. */}
          {me.role === "gm" && scene.arrival && (
            <Group x={scene.arrival.x} y={scene.arrival.y} listening={false}>
              <Line points={[0, -22, 0, 8]} stroke="#d4af37" strokeWidth={2} />
              <Line points={[0, -22, 14, -15, 0, -8]} closed fill="#d4af37" />
              <Circle radius={3} fill="#d4af37" y={8} />
            </Group>
          )}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            keepRatio
            enabledAnchors={[...RESIZE_ANCHOR_NAMES]}
            anchorStroke="#d4af37"
            anchorFill="#1a1a1a"
            anchorSize={8}
            borderStroke="#d4af37"
            borderDash={[4, 4]}
            ignoreStroke
          />
        </Layer>

        {/* Camada 3: réguas e caixa de seleção (só desenho) */}
        <Layer listening={false}>
          {remoteRulers.map((r) => (
            <RulerShape key={r.participantId} ruler={r.ruler} grid={scene.grid} systemDef={systemDef} stageScale={stageScale} color="#60a5fa" author={r.nickname} />
          ))}
          {ruler && <RulerShape ruler={ruler} grid={scene.grid} systemDef={systemDef} stageScale={stageScale} color="#d4af37" author={null} />}
          {fogActive && fogTool && (
            <FogGestureOverlay tool={fogTool} pointer={fogPointer} polygonPoints={polygonPoints} draft={fogDraft} stageScale={stageScale} />
          )}
          <TemplateLayer
            templates={templates}
            draft={templateDraft}
            draftLabel={templateDraftLabel}
            selectedId={selectedTemplateId}
            targetCounts={templateTargets.counts}
            rotateHandle={templateRotateHandle}
            highlightedTokens={templateTargets.highlighted}
            coveredCellsById={templateCoveredCellsById}
            draftCoveredCells={templateDraftCoveredCells}
            cellSize={effectiveCellSize(scene.grid)}
            stageScale={stageScale}
          />
          <HandoutPinLayer pins={handoutPins} stageScale={stageScale} />
          {movementDisplay && <MovementLayer {...movementDisplay} stageScale={stageScale} />}
          {selectionBox && (
            <Rect
              x={Math.min(selectionBox.x1, selectionBox.x2)}
              y={Math.min(selectionBox.y1, selectionBox.y2)}
              width={Math.abs(selectionBox.x2 - selectionBox.x1)}
              height={Math.abs(selectionBox.y2 - selectionBox.y1)}
              fill="rgba(212, 175, 55, 0.12)"
              stroke="#d4af37"
              strokeWidth={1 / stageScale}
              dash={[6 / stageScale, 4 / stageScale]}
            />
          )}
          {/* Fantasma de soltura de criatura: por cima de tudo, só desenho (listening={false} no Layer). */}
          {creatureGhost?.cells.map((p, i) => (
            <Rect
              key={i}
              x={p.x}
              y={p.y}
              width={creatureGhost.size}
              height={creatureGhost.size}
              fill={`${creatureGhost.color}33`}
              stroke={creatureGhost.color}
              strokeWidth={2 / stageScale}
              dash={[8 / stageScale, 4 / stageScale]}
            />
          ))}
          {/* Tooltip de condição por último de todos: nenhum token pode cobri-lo. */}
          {conditionTooltip && <ConditionTooltipLayerContent tip={conditionTooltip} stageScale={stageScale} />}
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

      {selectedToken && showQuickCard && systemDef && selectedCharacter && (
        <NpcQuickCard
          token={selectedToken}
          character={selectedCharacter}
          computed={computeCharacter(systemDef, selectedCharacter)}
          def={systemDef}
          conditions={systemDef.conditions}
          activeConditions={selectedToken.conditions}
          onHpChange={(delta) => {
            const tokenBar = systemDef.tokenBar;
            if (!tokenBar) return;
            const bounds = computeCharacter(systemDef, selectedCharacter).resources[tokenBar] ?? { max: 0, min: 0, detail: null };
            const current = selectedCharacter.resources[tokenBar] ?? { current: 0, temp: 0, maxOverride: null };
            const next = applyResourceDelta({ current: current.current, temp: current.temp }, delta, { min: bounds.min, max: bounds.max });
            onCharacterPatch(selectedCharacter.id, {
              resources: { ...selectedCharacter.resources, [tokenBar]: { ...current, current: next.current, temp: next.temp } },
            });
          }}
          onRoll={(ref) => onCharacterRoll(selectedCharacter.id, { type: "action", itemId: ref.itemId, actionId: ref.actionId })}
          onUseItem={(itemId) => onCharacterUseItem(selectedCharacter.id, itemId)}
          onToggleCondition={(key) => {
            const has = selectedToken.conditions.some((c) => c.key === key);
            const next = has ? selectedToken.conditions.filter((c) => c.key !== key) : [...selectedToken.conditions, { key }];
            onTokenPatch({ id: selectedToken.id, conditions: next });
          }}
          onOpenFullSheet={() => onOpenCharacter(selectedCharacter.id)}
          onOpenTokenInspector={() => setForceInspector(true)}
          onDelete={onDeleteSelected}
          onClose={() => onSelectToken(null)}
        />
      )}
      {selectedToken && !showQuickCard && (
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
          conditions={systemDef?.conditions ?? []}
          onOpenConditions={() => openConditionMenuAt(selectedToken)}
        />
      )}

      {conditionMenu && systemDef && (() => {
        const target = tokens.find((t) => t.id === conditionMenu.tokenId);
        if (!target) return null;
        return (
          <ConditionMenu
            x={conditionMenu.x}
            y={conditionMenu.y}
            conditions={systemDef.conditions}
            active={target.conditions}
            combatRound={menuCombatRound}
            onChange={(next) => onTokenPatch({ id: target.id, conditions: next })}
            onClose={() => setConditionMenu(null)}
          />
        );
      })()}

      {!selectedToken && (
      <div className="absolute top-4 right-4 z-10 hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a]/95 border border-[#2d2417] text-[11px] text-zinc-400 shadow-xl pointer-events-none">
        <Info className="w-3.5 h-3.5 text-[#d4af37]" />
        {/* "Delete apaga" só pro GM: jogador não apaga token por este atalho (ver useDeleteSelectionShortcut). */}
        <span>
          {arrivalPickMode
            ? "Clique no mapa para definir o ponto de chegada • Esc cancela"
            : fogActive && fogTool
              ? FOG_HINTS[fogTool.shape]
              : mode === "select" && me.role === "gm"
                ? `${MODE_HINTS.select} • Delete apaga os selecionados`
                : MODE_HINTS[mode]}
        </span>
      </div>
      )}
    </div>
  );
});
VttCanvas.displayName = "VttCanvas";

/**
 * Evita empilhar tokens novos no mesmo ponto (só o de cima receberia cliques):
 * anda em espiral pelas células vizinhas até achar uma sem token.
 */
/**
 * Evita empilhar tokens novos no mesmo ponto: espiral em CÉLULAS a partir do ponto pedido
 * (findFreeCells, shared), devolvendo o canto superior esquerdo em pixels do mapa. Caso particular
 * de 1 célula de lado — o botão "novo token" só cria 1x1; a soltura de criaturas (docs/plano-criaturas.md)
 * usa findFreeCells direto, com o lado do tamanho da criatura.
 */
function findFreeSpot(
  start: { x: number; y: number },
  grid: GridConfig,
  tokens: Token[],
  map: { width: number; height: number },
): { x: number; y: number } {
  const size = effectiveCellSize(grid);
  const bounds = { cols: Math.max(1, Math.ceil(map.width / size)), rows: Math.max(1, Math.ceil(map.height / size)) };
  const occupied = tokens.map((t) => cellRect(t, grid));
  const [cell] = findFreeCells({ start: cellAt(start, grid), cells: 1, count: 1, occupied, bounds });
  return cell ? cellToPoint(cell, grid) : clampToMap(start.x, start.y, { width: size, height: size }, map);
}

// --- Token ------------------------------------------------------------------

interface TokenNodeProps {
  token: Token;
  bar: TokenBar | null;
  /** conditions[] do sistema, indexadas por key, pra resolver ícone/cor/descrição das do token. */
  conditionByKey: Map<string, ConditionDef>;
  /** Rodada do combate da cena, pro número de rodadas restantes no badge. null = sem combate. */
  combatRound: number | null;
  draggable: boolean;
  /** Modo Selecionar: clique seleciona. Nos outros modos o clique sobe para o Stage (ex.: vértice do polígono da névoa). */
  selectable: boolean;
  isSelected: boolean;
  isActiveTurn: boolean;
  /** additive = Shift pressionado (entra/sai da seleção em vez de substituí-la). */
  onSelect: (additive: boolean) => void;
  /** Cursor durante o arraste (fora dele o Stage decide por geometria). */
  onCursor: (cursor: string) => void;
  /** additive = Shift pressionado no início do arraste (mesmo sentido de onSelect). */
  onDragStart: (node: Konva.Node, additive: boolean) => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (node: Konva.Node) => void;
  onTransformEnd: (node: Konva.Node) => void;
  /** Botão direito no token: abre o ConditionMenu ancorado ao lado do token (ver openConditionMenuAt). */
  onContextMenu: () => void;
  /** Zoom atual do Stage: os badges de condição precisam saber pra manter o tamanho em px de tela. */
  stageScale: number;
}

const TokenNode: React.FC<TokenNodeProps> = ({ token, bar, conditionByKey, combatRound, draggable, selectable, isSelected, isActiveTurn, onSelect, onCursor, onDragStart, onDragMove, onDragEnd, onTransformEnd, onContextMenu, stageScale }) => {
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
        if (!selectable) return;
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey);
      }}
      onTap={(e) => {
        if (!selectable) return;
        e.cancelBubble = true;
        onSelect(false);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        onContextMenu();
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onCursor("grabbing");
        onDragStart(e.target, e.evt.shiftKey);
      }}
      onDragMove={(e) => onDragMove(e.target)}
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

      {/*
        Badges de condição por ÚLTIMO (depois do círculo de hit): senão o hit, que cobre até um
        pouco além da borda do círculo, rouba o mouseenter/leave dos badges e o tooltip nunca abre.
        Um clique num badge ainda seleciona o token normalmente (sem handler próprio, o evento sobe
        pro onClick do Group principal). Ver comentário geométrico em ConditionMarkers.
      */}
      {token.conditions.length > 0 && (
        <ConditionMarkers
          width={token.width}
          height={token.height}
          stageScale={stageScale}
          combatRound={combatRound}
          entries={token.conditions
            .map((cond) => ({ cond, def: conditionByKey.get(cond.key) }))
            .filter((e): e is { cond: (typeof token.conditions)[number]; def: ConditionDef } => e.def !== undefined)}
        />
      )}
    </Group>
  );
};

// --- Condições: coluna de ícones encostada na borda direita do token ----------
//
// A GEOMETRIA (posição/tamanho de cada badge) mora em lib/conditionLayout.ts, função pura, porque
// duas coisas dependem dela e não podem divergir: o desenho daqui e o hit do mouse no Stage
// (conditionTooltipAtPointer). Ler o comentário de lá para o raciocínio da coluna/colunas.
//
// Aqui é SÓ DESENHO (`listening={false}` em tudo, igual às decorações do token): o hover não pode
// depender do canvas de hit do Konva, que navegadores com proteção anti-fingerprinting embaralham
// (docs/debug-token.md) — medido: com o hit sabotado, 0 de 6 badges disparavam mouseenter.

type ConditionSlot = { key: string; label: string; description: string; icon?: string; color: string; roundsLeft?: number };

/** Tooltip de condição, desenhado numa camada ACIMA de todos os tokens (ver ConditionTooltipLayerContent). */
export interface ConditionTooltip {
  /** Identidade do que está sob o mouse (`<tokenId>:<slot>`), pra não repintar a cada mousemove. */
  key: string;
  /** Âncora em pixels do MAPA (centro do badge). */
  x: number;
  y: number;
  /** Raio do badge em pixels de TELA, pra afastar o balão do ícone. */
  anchorRadius: number;
  text: string;
}

/** Rodadas restantes de uma condição com `expiresRound`, ou undefined (permanente, ou sem rodada
 *  do combate pra comparar). Nunca negativo — se já passou do previsto, mostra 0. */
function roundsLeft(expiresRound: number | undefined, combatRound: number | null): number | undefined {
  if (expiresRound === undefined || combatRound === null) return undefined;
  return Math.max(0, expiresRound - combatRound);
}

/** Sufixo " · N rodada(s)" pro tooltip; "" se a condição é permanente (ou sem combate ativo). */
function roundsSuffix(expiresRound: number | undefined, combatRound: number | null): string {
  const left = roundsLeft(expiresRound, combatRound);
  return left === undefined ? "" : ` · ${left} rodada${left === 1 ? "" : "s"}`;
}

const ConditionMarkers: React.FC<{
  width: number;
  height: number;
  stageScale: number;
  combatRound: number | null;
  entries: { cond: TokenCondition; def: ConditionDef }[];
}> = ({ width, height, stageScale, combatRound, entries }) => {
  const layout = conditionLayout(width, height, stageScale, entries.length);

  if (layout.mode === "counter") {
    return <ConditionCounter cx={layout.cx} cy={layout.cy} count={entries.length} stageScale={stageScale} />;
  }

  const slots: ConditionSlot[] = entries.slice(0, layout.visibleCount).map(({ cond, def }) => ({
    key: def.key,
    label: def.label,
    description: def.description,
    icon: def.icon,
    color: def.color,
    roundsLeft: roundsLeft(cond.expiresRound, combatRound),
  }));
  if (layout.hiddenCount > 0) {
    slots.push({ key: "__overflow", label: `+${layout.hiddenCount}`, description: "", color: "#71717a" });
  }

  return (
    <>
      {slots.map((slot, i) => {
        const p = layout.slots[i];
        return p ? <ConditionBadge key={slot.key} slot={slot} x={p.x} y={p.y} r={layout.r} /> : null;
      })}
    </>
  );
};

/**
 * Um badge: fundo circular escuro semitransparente + ícone (SVG do JSON, rasterizado com a cor da
 * condição), ou "+N". Ícone que falha no load cai na INICIAL da condição — nunca no rótulo inteiro,
 * que quebraria em várias linhas e vazaria pra fora do círculo. Condição com duração ganha um
 * selinho pequeno no canto inferior direito com as rodadas restantes (o tooltip tem o texto por
 * extenso — o número aqui é só um lembrete rápido, fica minúsculo em zoom baixo).
 */
const ConditionBadge: React.FC<{ slot: ConditionSlot; x: number; y: number; r: number }> = ({ slot, x, y, r }) => {
  const iconUrl = useMemo(() => (slot.icon ? conditionIconDataUrl(slot.icon, slot.color) : null), [slot.icon, slot.color]);
  const icon = useImage(iconUrl);
  const iconSize = r * 1.24;
  // O slot "+N" não tem ícone e usa o próprio rótulo ("+3"); condição sem ícone (ou cujo ícone
  // falhou no load) mostra só a inicial.
  const fallback = slot.icon ? slot.label.charAt(0).toUpperCase() : slot.label;

  return (
    <Group name="condition-badge" x={x} y={y} listening={false}>
      <Circle radius={r} fill="rgba(12, 12, 12, 0.75)" stroke={slot.color} strokeWidth={Math.max(1, r * 0.1)} />
      {icon ? (
        <KonvaImage image={icon} x={-iconSize / 2} y={-iconSize / 2} width={iconSize} height={iconSize} />
      ) : (
        <Text x={-r} y={-r * 0.45} width={r * 2} text={fallback} align="center" fontSize={r * 0.85} fontFamily="sans-serif" fontStyle="bold" fill="#e0e0e0" wrap="none" ellipsis />
      )}
      {slot.roundsLeft !== undefined && (
        <Group x={r * 0.62} y={r * 0.62}>
          <Circle radius={Math.max(4, r * 0.46)} fill="#0c0c0c" stroke="#d4af37" strokeWidth={1} />
          <Text
            x={-r}
            y={-r * 0.32}
            width={r * 2}
            text={String(slot.roundsLeft)}
            align="center"
            fontSize={Math.max(6, r * 0.6)}
            fontFamily="monospace"
            fontStyle="bold"
            fill="#d4af37"
            wrap="none"
          />
        </Group>
      )}
    </Group>
  );
};

/**
 * Fallback de zoom baixo: um badge de tamanho FIXO em tela (não some nem encolhe além disso),
 * ancorado no canto superior direito da bounding box. `scale={1/stageScale}` cancela o zoom do
 * Stage no subtree — os filhos são desenhados direto em "px de tela equivalente".
 */
const ConditionCounter: React.FC<{ cx: number; cy: number; count: number; stageScale: number }> = ({ cx, cy, count, stageScale }) => {
  const radius = CONDITION_COUNTER_RADIUS;
  return (
    <Group name="condition-badge" x={cx} y={cy} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
      <Circle radius={radius} fill="rgba(12, 12, 12, 0.85)" stroke="#71717a" strokeWidth={1.2} />
      <Text x={-radius} y={-4} width={radius * 2} text={String(count)} align="center" fontSize={9} fontFamily="sans-serif" fontStyle="bold" fill="#e0e0e0" />
    </Group>
  );
};

/**
 * Tooltip das condições, numa camada PRÓPRIA acima de todos os tokens.
 *
 * Por que não dentro do Group do token (era um bug real, medido): tokens são Groups irmãos na mesma
 * layer, então um token desenhado depois pinta por cima do tooltip do anterior. Como o balão abre
 * pra direita, ele caía justamente na célula vizinha — com um token colado à direita sobravam 9 px
 * visíveis, dava pra ler uma letra de "Cego" e nada de "Sobrecarregado".
 *
 * Só o TOOLTIP sobe de camada, não os badges: badge é permanente e precisa continuar respeitando a
 * ordem mapa → tokens alheios → névoa → meus tokens (§9.3 do SPEC); o tooltip é efêmero e só existe
 * pro token que o usuário já está apontando, então não vaza nada da névoa.
 *
 * O balão é desenhado em tamanho de TELA fixo (`scale = 1/stageScale`): antes escalava com o zoom
 * e ficava ilegível de longe.
 */
const ConditionTooltipLayerContent: React.FC<{ tip: ConditionTooltip; stageScale: number }> = ({ tip, stageScale }) => (
  <Group x={tip.x} y={tip.y} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
    <Label x={tip.anchorRadius + 4} y={-tip.anchorRadius - 2}>
      <Tag fill="#0c0c0c" stroke="#2d2417" strokeWidth={1} cornerRadius={3} />
      <Text text={tip.text} fontSize={11} fontFamily="sans-serif" fill="#e0e0e0" padding={5} lineHeight={1.3} />
    </Label>
  </Group>
);

// --- Névoa: contorno do gesto em andamento -----------------------------------

interface FogGestureOverlayProps {
  tool: FogTool;
  pointer: { x: number; y: number } | null;
  polygonPoints: number[];
  draft: FogShape | null;
  stageScale: number;
}

/**
 * Guias douradas por cima da névoa: círculo do pincel no ponteiro, contorno do
 * retângulo em andamento e vértices + linha elástica do polígono. Só desenho; a
 * "tinta" de verdade é o draft na FogLayer.
 */
const FogGestureOverlay: React.FC<FogGestureOverlayProps> = ({ tool, pointer, polygonPoints, draft, stageScale }) => {
  const k = 1 / stageScale;
  const color = tool.mode === "reveal" ? "#d4af37" : "#f87171";
  return (
    <Group>
      {tool.shape === "brush" && pointer && (
        <Circle x={pointer.x} y={pointer.y} radius={tool.brushSize / 2} stroke={color} strokeWidth={1.5 * k} dash={[6 * k, 4 * k]} />
      )}
      {tool.shape === "rect" && draft?.kind === "rect" && (
        <Rect x={draft.x} y={draft.y} width={draft.width} height={draft.height} stroke={color} strokeWidth={1.5 * k} dash={[6 * k, 4 * k]} />
      )}
      {tool.shape === "polygon" && polygonPoints.length >= 2 && (
        <>
          <Line
            points={pointer ? [...polygonPoints, pointer.x, pointer.y] : polygonPoints}
            stroke={color}
            strokeWidth={1.5 * k}
            dash={[6 * k, 4 * k]}
            closed={polygonPoints.length >= 6}
          />
          {Array.from({ length: polygonPoints.length / 2 }, (_, i) => (
            <Circle key={i} x={polygonPoints[i * 2] ?? 0} y={polygonPoints[i * 2 + 1] ?? 0} radius={(i === 0 ? 5 : 3.5) * k} fill={i === 0 ? color : "#1a1a1a"} stroke={color} strokeWidth={k} />
          ))}
        </>
      )}
    </Group>
  );
};

// --- Régua -----------------------------------------------------------------

const distanceFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** "6 m · 4 células" (sistema com `grid`) ou só "4 células". */
export function formatDistance(d: { cells: number; value: number | null; unit: string | null }): string {
  const cells = `${distanceFormat.format(d.cells)} ${d.cells === 1 ? "célula" : "células"}`;
  return d.value !== null && d.unit !== null ? `${distanceFormat.format(d.value)} ${d.unit} · ${cells}` : cells;
}

interface RulerShapeProps {
  ruler: Ruler;
  grid: Scene["grid"];
  systemDef: SystemDefinition | null;
  /** Zoom atual: traço, pontas e rótulo mantêm tamanho de tela. */
  stageScale: number;
  color: string;
  /** Nickname de quem mede (réguas remotas); null na minha. */
  author: string | null;
}

/** Linha da régua com o rótulo da distância. O deslocamento em células vem do cellSize da CENA; a regra, do sistema. */
const RulerShape: React.FC<RulerShapeProps> = ({ ruler, grid, systemDef, stageScale, color, author }) => {
  const { start, end } = ruler;
  const dxCells = (end.x - start.x) / grid.cellSize;
  const dyCells = (end.y - start.y) / grid.cellSize;
  const label = formatDistance(measureDistance(systemDef ?? { grid: undefined }, dxCells, dyCells));
  const k = 1 / stageScale;
  return (
    <Group>
      <Line points={[start.x, start.y, end.x, end.y]} stroke="#000" strokeWidth={4 * k} opacity={0.5} lineCap="round" />
      <Line points={[start.x, start.y, end.x, end.y]} stroke={color} strokeWidth={2 * k} dash={[8 * k, 6 * k]} lineCap="round" />
      <Circle x={start.x} y={start.y} radius={4 * k} fill={color} stroke="#000" strokeWidth={k} />
      <Circle x={end.x} y={end.y} radius={4 * k} fill={color} stroke="#000" strokeWidth={k} />
      <Label x={end.x} y={end.y - 14 * k} scaleX={k} scaleY={k}>
        <Tag fill="#1a1a1a" stroke={color} strokeWidth={1} cornerRadius={3} pointerDirection="down" pointerWidth={8} pointerHeight={6} opacity={0.95} />
        <Text text={author ? `${author}: ${label}` : label} fontSize={12} fontFamily="monospace" fontStyle="bold" fill={color} padding={5} />
      </Label>
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
