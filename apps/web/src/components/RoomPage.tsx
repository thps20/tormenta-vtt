import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { selectActiveScene, selectViewedScene, useRoom } from "../store/room";
import { sceneTokens, useTokens } from "../store/tokens";
import { sceneTemplates, useTemplates } from "../store/templates";
import { useTemplateHistory } from "../store/templateHistory";
import { useTargets } from "../store/targets";
import { scenePins, useHandouts } from "../store/handouts";
import { describeTemplateAreaChange } from "../lib/templates";
import { effectiveCellSize } from "../lib/grid";
import { useChat } from "../store/chat";
import { activeCombatant, isMyTurn, sceneCombat, useCombat } from "../store/combat";
import { canEditCharacter, sortedCharacters, useCharacters } from "../store/characters";
import { useParty } from "../store/party";
import { useSystemDef } from "../lib/system";
import { useToolShortcuts } from "../lib/useToolShortcuts";
import { deleteSelectedTokens, useDeleteSelectionShortcut } from "../lib/useDeleteSelectionShortcut";
import { useTokenMoveShortcuts } from "../lib/useTokenMoveShortcuts";
import { useMapPaletteShortcut } from "../lib/useMapPaletteShortcut";
import { useSidePanelShortcut } from "../lib/useSidePanelShortcut";
import { useTurnTitle } from "../lib/useTurnTitle";
import { useHistory } from "../store/history";
import { useSceneList } from "../store/sceneList";
import { selectEffectiveMode, useTools } from "../store/tools";
import {
  computeCharacter,
  isPointRevealed,
  pickTokensToCarry,
  targetsFromTemplate,
  tokenCenter,
  type Handout,
  type HandoutCard,
  type HandoutPin,
  type Template,
  type TemplateChangeAction,
} from "@tormenta-vtt/shared";
import { CharacterSheetDrawer } from "./CharacterSheetDrawer";
import { CombatBanner } from "./CombatBanner";
import { type CombatPanelCallbacks } from "./CombatPanel";
import { CarryTokensDialog, type CarryTokenRow } from "./CarryTokensDialog";
import { MapSelector } from "./MapSelector";
import { HandoutSelector } from "./HandoutSelector";
import { HandoutOverlay } from "./HandoutOverlay";
import { HandoutDragGhost } from "./HandoutDragGhost";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { FogToolbar } from "./FogToolbar";
import { TemplateToolbar } from "./TemplateToolbar";
import { VttCanvas, type TokenBar, type VttCanvasHandle } from "./VttCanvas";
import { TOKEN_COLORS } from "./TokenInspector";
import { MapConfigModal, type MapConfigResult } from "./MapConfigModal";
import { SidePanel, type SidePanelTab } from "./SidePanel";
import { CharacterMenu } from "./CharacterMenu";
import { NicknamePrompt } from "./NicknamePrompt";
import { CompendiumPalette } from "./compendium/CompendiumPalette";
import { DragGhost, EncounterDragGhost } from "./compendium/DragGhost";
import { useCompendium } from "../store/compendium";
import { useEncounters } from "../store/encounters";
import { CREATURE_FILTER } from "../lib/compendium";

const CENTER_ON_TURN_KEY = "tvtt:centerOnActiveTurn";
const SIDE_PANEL_COLLAPSED_KEY = "tvtt:sidePanelCollapsed";
// Visão de grupo (SPEC §3.6): preferência por usuário, padrão ligada — mesmo padrão de CENTER_ON_TURN_KEY.
const PARTY_VIEW_EXPANDED_KEY = "tvtt:partyViewExpanded";
// Sistema de alvos (docs/plano-alvos.md): preferências por usuário, mesmo padrão de CENTER_ON_TURN_KEY.
const SHOW_OTHER_TARGETS_KEY = "tvtt:showOtherTargets";
const CLEAR_TARGETS_ON_TURN_END_KEY = "tvtt:clearTargetsOnTurnEnd";

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
        <p className="text-red-400 text-sm">{status.message}</p>
        <button onClick={() => navigate("/")} className="text-xs text-[#d4af37] underline cursor-pointer">
          Voltar ao lobby
        </button>
      </Centered>
    );
  }

  if (status.kind !== "joined") {
    return (
      <Centered>
        <p className="text-zinc-400 text-sm font-serif">Entrando na sala…</p>
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
  useToolShortcuts();
  useDeleteSelectionShortcut();
  useTokenMoveShortcuts();

  // Handouts (docs/SPEC.md §9.10): biblioteca por sala (só GM, carregada sob demanda ao abrir o
  // HandoutSelector) + pinos do mapa visitado + overlay em tela cheia atualmente aberto.
  const handoutLibrary = useHandouts((s) => s.library);
  const loadHandoutLibrary = useHandouts((s) => s.loadLibrary);
  const createHandout = useHandouts((s) => s.create);
  const renameHandout = useHandouts((s) => s.update);
  const deleteHandout = useHandouts((s) => s.remove);
  const showHandout = useHandouts((s) => s.show);
  const closeHandoutForAll = useHandouts((s) => s.closeForAll);
  const pinHandout = useHandouts((s) => s.pin);
  const unpinHandout = useHandouts((s) => s.unpin);
  const openHandoutLocal = useHandouts((s) => s.openLocal);
  const closeHandoutLocal = useHandouts((s) => s.closeLocal);
  const openHandout = useHandouts((s) => s.open);
  const pinsByScene = useHandouts((s) => s.pinsByScene);
  const handoutPins = useMemo(() => scenePins(pinsByScene, scene?.id), [pinsByScene, scene?.id]);

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
    return all.filter((t) => t.ownerId === me.id || isPointRevealed(scene.fog, tokenCenter(t)));
  }, [byId, scene, me]);
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
  const deleteToken = useTokens((s) => s.delete);
  const vttCanvasRef = useRef<VttCanvasHandle>(null);
  /** Solta na cena ativa (Enter/botão no preview usam o centro da viewport; arrastar no mapa usa o ponto largado). */
  const spawnCreatureAt = async (entryId: string, point: { x: number; y: number }, opts: { count: number; visible: boolean }): Promise<boolean> => {
    if (!scene) return false;
    const result = await spawnFromCompendium({ sceneId: scene.id, entryId, count: opts.count, visible: opts.visible, x: point.x, y: point.y });
    return result !== null;
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
    if (!sidePanelCollapsed) setSeenMessageCount(messages.length);
  }, [messages.length, sidePanelCollapsed]);
  const unreadMessages = sidePanelCollapsed ? Math.max(0, messages.length - seenMessageCount) : 0;

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
  const movementLimitEnabled = useRoom((s) => s.movementLimitEnabled);
  // Callbacks do CombatPanel: cada um reempacota os argumentos "soltos" da UI no payload
  // que o evento combat:* espera (agora sempre com o sceneId do mapa VISITADO) e chama a ação
  // correspondente da store (server = fonte da verdade, sem otimismo — ver store/combat.ts).
  const viewedSceneId = scene?.id ?? null;
  const combatCallbacks: CombatPanelCallbacks = useMemo(
    () => ({
      onStart: (sceneId, tokenIds) => void combatStart({ sceneId, tokenIds }),
      onRoll: (scope, combatantId, visibility) => viewedSceneId && void combatRoll({ sceneId: viewedSceneId, scope, combatantId, visibility }),
      onSetInitiative: (combatantId, initiative, bonus) =>
        viewedSceneId && void combatSetInitiative({ sceneId: viewedSceneId, combatantId, initiative, bonus }),
      onNext: () => viewedSceneId && void combatNext(viewedSceneId),
      onPrev: () => viewedSceneId && void combatPrev(viewedSceneId),
      onReorder: (combatantIds) => viewedSceneId && void combatReorder(viewedSceneId, combatantIds),
      onAdd: (tokenIds) => viewedSceneId && void combatAddCombatants({ sceneId: viewedSceneId, tokenIds }),
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
    const ids = targetsFromTemplate(tokens, tmpl, effectiveCellSize(scene.grid));
    const current = useTargets.getState().mine;
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    void setTargetsFromTemplate(myTemplateId, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTemplateId, templates, tokens, scene?.grid]);

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

  // --- Gabaritos de área de efeito: Ctrl+Z local do jogador (docs/plano-gabaritos.md §4) ---------
  // O GM já tem tudo isso pela pilha geral do servidor (socket/templates.ts empilha sozinho); aqui
  // só cobre o jogador, que não tem acesso a `history:undo` (gmOnly). Efêmero: some ao recarregar.
  const pushTemplateUndo = (action: TemplateChangeAction, template: Template, revert: () => Promise<boolean>) => {
    if (isGm || !scene || !systemDef) return;
    const cellSizePx = effectiveCellSize(scene.grid);
    useTemplateHistory.getState().push({ summary: describeTemplateAreaChange(action, systemDef, template, cellSizePx), revert });
  };
  const handleTemplateCreate = (t: Template) => {
    if (!scene) return;
    void createTemplate(scene.id, t);
    pushTemplateUndo("colocar", t, () => useTemplates.getState().remove(scene.id, t.id));
    // Sistema de alvos (docs/plano-alvos.md §3.6): meu gabarito já vira meus alvos, substituindo a
    // seleção manual; o efeito de cima mantém isso ao vivo enquanto ele existir.
    void setTargetsFromTemplate(t.id, targetsFromTemplate(tokens, t, effectiveCellSize(scene.grid)));
  };
  const handleTemplateCommit = (t: Template, dragFrom?: { x: number; y: number; rotation: number }) => {
    if (!scene) return;
    void commitTemplate(scene.id, t, dragFrom);
    if (!dragFrom) return; // sem dragFrom = não veio de um gesto de mover/girar (ou nada mudou)
    const action = dragFrom.x !== t.x || dragFrom.y !== t.y ? "mover" : dragFrom.rotation !== t.rotation ? "girar" : null;
    if (action) pushTemplateUndo(action, t, () => useTemplates.getState().commit(scene.id, { ...t, ...dragFrom }));
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
  };

  // --- Handouts (docs/SPEC.md §9.10) --------------------------------------------------------
  const handoutsProps = {
    handouts: handoutLibrary,
    participants,
    onCreate: (payload: Parameters<typeof createHandout>[0]) => void createHandout(payload),
    onRename: (id: string, name: string) => void renameHandout(id, { name }),
    onDelete: (id: string) => void deleteHandout(id),
    onShow: (id: string, target: Parameters<typeof showHandout>[1]) => void showHandout(id, target),
  };

  /** Card denormalizado a partir de um pino (mesmos campos de HandoutCard, o pino só tem 3 a mais: id/sceneId/visible). */
  const pinToCard = (pin: HandoutPin): HandoutCard =>
    pin.kind === "image"
      ? { handoutId: pin.handoutId, name: pin.name, kind: "image", imageUrl: pin.imageUrl, width: pin.width, height: pin.height }
      : { handoutId: pin.handoutId, name: pin.name, kind: "text", text: pin.text };

  const handleOpenHandoutPin = (pin: HandoutPin) => openHandoutLocal(null, pinToCard(pin));
  const handleDeleteHandoutPin = (pin: HandoutPin) => scene && void unpinHandout(scene.id, pin.id);
  const handleHandoutDrop = (handout: Handout, point: { x: number; y: number }) => {
    if (!scene) return;
    void pinHandout(scene.id, handout.id, point.x, point.y, true);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0c0c0c] text-zinc-100 antialiased">
      <TopBar
        room={room}
        scene={scene}
        participants={participants}
        me={me}
        onLeaveToLobby={() => {
          leave();
          navigate("/");
        }}
        onOpenMapConfig={isGm ? () => setMapConfigOpen(true) : undefined}
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
            <MapSelector viewingScene={scene} activeScene={activeScene} maps={mapsProps} onOpen={() => void loadSceneList()} />
          ) : undefined
        }
        handoutSelector={
          isGm ? <HandoutSelector handouts={handoutsProps} onOpen={() => void loadHandoutLibrary()} /> : undefined
        }
      />

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 h-full relative overflow-hidden">
          <CombatBanner
            combat={combat}
            meId={me.id}
            viewer={isGm ? "gm" : "player"}
            onRollSelf={() => viewedSceneId && void combatRoll({ sceneId: viewedSceneId, scope: "self" })}
            onDelay={(combatantId) => viewedSceneId && void combatDelay(viewedSceneId, combatantId)}
            onResume={(combatantId) => viewedSceneId && void combatResume(viewedSceneId, combatantId)}
          />
          {scene ? (
            <>
              <VttCanvas
                ref={vttCanvasRef}
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
                onTokenCreate={(pos, size) => {
                  const n = tokens.length + 1;
                  void createToken({
                    sceneId: scene.id,
                    name: `Token ${n}`,
                    imageUrl: null,
                    x: pos.x,
                    y: pos.y,
                    width: size,
                    height: size,
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
                handoutPins={handoutPins}
                onOpenHandoutPin={handleOpenHandoutPin}
                onDeleteHandoutPin={isGm ? handleDeleteHandoutPin : undefined}
                onHandoutDrop={isGm ? handleHandoutDrop : undefined}
                myTargetIds={myTargetIds}
                othersTargets={othersTargets}
                showOtherTargets={showOtherTargets}
                onToggleTarget={(tokenId, additive) => void toggleTarget(tokenId, additive)}
                onClearTargets={() => void clearTargets()}
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
                  unit={systemDef.grid?.unit ?? ""}
                  presets={systemDef.templates.presets}
                  onShape={setTemplateShape}
                  onSize={setTemplateSize}
                  onPreset={pickTemplatePreset}
                />
              )}
            </>
          ) : (
            <Centered>
              <p className="text-zinc-500 text-sm">Nenhum mapa ativo.</p>
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
          isGm={isGm}
          onSendMessage={(text) => void sendMessage(text)}
          onSelectToken={focusToken}
          selectedTokenId={selectedTokenId}
          me={me}
          characters={characters}
          onOpenCharacter={openCharacter}
          onCreateCharacter={(payload) => void createCharacter(payload).then((c) => c && openCharacter(c.id))}
          onDeleteCharacter={(id) => void deleteCharacter(id)}
          collapsed={sidePanelCollapsed}
          onToggleCollapsed={() => setSidePanelCollapsed((v) => !v)}
          unreadMessages={unreadMessages}
          isMyTurn={myTurn}
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
        />
      )}

      {isGm && scene && (
        <MapConfigModal isOpen={isMapConfigOpen} scene={scene} onSave={(r) => void handleSaveMapConfig(r)} onClose={() => setMapConfigOpen(false)} />
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
        />
      )}
      {isGm && <HandoutDragGhost />}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full min-h-screen flex flex-col items-center justify-center gap-3 bg-[#0c0c0c]">{children}</div>;
}
