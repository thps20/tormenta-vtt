import React, { useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Music, Pencil, Scroll, Search, Star, Swords, Trash2, Upload, Users, X, Zap } from "lucide-react";
import type { Asset, AssetKind, AssetPatch, EncounterPatch, HandoutPatch, LibraryItem, LibraryRefKind } from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";
import { useLibraryDrag } from "../lib/useLibraryDrag";
import type { UploadQueueItem } from "../store/library";
import { Dialog } from "./Dialog";

export interface LibraryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  items: LibraryItem[];
  uploads: UploadQueueItem[];
  onUploadAsset: (file: File, override: { name: string; kind: AssetKind; tags: string[] }) => void;
  onToggleFavorite: (refKind: LibraryRefKind, refId: string, favorite: boolean) => void;
  onEditAsset: (id: string, patch: AssetPatch) => void;
  onDeleteAsset: (id: string) => void;
  onEditHandout: (id: string, patch: HandoutPatch) => void;
  onEditEncounter: (id: string, patch: EncounterPatch) => void;
  /** Fecha o diálogo e abre a paleta do compêndio (filtrada em "Sala") — o acervo não reimplementa
   *  o editor de homebrew, só leva até ele (§1.2 do plano: "botão Editar abre a tela deles"). */
  onOpenCreature: () => void;
  /** Fecha o diálogo e abre o editor da macro na MacroBar (mesmo mecanismo do botão "editar" de lá). */
  onOpenMacro: (macroId: string) => void;
}

const TYPE_FILTERS: { key: string; label: string; icon: React.ElementType; matches: (item: LibraryItem) => boolean }[] = [
  { key: "map", label: "Mapa", icon: ImageIcon, matches: (i) => i.kind === "asset" && i.assetKind === "map" },
  { key: "token", label: "Token", icon: ImageIcon, matches: (i) => i.kind === "asset" && i.assetKind === "token" },
  { key: "audio", label: "Áudio", icon: Music, matches: (i) => i.kind === "asset" && i.assetKind === "audio" },
  { key: "handout", label: "Handout", icon: Scroll, matches: (i) => i.kind === "handout" },
  { key: "encounter", label: "Encontro", icon: Swords, matches: (i) => i.kind === "encounter" },
  { key: "creature", label: "Criatura", icon: Users, matches: (i) => i.kind === "creature" },
  { key: "macro", label: "Macro", icon: Zap, matches: (i) => i.kind === "macro" },
];

function iconOf(item: LibraryItem): React.ElementType {
  if (item.kind === "asset") return item.assetKind === "audio" ? Music : ImageIcon;
  if (item.kind === "handout") return item.handout.kind === "image" ? ImageIcon : Scroll;
  if (item.kind === "encounter") return Swords;
  if (item.kind === "creature") return Users;
  return Zap;
}

function thumbUrlOf(item: LibraryItem): string | null {
  if (item.kind === "asset" && item.assetKind !== "audio") return assetUrl(item.asset.url);
  if (item.kind === "handout" && item.handout.kind === "image") return assetUrl(item.handout.imageUrl);
  return null;
}

/** Lado maior ≥ 1000px → sugestão "mapa"; senão "token" (§1.3 do plano). */
async function suggestImageKind(file: File): Promise<AssetKind> {
  const url = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("não foi possível ler a imagem"));
      img.src = url;
    });
    return Math.max(size.w, size.h) >= 1000 ? "map" : "token";
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface PendingUpload {
  id: string;
  file: File;
  name: string;
  kind: AssetKind;
  tags: string;
}

/** Fila de upload (§1.3): arquivo(s) escolhido(s)/arrastados do SO, cada um com tipo sugerido e
 *  editável antes de confirmar — SEPARADA de `uploads` (progresso pós-confirmação, na store). */
function useUploadQueue(onUploadAsset: LibraryDialogProps["onUploadAsset"]) {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const isAudio = file.type.startsWith("audio/") || /\.(mp3|ogg)$/i.test(file.name);
      const row: PendingUpload = { id, file, name: file.name.replace(/\.[^./]+$/, ""), kind: isAudio ? "audio" : "token", tags: "" };
      setPending((prev) => [...prev, row]);
      if (!isAudio) {
        void suggestImageKind(file)
          .then((kind) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, kind } : p))))
          .catch(() => undefined);
      }
    }
  };

  const updateRow = (id: string, patch: Partial<PendingUpload>) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removeRow = (id: string) => setPending((prev) => prev.filter((p) => p.id !== id));
  const confirmRow = (id: string) => {
    const row = pending.find((p) => p.id === id);
    if (!row) return;
    removeRow(id);
    onUploadAsset(row.file, { name: row.name.trim() || row.file.name, kind: row.kind, tags: row.tags.split(",").map((t) => t.trim()).filter(Boolean) });
  };

  return { pending, addFiles, updateRow, removeRow, confirmRow };
}

/** Editor simples de nome/tags (Asset/Handout/Encontro compartilham o mesmo formato de patch —
 *  §1.2 do plano). Asset também troca "mapa"↔"token" aqui (nunca "áudio", que não é imagem). */
const EditFieldsDialog: React.FC<{
  item: LibraryItem;
  onSave: (patch: { name: string; tags: string[]; assetKind?: "map" | "token" }) => void;
  onClose: () => void;
}> = ({ item, onSave, onClose }) => {
  const [name, setName] = useState(item.name);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [assetKind, setAssetKind] = useState<"map" | "token">(item.kind === "asset" && item.assetKind !== "audio" ? item.assetKind : "map");

  return (
    <Dialog onClose={onClose} ariaLabel={`Editar ${item.name}`} maxWidthClassName="max-w-sm">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-13 font-bold text-text">Editar item do acervo</h2>
          <button onClick={onClose} className="focus-ring p-1 rounded-ui hover:bg-surface-2">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-11 text-text-muted">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 rounded-ui bg-surface-2 text-text text-13" />
        </label>
        <label className="flex flex-col gap-1 text-11 text-text-muted">
          Tags (separadas por vírgula)
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="h-8 px-2 rounded-ui bg-surface-2 text-text text-13" />
        </label>
        {item.kind === "asset" && item.assetKind !== "audio" && (
          <label className="flex flex-col gap-1 text-11 text-text-muted">
            Tipo
            <select value={assetKind} onChange={(e) => setAssetKind(e.target.value as "map" | "token")} className="h-8 px-2 rounded-ui bg-surface-2 text-text text-13">
              <option value="map">Mapa</option>
              <option value="token">Token</option>
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-8 px-3 rounded-ui text-13 text-text-muted hover:bg-surface-2">
            Cancelar
          </button>
          <button
            onClick={() => {
              onSave({
                name: name.trim() || item.name,
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                assetKind: item.kind === "asset" && item.assetKind !== "audio" ? assetKind : undefined,
              });
              onClose();
            }}
            className="h-8 px-3 rounded-ui text-13 bg-amber-600/80 hover:bg-amber-600 text-white"
          >
            Salvar
          </button>
        </div>
      </div>
    </Dialog>
  );
};

/**
 * Acervo da sala (docs/plano-preparo.md §1): biblioteca única — Asset (mapa/token/áudio) +
 * handout/encontro/criatura homebrew/macro, todos já combinados em `items` (via
 * `rules/library.ts#buildLibraryItems`, chamado por quem monta esta prop). Busca por nome/tag,
 * chips de tipo e tag, "só favoritos", grade de cards. Arrastar um card até o mapa usa
 * `useLibraryDrag` (mesmo mecanismo de pointer events de `useHandoutDrag`).
 */
export const LibraryDialog: React.FC<LibraryDialogProps> = ({
  isOpen,
  onClose,
  items,
  uploads,
  onUploadAsset,
  onToggleFavorite,
  onEditAsset,
  onDeleteAsset,
  onEditHandout,
  onEditEncounter,
  onOpenCreature,
  onOpenMacro,
}) => {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [dropHighlight, setDropHighlight] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { onCardPointerDown } = useLibraryDrag();
  const { pending, addFiles, updateRow, removeRow, confirmRow } = useUploadQueue(onUploadAsset);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const typeMatcher = TYPE_FILTERS.find((t) => t.key === typeFilter)?.matches;
    return items.filter((item) => {
      if (onlyFavorites && !item.favorite) return false;
      if (typeMatcher && !typeMatcher(item)) return false;
      if (tagFilter && !item.tags.includes(tagFilter)) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, query, typeFilter, tagFilter, onlyFavorites]);

  if (!isOpen) return null;

  const handleEditSave = (item: LibraryItem, patch: { name: string; tags: string[]; assetKind?: "map" | "token" }) => {
    if (item.kind === "asset") onEditAsset(item.id, { name: patch.name, tags: patch.tags, kind: patch.assetKind });
    else if (item.kind === "handout") onEditHandout(item.id, { name: patch.name, tags: patch.tags });
    else if (item.kind === "encounter") onEditEncounter(item.id, { name: patch.name, tags: patch.tags });
  };

  return (
    <Dialog onClose={onClose} ariaLabel="Acervo da sala" maxWidthClassName="max-w-[760px]">
      <div
        className="flex flex-col max-h-[85vh]"
        onDragOver={(e) => {
          e.preventDefault();
          setDropHighlight(true);
        }}
        onDragLeave={() => setDropHighlight(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropHighlight(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center gap-2 p-3 border-b border-[#2a2419]">
          <h2 className="text-13 font-bold text-text shrink-0">Acervo</h2>
          <div className="flex-1 flex items-center gap-1.5 h-8 px-2 rounded-ui bg-surface-2">
            <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou tag…"
              className="flex-1 bg-transparent text-13 text-text outline-none"
            />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-8 px-2.5 flex items-center gap-1.5 rounded-ui text-13 text-text hover:bg-surface-2"
            title="Enviar imagem ou áudio pro acervo"
          >
            <Upload className="w-3.5 h-3.5" />
            Enviar arquivo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp3,audio/ogg"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button onClick={onClose} className="focus-ring p-1.5 rounded-ui hover:bg-surface-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-[#2a2419]">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTypeFilter((cur) => (cur === t.key ? null : t.key))}
              className={`h-6 px-2 rounded-full text-11 flex items-center gap-1 ${typeFilter === t.key ? "bg-amber-600/80 text-white" : "bg-surface-2 text-text-muted hover:text-text"}`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-[#2a2419] mx-1" />
          <button
            onClick={() => setOnlyFavorites((v) => !v)}
            className={`h-6 px-2 rounded-full text-11 flex items-center gap-1 ${onlyFavorites ? "bg-amber-600/80 text-white" : "bg-surface-2 text-text-muted hover:text-text"}`}
          >
            <Star className="w-3 h-3" />
            Só favoritos
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
              className={`h-6 px-2 rounded-full text-11 ${tagFilter === tag ? "bg-amber-600/80 text-white" : "bg-surface-2 text-text-muted hover:text-text"}`}
            >
              #{tag}
            </button>
          ))}
        </div>

        {(pending.length > 0 || uploads.length > 0) && (
          <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-[#2a2419] bg-black/20">
            {pending.map((row) => (
              <div key={row.id} className="flex items-center gap-2 text-11">
                <input value={row.name} onChange={(e) => updateRow(row.id, { name: e.target.value })} className="h-6 px-1.5 rounded-ui bg-surface-2 text-text w-40" />
                {row.kind !== "audio" && (
                  <select value={row.kind} onChange={(e) => updateRow(row.id, { kind: e.target.value as AssetKind })} className="h-6 px-1 rounded-ui bg-surface-2 text-text">
                    <option value="map">Mapa</option>
                    <option value="token">Token</option>
                  </select>
                )}
                <input value={row.tags} onChange={(e) => updateRow(row.id, { tags: e.target.value })} placeholder="tags" className="h-6 px-1.5 rounded-ui bg-surface-2 text-text w-28" />
                <button onClick={() => confirmRow(row.id)} className="h-6 px-2 rounded-ui bg-amber-600/80 hover:bg-amber-600 text-white">
                  Enviar
                </button>
                <button onClick={() => removeRow(row.id)} className="h-6 px-1.5 rounded-ui text-text-muted hover:bg-surface-2">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-11 text-text-muted">
                {u.status === "uploading" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                <span>{u.file.name}</span>
                {u.status === "error" && <span className="text-red-400">{u.error ?? "falhou"}</span>}
              </div>
            ))}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto p-3 ${dropHighlight ? "ring-2 ring-inset ring-amber-500/60" : ""}`}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-text-muted text-13 gap-1">
              <p>Nada por aqui.</p>
              <p className="text-11">Arraste um arquivo pra dentro pra enviar, ou ajuste os filtros.</p>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
              {filtered.map((item) => {
                const Icon = iconOf(item);
                const thumb = thumbUrlOf(item);
                const editable = item.kind === "asset" || item.kind === "handout" || item.kind === "encounter";
                return (
                  <div
                    key={`${item.kind}:${item.id}`}
                    onPointerDown={(e) => onCardPointerDown(e, item)}
                    className="group relative flex flex-col rounded-lg overflow-hidden border border-[#2a2419] bg-[#15130f] cursor-grab active:cursor-grabbing"
                  >
                    <div className="h-20 flex items-center justify-center bg-black/30">
                      {thumb ? <img src={thumb} alt={item.name} className="w-full h-full object-cover" /> : <Icon className="w-6 h-6 text-text-muted" />}
                    </div>
                    <div className="flex items-center justify-between px-1.5 py-1 gap-1">
                      <span className="text-11 text-text truncate flex-1" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onToggleFavorite(item.kind, item.id, !item.favorite)}
                        className={`p-1 rounded-full bg-black/60 hover:bg-black/80 ${item.favorite ? "text-amber-400" : "text-zinc-400"}`}
                        title="Favoritar"
                      >
                        <Star className="w-3 h-3" fill={item.favorite ? "currentColor" : "none"} />
                      </button>
                      {editable && (
                        <button onClick={() => setEditing(item)} className="p-1 rounded-full bg-black/60 hover:bg-black/80 text-zinc-300" title="Editar">
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {item.kind === "creature" && (
                        <button onClick={onOpenCreature} className="p-1 rounded-full bg-black/60 hover:bg-black/80 text-zinc-300" title="Editar no compêndio">
                          <Users className="w-3 h-3" />
                        </button>
                      )}
                      {item.kind === "macro" && (
                        <button onClick={() => onOpenMacro(item.id)} className="p-1 rounded-full bg-black/60 hover:bg-black/80 text-zinc-300" title="Editar macro">
                          <Zap className="w-3 h-3" />
                        </button>
                      )}
                      {item.kind === "asset" && (
                        <button onClick={() => setDeleting(item.asset)} className="p-1 rounded-full bg-black/60 hover:bg-black/80 text-red-400" title="Apagar do acervo">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditFieldsDialog item={editing} onClose={() => setEditing(null)} onSave={(patch) => handleEditSave(editing, patch)} />
      )}

      {deleting && (
        <Dialog onClose={() => setDeleting(null)} ariaLabel="Apagar do acervo" maxWidthClassName="max-w-sm">
          <div className="p-4 flex flex-col gap-3">
            <p className="text-13 text-text">
              Apagar <strong>{deleting.name}</strong> do acervo? Passos do preparo que usam este item ficam com a referência quebrada (dá pra desfazer, Ctrl+Z).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="h-8 px-3 rounded-ui text-13 text-text-muted hover:bg-surface-2">
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDeleteAsset(deleting.id);
                  setDeleting(null);
                }}
                className="h-8 px-3 rounded-ui text-13 bg-red-700/80 hover:bg-red-700 text-white"
              >
                Apagar
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
};
