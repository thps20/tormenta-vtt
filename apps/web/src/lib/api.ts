import type { CreateRoomBody, RoomPublic, UploadResult } from "@tormenta-vtt/shared";
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

export async function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${SERVER_URL}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as UploadResult;
}

/** O servidor guarda URLs relativas ("/uploads/x.png"); aqui viram absolutas. */
export function assetUrl(url: string | null): string | null {
  if (!url) return null;
  return /^(https?:|blob:|data:)/.test(url) ? url : `${SERVER_URL}${url}`;
}
