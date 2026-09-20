import type {
  AdoptRoomBody,
  CreateRoomBody,
  EndRoomBody,
  MyRoom,
  ReopenRoomBody,
  RenameRoomBody,
  RoomPublic,
  UploadAudioResult,
  UploadResult,
} from "@tormenta-vtt/shared";
import { SERVER_URL } from "../config";

/** Chamadas HTTP (fora do socket). Erros viram exceções com a mensagem do servidor. */

export interface CreateRoomResponse {
  room: RoomPublic;
  gmSecret: string;
  sessionToken: string;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Erro ${res.status}`;
  } catch {
    return `Erro ${res.status}`;
  }
}

export async function createRoom(body: CreateRoomBody): Promise<CreateRoomResponse> {
  const res = await fetch(`${SERVER_URL}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as CreateRoomResponse;
}

/** GET /api/rooms/mine — "Minhas mesas" do Lobby (docs/SPEC.md §3.1). */
export async function listMyRooms(ownerKey: string, status: "active" | "ended"): Promise<MyRoom[]> {
  const url = `${SERVER_URL}/api/rooms/mine?${new URLSearchParams({ ownerKey, status })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { rooms: MyRoom[] };
  return body.rooms;
}

export async function renameMyRoom(roomId: string, body: RenameRoomBody): Promise<MyRoom> {
  const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return ((await res.json()) as { room: MyRoom }).room;
}

export async function endMyRoom(roomId: string, body: EndRoomBody): Promise<MyRoom> {
  const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return ((await res.json()) as { room: MyRoom }).room;
}

export async function reopenMyRoom(roomId: string, body: ReopenRoomBody): Promise<MyRoom> {
  const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/reopen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return ((await res.json()) as { room: MyRoom }).room;
}

export async function adoptRoom(body: AdoptRoomBody): Promise<MyRoom> {
  const res = await fetch(`${SERVER_URL}/api/rooms/adopt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return ((await res.json()) as { room: MyRoom }).room;
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${SERVER_URL}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as UploadResult;
}

/**
 * Mesma rota, aceitando também áudio (docs/plano-preparo.md §1.3, acervo) — `uploadImage` continua
 * existindo à parte pros call sites que só lidam com imagem e não querem checar `kind`.
 */
export async function uploadFile(file: File): Promise<UploadResult | UploadAudioResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${SERVER_URL}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as UploadResult | UploadAudioResult;
}

/** O servidor guarda URLs relativas ("/uploads/x.png"); aqui viram absolutas. */
export function assetUrl(url: string | null): string | null {
  if (!url) return null;
  return /^(https?:|blob:|data:)/.test(url) ? url : `${SERVER_URL}${url}`;
}
