import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { selectActiveScene, selectViewedScene, useRoom } from "../store/room";
import { sceneTokens, useTokens } from "../store/tokens";
import { sceneTemplates, useTemplates } from "../store/templates";
import { useTemplateHistory } from "../store/templateHistory";
import { useTargets } from "../store/targets";
import { useHandouts } from "../store/handouts";
import { scenePins, usePins } from "../store/pins";
import { sceneDrawings, useDrawings } from "../store/drawings";
import { useDrawingHistory } from "../store/drawingHistory";
import { resolvePinIcons } from "../lib/pinIcons";
import { describeTemplateAreaChange } from "../lib/templates";
import { effectiveCellSize, sizeTokens } from "../lib/grid";
import type { PlaceOnMapController } from "../lib/placeOnMap";
import { useChat } from "../store/chat";
import { activeCombatant, isMyTurn, sceneCombat, useCombat } from "../store/combat";
import { canEditCharacter, sortedCharacters, useCharacters } from "../store/characters";
import { useParty } from "../store/party";
import { useSystemDef } from "../lib/system";
import { useEmitGmView } from "../lib/castCamera";
import { useToolShortcuts } from "../lib/useToolShortcuts";
import { useMacroShortcuts } from "../lib/useMacroShortcuts";
import { deleteSelectedTokens, useDeleteSelectionShortcut } from "../lib/useDeleteSelectionShortcut";
import { useTokenMoveShortcuts } from "../lib/useTokenMoveShortcuts";
import { useMapPaletteShortcut } from "../lib/useMapPaletteShortcut";
import { useSidePanelShortcut } from "../lib/useSidePanelShortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useImmersiveModeShortcut } from "../lib/useImmersiveModeShortcut";
import { useGmPanelShortcuts } from "../lib/useGmPanelShortcuts";
import { useCombatTurnShortcut } from "../lib/useCombatTurnShortcut";
import { useFullscreen } from "../lib/useFullscreen";
import { useIdle } from "../lib/useIdle";
import { useTurnTitle } from "../lib/useTurnTitle";
import { useHistory } from "../store/history";
import { useSceneList } from "../store/sceneList";
import { selectEffectiveMode, useTools } from "../store/tools";
import {
  buildLibraryItems,
  computeCharacter,
  isPointRevealed,
  pickTokensToCarry,
  targetsFromTemplate,
  tokenCenter,
  withMapScale,
  type Asset,
  type Drawing,
  type DrawingPatchPayload,
  type Handout,
  type HandoutCard,
  type Pin,
  type Template,
  type TemplateChangeAction,
} from "@tormenta-vtt/shared";
import { newId } from "../lib/ids";
import { CharacterSheetDrawer } from "./CharacterSheetDrawer";
import { CombatBanner } from "./CombatBanner";
import { type CombatPanelCallbacks } from "./CombatPanel";
import { CarryTokensDialog, type CarryTokenRow } from "./CarryTokensDialog";
import { MapSelector } from "./MapSelector";
import { HandoutSelector } from "./HandoutSelector";
import { HandoutOverlay } from "./HandoutOverlay";
import { CharacterDragGhost } from "./CharacterDragGhost";
import { HandoutDragGhost } from "./HandoutDragGhost";
import { DiceOverlay3D } from "./DiceOverlay3D";
import { NotePinCard } from "./NotePinCard";
import { PinCreatePopover } from "./PinCreatePopover";
import { DrawToolbar } from "./DrawToolbar";
import { DrawingTextPopover } from "./DrawingTextPopover";
import { NotesPanel, type NotesPanelTarget } from "./NotesPanel";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { FogToolbar } from "./FogToolbar";
import { TemplateToolbar } from "./TemplateToolbar";
import { VttCanvas, type TokenBar, type VttCanvasHandle } from "./VttCanvas";
import { TOKEN_COLORS } from "./TokenInspector";
import { ClipboardList, Image as ImageIcon, Library, LogOut } from "lucide-react";
import { SidePanel, type SidePanelTab } from "./SidePanel";
import { MapConfigModal, type MapConfigResult } from "./MapConfigModal";
import { PrepPanel, type PrepPanelProps } from "./PrepPanel";
import { BastidoresDrawer, type BastidoresSection } from "./bastidores/BastidoresDrawer";
import { MapsSection } from "./bastidores/MapsSection";
import { TabErrorBoundary } from "./TabErrorBoundary";
import { PrepNextStepCard } from "./PrepNextStepCard";
import { TopBarOverflowMenu, type OverflowAction } from "./TopBarOverflowMenu";
import { CharacterMenu } from "./CharacterMenu";
import { CastMenu } from "./cast/CastMenu";
import { useCast } from "../store/cast";
import { NicknamePrompt } from "./NicknamePrompt";
import { CompendiumPalette } from "./compendium/CompendiumPalette";
import { MacroBar, useMacroBarController } from "./MacroBar";
import { DragGhost, EncounterDragGhost } from "./compendium/DragGhost";
import { useCompendium } from "../store/compendium";
import { useEncounters } from "../store/encounters";
import { useMacros } from "../store/macros";
import { useLibrary } from "../store/library";
import { LibrarySelector } from "./LibrarySelector";
import { LibraryDragGhost } from "./LibraryDragGhost";
import { CREATURE_FILTER } from "../lib/compendium";
import { useAudio } from "../store/audio";
import { AudioEngine } from "./AudioEngine";
import { AudioPlayer } from "./AudioPlayer";
import { VolumeControl } from "./VolumeControl";

const CENTER_ON_TURN_KEY = "tvtt:centerOnActiveTurn";
const SIDE_PANEL_COLLAPSED_KEY = "tvtt:sidePanelCollapsed";
// Visão de grupo (SPEC §3.6): preferência por usuário, padrão ligada — mesmo padrão de CENTER_ON_TURN_KEY.
const PARTY_VIEW_EXPANDED_KEY = "tvtt:partyViewExpanded";
// Sistema de alvos (docs/plano-alvos.md): preferências por usuário, mesmo padrão de CENTER_ON_TURN_KEY.
const SHOW_OTHER_TARGETS_KEY = "tvtt:showOtherTargets";
const CLEAR_TARGETS_ON_TURN_END_KEY = "tvtt:clearTargetsOnTurnEnd";
// Barras flutuantes translúcidas sobre o mapa: preferência por usuário, padrão ligada — mesmo
// padrão de PARTY_VIEW_EXPANDED_KEY (botão no HUD inferior do VttCanvas, ver useBarTranslucency).
const TRANSLUCENT_BARS_OVER_MAP_KEY = "tvtt:translucentBarsOverMap";
// Modo imersivo (docs/SPEC.md §9.22): só a cor de fundo fora do mapa é preferência persistida
// (`null` = padrão quase preto, ver lib/immersiveMode.ts) — o modo em si (entrar/sair) é uma ação de
// cada sessão, como tela cheia, não algo que volta sozinho ao recarregar a página.
const IMMERSIVE_BG_COLOR_KEY = "tvtt:immersiveBgColor";
/** Bastidores (§9.29): aberto/fechado e seção ativa, por usuário (mesmo padrão dos outros acima). */
const BASTIDORES_OPEN_KEY = "tvtt:bastidoresOpen";
const BASTIDORES_SECTION_KEY = "tvtt:bastidoresSection";
/** Abaixo disto, gaveta e painel lateral não cabem juntos: abrir um recolhe o outro (§9.29). */
const NARROW_LAYOUT_QUERY = "(max-width: 1099px)";

/** Patch de um traço já existente (SPEC §9.17) — mesmo shape do payload do servidor. */
type DrawingPatch = DrawingPatchPayload["patch"];

/**
 * Página da mesa: entra na sala pela URL e liga as stores aos componentes.
 * Os componentes visuais recebem props; só esta página conhece as stores.
 */
export function RoomPage({ inviteCode, gmSecret }: { inviteCode: string; gmSecret: string | null }) {
  const status = useRoom((s) => s.status);
  const lastJoin = useRoom((s) => s.lastJoin);
  const join = useRoom((s) => s.join);

  // Entra na sala ao abrir a URL (a menos que o Lobby já tenha iniciado o join deste código).
  useEffect(() => {
    if (lastJoin?.inviteCode !== inviteCode) void join({ inviteCode, gmSecret });
  }, [inviteCode, gmSecret, lastJoin?.inviteCode, join]);

  if (status.kind === "needsNickname") {
    return (
      <NicknamePrompt inviteCode={inviteCode} error={status.error} onSubmit={(nickname) => void join({ inviteCode, gmSecret, nickname })} />
    );
  }

  if (status.kind === "error") {
    return (
      <Centered>
        <p className="font-ui text-14 text-text">{status.message}</p>
        <button onClick={() => navigate("/")} className="focus-ring font-ui text-13 text-accent underline underline-offset-2 cursor-pointer">
          Voltar ao lobby
        </button>
      </Centered>
    );
  }

  if (status.kind !== "joined") {
    return (
      <Centered>
        <p className="font-ui text-14 text-text-muted">Entrando na sala…</p>
      </Centered>
    );
  }

  return <Table />;
}

function Table() {
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const participants = useRoom((s) => s.participants);
  // "scene" = mapa que ESTE cliente está vendo (docs/plano-mapas.md §4): dirige o canvas, a névoa,
  // a régua, o combate e o spawn de criatura. `selectActiveScene` continua existindo pro
  // `MapSelector` (que precisa saber qual é o ativo de verdade da mesa, além do que o GM está vendo).
  const scene = useRoom(selectViewedScene);
  const activeScene = useRoom(selectActiveScene);
  const scenes = useRoom((s) => s.scenes);
  const viewingSceneId = useRoom((s) => s.viewingSceneId);
  const leave = useRoom((s) => s.leave);
  const setMap = useRoom((s) => s.setMap);
  const updateGrid = useRoom((s) => s.updateGrid);
  const enterScene = useRoom((s) => s.enterScene);
  const createScene = useRoom((s) => s.createScene);
  const activateScene = useRoom((s) => s.activateScene);
  const renameScene = useRoom((s) => s.renameScene);
  const duplicateSceneAction = useRoom((s) => s.duplicateScene);
  const deleteScene = useRoom((s) => s.deleteScene);
  const reorderScenesAction = useRoom((s) => s.reorderScenes);
  const setSceneArrival = useRoom((s) => s.setSceneArrival);
  const [isMapConfigOpen, setMapConfigOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("chat");
  // Painel lateral recolhido (\ ou Ctrl+B, ícone na borda): preferência por usuário (localStorage,
  // mesmo padrão de centerOnActiveTurn abaixo) — cada navegador/aba é "um usuário" neste app sem login.
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDE_PANEL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDE_PANEL_COLLAPSED_KEY, sidePanelCollapsed ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [sidePanelCollapsed]);
  useSidePanelShortcut(() => setSidePanelCollapsed((v) => !v));

  // Bastidores (§9.29): coluna à esquerda com Mapas e Preparo, uma seção por vez. Aberto/fechado e
  // seção ativa ficam no localStorage (por usuário), mesmo padrão do painel lateral recolhido.
  const [bastidoresOpen, setBastidoresOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BASTIDORES_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [bastidoresSection, setBastidoresSection] = useState<BastidoresSection>(() => {
    try {
      return localStorage.getItem(BASTIDORES_SECTION_KEY) === "preparo" ? "preparo" : "mapas";
    } catch {
      return "mapas";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(BASTIDORES_OPEN_KEY, bastidoresOpen ? "1" : "0");
      localStorage.setItem(BASTIDORES_SECTION_KEY, bastidoresSection);
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [bastidoresOpen, bastidoresSection]);
  // Refs com o estado atual: deixam o toggle abaixo ter dependência vazia (identidade estável, que
  // os atalhos precisam) sem ler `bastidoresOpen`/`bastidoresSection` de um closure velho.
  const sectionRef = useRef(bastidoresSection);
  sectionRef.current = bastidoresSection;
  const bastidoresOpenRef = useRef(bastidoresOpen);
  bastidoresOpenRef.current = bastidoresOpen;
  /**
   * Abre numa seção (ou fecha, se já estava aberta NELA) — é o que as teclas M/Shift+P fazem.
   * Decide FORA do updater de estado: um updater precisa ser puro, e o React pode reexecutá-lo num
   * render seguinte. Quando isso acontecia com a decisão lá dentro, a segunda execução já via a
   * seção nova e lia "mesma seção" — então Shift+P com os Mapas abertos fechava a gaveta em vez de
   * trocar para o Preparo.
   */
  const toggleBastidoresSection = useCallback((section: BastidoresSection) => {
    if (bastidoresOpenRef.current && sectionRef.current === section) {
      setBastidoresOpen(false);
      return;
    }
    setBastidoresSection(section);
    setBastidoresOpen(true);
  }, []);

  /**
   * Abaixo de 1100 px a gaveta (340) e o painel lateral (320/384) não cabem junto com um mapa
   * utilizável: abrir um lado recolhe o outro (§9.29). A regra é só de layout — não escreve a
   * preferência do usuário no localStorage (mesmo cuidado do modo imersivo): `narrowHidesSidePanel`
   * é um véu por cima dela, e volta a valer sozinho quando a janela cresce ou a gaveta fecha.
   */
  const narrowLayout = useMediaQuery(NARROW_LAYOUT_QUERY);
  // Mantém a gaveta montada durante a animação de saída (150 ms) e a desmonta depois — assim o
  // MapsPanel/PrepPanel não ficam carregando em segundo plano com a gaveta fechada.
  const [bastidoresRendered, setBastidoresRendered] = useState(bastidoresOpen);
  useEffect(() => {
    if (bastidoresOpen) {
      setBastidoresRendered(true);
      return;
    }
    const id = setTimeout(() => setBastidoresRendered(false), 160);
    return () => clearTimeout(id);
  }, [bastidoresOpen]);

  /** Véu de layout: numa janela estreita com os Bastidores abertos, a Mesa fica recolhida. */
  const narrowHidesSidePanel = narrowLayout && bastidoresOpen && me?.role === "gm";

  // --- Modo imersivo do mapa (docs/SPEC.md §9.22) -------------------------------------------------
  // `immersiveMode` não é persistido (ver comentário de IMMERSIVE_BG_COLOR_KEY no topo do arquivo).
  // O painel lateral recolhido AO ENTRAR usa um flag à parte de `sidePanelCollapsed`
  // (`immersiveSidePanelCollapsed`) — assim entrar/sair do modo nunca sobrescreve a preferência
  // normal de recolhido do usuário (só ela vai pro localStorage), e "restaurar o layout anterior" ao
  // sair sai de graça: já não mexemos nela. `effectiveSidePanelCollapsed` é o que todo o resto do
  // componente (painel, badge de não lidas) deve enxergar.
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [immersiveSidePanelCollapsed, setImmersiveSidePanelCollapsed] = useState(true);
  const effectiveSidePanelCollapsed = immersiveMode ? immersiveSidePanelCollapsed : sidePanelCollapsed || narrowHidesSidePanel;
  /**
   * Alça/atalho do painel lateral. Numa janela estreita com os Bastidores abertos, quem esconde a
   * Mesa é o VÉU, não a preferência: aí o botão significa sempre "me devolve a Mesa" — fecha os
   * Bastidores e deixa a preferência expandida, em vez de inverter um valor que já estava expandido
   * (o que recolhia a Mesa de verdade e fazia o botão parecer quebrado).
   */
  const toggleSidePanelCollapsed = () => {
    if (immersiveMode) {
      setImmersiveSidePanelCollapsed((v) => !v);
      return;
    }
    if (narrowHidesSidePanel) {
      setBastidoresOpen(false);
      setSidePanelCollapsed(false);
      return;
    }
    setSidePanelCollapsed((v) => !v);
  };
  const enterImmersiveMode = () => {
    setImmersiveSidePanelCollapsed(true);
    setImmersiveMode(true);
  };
  const exitImmersiveMode = () => setImmersiveMode(false);
  const toggleImmersiveMode = () => (immersiveMode ? exitImmersiveMode() : enterImmersiveMode());
  useImmersiveModeShortcut(immersiveMode, toggleImmersiveMode, exitImmersiveMode);
  // Barras flutuantes (TopBar, Toolbar, HUD do canvas, barra de macros) somem de vez depois de 2s
  // sem mouse/tecla; qualquer atividade traz tudo de volta na hora (lib/useIdle).
  const immersiveIdle = useIdle(immersiveMode, 2000);
  const immersiveBarsHidden = immersiveMode && immersiveIdle;
  // "Tela cheia do navegador": item do menu do botão Imersivo, mas independente — combinável.
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  // Cor de fundo fora do mapa nesse modo: preferência pessoal (`null` = padrão quase preto).
  const [immersiveBgColor, setImmersiveBgColor] = useState<string | null>(() => {
    try {
      return localStorage.getItem(IMMERSIVE_BG_COLOR_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (immersiveBgColor) localStorage.setItem(IMMERSIVE_BG_COLOR_KEY, immersiveBgColor);
      else localStorage.removeItem(IMMERSIVE_BG_COLOR_KEY);
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [immersiveBgColor]);
  const [partyViewExpanded, setPartyViewExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(PARTY_VIEW_EXPANDED_KEY);
      return saved === null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PARTY_VIEW_EXPANDED_KEY, partyViewExpanded ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [partyViewExpanded]);
  // Mapas (docs/plano-mapas.md §8/§9): diálogo "Levar para o mapa" ao ativar, e o modo "definir
  // ponto de chegada" (o próximo clique no canvas do mapa X grava, ver VttCanvas#arrivalPickMode).
  const [carryDialogSceneId, setCarryDialogSceneId] = useState<string | null>(null);
  const [settingArrivalSceneId, setSettingArrivalSceneId] = useState<string | null>(null);
  const sceneListItems = useSceneList((s) => s.itemsBySceneId);
  const loadSceneList = useSceneList((s) => s.load);

  // Ferramenta ativa do canvas + atalhos de teclado (V/H/R/Esc/espaço).
  const toolMode = useTools((s) => s.mode);
  const effectiveMode = useTools(selectEffectiveMode);
  const setToolMode = useTools((s) => s.setMode);
  const cancelNonce = useTools((s) => s.cancelNonce);
  const ruler = useTools((s) => s.ruler);
  const remoteRulersById = useTools((s) => s.remoteRulers);
  const updateRuler = useTools((s) => s.updateRuler);
  const clearRuler = useTools((s) => s.clearRuler);
  // Névoa (GM): sub-modo, forma e pincel ficam na store de ferramentas; a névoa em si é da cena.
  const fogMode = useTools((s) => s.fogMode);
  const fogShape = useTools((s) => s.fogShape);
  const fogBrushSize = useTools((s) => s.fogBrushSize);
  const setFogMode = useTools((s) => s.setFogMode);
  const setFogShape = useTools((s) => s.setFogShape);
  const setFogBrushSize = useTools((s) => s.setFogBrushSize);
  const fogOp = useRoom((s) => s.fogOp);
  // Gabaritos de área de efeito (docs/plano-gabaritos.md): forma/tamanho ficam na store de
  // ferramentas (igual à névoa); os gabaritos em si são da cena, guardados em useTemplates.
  const templateShape = useTools((s) => s.templateShape);
  const templateSize = useTools((s) => s.templateSize);
  const templateAngle = useTools((s) => s.templateAngle);
  const templateWidth = useTools((s) => s.templateWidth);
  const setTemplateShape = useTools((s) => s.setTemplateShape);
  const setTemplateSize = useTools((s) => s.setTemplateSize);
  const pickTemplatePreset = useTools((s) => s.pickTemplatePreset);
  const templatesByScene = useTemplates((s) => s.byScene);
  const templates = useMemo(() => sceneTemplates(templatesByScene, scene?.id), [templatesByScene, scene?.id]);
  const selectedTemplateId = useTemplates((s) => s.selectedId);
  const selectTemplate = useTemplates((s) => s.select);
  const createTemplate = useTemplates((s) => s.create);
  const templateLive = useTemplates((s) => s.updateLive);
  const commitTemplate = useTemplates((s) => s.commit);
  // Desenho livre no mapa (SPEC §9.17): forma/cor/espessura/preenchimento/visibilidade ficam na
  // store de ferramentas (igual à névoa/gabarito); os traços em si são da cena, em useDrawings.
  const drawKind = useTools((s) => s.drawKind);
  const drawColor = useTools((s) => s.drawColor);
  const drawStrokeWidth = useTools((s) => s.drawStrokeWidth);
  const drawFilled = useTools((s) => s.drawFilled);
  const drawVisible = useTools((s) => s.drawVisible);
  const setDrawKind = useTools((s) => s.setDrawKind);
  const setDrawColor = useTools((s) => s.setDrawColor);
  const setDrawStrokeWidth = useTools((s) => s.setDrawStrokeWidth);
  const setDrawFilled = useTools((s) => s.setDrawFilled);
  const setDrawVisible = useTools((s) => s.setDrawVisible);
  const drawingsByScene = useDrawings((s) => s.byScene);
  const drawings = useMemo(() => sceneDrawings(drawingsByScene, scene?.id), [drawingsByScene, scene?.id]);
  const selectedDrawingId = useDrawings((s) => s.selectedId);
  const selectDrawing = useDrawings((s) => s.select);
  const createDrawing = useDrawings((s) => s.create);
  const drawingLive = useDrawings((s) => s.updateLive);
  const commitDrawing = useDrawings((s) => s.commit);
  const clearMyDrawings = useDrawings((s) => s.clearMine);
  const clearAllDrawings = useDrawings((s) => s.clearAll);
  const setPlayerDrawingPermission = useDrawings((s) => s.setPlayerPermission);
  const playerDrawingEnabled = useRoom((s) => s.playerDrawingEnabled);
  const [pendingDrawingTextPoint, setPendingDrawingTextPoint] = useState<{ x: number; y: number } | null>(null);
  useToolShortcuts();
  useMacroShortcuts();
  const macroBarController = useMacroBarController();
  useDeleteSelectionShortcut();
  useTokenMoveShortcuts();
  useCombatTurnShortcut();

  // Handouts (docs/SPEC.md §9.10): biblioteca por sala (só GM, carregada sob demanda ao abrir o
  // HandoutSelector) + overlay em tela cheia atualmente aberto.
  const handoutLibrary = useHandouts((s) => s.library);
  const loadHandoutLibrary = useHandouts((s) => s.loadLibrary);
  const createHandout = useHandouts((s) => s.create);
  const updateHandout = useHandouts((s) => s.update);
  const deleteHandout = useHandouts((s) => s.remove);
  const showHandout = useHandouts((s) => s.show);
  const closeHandoutForAll = useHandouts((s) => s.closeForAll);
  const openHandoutLocal = useHandouts((s) => s.openLocal);
  const closeHandoutLocal = useHandouts((s) => s.closeLocal);
  const openHandout = useHandouts((s) => s.open);

  // Esc cancela o modo "definir ponto de chegada" em andamento (mesmo gesto de cancelar de sempre).
  useEffect(() => {
    setSettingArrivalSceneId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelNonce]);

  // Seleciona o objeto estável (byId) e deriva a lista com useMemo: um seletor que
  // devolvesse um array novo a cada chamada faria o Zustand re-renderizar sem parar.
  const byId = useTokens((s) => s.byId);
  // Jogador: tokens alheios com o centro na névoa não aparecem (a mesma regra do servidor, que
  // nem os envia; aqui cobre broadcasts fora de ordem entre fog:updated e token:deleted).
  const tokens = useMemo(() => {
    const all = sceneTokens(byId, scene?.id);
    if (!scene || !me || me.role === "gm") return all;
    return all.filter((t) => t.ownerId === me.id || isPointRevealed(scene.fog, tokenCenter(t, effectiveCellSize(scene.grid))));
  }, [byId, scene, me]);
  // Token.cells é a fonte da verdade do tamanho (docs/plano-grid.md): deriva width/height uma vez
  // aqui, pras funções puras do shared (targetsFromTemplate) que ainda esperam width/height.
  const sizedTokens = useMemo(() => (scene ? sizeTokens(tokens, scene.grid) : []), [tokens, scene]);
  const selectedTokenId = useTokens((s) => s.selectedId);
  const selectedIds = useTokens((s) => s.selectedIds);
  const focusRequest = useTokens((s) => s.focusRequest);
  const selectToken = useTokens((s) => s.select);
  const selectMany = useTokens((s) => s.selectMany);
  const toggleSelect = useTokens((s) => s.toggleSelect);
  const focusToken = useTokens((s) => s.focus);
  const moveLive = useTokens((s) => s.moveLive);
  const patchToken = useTokens((s) => s.patch);
  const patchTokenMany = useTokens((s) => s.patchMany);
  const createToken = useTokens((s) => s.create);
  // Desfazer/refazer (docs/plano-desfazer.md): estado espelhado de history:updated (bindSocket.ts).
  const canUndo = useHistory((s) => s.canUndo);
  const canRedo = useHistory((s) => s.canRedo);
  const undoSummary = useHistory((s) => s.undoSummary);
  const redoSummary = useHistory((s) => s.redoSummary);
  const undoHistory = useHistory((s) => s.undo);
  const redoHistory = useHistory((s) => s.redo);
  const spawnFromCompendium = useTokens((s) => s.spawnFromCompendium);
  const placeCharacterToken = useTokens((s) => s.placeCharacter);
  const deleteToken = useTokens((s) => s.delete);
  const vttCanvasRef = useRef<VttCanvasHandle>(null);
  // Cast, "seguir o Mestre" (docs/plano-cast.md §4.1): manda o enquadramento pra tela de exibição,
  // throttled — só GM, e só quando compensa (useEmitGmView já filtra displayCount/cameraMode).
  useEmitGmView(() => vttCanvasRef.current?.getView() ?? null, scene?.id ?? null, me?.role === "gm");
  /** Solta na cena ativa (Enter/botão no preview usam o centro da viewport; arrastar no mapa usa o ponto largado). */
  const spawnCreatureAt = async (entryId: string, point: { x: number; y: number }, opts: { count: number; visible: boolean }): Promise<boolean> => {
    if (!scene) return false;
    const result = await spawnFromCompendium({ sceneId: scene.id, entryId, count: opts.count, visible: opts.visible, x: point.x, y: point.y });
    return result !== null;
  };
  /**
   * "Colocar no mapa" (SPEC §9.30): a ficha é a prateleira, o token é a presença dela neste mapa.
   * Montado aqui porque só o RoomPage conhece as três coisas de que todo botão desses precisa — o
   * mapa visto, os tokens dele e o centro da área visível do canvas — e desce como uma prop só.
   */
  const placeOnMap: PlaceOnMapController = {
    enabled: scene !== null,
    tokenOf: (characterId) => tokens.find((t) => t.characterId === characterId) ?? null,
    place: (characterId, point) => {
      if (!scene) return;
      // Sem ponto (botão, não arrasto): no CENTRO da área visível. O x/y do token é o canto
      // superior esquerdo, então desconta meio token — mesma conta do botão "Novo token".
      const cells = charById[characterId]?.tokenDefaults?.cells ?? 1;
      const half = (effectiveCellSize(scene.grid) * cells) / 2;
      const center = vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 };
      void placeCharacterToken(characterId, scene.id, point ?? { x: center.x - half, y: center.y - half });
    },
    goTo: (tokenId) => focusToken(tokenId),
  };

  const spawnEncounter = useEncounters((s) => s.spawn);
  /** Solta o encontro inteiro na cena ativa (§9.14) — mesma dualidade Enter/arrasto de spawnCreatureAt. */
  const spawnEncounterAt = async (
    encounterId: string,
    point: { x: number; y: number },
    opts: { startCombat: boolean; rollNpcInitiative: boolean },
  ): Promise<boolean> => {
    if (!scene) return false;
    return spawnEncounter(encounterId, scene.id, point, opts);
  };

  const messages = useChat((s) => s.messages);
  const sendMessage = useChat((s) => s.send);
  // Badge "mensagens não lidas" da alça do painel recolhido: quantas chegaram desde que recolheu.
  // Expandido, o contador acompanha messages.length de perto (fica sempre em 0); recolhido, ele
  // para de seguir e a diferença vira o badge — reabrir volta a seguir (zera na hora).
  const [seenMessageCount, setSeenMessageCount] = useState(messages.length);
  useEffect(() => {
    if (!effectiveSidePanelCollapsed) setSeenMessageCount(messages.length);
  }, [messages.length, effectiveSidePanelCollapsed]);
  const unreadMessages = effectiveSidePanelCollapsed ? Math.max(0, messages.length - seenMessageCount) : 0;

  // Combate do mapa VISITADO (docs/plano-mapas.md §7): não existe mais "o combate da sala" — cada
  // mapa tem o seu (ou nenhum), independente do que os outros mapas têm.
  const combatByScene = useCombat((s) => s.byScene);
  const combat = useMemo(() => sceneCombat(combatByScene, scene?.id), [combatByScene, scene?.id]);
  const combatStart = useCombat((s) => s.start);
  const combatAddCombatants = useCombat((s) => s.addCombatants);
  const combatRemove = useCombat((s) => s.remove);
  const combatRoll = useCombat((s) => s.roll);
  const combatSetInitiative = useCombat((s) => s.setInitiative);
  const combatSetSurprised = useCombat((s) => s.setSurprised);
  const combatNext = useCombat((s) => s.next);
  const combatPrev = useCombat((s) => s.prev);
  const combatReorder = useCombat((s) => s.reorder);
  const combatDelay = useCombat((s) => s.delay);
  const combatResume = useCombat((s) => s.resume);
  const combatEnd = useCombat((s) => s.end);
  const combatSetMovement = useCombat((s) => s.setMovement);
  const combatSetMovementLimit = useCombat((s) => s.setMovementLimit);
  const combatSetAutoRollNpcInitiative = useCombat((s) => s.setAutoRollNpcInitiative);
  const movementLimitEnabled = useRoom((s) => s.movementLimitEnabled);
  const autoRollNpcInitiativeEnabled = useRoom((s) => s.autoRollNpcInitiativeEnabled);
  // Callbacks do CombatPanel: cada um reempacota os argumentos "soltos" da UI no payload
  // que o evento combat:* espera (agora sempre com o sceneId do mapa VISITADO) e chama a ação
  // correspondente da store (server = fonte da verdade, sem otimismo — ver store/combat.ts).
  const viewedSceneId = scene?.id ?? null;
  const combatCallbacks: CombatPanelCallbacks = useMemo(
    () => ({
      // visibility: modo de rolagem ATUAL do GM (useChat.rollMode) — só importa pra rolagem
      // automática de NPCs (§3.5); lido na hora do clique, não precisa entrar nas deps do useMemo.
      onStart: (sceneId, tokenIds) => void combatStart({ sceneId, tokenIds, visibility: useChat.getState().rollMode }),
      onRoll: (scope, combatantId, visibility) => viewedSceneId && void combatRoll({ sceneId: viewedSceneId, scope, combatantId, visibility }),
      onSetInitiative: (combatantId, initiative, bonus) =>
        viewedSceneId && void combatSetInitiative({ sceneId: viewedSceneId, combatantId, initiative, bonus }),
      onNext: () => viewedSceneId && void combatNext(viewedSceneId),
      onPrev: () => viewedSceneId && void combatPrev(viewedSceneId),
      onReorder: (combatantIds) => viewedSceneId && void combatReorder(viewedSceneId, combatantIds),
      onAdd: (tokenIds) => viewedSceneId && void combatAddCombatants({ sceneId: viewedSceneId, tokenIds, visibility: useChat.getState().rollMode }),
      onRemove: (combatantIds) => viewedSceneId && void combatRemove(viewedSceneId, combatantIds),
      onDelay: (combatantId) => viewedSceneId && void combatDelay(viewedSceneId, combatantId),
      onResume: (combatantId) => viewedSceneId && void combatResume(viewedSceneId, combatantId),
      // Sem evento combat:skip no servidor: só faz sentido pular quem está agindo agora, e
      // aí equivale a avançar o turno (CombatPanel só mostra "Pular turno" pro combatente ativo).
      onSkip: () => viewedSceneId && void combatNext(viewedSceneId),
      onSetSurprised: (combatantId, surprised) => viewedSceneId && void combatSetSurprised({ sceneId: viewedSceneId, combatantId, surprised }),
      onEnd: (clear) => viewedSceneId && void combatEnd(viewedSceneId, clear),
      onSetMovement: (combatantId, patch) => viewedSceneId && void combatSetMovement({ sceneId: viewedSceneId, combatantId, ...patch }),
      onToggleMovementLimit: () => void combatSetMovementLimit({ enabled: !movementLimitEnabled }),
      onToggleAutoRollNpcInitiative: () => void combatSetAutoRollNpcInitiative({ enabled: !autoRollNpcInitiativeEnabled }),
    }),
    [
      viewedSceneId,
      combatStart,
      combatRoll,
      combatSetInitiative,
      combatNext,
      combatPrev,
      combatReorder,
      combatAddCombatants,
      combatRemove,
      combatDelay,
      combatResume,
      combatSetSurprised,
      combatEnd,
      combatSetMovement,
      combatSetMovementLimit,
      movementLimitEnabled,
      combatSetAutoRollNpcInitiative,
      autoRollNpcInitiativeEnabled,
    ],
  );
  const [centerOnActiveTurn, setCenterOnActiveTurn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CENTER_ON_TURN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CENTER_ON_TURN_KEY, centerOnActiveTurn ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [centerOnActiveTurn]);
  // Barras flutuantes (Toolbar, HUD do canvas) translúcidas sobre o mapa: botão no próprio HUD.
  const [translucentBarsOverMap, setTranslucentBarsOverMap] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(TRANSLUCENT_BARS_OVER_MAP_KEY);
      return saved === null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TRANSLUCENT_BARS_OVER_MAP_KEY, translucentBarsOverMap ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [translucentBarsOverMap]);

  // "Centralizar no token da vez": ao mudar quem age, foca (e seleciona) o token dele.
  const activeTurnTokenId = activeCombatant(combat)?.tokenId ?? null;
  useEffect(() => {
    if (centerOnActiveTurn && activeTurnTokenId) focusToken(activeTurnTokenId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerOnActiveTurn, activeTurnTokenId]);

  // Título da aba pisca "Seu turno" pra quem está numa aba em segundo plano.
  const myTurn = me !== null && isMyTurn(combat, me);
  useTurnTitle(myTurn);

  // Sistema de alvos (docs/plano-alvos.md): meus alvos + os dos outros (já filtrados pelo
  // servidor — nunca inclui o GM), e as duas preferências por usuário (mesmo padrão de
  // centerOnActiveTurn acima).
  const myTargetIds = useTargets((s) => s.mine);
  const targetSource = useTargets((s) => s.source);
  const othersTargets = useTargets((s) => s.others);
  const toggleTarget = useTargets((s) => s.toggle);
  const clearTargets = useTargets((s) => s.clear);
  const setTargetsFromTemplate = useTargets((s) => s.setFromTemplate);
  const [showOtherTargets, setShowOtherTargets] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_OTHER_TARGETS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_OTHER_TARGETS_KEY, showOtherTargets ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [showOtherTargets]);
  const [clearTargetsOnTurnEnd, setClearTargetsOnTurnEnd] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CLEAR_TARGETS_ON_TURN_END_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLEAR_TARGETS_ON_TURN_END_KEY, clearTargetsOnTurnEnd ? "1" : "0");
    } catch {
      /* ignora (aba anônima etc.) */
    }
  }, [clearTargetsOnTurnEnd]);
  // Fim do MEU turno (token que estava agindo era meu — para o GM, sem dono): limpa meus alvos,
  // se a opção estiver ligada. `lastActiveCombatantRef` guarda quem estava agindo ANTES da
  // mudança (o combate já trocou de mão quando este efeito roda).
  const lastActiveCombatantRef = useRef<{ id: string; ownerId: string | null } | null>(null);
  useEffect(() => {
    const activeC = activeCombatant(combat);
    const prev = lastActiveCombatantRef.current;
    lastActiveCombatantRef.current = activeC ? { id: activeC.id, ownerId: activeC.ownerId } : null;
    if (!clearTargetsOnTurnEnd || !prev || activeC?.id === prev.id) return;
    const wasMine = me?.role === "gm" ? prev.ownerId === null : prev.ownerId === me?.id;
    if (wasMine) void clearTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat?.activeCombatantId]);
  // Gabarito de área que EU coloquei substitui a seleção manual enquanto existir (docs/plano-alvos.md
  // §3.6): recalcula ao mover/girar (templates muda) ou tokens entrarem/saírem dele; some (Ctrl+Z,
  // Delete, apagar) => limpa os alvos (decisão: não volta pra seleção manual de antes).
  // Ids de token mirados por QUALQUER outro participante, no mapa visitado — pro CombatPanel (só
  // liga alguma coisa, sem nome de quem; VttCanvas já resolve o nome pro selo no token).
  const othersTargetTokenIds = useMemo(() => {
    if (!showOtherTargets || !scene) return [];
    const ids = new Set<string>();
    for (const state of Object.values(othersTargets)) {
      if (state.sceneId !== scene.id) continue;
      for (const id of state.tokenIds) ids.add(id);
    }
    return [...ids];
  }, [othersTargets, showOtherTargets, scene?.id]);

  const myTemplateId = targetSource.kind === "template" ? targetSource.templateId : null;
  useEffect(() => {
    if (!myTemplateId || !scene) return;
    const tmpl = templates.find((t) => t.id === myTemplateId);
    if (!tmpl) {
      void clearTargets();
      return;
    }
    const ids = targetsFromTemplate(sizedTokens, tmpl, effectiveCellSize(scene.grid));
    const current = useTargets.getState().mine;
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    void setTargetsFromTemplate(myTemplateId, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTemplateId, templates, sizedTokens, scene?.grid]);

  const charById = useCharacters((s) => s.byId);
  const characters = useMemo(() => sortedCharacters(charById), [charById]);
  const openCharacterId = useCharacters((s) => s.openId);
  const emptySheetOpen = useCharacters((s) => s.emptyOpen);
  const openCharacter = useCharacters((s) => s.open);
  const openEmptySheet = useCharacters((s) => s.openEmpty);
  const createCharacter = useCharacters((s) => s.create);
  const updateCharacter = useCharacters((s) => s.update);
  const deleteCharacter = useCharacters((s) => s.delete);
  const rollCharacter = useCharacters((s) => s.roll);
  const useCharacterItem = useCharacters((s) => s.useItem);
  const insertFromCompendium = useCharacters((s) => s.insertFromCompendium);
  const linkCharacter = useTokens((s) => s.linkCharacter);
  const systemDef = useSystemDef();
  /** `systemDef` com a escala do MAPA visitado por cima da do sistema (docs/SPEC.md §3.2, "Escala
   *  por mapa") — usado só onde célula→distância importa (rótulo do Ctrl+Z local de gabarito,
   *  unidade da barra de gabaritos); o resto continua em `systemDef`. */
  const mapSystemDef = useMemo(() => (systemDef && scene ? withMapScale(systemDef, scene.grid) : null), [systemDef, scene?.grid]);

  // Pinos no mapa (docs/plano-narracao.md — unifica handout:pin com pino de nota): pinos do mapa
  // visitado + ícones disponíveis (do sistema, senão o padrão embutido) + o cartão de nota aberto.
  const createPin = usePins((s) => s.create);
  const updatePin = usePins((s) => s.update);
  const removePin = usePins((s) => s.remove);
  const pinsByScene = usePins((s) => s.pinsByScene);
  /** Seleção (halo) — pino se comporta como token, docs/plano-narracao.md. */
  const selectedPinId = usePins((s) => s.selectedId);
  const selectPin = usePins((s) => s.select);
  const pins = useMemo(() => scenePins(pinsByScene, scene?.id), [pinsByScene, scene?.id]);
  const pinIcons = useMemo(() => resolvePinIcons(systemDef), [systemDef]);
  /** Ponto pendente da ferramenta "Pino" (clicou no mapa, formulário ainda não confirmado). */
  const [pendingPinPoint, setPendingPinPoint] = useState<{ x: number; y: number } | null>(null);
  /** Cartão de nota aberto (diferente do overlay de handout, que usa `openHandout` acima). */
  const [openNotePin, setOpenNotePin] = useState<(Pin & { kind: "note" }) | null>(null);

  // Notas do Mestre (docs/plano-narracao.md), por mapa ou por token — painel único, GM only.
  const [notesTarget, setNotesTarget] = useState<NotesPanelTarget | null>(null);

  // Visão de grupo (SPEC §9.15): grupo já filtrado pra este cliente (jogador nunca recebe oculto).
  const party = useParty((s) => s.entries);
  const addToParty = useParty((s) => s.add);
  const removeFromParty = useParty((s) => s.remove);
  const setPartyHidden = useParty((s) => s.setHidden);
  const reorderParty = useParty((s) => s.reorder);

  // Paleta do compêndio sobre o mapa (Mesa em foco, nenhuma ficha aberta — docs/plano-criaturas.md §2.2).
  const compendiumOpen = useCompendium((s) => s.isOpen);
  const compendiumContext = useCompendium((s) => s.context);
  const closeCompendium = useCompendium((s) => s.close);
  const mapPaletteOpen = compendiumOpen && compendiumContext === "map";
  useMapPaletteShortcut((openCharacterId !== null || emptySheetOpen) || isMapConfigOpen, me?.role === "gm" ? CREATURE_FILTER : null);

  // Seletores de Mapas (M), Handouts (J) e Acervo (B) do GM: aberto/fechado mora aqui, não dentro
  // de cada botão, pra tecla continuar valendo mesmo se o botão sair da barra (lib/useGmPanelShortcuts).
  // Abrir sempre dispara o carregamento sob demanda da lista (só a store conhece o evento).
  const [handoutSelectorOpen, setHandoutSelectorOpen] = useState(false);
  const [librarySelectorOpen, setLibrarySelectorOpen] = useState(false);
  // useCallback: identidade estável. Os seletores registram o Esc num efeito que depende disto; se
  // a função mudasse a cada render, o Esc (que também troca a ferramenta e re-renderiza a página no
  // meio do evento) removeria o listener antes de ele rodar.
  const setHandoutSelectorOpenAndLoad = useCallback((open: boolean) => {
    if (open) void useHandouts.getState().loadLibrary();
    setHandoutSelectorOpen(open);
  }, []);
  const setLibrarySelectorOpenAndLoad = useCallback((open: boolean) => {
    if (open) {
      void useLibrary.getState().loadAssets();
      void useLibrary.getState().loadFavorites();
    }
    setLibrarySelectorOpen(open);
  }, []);

  useGmPanelShortcuts(me?.role === "gm", {
    // M e Shift+P abrem a gaveta já na seção certa (§9.29); o seletor da barra virou só o estado.
    onToggleMaps: () => {
      void useSceneList.getState().load();
      toggleBastidoresSection("mapas");
    },
    onToggleHandouts: () => setHandoutSelectorOpenAndLoad(!handoutSelectorOpen),
    onToggleLibrary: () => setLibrarySelectorOpenAndLoad(!librarySelectorOpen),
    onTogglePrep: () => toggleBastidoresSection("preparo"),
  });

  // Réguas dos outros só valem na cena que estou vendo.
  const remoteRulers = useMemo(() => Object.values(remoteRulersById).filter((r) => r.sceneId === scene?.id), [remoteRulersById, scene?.id]);

  // Barra de vida: para cada token vinculado a uma ficha visível, o atual/máximo
  // do recurso apontado por tokenBar no JSON do sistema (computeCharacter dá o máximo).
  const tokenBars = useMemo(() => {
    const out: Record<string, TokenBar> = {};
    const resourceKey = systemDef?.tokenBar;
    if (!systemDef || !resourceKey) return out;
    const barOf = new Map<string, TokenBar>();
    for (const token of tokens) {
      if (!token.characterId) continue;
      const character = charById[token.characterId];
      if (!character) continue;
      let bar = barOf.get(character.id);
      if (!bar) {
        const computed = computeCharacter(systemDef, character);
        const res = character.resources[resourceKey];
        bar = { current: res?.current ?? 0, max: computed.resources[resourceKey]?.max ?? 0, temp: res?.temp ?? 0 };
        barOf.set(character.id, bar);
      }
      out[token.id] = bar;
    }
    return out;
  }, [systemDef, tokens, charById]);

  if (!room || !me) return null;
  const openChar = openCharacterId ? (charById[openCharacterId] ?? null) : null;
  const sheetOpen = openChar !== null || emptySheetOpen;
  const linkableCharacters = characters.filter((c) => canEditCharacter(me, c));
  const isGm = me.role === "gm";
  const hasAudioTrack = useAudio((s) => s.track !== null);

  // --- Gabaritos de área de efeito: Ctrl+Z local do jogador (docs/plano-gabaritos.md §4) ---------
  // O GM já tem tudo isso pela pilha geral do servidor (socket/templates.ts empilha sozinho); aqui
  // só cobre o jogador, que não tem acesso a `history:undo` (gmOnly). Efêmero: some ao recarregar.
  const pushTemplateUndo = (action: TemplateChangeAction, template: Template, revert: () => Promise<boolean>) => {
    if (isGm || !scene || !mapSystemDef) return;
    const cellSizePx = effectiveCellSize(scene.grid);
    useTemplateHistory.getState().push({ summary: describeTemplateAreaChange(action, mapSystemDef, template, cellSizePx), revert });
  };
  const handleTemplateCreate = (t: Template) => {
    if (!scene) return;
    void createTemplate(scene.id, t);
    pushTemplateUndo("colocar", t, () => useTemplates.getState().remove(scene.id, t.id));
    // Sistema de alvos (docs/plano-alvos.md §3.6): meu gabarito já vira meus alvos, substituindo a
    // seleção manual; o efeito de cima mantém isso ao vivo enquanto ele existir.
    void setTargetsFromTemplate(t.id, targetsFromTemplate(sizedTokens, t, effectiveCellSize(scene.grid)));
  };
  const handleTemplateCommit = (t: Template, dragFrom?: { x: number; y: number; rotation: number }) => {
    if (!scene) return;
    void commitTemplate(scene.id, t, dragFrom);
    if (!dragFrom) return; // sem dragFrom = não veio de um gesto de mover/girar (ou nada mudou)
    const action = dragFrom.x !== t.x || dragFrom.y !== t.y ? "mover" : dragFrom.rotation !== t.rotation ? "girar" : null;
    if (action) pushTemplateUndo(action, t, () => useTemplates.getState().commit(scene.id, { ...t, ...dragFrom }));
  };

  // --- Desenho livre no mapa (SPEC §9.17) ---------------------------------------------------------
  // Mesmo raciocínio do gabarito acima: o GM já tem tudo pela pilha geral do servidor (empilha
  // sozinho ao receber drawing:create/update/remove); aqui só cobre o jogador, que não tem acesso a
  // `history:undo` (gmOnly) — ver store/drawingHistory.ts.
  const handleDrawingCreate = (d: Drawing) => {
    void createDrawing(d.sceneId, d);
    if (!isGm) useDrawingHistory.getState().push({ summary: "desenhar", revert: () => useDrawings.getState().remove(d.sceneId, d.id) });
  };
  const handleDrawingLive = (drawingId: string, patch: DrawingPatch) => {
    if (!scene) return;
    drawingLive(scene.id, drawingId, patch);
  };
  const handleDrawingCommit = (drawingId: string, patch: DrawingPatch) => {
    if (!scene) return;
    // Jogador: empilha o "antes" (valor de cada campo do patch ANTES de aplicá-lo) pro Ctrl+Z local
    // desfazer de volta — o GM já tem isso pela pilha geral do servidor (empilha sozinho).
    const before = !isGm ? drawings.find((d) => d.id === drawingId) : undefined;
    void commitDrawing(scene.id, drawingId, patch);
    if (before) {
      const beforePatch = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])) as DrawingPatch;
      useDrawingHistory.getState().push({
        summary: "mover/redimensionar desenho",
        revert: () => useDrawings.getState().commit(scene.id, drawingId, beforePatch).then((d) => d !== null),
      });
    }
  };
  const handleDrawingTextToolClick = (point: { x: number; y: number }) => setPendingDrawingTextPoint(point);
  const handleCreateDrawingText = (text: string) => {
    if (!scene || !pendingDrawingTextPoint) return;
    handleDrawingCreate({
      id: newId(),
      sceneId: scene.id,
      ownerId: me.id,
      kind: "text",
      x: pendingDrawingTextPoint.x,
      y: pendingDrawingTextPoint.y,
      text,
      color: drawColor,
      strokeWidth: drawStrokeWidth,
      visible: drawVisible,
    });
    setPendingDrawingTextPoint(null);
  };

  // Salvar do modal: só emite o que mudou (mapa e/ou grid).
  const handleSaveMapConfig = async ({ map, grid }: MapConfigResult) => {
    if (!scene) return;
    const mapChanged = map.mapUrl !== scene.mapUrl || map.mapWidth !== scene.mapWidth || map.mapHeight !== scene.mapHeight;
    if (mapChanged) await setMap(map);
    await updateGrid(grid);
  };

  // --- Mapas: painel, ativar com "Levar para o mapa", ponto de chegada (docs/plano-mapas.md) -----

  const handleActivateRequest = (destSceneId: string) => {
    const originTokens = activeScene ? sceneTokens(byId, activeScene.id) : [];
    // Nada pra levar: ativa direto, sem incomodar o GM com um diálogo vazio.
    if (!activeScene || originTokens.length === 0) {
      void activateScene({ sceneId: destSceneId });
      return;
    }
    setCarryDialogSceneId(destSceneId);
  };

  const handleCarryConfirm = (moveTokenIds: string[]) => {
    if (carryDialogSceneId) void activateScene({ sceneId: carryDialogSceneId, moveTokenIds });
    setCarryDialogSceneId(null);
  };

  const handleSetArrivalMode = (sceneId: string) => {
    // O clique precisa acontecer no canvas DESTE mapa: navega pra ele primeiro se for outro.
    if (scene?.id !== sceneId) void enterScene(sceneId);
    setSettingArrivalSceneId(sceneId);
  };

  const handlePickArrival = (point: { x: number; y: number }) => {
    if (settingArrivalSceneId) void setSceneArrival(settingArrivalSceneId, point);
    setSettingArrivalSceneId(null);
  };

  const handleDeleteMapRequest = async (sceneId: string) => {
    const sceneName = scenes.find((s) => s.id === sceneId)?.name ?? "este mapa";
    if (!window.confirm(`Apagar o mapa "${sceneName}"?`)) return;
    const res = await deleteScene(sceneId);
    if (!res || res.status !== "needs-confirm") return;
    const names = res.playerTokenIds.map((id) => byId[id]?.name ?? "token").join(", ");
    if (window.confirm(`Este mapa tem tokens de jogador (${names}). Apagar move eles para o mapa ativo. Continuar?`)) {
      await deleteScene(sceneId, true);
    }
  };

  // Linhas do diálogo "Levar para o mapa": tokens do mapa ATIVO ATUAL (de onde eles saem).
  const carryDestScene = carryDialogSceneId ? scenes.find((s) => s.id === carryDialogSceneId) : null;
  const activeSceneTokens = activeScene ? sceneTokens(byId, activeScene.id) : [];
  const activeCombat = sceneCombat(combatByScene, activeScene?.id);
  const carryRows: CarryTokenRow[] = carryDestScene
    ? (() => {
        // "Selecionado" só faz sentido se o GM estava olhando o mapa ativo quando clicou em Ativar.
        const relevantSelected = scene?.id === activeScene?.id ? selectedIds : [];
        const candidates = pickTokensToCarry({ tokens: activeSceneTokens, selectedIds: relevantSelected, characters });
        return activeSceneTokens.map((t) => ({
          tokenId: t.id,
          name: t.name,
          ownerNickname: t.ownerId ? (participants.find((p) => p.id === t.ownerId)?.nickname ?? null) : null,
          preselected: candidates.some((c) => c.tokenId === t.id),
          inCombat: activeCombat?.combatants.some((c) => c.tokenId === t.id) ?? false,
        }));
      })()
    : [];

  const mapsProps = {
    scenes,
    activeSceneId: room.activeSceneId,
    viewingSceneId,
    itemsBySceneId: sceneListItems,
    onEnter: (sceneId: string) => void enterScene(sceneId),
    onActivateRequest: handleActivateRequest,
    onCreate: (payload: { name: string; mapUrl?: string | null; mapWidth?: number | null; mapHeight?: number | null }) => void createScene(payload),
    onRename: (sceneId: string, name: string) => void renameScene(sceneId, name),
    onDuplicate: (sceneId: string) => void duplicateSceneAction(sceneId),
    onDeleteRequest: (sceneId: string) => void handleDeleteMapRequest(sceneId),
    onReorder: (sceneIds: string[]) => void reorderScenesAction(sceneIds),
    onSetArrivalMode: handleSetArrivalMode,
    onClearArrival: (sceneId: string) => void setSceneArrival(sceneId, null),
    arrivalPickingSceneId: settingArrivalSceneId,
    onOpenNotes: (sceneId: string) => {
      const target = scenes.find((sc) => sc.id === sceneId);
      if (target) setNotesTarget({ kind: "scene", id: target.id, name: target.name });
    },
  };

  // --- Handouts (docs/SPEC.md §9.10) --------------------------------------------------------
  const handoutGalleryProps = {
    handouts: handoutLibrary,
    pins,
    participants,
    /** Sem mapa aberto, não tem onde fixar (mesma guarda de `handleHandoutDrop`, arrasto). */
    canPinToMap: scene !== null,
    onCreate: (payload: Parameters<typeof createHandout>[0]) => void createHandout(payload),
    onEdit: (id: string, patch: Parameters<typeof updateHandout>[1]) => void updateHandout(id, patch),
    onDelete: (id: string) => void deleteHandout(id),
    onShow: (id: string, target: Parameters<typeof showHandout>[1]) => void showHandout(id, target),
    /** Clique (sem arrastar): fixa no centro do VIEWPORT do mapa visto agora — mesmo ponto que
     *  `onSpawnCreature`/`onSpawnEncounter` usam pro mesmo tipo de ação (`VttCanvasHandle`). */
    onPinToMap: (handoutId: string) => {
      if (!scene) return;
      const point = vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 };
      void createPin({ kind: "handout", sceneId: scene.id, x: point.x, y: point.y, visible: true, handoutId });
    },
  };

  // --- Acervo (docs/plano-preparo.md §1) ------------------------------------------------------
  const libraryAssets = useLibrary((s) => s.assets);
  const libraryFavorites = useLibrary((s) => s.favorites);
  const libraryUploads = useLibrary((s) => s.uploads);
  const loadLibraryAssets = useLibrary((s) => s.loadAssets);
  const loadLibraryFavorites = useLibrary((s) => s.loadFavorites);
  const updateAsset = useLibrary((s) => s.updateAsset);
  const removeAsset = useLibrary((s) => s.removeAsset);
  const toggleLibraryFavorite = useLibrary((s) => s.toggleFavorite);
  const uploadAndCreateAsset = useLibrary((s) => s.uploadAndCreateAsset);
  const encounterLibraryItems = useEncounters((s) => s.items);
  const updateEncounterAction = useEncounters((s) => s.update);
  const compendiumEntries = useCompendium((s) => s.entries);
  const compendiumRoomIds = useCompendium((s) => s.roomIds);
  const roomMacros = useMacros((s) => s.macros);

  /** Combina Asset + handout/encontro/criatura(homebrew)/macro numa vista única (`rules/library.ts`,
   *  §1.1 do plano) — cada lista já vem pré-filtrada por quem a possui, esta função só junta. */
  const libraryItems = useMemo(
    () =>
      buildLibraryItems({
        assets: libraryAssets,
        handouts: handoutLibrary,
        encounters: encounterLibraryItems,
        creatures: compendiumEntries.filter((e) => compendiumRoomIds.includes(e.id)),
        macros: roomMacros,
        favorites: libraryFavorites,
      }),
    [libraryAssets, handoutLibrary, encounterLibraryItems, compendiumEntries, compendiumRoomIds, roomMacros, libraryFavorites],
  );

  const libraryDialogProps = {
    items: libraryItems,
    uploads: libraryUploads,
    onUploadAsset: (file: File, override: Parameters<typeof uploadAndCreateAsset>[1]) => void uploadAndCreateAsset(file, override),
    onToggleFavorite: (refKind: Parameters<typeof toggleLibraryFavorite>[0], refId: string, favorite: boolean) => void toggleLibraryFavorite(refKind, refId, favorite),
    onEditAsset: (id: string, patch: Parameters<typeof updateAsset>[1]) => void updateAsset(id, patch),
    onDeleteAsset: (id: string) => void removeAsset(id),
    onEditHandout: (id: string, patch: Parameters<typeof updateHandout>[1]) => void updateHandout(id, patch),
    onEditEncounter: (id: string, patch: Parameters<typeof updateEncounterAction>[1]) => void updateEncounterAction(id, patch),
    /** O acervo não reimplementa o editor de homebrew — só abre a paleta do compêndio, já filtrável
     *  em "Sala" por lá (§1.2 do plano: "botão Editar abre a tela deles"). */
    onOpenCreature: () => useCompendium.getState().open("map", null),
    onOpenMacro: (macroId: string) => macroBarController.setEditingId(macroId),
  };

  /** Props do Preparo do mapa visto — hoje só a gaveta usa; no passo 3, a seção dos Bastidores. */
  const prepPanelProps: PrepPanelProps | null =
    isGm && scene
      ? {
          sceneId: scene.id,
          sceneName: scene.name,
          scenes: scenes.map((sc) => ({ id: sc.id, name: sc.name })),
          getViewportCenter: () => vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 },
          onOpenMapNotes: () => setNotesTarget({ kind: "scene", id: scene.id, name: scene.name }),
          onOpenNotePin: (pin) => setOpenNotePin(pin),
        }
      : null;

  /** Menu "⋯" do fim da barra (§9.28): o que é de PREPARAR (só GM) e o sistema (Lobby, todos). */
  const overflowActions: OverflowAction[] = [
    ...(isGm
      ? [
          {
            id: "handouts",
            label: "Handouts",
            Icon: ImageIcon,
            shortcut: "J",
            onClick: () => setHandoutSelectorOpenAndLoad(true),
          },
          { id: "library", label: "Acervo", Icon: Library, shortcut: "B", onClick: () => setLibrarySelectorOpenAndLoad(true) },
          { id: "prep", label: "Preparo", Icon: ClipboardList, shortcut: "Shift+P", onClick: () => toggleBastidoresSection("preparo") },
        ]
      : []),
    {
      id: "lobby",
      label: "Sair para o Lobby",
      Icon: LogOut,
      separated: isGm,
      danger: true,
      onClick: () => {
        leave();
        navigate("/");
      },
    },
  ];

  // --- Pinos (docs/plano-narracao.md — unifica handout:pin com pino de nota) ----------------
  /** Card denormalizado a partir de um pino de handout (mesmos campos de HandoutCard, o pino só tem 3 a mais: id/sceneId/visible). */
  const pinToCard = (pin: Pin & { kind: "image" | "text" }): HandoutCard =>
    pin.kind === "image"
      ? { handoutId: pin.handoutId, name: pin.name, kind: "image", imageUrl: pin.imageUrl, width: pin.width, height: pin.height }
      : { handoutId: pin.handoutId, name: pin.name, kind: "text", text: pin.text };

  /** Clique num pino (ferramenta Selecionar): handout abre o overlay de sempre; nota abre o cartão. */
  const handleOpenPin = (pin: Pin) => (pin.kind === "note" ? setOpenNotePin(pin) : openHandoutLocal(null, pinToCard(pin)));
  /** Arrastar move (GM) — mesmo `pin:update` da edição de nota, só que com x/y (vale pra qualquer kind). */
  const handleMovePin = (pin: Pin, x: number, y: number) => scene && void updatePin(scene.id, pin.id, { x, y });
  const handleHandoutDrop = (handout: Handout, point: { x: number; y: number }) => {
    if (!scene) return;
    void createPin({ kind: "handout", sceneId: scene.id, x: point.x, y: point.y, visible: true, handoutId: handout.id });
  };

  // --- Acervo (docs/plano-preparo.md §1.5) — arrastar um Asset até o mapa --------------------
  /** Token: mesma criação "em branco" de `onTokenCreate`, só com a arte/nome do asset arrastado.
   *  Mapa: pergunta antes de trocar o fundo (mesma conta de `window.confirm` usada em outros lugares
   *  do projeto, ex. apagar mapa) e chama o MESMO `scene:setMap` do `MapConfigModal`. */
  const handleAssetDrop = (asset: Asset, point: { x: number; y: number }) => {
    if (!scene) return;
    if (asset.kind === "token") {
      const n = tokens.length + 1;
      void createToken({
        sceneId: scene.id,
        name: asset.name,
        imageUrl: asset.url,
        x: point.x,
        y: point.y,
        cells: 1,
        rotation: 0,
        zIndex: n,
        visible: true,
        ownerId: null,
        hp: null,
        conditions: [],
        color: TOKEN_COLORS[(n - 1) % TOKEN_COLORS.length] ?? "#e11d48",
      }).then((created) => created && selectToken(created.id));
      return;
    }
    if (!window.confirm(`Usar "${asset.name}" como fundo deste mapa?`)) return;
    void setMap({ mapUrl: asset.url, mapWidth: asset.width, mapHeight: asset.height });
  };

  /** Ferramenta "Pino" (atalho P): clique no mapa guarda o ponto e abre o formulário de nota. */
  const handlePinToolClick = (point: { x: number; y: number }) => setPendingPinPoint(point);
  const handleCreateNotePin = (data: { title: string; text: string; icon: string; color: string; visible: boolean }) => {
    if (!scene || !pendingPinPoint) return;
    void createPin({ kind: "note", sceneId: scene.id, x: pendingPinPoint.x, y: pendingPinPoint.y, ...data });
    setPendingPinPoint(null);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg text-zinc-100 antialiased">
      {/* Modo imersivo (docs/SPEC.md §9.22): a TopBar deixa de ocupar altura no layout e vira um
       *  overlay flutuante por cima do mapa (mapa ocupa a área toda) que some de vez por ociosidade,
       *  igual às outras barras — fora do modo é o cabeçalho fixo de sempre. */}
      <div
        className={
          immersiveMode
            ? `absolute top-0 left-0 right-0 z-40 shadow-float transition-opacity duration-150 ease-out ${immersiveBarsHidden ? "opacity-0 pointer-events-none" : "opacity-100"}`
            : "shrink-0"
        }
      >
        <TopBar
          room={room}
          scene={scene}
          participants={participants}
          me={me}
          onOpenMapConfig={isGm ? () => setMapConfigOpen(true) : undefined}
          onOpenMapNotes={isGm && scene ? () => setNotesTarget({ kind: "scene", id: scene.id, name: scene.name }) : undefined}
          characterMenu={
            <CharacterMenu
              me={me}
              participants={participants}
              characters={characters}
              onOpenCharacter={openCharacter}
              onOpenEmpty={openEmptySheet}
              onNewCharacter={() => setSidePanelTab("characters")}
            />
          }
          mapSelector={
            isGm ? (
              <MapSelector
                viewingScene={scene}
                activeScene={activeScene}
                onOpenMaps={() => {
                  void useSceneList.getState().load();
                  toggleBastidoresSection("mapas");
                }}
              />
            ) : undefined
          }
          overflowMenu={<TopBarOverflowMenu actions={overflowActions} />}
          hiddenSelectors={
            isGm ? (
              <>
                <HandoutSelector gallery={handoutGalleryProps} open={handoutSelectorOpen} onOpenChange={setHandoutSelectorOpenAndLoad} hideTrigger />
                <LibrarySelector dialog={libraryDialogProps} open={librarySelectorOpen} onOpenChange={setLibrarySelectorOpenAndLoad} hideTrigger />
              </>
            ) : undefined
          }
          onOpenMacros={() => macroBarController.setCreating(true)}
          castMenu={
            isGm ? (
              <CastMenu
                onCenterHere={
                  scene
                    ? () => {
                        const v = vttCanvasRef.current?.getView();
                        if (v) useCast.getState().centerHere({ sceneId: scene.id, ...v });
                      }
                    : undefined
                }
              />
            ) : undefined
          }
          audioPlayer={isGm && hasAudioTrack ? <AudioPlayer /> : undefined}
          volumeControl={<VolumeControl />}
        />
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Bastidores: coluna à ESQUERDA, empurrando o mapa — a barra de ferramentas do canvas é
            ancorada à área do mapa, então continua visível e clicável. */}
        {isGm && bastidoresRendered && (
          <BastidoresDrawer open={bastidoresOpen} section={bastidoresSection} onSectionChange={setBastidoresSection} onClose={() => setBastidoresOpen(false)}>
            {bastidoresSection === "mapas" ? (
              <TabErrorBoundary label="Mapas">
                <MapsSection maps={mapsProps} viewingScene={scene} activeScene={activeScene} />
              </TabErrorBoundary>
            ) : prepPanelProps ? (
              <TabErrorBoundary label="Preparo">
                <PrepPanel {...prepPanelProps} />
              </TabErrorBoundary>
            ) : (
              <p className="p-3 text-12 text-text-muted">Sem mapa aberto — o preparo é por mapa.</p>
            )}
          </BastidoresDrawer>
        )}
        <main className="flex-1 h-full relative overflow-hidden">
          <CombatBanner
            combat={combat}
            meId={me.id}
            viewer={isGm ? "gm" : "player"}
            onRollSelf={() => viewedSceneId && void combatRoll({ sceneId: viewedSceneId, scope: "self" })}
            onDelay={(combatantId) => viewedSceneId && void combatDelay(viewedSceneId, combatantId)}
            onResume={(combatantId) => viewedSceneId && void combatResume(viewedSceneId, combatantId)}
          />
          <MacroBar controller={macroBarController} immersiveHidden={immersiveBarsHidden} />
          {scene ? (
            <>
              <VttCanvas
                ref={vttCanvasRef}
                roomId={room.id}
                scene={scene}
                mode={effectiveMode}
                tokens={tokens}
                participants={participants}
                me={me}
                activeTurnTokenId={activeTurnTokenId}
                combat={combat}
                movementLimitEnabled={movementLimitEnabled}
                selectedTokenId={selectedTokenId}
                selectedIds={selectedIds}
                focusRequest={focusRequest}
                cancelNonce={cancelNonce}
                ruler={ruler}
                remoteRulers={remoteRulers}
                systemDef={systemDef}
                onRulerUpdate={(r) => updateRuler(scene.id, r)}
                onRulerClear={() => clearRuler(scene.id)}
                onSelectMany={selectMany}
                onToggleSelect={toggleSelect}
                onSelectToken={selectToken}
                onTokenMoveLive={moveLive}
                onTokenPatch={(patch) => void patchToken(patch)}
                onTokenPatchMany={(patches) => void patchTokenMany(patches)}
                onTokenCreate={(pos) => {
                  const n = tokens.length + 1;
                  void createToken({
                    sceneId: scene.id,
                    name: `Token ${n}`,
                    imageUrl: null,
                    x: pos.x,
                    y: pos.y,
                    cells: 1,
                    rotation: 0,
                    zIndex: n,
                    visible: true,
                    ownerId: null,
                    hp: null,
                    conditions: [],
                    color: TOKEN_COLORS[(n - 1) % TOKEN_COLORS.length] ?? "#e11d48",
                  }).then((created) => created && selectToken(created.id));
                }}
                onTokenDelete={(id) => void deleteToken(id)}
                onDeleteSelected={deleteSelectedTokens}
                linkableCharacters={linkableCharacters}
                onLinkCharacter={(tokenId, characterId) => void linkCharacter(tokenId, characterId)}
                onOpenCharacter={openCharacter}
                onOpenTokenNotes={(token) => setNotesTarget({ kind: "token", id: token.id, name: token.name })}
                onTokenOpenSheet={(tokenId) => {
                  // Duplo clique num token vinculado a uma ficha que eu vejo abre a ficha.
                  const characterId = byId[tokenId]?.characterId;
                  if (characterId && charById[characterId]) openCharacter(characterId);
                }}
                onCharacterPatch={(characterId, patch) => void updateCharacter(characterId, patch)}
                onCharacterRoll={(characterId, request) => void rollCharacter(characterId, request)}
                onCharacterUseItem={(characterId, itemId) => void useCharacterItem(characterId, itemId)}
                tokenBars={tokenBars}
                fogTool={isGm ? { mode: fogMode, shape: fogShape, brushSize: fogBrushSize } : null}
                onFogShape={(shape) => {
                  // Pintar com a névoa desligada não mostraria nada: liga antes de adicionar.
                  if (!scene.fog.enabled) void fogOp({ type: "setEnabled", enabled: true });
                  void fogOp({ type: "add", shape });
                }}
                onPlaceCharacter={(characterId, point) => placeOnMap.place(characterId, point)}
                onSpawnCreature={isGm ? (entryId, point, opts) => void spawnCreatureAt(entryId, point, opts) : undefined}
                onSpawnEncounter={isGm ? (encounterId, point, opts) => void spawnEncounterAt(encounterId, point, opts) : undefined}
                arrivalPickMode={isGm && settingArrivalSceneId === scene.id}
                onPickArrival={handlePickArrival}
                templates={templates}
                templateTool={
                  systemDef?.templates ? { shape: templateShape, sizeUnits: templateSize, angleOverride: templateAngle, widthOverride: templateWidth } : null
                }
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={selectTemplate}
                onTemplateCreate={handleTemplateCreate}
                onTemplateLive={(t) => scene && templateLive(scene.id, t)}
                onTemplateCommit={handleTemplateCommit}
                pins={pins}
                pinIcons={pinIcons}
                selectedPinId={selectedPinId}
                onSelectPin={selectPin}
                onOpenPin={handleOpenPin}
                onMovePin={isGm ? handleMovePin : undefined}
                onHandoutDrop={isGm ? handleHandoutDrop : undefined}
                onAssetDrop={isGm ? handleAssetDrop : undefined}
                onPinToolClick={isGm ? handlePinToolClick : undefined}
                drawings={drawings}
                drawTool={isGm || playerDrawingEnabled ? { kind: drawKind, color: drawColor, strokeWidth: drawStrokeWidth, filled: drawFilled, visible: drawVisible } : null}
                selectedDrawingId={selectedDrawingId}
                onSelectDrawing={selectDrawing}
                onDrawingCreate={handleDrawingCreate}
                onDrawingLive={handleDrawingLive}
                onDrawingCommit={handleDrawingCommit}
                onDrawingTextToolClick={handleDrawingTextToolClick}
                myTargetIds={myTargetIds}
                othersTargets={othersTargets}
                showOtherTargets={showOtherTargets}
                onToggleTarget={(tokenId, additive) => void toggleTarget(tokenId, additive)}
                onClearTargets={() => void clearTargets()}
                translucentBarsOverMap={translucentBarsOverMap}
                onToggleTranslucentBarsOverMap={() => setTranslucentBarsOverMap((v) => !v)}
                immersiveMode={immersiveMode}
                onToggleImmersiveMode={toggleImmersiveMode}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
                immersiveBgColor={immersiveBgColor}
                onImmersiveBgColorChange={setImmersiveBgColor}
                immersiveBarsHidden={immersiveBarsHidden}
              />
              <Toolbar
                isGm={isGm}
                showTemplateTool={systemDef?.templates != null}
                mode={toolMode}
                effectiveMode={effectiveMode}
                onChange={setToolMode}
                canUndo={canUndo}
                canRedo={canRedo}
                undoSummary={undoSummary}
                redoSummary={redoSummary}
                onUndo={() => void undoHistory()}
                onRedo={() => void redoHistory()}
                translucentBarsOverMap={translucentBarsOverMap}
                immersiveHidden={immersiveBarsHidden}
              />
              {isGm && toolMode === "fog" && (
                <FogToolbar
                  fog={scene.fog}
                  grid={scene.grid}
                  fogMode={fogMode}
                  fogShape={fogShape}
                  brushSize={fogBrushSize}
                  onFogMode={setFogMode}
                  onFogShape={setFogShape}
                  onBrushSize={setFogBrushSize}
                  onOp={(op) => void fogOp(op)}
                />
              )}
              {toolMode === "template" && systemDef?.templates && (
                <TemplateToolbar
                  shape={templateShape}
                  size={templateSize}
                  unit={mapSystemDef?.grid?.unit ?? ""}
                  presets={systemDef.templates.presets}
                  onShape={setTemplateShape}
                  onSize={setTemplateSize}
                  onPreset={pickTemplatePreset}
                />
              )}
              {toolMode === "draw" && (
                <DrawToolbar
                  isGm={isGm}
                  drawKind={drawKind}
                  drawColor={drawColor}
                  strokeWidth={drawStrokeWidth}
                  filled={drawFilled}
                  visible={drawVisible}
                  drawingCount={drawings.length}
                  playerDrawingEnabled={playerDrawingEnabled}
                  onDrawKind={setDrawKind}
                  onDrawColor={setDrawColor}
                  onStrokeWidth={setDrawStrokeWidth}
                  onFilled={setDrawFilled}
                  onVisible={setDrawVisible}
                  onTogglePlayerDrawing={() => void setPlayerDrawingPermission(!playerDrawingEnabled)}
                  onClearMine={() => scene && void clearMyDrawings(scene.id)}
                  onClearAll={() => scene && void clearAllDrawings(scene.id)}
                />
              )}
            </>
          ) : (
            <Centered>
              <p className="font-ui text-14 text-text-muted">Nenhum mapa ativo.</p>
            </Centered>
          )}

          {mapPaletteOpen && systemDef && (
            <>
              <CompendiumPalette
                def={systemDef}
                character={null}
                mode="map"
                onClose={closeCompendium}
                onSpawnCreature={isGm ? (entryId, opts) => spawnCreatureAt(entryId, vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 }, opts) : undefined}
                onSpawnEncounter={isGm ? (id, opts) => spawnEncounterAt(id, vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 }, opts) : undefined}
                selectedTokenIds={isGm ? selectedIds : []}
              />
              <DragGhost def={systemDef} />
              <EncounterDragGhost />
            </>
          )}

          <DiceOverlay3D />
          <AudioEngine />
        </main>

        <SidePanel
          activeTab={sidePanelTab}
          onTabChange={setSidePanelTab}
          messages={messages}
          participants={participants}
          currentUserId={me.id}
          combat={combat}
          activeSceneId={scene?.id ?? null}
          selectedIds={selectedIds}
          combatCallbacks={combatCallbacks}
          movementLimitEnabled={movementLimitEnabled}
          autoRollNpcInitiativeEnabled={autoRollNpcInitiativeEnabled}
          centerOnActiveTurn={centerOnActiveTurn}
          onToggleCenterOnActiveTurn={() => setCenterOnActiveTurn((v) => !v)}
          myTargetTokenIds={myTargetIds}
          othersTargetTokenIds={othersTargetTokenIds}
          showOtherTargets={showOtherTargets}
          onToggleShowOtherTargets={() => setShowOtherTargets((v) => !v)}
          clearTargetsOnTurnEnd={clearTargetsOnTurnEnd}
          onToggleClearTargetsOnTurnEnd={() => setClearTargetsOnTurnEnd((v) => !v)}
          tokens={tokens}
          conditions={systemDef?.conditions ?? []}
          systemDef={systemDef}
          activeTurnTokenId={activeTurnTokenId}
          partyViewExpanded={partyViewExpanded}
          onTogglePartyView={() => setPartyViewExpanded((v) => !v)}
          party={party}
          onAddToParty={(characterId) => void addToParty(characterId)}
          onRemoveFromParty={(characterId) => void removeFromParty(characterId)}
          onSetPartyHidden={(characterId, hidden) => void setPartyHidden(characterId, hidden)}
          onReorderParty={(characterIds) => void reorderParty(characterIds)}
          onRollCharacter={(characterId, request) => void rollCharacter(characterId, request)}
          onSaveMacro={(action, defaultLabel) => macroBarController.openQuickCreate(action, defaultLabel)}
          isGm={isGm}
          onSendMessage={(text) => void sendMessage(text)}
          onSelectToken={focusToken}
          selectedTokenId={selectedTokenId}
          me={me}
          characters={characters}
          onOpenCharacter={openCharacter}
          onCreateCharacter={(payload) => void createCharacter(payload).then((c) => c && openCharacter(c.id))}
          onDeleteCharacter={(id) => void deleteCharacter(id)}
          placeOnMap={placeOnMap}
          collapsed={effectiveSidePanelCollapsed}
          onToggleCollapsed={toggleSidePanelCollapsed}
          unreadMessages={unreadMessages}
          isMyTurn={myTurn}
          prepNextStep={
            isGm && scene ? (
              <PrepNextStepCard
                sceneId={scene.id}
                getViewportCenter={() => vttCanvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 }}
                onOpenNotePin={(pin) => setOpenNotePin(pin)}
                onOpenPrep={() => {
                  setBastidoresSection("preparo");
                  setBastidoresOpen(true);
                }}
              />
            ) : undefined
          }
        />
      </div>

      {sheetOpen && systemDef && (
        <CharacterSheetDrawer
          def={systemDef}
          character={openChar}
          participants={participants}
          me={me}
          canEdit={openChar !== null && canEditCharacter(me, openChar)}
          onPatch={(patch) => openChar && void updateCharacter(openChar.id, patch)}
          onRoll={(request) => openChar && void rollCharacter(openChar.id, request)}
          onUseItem={(itemId, enhancements) => openChar && void useCharacterItem(openChar.id, itemId, enhancements)}
          onInsertFromCompendium={(entryId, opts) => (openChar ? insertFromCompendium(systemDef, openChar.id, entryId, opts) : Promise.resolve(null))}
          onCreateMine={() => void createCharacter({ name: me.nickname, kind: "pc", ownerId: me.id }).then((c) => c && openCharacter(c.id))}
          onClose={() => openCharacter(null)}
          placeOnMap={placeOnMap}
        />
      )}

      {isGm && scene && (
        <MapConfigModal isOpen={isMapConfigOpen} scene={scene} systemDef={systemDef} onSave={(r) => void handleSaveMapConfig(r)} onClose={() => setMapConfigOpen(false)} />
      )}

      {carryDestScene && (
        <CarryTokensDialog
          destSceneName={carryDestScene.name}
          rows={carryRows}
          onCancel={() => setCarryDialogSceneId(null)}
          onConfirm={handleCarryConfirm}
        />
      )}

      {openHandout && (
        <HandoutOverlay
          card={openHandout.card}
          onClose={closeHandoutLocal}
          onCloseForAll={isGm && openHandout.messageId ? () => void closeHandoutForAll(openHandout.messageId!) : undefined}
          // Sincroniza zoom/pan com a tela de exibição (docs/revisao-cast.md) só quando este é o
          // MESMO handout que está lá: "para todos" (`whisperTo === null`) e veio de uma mensagem
          // de verdade (`messageId`, nunca um pino aberto localmente).
          syncToDisplay={isGm && !!openHandout.messageId && openHandout.whisperTo === null}
        />
      )}
      <CharacterDragGhost />
      {isGm && <HandoutDragGhost />}
      {isGm && <LibraryDragGhost />}

      {openNotePin && (
        <NotePinCard
          pin={openNotePin}
          icons={pinIcons}
          isGm={isGm}
          onClose={() => setOpenNotePin(null)}
          onSave={(patch) => {
            if (!scene) return;
            void updatePin(scene.id, openNotePin.id, patch).then((updated) => {
              if (updated && updated.kind === "note") setOpenNotePin(updated);
            });
          }}
          onDelete={() => {
            if (scene) void removePin(scene.id, openNotePin.id);
            setOpenNotePin(null);
          }}
        />
      )}
      {pendingPinPoint && isGm && <PinCreatePopover icons={pinIcons} onCreate={handleCreateNotePin} onCancel={() => setPendingPinPoint(null)} />}
      {pendingDrawingTextPoint && <DrawingTextPopover onCreate={handleCreateDrawingText} onCancel={() => setPendingDrawingTextPoint(null)} />}

      {notesTarget && isGm && (
        <NotesPanel
          target={notesTarget}
          onChangeTarget={setNotesTarget}
          onGoToScene={(sceneId) => {
            if (scene?.id !== sceneId) void enterScene(sceneId);
          }}
          onClose={() => setNotesTarget(null)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full min-h-screen flex flex-col items-center justify-center gap-3 bg-bg">{children}</div>;
}
