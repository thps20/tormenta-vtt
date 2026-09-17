/**
 * Cast — tela de exibição (docs/plano-cast.md). A tela NUNCA é um `Participant`: entra por
 * `display:join`, nunca por `room:join`, e vê a sala com o MESMO filtro que qualquer jogador (dono
 * de nenhum token) — as funções puras de `services/visibility.ts`/`pins.ts`/`drawings.ts`/
 * `chatVisibility.ts`/`combat.ts` já fazem isso pra qualquer `Viewer { role: "player" }`; basta um
 * `participantId` que nunca é dono de nada.
 *
 * Estado por SALA em memória (modo de câmera, blackout, dica de mesa física, quem pediu miniatura)
 * — não sobrevive a um restart do servidor, mesmo padrão de `movementLimit.ts`/`drawingPermission.ts`.
 */
import { timingSafeEqual } from "node:crypto";
import type { Room as DbRoom } from "@prisma/client";
import type { CastState, DisplayCameraMode } from "@tormenta-vtt/shared";
import { rooms, type TypedServer } from "../socket/types.js";
import type { Viewer } from "./visibility.js";

/** `participantId` sintético da tela: nunca um cuid real, então nunca é `ownerId` de token nem autor de nada. */
export const DISPLAY_VIEWER_ID = "display";

/** Como a tela enxerga a sala: exatamente como um jogador sem tokens. */
export function displayViewer(): Viewer {
  return { role: "player", participantId: DISPLAY_VIEWER_ID };
}

/**
 * Eventos que um socket de tela pode chamar (docs/plano-cast.md §1.5): a lista de fato é a garantia
 * de "somente leitura", não cada handler individual lembrando de checar. `scene:enter` entra porque
 * é como o cliente da tela segue o mapa ativo sem repetir `display:join` inteiro.
 */
const DISPLAY_ALLOWED_EVENTS = new Set(["display:join", "display:frame", "display:set-tabletop-hint", "scene:enter"]);

export function isDisplayAllowedEvent(eventName: string): boolean {
  return DISPLAY_ALLOWED_EVENTS.has(eventName);
}

/**
 * Compara o token com `timingSafeEqual` (mesmo cuidado de comparar senha: não vazar pelo tempo de
 * resposta). `room.displayToken` null = Cast desligado nesta sala — nenhum token bate.
 */
export function displayTokenMatches(room: { displayToken: string | null }, token: string): boolean {
  if (!room.displayToken) return false;
  const a = Buffer.from(room.displayToken);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Modo de câmera (docs/plano-cast.md §4.1, §9 decisão 1) ----------------------------------

const cameraModeByRoom = new Map<string, DisplayCameraMode>();
/** Última dica de "mesa física ligada?" que QUALQUER tela da sala reportou (ver `reportTabletopHint`). */
const tabletopHintByRoom = new Map<string, boolean>();

/**
 * Enquanto o GM nunca escolheu um modo explicitamente (`display:set-camera-mode`), o padrão
 * acompanha a mesa física: ligada → "free" (nada se move sozinho — a câmera automática/seguir
 * atrapalham miniaturas de verdade sobre a mesa); desligada (TV comum) → "follow". Depois da
 * primeira escolha explícita do GM, fica travado nela (não volta a mudar sozinho).
 */
export function getCameraMode(roomId: string): DisplayCameraMode {
  return cameraModeByRoom.get(roomId) ?? (tabletopHintByRoom.get(roomId) ? "free" : "follow");
}

export function setCameraMode(roomId: string, mode: DisplayCameraMode): void {
  cameraModeByRoom.set(roomId, mode);
}

/** A tela reporta seu `tabletop.enabled` (calibração local) ao entrar e a cada troca no painel. */
export function reportTabletopHint(roomId: string, enabled: boolean): void {
  tabletopHintByRoom.set(roomId, enabled);
}

// --- Blackout ----------------------------------------------------------------------------------

const blackoutByRoom = new Map<string, boolean>();

export function isBlackout(roomId: string): boolean {
  return blackoutByRoom.get(roomId) ?? false;
}

export function setBlackout(roomId: string, blackout: boolean): void {
  blackoutByRoom.set(roomId, blackout);
}

// --- Miniatura sob demanda (docs/plano-cast.md §5) ----------------------------------------------

/** Sockets de GM com o popover Cast aberto pedindo miniatura, por sala — várias abas não brigam entre si. */
const previewDemandByRoom = new Map<string, Set<string>>();

export function addPreviewDemand(roomId: string, socketId: string): boolean {
  let set = previewDemandByRoom.get(roomId);
  if (!set) previewDemandByRoom.set(roomId, (set = new Set()));
  const was = set.size > 0;
  set.add(socketId);
  return !was; // true = a demanda passou de "ninguém pedia" para "alguém pede" (avisar as telas).
}

/** Devolve true se a demanda da sala foi de "alguém pede" para "ninguém pede mais" (avisar as telas). */
export function removePreviewDemand(roomId: string, socketId: string): boolean {
  const set = previewDemandByRoom.get(roomId);
  if (!set || !set.delete(socketId)) return false;
  if (set.size === 0) {
    previewDemandByRoom.delete(roomId);
    return true;
  }
  return false;
}

export function hasPreviewDemand(roomId: string): boolean {
  return (previewDemandByRoom.get(roomId)?.size ?? 0) > 0;
}

// --- Estado agregado pro GM (RoomSnapshot.cast) -------------------------------------------------

/** Quantas telas de exibição estão conectadas agora — direto da sala do Socket.io, sem estado próprio. */
export function displayCount(io: TypedServer, roomId: string): number {
  return io.sockets.adapter.rooms.get(rooms.display(roomId))?.size ?? 0;
}

/** `RoomSnapshot.cast` (só pro GM) — ver `socket/room.ts#room:join` e `socket/display.ts`. */
export function buildCastState(io: TypedServer, room: Pick<DbRoom, "id" | "displayToken">): CastState {
  return {
    displayToken: room.displayToken,
    cameraMode: getCameraMode(room.id),
    blackout: isBlackout(room.id),
    displayCount: displayCount(io, room.id),
  };
}
