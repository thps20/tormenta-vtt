import React, { useEffect, useMemo, useRef, useState } from "react";
import { CastIcon } from "lucide-react";
import { computeCharacter, isPointRevealed, tokenCenter } from "@tormenta-vtt/shared";
import { effectiveCellSize, sizeTokens } from "../lib/grid";
import { selectActiveScene, useRoom } from "../store/room";
import { sceneTokens, useTokens } from "../store/tokens";
import { activeCombatant, sceneCombat, useCombat } from "../store/combat";
import { scenePins, usePins } from "../store/pins";
import { sceneDrawings, useDrawings } from "../store/drawings";
import { sceneTemplates, useTemplates } from "../store/templates";
import { useCharacters } from "../store/characters";
import { useTools, type RemoteRuler } from "../store/tools";
import { useCast } from "../store/cast";
import { emitAck } from "../store/connection";
import { setDisplayMode } from "../store/ui";
import { useSystemDef } from "../lib/system";
import { resolvePinIcons } from "../lib/pinIcons";
import { loadTabletopPrefs, saveTabletopPrefs } from "../lib/tabletopPrefs";
import { useCastCamera } from "../lib/castCamera";
import { useFullscreen } from "../lib/useFullscreen";
import { DEFAULT_IMMERSIVE_BG_COLOR } from "../lib/immersiveMode";
import { VttCanvas, type TokenBar, type VttCanvasHandle } from "./VttCanvas";
import { HandoutOverlay } from "./HandoutOverlay";
import { CalibrationPanel } from "./cast/CalibrationPanel";
import { FLOAT_SURFACE } from "./MapBar";

interface DisplayPageProps {
  inviteCode: string;
  displayToken: string;
}

const noop = () => {};

/**
 * Cast — tela de exibição (docs/plano-cast.md): segunda tela só de leitura, projetada sobre a mesa
 * física ou numa TV, do ponto de vista de um jogador sem tokens (`displayViewer`, servidor). Não é
 * um `Participant`, não passa por `RoomPage`: rota própria (`App.tsx`, `?display=<token>`).
 */
export const DisplayPage: React.FC<DisplayPageProps> = ({ inviteCode, displayToken }) => {
  useEffect(() => setDisplayMode(true), []);

  const status = useRoom((s) => s.status);
  const joinDisplay = useRoom((s) => s.joinDisplay);
  useEffect(() => {
    void joinDisplay({ inviteCode, displayToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, displayToken]);

  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const participants = useRoom((s) => s.participants);
  const scene = useRoom(selectActiveScene);
  const systemDef = useSystemDef();

  const tokensById = useTokens((s) => s.byId);
  // Mesmo re-filtro defensivo de RoomPage (jogador): a tela nunca é dona de token, então só o
  // pedaço da névoa importa — cobre broadcasts fora de ordem entre fog:updated/token:deleted.
  const rawTokens = useMemo(() => {
    const all = sceneTokens(tokensById, scene?.id);
    if (!scene) return all;
    return all.filter((t) => isPointRevealed(scene.fog, tokenCenter(t, effectiveCellSize(scene.grid))));
  }, [tokensById, scene]);
  const tokens = useMemo(() => (scene ? sizeTokens(rawTokens, scene.grid) : []), [rawTokens, scene]);

  const combatByScene = useCombat((s) => s.byScene);
  const combat = useMemo(() => sceneCombat(combatByScene, scene?.id), [combatByScene, scene?.id]);
  const activeTurnTokenId = activeCombatant(combat)?.tokenId ?? null;
  const activeTurnName = activeCombatant(combat)?.name ?? null;

  const pinsByScene = usePins((s) => s.pinsByScene);
  const pins = useMemo(() => scenePins(pinsByScene, scene?.id), [pinsByScene, scene?.id]);

  const drawingsByScene = useDrawings((s) => s.byScene);
  const drawings = useMemo(() => sceneDrawings(drawingsByScene, scene?.id), [drawingsByScene, scene?.id]);

  const templatesByScene = useTemplates((s) => s.byScene);
  const templates = useMemo(() => sceneTemplates(templatesByScene, scene?.id), [templatesByScene, scene?.id]);

  const pinIcons = useMemo(() => resolvePinIcons(systemDef), [systemDef]);

  // Régua do Mestre (docs/plano-cast.md §9 decisão 3): já chega por `rooms.players` — só falta ler
  // (mesma store que RoomPage usa pro jogador ver a régua de outro participante).
  const remoteRulersByParticipant = useTools((s) => s.remoteRulers);
  const remoteRulers = useMemo<RemoteRuler[]>(() => Object.values(remoteRulersByParticipant), [remoteRulersByParticipant]);

  // Barra de vida: só de ficha vinculada visível (PC — o servidor já não manda NPC pra um viewer
  // "jogador", mesma regra de qualquer jogador de verdade, ver services/characters.ts).
  const charById = useCharacters((s) => s.byId);
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

  const cameraMode = useCast((s) => s.cameraMode);
  const blackout = useCast((s) => s.blackout);
  const lastView = useCast((s) => s.lastView);
  const displayHandout = useCast((s) => s.displayHandout);
  const handoutView = useCast((s) => s.handoutView);
  const revoked = useCast((s) => s.revoked);

  // Calibração de mesa física (docs/plano-cast.md §3.3): 100% local a esta tela.
  const [tabletop, setTabletop] = useState(() => loadTabletopPrefs());
  useEffect(() => saveTabletopPrefs(tabletop), [tabletop]);
  useEffect(() => {
    void emitAck("display:set-tabletop-hint", { tabletop: tabletop.enabled });
  }, [tabletop.enabled]);

  const [screenSize, setScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const { view, rotatedSize } = useCastCamera({ scene, tokens, combat, templates, cameraMode, lastView, tabletop, screenSize });

  const canvasRef = useRef<VttCanvasHandle>(null);

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") setCalibrationOpen((v) => !v);
      else if (key === "f") toggleFullscreen();
      else if (key === "escape") setCalibrationOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFullscreen]);

  if (status.kind === "error" || revoked) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-zinc-500 font-serif text-lg px-8 text-center">
        {revoked ? "Link de exibição revogado. Peça um novo link ao Mestre." : status.kind === "error" ? status.message : ""}
      </div>
    );
  }
  if (status.kind !== "joined" || !room || !me || !systemDef) {
    return <div className="fixed inset-0 bg-black" />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none" style={{ cursor: "none" }}>
      {scene ? (
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: rotatedSize.width,
            height: rotatedSize.height,
            transform: `translate(-50%, -50%) rotate(${tabletop.rotation}deg) translate(${tabletop.offsetX}px, ${tabletop.offsetY}px)`,
          }}
        >
          <VttCanvas
            ref={canvasRef}
            roomId={room.id}
            scene={scene}
            mode="select"
            tokens={tokens}
            participants={participants}
            me={me}
            activeTurnTokenId={activeTurnTokenId}
            combat={combat}
            movementLimitEnabled
            selectedTokenId={null}
            selectedIds={[]}
            focusRequest={null}
            cancelNonce={0}
            ruler={null}
            remoteRulers={remoteRulers}
            systemDef={systemDef}
            onRulerUpdate={noop}
            onRulerClear={noop}
            onSelectToken={noop}
            onSelectMany={noop}
            onToggleSelect={noop}
            onTokenMoveLive={noop}
            onTokenPatch={noop}
            onTokenPatchMany={noop}
            onTokenCreate={noop}
            onTokenDelete={noop}
            onDeleteSelected={noop}
            linkableCharacters={[]}
            onLinkCharacter={noop}
            onOpenCharacter={noop}
            onOpenTokenNotes={noop}
            onTokenOpenSheet={noop}
            onCharacterPatch={noop}
            onCharacterRoll={noop}
            onCharacterUseItem={noop}
            tokenBars={tokenBars}
            fogTool={null}
            onFogShape={noop}
            templates={templates}
            templateTool={null}
            selectedTemplateId={null}
            onSelectTemplate={noop}
            onTemplateCreate={noop}
            onTemplateLive={noop}
            onTemplateCommit={noop}
            pins={pins}
            pinIcons={pinIcons}
            selectedPinId={null}
            onSelectPin={noop}
            onOpenPin={noop}
            drawings={drawings}
            drawTool={null}
            selectedDrawingId={null}
            onSelectDrawing={noop}
            onDrawingCreate={noop}
            onDrawingLive={noop}
            onDrawingCommit={noop}
            myTargetIds={[]}
            othersTargets={{}}
            showOtherTargets={false}
            onToggleTarget={noop}
            onClearTargets={noop}
            translucentBarsOverMap={false}
            onToggleTranslucentBarsOverMap={noop}
            immersiveMode={false}
            onToggleImmersiveMode={noop}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            immersiveBgColor={DEFAULT_IMMERSIVE_BG_COLOR}
            onImmersiveBgColorChange={noop}
            immersiveBarsHidden={false}
            readOnly
            controlledView={view}
            labelScale={tabletop.labelScale}
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-600 font-serif text-lg">Nenhum mapa ativo.</div>
      )}

      {/* Blackout (docs/plano-cast.md §9 decisão 4): cobre TUDO, inclusive um handout aberto —
       *  "apagar a mesa" não deveria expor nada por baixo. */}
      {blackout && (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <CastIcon className="w-8 h-8 text-zinc-800" />
        </div>
      )}

      {!blackout && displayHandout && (
        <div className="absolute inset-0" style={{ fontSize: `${tabletop.labelScale}rem` }}>
          <HandoutOverlay card={displayHandout} onClose={noop} remoteView={handoutView} />
        </div>
      )}

      {/* Indicador de turno (docs/plano-cast.md §4.2): canto configurável na calibração, "off" desliga. */}
      {!blackout && combat && activeTurnName && tabletop.turnIndicatorCorner !== "off" && (
        <div
          className={`absolute ${TURN_INDICATOR_POSITION[tabletop.turnIndicatorCorner]} px-4 py-2 ${FLOAT_SURFACE} bg-surface-1/90`}
          style={{ fontSize: `${1.1 * tabletop.labelScale}rem` }}
        >
          <span className="font-serif font-bold text-[#d4af37]">Turno de {activeTurnName}</span>
        </div>
      )}

      {hintVisible && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-zinc-700 text-xs font-ui pointer-events-none">
          F: tela cheia · C: calibrar
        </div>
      )}

      {/* Canto discreto que abre a calibração (docs/plano-cast.md §3.3) — invisível, só a tecla C
       *  costuma ser usada; a área existe pra telas sem teclado por perto. */}
      <button
        type="button"
        aria-label="Calibração da mesa física"
        onClick={() => setCalibrationOpen(true)}
        className="absolute bottom-0 right-0 w-12 h-12"
        style={{ cursor: "auto" }}
      />

      {calibrationOpen && <CalibrationPanel prefs={tabletop} onChange={setTabletop} onClose={() => setCalibrationOpen(false)} screenSize={screenSize} />}
    </div>
  );
};

const TURN_INDICATOR_POSITION: Record<Exclude<import("@tormenta-vtt/shared").TabletopPrefs["turnIndicatorCorner"], "off">, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};
