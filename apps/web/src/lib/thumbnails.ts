import { useEffect, useState } from "react";
import type { Scene } from "@tormenta-vtt/shared";
import { assetUrl } from "./api";

/**
 * Miniaturas do painel "Mapas" (docs/plano-mapas.md §14): geradas no CLIENTE (a imagem já está no
 * navegador ou é baixável de /uploads/) e cacheadas em `localStorage`, chave por cena. O servidor
 * não vira processador de imagem por causa de uma listinha.
 */

const THUMB_WIDTH = 160;
const CACHE_PREFIX = "vtt:thumb:";
/** LRU simples: acima disso, descarta a miniatura mais antiga a cada nova geração. */
const MAX_CACHE_ENTRIES = 40;

interface CachedThumb {
  mapUrl: string;
  dataUrl: string;
  at: number;
}

function readCache(sceneId: string): CachedThumb | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + sceneId);
    return raw ? (JSON.parse(raw) as CachedThumb) : null;
  } catch {
    return null;
  }
}

/** Descarta as mais antigas acima do limite. Nunca lança: estourar a cota não pode derrubar o painel. */
function writeCache(sceneId: string, thumb: CachedThumb): void {
  try {
    localStorage.setItem(CACHE_PREFIX + sceneId, JSON.stringify(thumb));
    const entries: { key: string; at: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      try {
        entries.push({ key, at: (JSON.parse(localStorage.getItem(key) ?? "{}") as CachedThumb).at ?? 0 });
      } catch {
        /* entrada corrompida: ignora na varredura, não derruba o resto */
      }
    }
    if (entries.length <= MAX_CACHE_ENTRIES) return;
    entries.sort((a, b) => a.at - b.at);
    for (const { key } of entries.slice(0, entries.length - MAX_CACHE_ENTRIES)) localStorage.removeItem(key);
  } catch {
    /* estourou a cota do localStorage: a miniatura só é gerada de novo depois */
  }
}

function drawThumbnail(img: HTMLImageElement): string {
  const scale = THUMB_WIDTH / img.naturalWidth;
  const width = THUMB_WIDTH;
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

/**
 * Miniatura (~160px de largura) do mapa de um card, gerada sob demanda e cacheada por
 * `scene.mapUrl` (trocar a imagem do mapa invalida o cache dessa cena). `null` enquanto carrega,
 * sem imagem (`mapUrl` null), ou se a geração falhar — o card mostra um placeholder nesses casos.
 */
export function useThumbnail(scene: Pick<Scene, "id" | "mapUrl">): string | null {
  const cached = scene.mapUrl ? readCache(scene.id) : null;
  const [thumb, setThumb] = useState<string | null>(cached && cached.mapUrl === scene.mapUrl ? cached.dataUrl : null);

  useEffect(() => {
    if (!scene.mapUrl) {
      setThumb(null);
      return;
    }
    const hit = readCache(scene.id);
    if (hit && hit.mapUrl === scene.mapUrl) {
      setThumb(hit.dataUrl);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const dataUrl = drawThumbnail(img);
        if (!dataUrl) return;
        setThumb(dataUrl);
        writeCache(scene.id, { mapUrl: scene.mapUrl!, dataUrl, at: Date.now() });
      } catch {
        /* canvas manchado por CORS ou outra falha: sem miniatura, sem derrubar o painel */
      }
    };
    img.onerror = () => {
      if (!cancelled) setThumb(null);
    };
    img.src = assetUrl(scene.mapUrl) ?? "";
    return () => {
      cancelled = true;
    };
  }, [scene.id, scene.mapUrl]);

  return thumb;
}
