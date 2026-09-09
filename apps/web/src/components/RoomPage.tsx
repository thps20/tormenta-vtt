import { useEffect, useMemo, useState } from "react";
import { navigate } from "../lib/router";
import { selectActiveScene, useRoom } from "../store/room";
import { sceneTokens, useTokens } from "../store/tokens";
import { useChat } from "../store/chat";
import { activeCombatant, isMyTurn, useCombat } from "../store/combat";
import { canEditCharacter, sortedCharacters, useCharacters } from "../store/characters";
import { useSystemDef } from "../lib/system";
import { useToolShortcuts } from "../lib/useToolShortcuts";
import { useTurnTitle } from "../lib/useTurnTitle";
import { selectEffectiveMode, useTools } from "../store/tools";
import { computeCharacter, isPointRevealed, tokenCenter } from "@tormenta-vtt/shared";
import { CharacterSheetDrawer } from "./CharacterSheetDrawer";
import { CombatBanner } from "./CombatBanner";
import { type CombatPanelCallbacks } from "./CombatPanel";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { FogToolbar } from "./FogToolbar";
import { VttCanvas, type TokenBar } from "./VttCanvas";
import { TOKEN_COLORS } from "./TokenInspector";
import { MapConfigModal, type MapConfigResult } from "./MapConfigModal";
import { SidePanel, type SidePanelTab } from "./SidePanel";
import { CharacterMenu } from "./CharacterMenu";
import { NicknamePrompt } from "./NicknamePrompt";

const CENTER_ON_TURN_KEY = "tvtt:centerOnActiveTurn";

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
  const scene = useRoom(selectActiveScene);
  const leave = useRoom((s) => s.leave);
  const setMap = useRoom((s) => s.setMap);
  const updateGrid = useRoom((s) => s.updateGrid);
  const [isMapConfigOpen, setMapConfigOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("chat");

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
  useToolShortcuts();

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
  const createToken = useTokens((s) => s.create);
  const deleteToken = useTokens((s) => s.delete);

  const messages = useChat((s) => s.messages);
  const sendMessage = useChat((s) => s.send);

  const combat = useCombat((s) => s.state);
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
  // Callbacks do CombatPanel: cada um reempacota os argumentos "soltos" da UI no payload
  // que o evento combat:* espera e chama a ação correspondente da store (server = fonte da verdade,
  // sem otimismo — ver store/combat.ts).
  const combatCallbacks: CombatPanelCallbacks = useMemo(
    () => ({
      onStart: (sceneId, tokenIds) => void combatStart({ sceneId, tokenIds }),
      onRoll: (scope, combatantId, visibility) => void combatRoll({ scope, combatantId, visibility }),
      onSetInitiative: (combatantId, initiative, bonus) => void combatSetInitiative({ combatantId, initiative, bonus }),
      onNext: () => void combatNext(),
      onPrev: () => void combatPrev(),
      onReorder: (combatantIds) => void combatReorder(combatantIds),
      onAdd: (tokenIds) => void combatAddCombatants({ tokenIds }),
      onRemove: (combatantIds) => void combatRemove(combatantIds),
      onDelay: (combatantId) => void combatDelay(combatantId),
      onResume: (combatantId) => void combatResume(combatantId),
      // Sem evento combat:skip no servidor: só faz sentido pular quem está agindo agora, e
      // aí equivale a avançar o turno (CombatPanel só mostra "Pular turno" pro combatente ativo).
      onSkip: () => void combatNext(),
      onSetSurprised: (combatantId, surprised) => void combatSetSurprised({ combatantId, surprised }),
      onEnd: (clear) => void combatEnd(clear),
    }),
    [
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
  useTurnTitle(me !== null && isMyTurn(combat, me));

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

  // Salvar do modal: só emite o que mudou (mapa e/ou grid).
  const handleSaveMapConfig = async ({ map, grid }: MapConfigResult) => {
    if (!scene) return;
    const mapChanged = map.mapUrl !== scene.mapUrl || map.mapWidth !== scene.mapWidth || map.mapHeight !== scene.mapHeight;
    if (mapChanged) await setMap(map);
    await updateGrid(grid);
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
      />

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 h-full relative overflow-hidden">
          <CombatBanner
            combat={combat}
            meId={me.id}
            viewer={isGm ? "gm" : "player"}
            onRollSelf={() => combatRoll({ scope: "self" })}
            onDelay={combatDelay}
            onResume={combatResume}
          />
          {scene ? (
            <>
              <VttCanvas
                scene={scene}
                mode={effectiveMode}
                tokens={tokens}
                participants={participants}
                me={me}
                activeTurnTokenId={activeTurnTokenId}
                combat={combat}
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
                onSelectToken={(tokenId) => {
                  selectToken(tokenId);
                  // Clique num token vinculado a uma ficha que eu vejo abre a ficha.
                  const characterId = tokenId ? byId[tokenId]?.characterId : null;
                  if (characterId && charById[characterId]) openCharacter(characterId);
                }}
                onTokenMoveLive={moveLive}
                onTokenPatch={(patch) => void patchToken(patch)}
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
                linkableCharacters={linkableCharacters}
                onLinkCharacter={(tokenId, characterId) => void linkCharacter(tokenId, characterId)}
                onOpenCharacter={openCharacter}
                tokenBars={tokenBars}
                fogTool={isGm ? { mode: fogMode, shape: fogShape, brushSize: fogBrushSize } : null}
                onFogShape={(shape) => {
                  // Pintar com a névoa desligada não mostraria nada: liga antes de adicionar.
                  if (!scene.fog.enabled) void fogOp({ type: "setEnabled", enabled: true });
                  void fogOp({ type: "add", shape });
                }}
              />
              <Toolbar isGm={isGm} mode={toolMode} effectiveMode={effectiveMode} onChange={setToolMode} />
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
            </>
          ) : (
            <Centered>
              <p className="text-zinc-500 text-sm">Nenhuma cena ativa.</p>
            </Centered>
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
          centerOnActiveTurn={centerOnActiveTurn}
          onToggleCenterOnActiveTurn={() => setCenterOnActiveTurn((v) => !v)}
          tokens={tokens}
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
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full min-h-screen flex flex-col items-center justify-center gap-3 bg-[#0c0c0c]">{children}</div>;
}
