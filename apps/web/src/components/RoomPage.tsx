import { useEffect, useMemo, useState } from "react";
import { navigate } from "../lib/router";
import { selectActiveScene, useRoom } from "../store/room";
import { sceneTokens, useTokens } from "../store/tokens";
import { useChat } from "../store/chat";
import { currentEntry, useInitiative } from "../store/initiative";
import { canEditCharacter, sortedCharacters, useCharacters } from "../store/characters";
import { useSystemDef } from "../lib/system";
import { CharacterSheetDrawer } from "./CharacterSheetDrawer";
import { TopBar } from "./TopBar";
import { VttCanvas } from "./VttCanvas";
import { TOKEN_COLORS } from "./TokenInspector";
import { MapConfigModal, type MapConfigResult } from "./MapConfigModal";
import { SidePanel } from "./SidePanel";
import { NicknamePrompt } from "./NicknamePrompt";

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

  // Seleciona o objeto estável (byId) e deriva a lista com useMemo: um seletor que
  // devolvesse um array novo a cada chamada faria o Zustand re-renderizar sem parar.
  const byId = useTokens((s) => s.byId);
  const tokens = useMemo(() => sceneTokens(byId, scene?.id), [byId, scene?.id]);
  const selectedTokenId = useTokens((s) => s.selectedId);
  const focusRequest = useTokens((s) => s.focusRequest);
  const selectToken = useTokens((s) => s.select);
  const focusToken = useTokens((s) => s.focus);
  const moveLive = useTokens((s) => s.moveLive);
  const patchToken = useTokens((s) => s.patch);
  const createToken = useTokens((s) => s.create);
  const deleteToken = useTokens((s) => s.delete);

  const messages = useChat((s) => s.messages);
  const sendMessage = useChat((s) => s.send);

  const initiative = useInitiative((s) => s.state);
  const nextTurn = useInitiative((s) => s.next);
  const prevTurn = useInitiative((s) => s.prev);
  const resetInitiative = useInitiative((s) => s.reset);
  const addEntry = useInitiative((s) => s.add);
  const updateEntry = useInitiative((s) => s.update);
  const removeEntry = useInitiative((s) => s.remove);

  const charById = useCharacters((s) => s.byId);
  const characters = useMemo(() => sortedCharacters(charById), [charById]);
  const openCharacterId = useCharacters((s) => s.openId);
  const emptySheetOpen = useCharacters((s) => s.emptyOpen);
  const openCharacter = useCharacters((s) => s.open);
  const createCharacter = useCharacters((s) => s.create);
  const updateCharacter = useCharacters((s) => s.update);
  const deleteCharacter = useCharacters((s) => s.delete);
  const rollCharacter = useCharacters((s) => s.roll);
  const linkCharacter = useTokens((s) => s.linkCharacter);
  const systemDef = useSystemDef();

  if (!room || !me) return null;
  const openChar = openCharacterId ? (charById[openCharacterId] ?? null) : null;
  const sheetOpen = openChar !== null || emptySheetOpen;
  const linkableCharacters = characters.filter((c) => canEditCharacter(me, c));
  const isGm = me.role === "gm";
  const activeTurnTokenId = currentEntry(initiative)?.tokenId ?? null;

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
      />

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 h-full relative overflow-hidden">
          {scene ? (
            <VttCanvas
              scene={scene}
              tokens={tokens}
              participants={participants}
              me={me}
              activeTurnTokenId={activeTurnTokenId}
              selectedTokenId={selectedTokenId}
              focusRequest={focusRequest}
              onSelectToken={selectToken}
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
                  color: TOKEN_COLORS[(n - 1) % TOKEN_COLORS.length] ?? "#e11d48",
                }).then((created) => created && selectToken(created.id));
              }}
              onTokenDelete={(id) => void deleteToken(id)}
              linkableCharacters={linkableCharacters}
              onLinkCharacter={(tokenId, characterId) => void linkCharacter(tokenId, characterId)}
              onOpenCharacter={openCharacter}
            />
          ) : (
            <Centered>
              <p className="text-zinc-500 text-sm">Nenhuma cena ativa.</p>
            </Centered>
          )}
        </main>

        <SidePanel
          messages={messages}
          participants={participants}
          currentUserId={me.id}
          initiative={initiative}
          tokens={tokens}
          isGm={isGm}
          onSendMessage={(text) => void sendMessage(text)}
          onNextTurn={() => void nextTurn()}
          onPrevTurn={() => void prevTurn()}
          onResetInitiative={() => void resetInitiative()}
          onAddEntry={(entry) => void addEntry(entry)}
          onUpdateEntry={(patch) => void updateEntry(patch)}
          onRemoveEntry={(id) => void removeEntry(id)}
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
