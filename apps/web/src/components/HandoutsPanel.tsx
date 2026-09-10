import React, { useRef, useState } from "react";
import { Edit2, Eye, FileText, Image as ImageIcon, MapPinned, Plus, Send, Trash2, Upload, Users } from "lucide-react";
import type { Handout, HandoutCreatePayload, HandoutShowTarget, Participant } from "@tormenta-vtt/shared";
import { assetUrl, uploadImage } from "../lib/api";
import { useHandoutDrag } from "../lib/useHandoutDrag";
import { toast } from "../store/ui";

export interface HandoutsPanelProps {
  handouts: Handout[];
  /** Pra listar jogadores no menu "Mostrar para...". */
  participants: Participant[];
  onCreate: (payload: HandoutCreatePayload) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onShow: (id: string, target: HandoutShowTarget) => void;
}

/** "Handout N": próximo número livre, sem colidir com os nomes já usados — mesma ideia de `nextMapName` (MapsPanel). */
function nextHandoutName(existing: string[]): string {
  let max = 0;
  for (const name of existing) {
    const m = /^Handout (\d+)$/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Handout ${max + 1}`;
}

/** Miniatura de um handout: imagem de verdade, ou ícone de texto. */
const Thumb: React.FC<{ h: Handout }> = ({ h }) =>
  h.kind === "image" ? (
    <img src={assetUrl(h.imageUrl) ?? undefined} alt="" className="w-10 h-10 rounded object-cover border border-[#3d3d3d] shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded border border-[#3d3d3d] bg-[#1f1f1f] flex items-center justify-center shrink-0">
      <FileText className="w-4 h-4 text-zinc-500" />
    </div>
  );

/** Painel "Handouts" da TopBar (só GM), dropdown do `HandoutSelector` — mesmo padrão visual do `MapsPanel`. */
export const HandoutsPanel: React.FC<HandoutsPanelProps> = ({ handouts, participants, onCreate, onRename, onDelete, onShow }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showMenuId, setShowMenuId] = useState<string | null>(null);
  const [newTextOpen, setNewTextOpen] = useState(false);
  const [newTextName, setNewTextName] = useState("");
  const [newTextBody, setNewTextBody] = useState("");
  const { onCardPointerDown } = useHandoutDrag();
  const players = participants.filter((p) => p.role === "player");

  const handleUploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onCreate({ kind: "image", name: nextHandoutName(handouts.map((h) => h.name)), imageUrl: res.url, width: res.width, height: res.height, tags: [] });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const commitNewText = () => {
    const name = newTextName.trim() || nextHandoutName(handouts.map((h) => h.name));
    const text = newTextBody.trim();
    if (!text) return;
    onCreate({ kind: "text", name, text, tags: [] });
    setNewTextOpen(false);
    setNewTextName("");
    setNewTextBody("");
  };

  const commitRename = (id: string) => {
    const trimmed = editValue.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  return (
    <div id="handouts-panel" className="flex flex-col max-h-[70vh]">
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {handouts.length === 0 && !newTextOpen && (
          <p className="text-xs text-zinc-500 text-center py-6 font-serif">Nenhum handout ainda. Crie um abaixo.</p>
        )}
        {handouts.map((h) => (
          <div
            key={h.id}
            id={`handout-card-${h.id}`}
            className="group flex items-center gap-2 p-1.5 rounded border border-transparent hover:border-[#3d3d3d] hover:bg-[#1f1f1f] cursor-grab active:cursor-grabbing"
            title="Arraste para o mapa para fixar como pino"
            onPointerDown={(e) => onCardPointerDown(e, h.id)}
          >
            <Thumb h={h} />
            <div className="flex-1 min-w-0">
              {editingId === h.id ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(h.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(h.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="w-full bg-[#101418] border border-[#d4af37]/60 rounded px-1.5 py-0.5 text-xs text-zinc-100"
                />
              ) : (
                <p className="text-xs font-serif text-zinc-200 truncate">{h.name}</p>
              )}
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{h.kind === "image" ? "Imagem" : "Texto"}</p>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                title="Mostrar para todos"
                onClick={() => onShow(h.id, "all")}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <button
                  title="Mostrar para um jogador (sussurro)"
                  onClick={() => setShowMenuId(showMenuId === h.id ? null : h.id)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1.5 rounded hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
                {showMenuId === h.id && (
                  <div className="absolute right-0 top-full mt-1 w-40 rounded bg-[#181614] border border-[#2d2417] shadow-xl z-10 py-1">
                    {players.length === 0 && <p className="px-2 py-1 text-[11px] text-zinc-500">Nenhum jogador na sala</p>}
                    {players.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          onShow(h.id, { participantId: p.id });
                          setShowMenuId(null);
                        }}
                        className="w-full text-left px-2 py-1 text-[11px] text-zinc-300 hover:bg-[#2d2417] hover:text-[#d4af37] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Users className="w-3 h-3 shrink-0" />
                        {p.nickname}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                title="Arraste para o mapa para fixar como pino"
                onPointerDown={(e) => onCardPointerDown(e, h.id)}
                className="p-1.5 rounded hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-grab"
              >
                <MapPinned className="w-3.5 h-3.5" />
              </button>
              <button
                title="Renomear"
                onClick={() => {
                  setEditingId(h.id);
                  setEditValue(h.name);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                title="Apagar"
                onClick={() => onDelete(h.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-red-950 text-zinc-400 hover:text-red-400 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[#2d2417] p-2 shrink-0 space-y-1.5">
        {newTextOpen ? (
          <div className="rounded border border-[#3d3d3d] bg-[#14120e] p-2 space-y-1.5">
            <input
              autoFocus
              value={newTextName}
              onChange={(e) => setNewTextName(e.target.value)}
              placeholder="Nome (opcional)"
              className="w-full bg-[#101418] border border-[#3d3d3d] rounded px-2 py-1 text-xs text-zinc-100"
            />
            <textarea
              value={newTextBody}
              onChange={(e) => setNewTextBody(e.target.value)}
              placeholder="Texto do handout…"
              rows={4}
              className="w-full bg-[#101418] border border-[#3d3d3d] rounded px-2 py-1 text-xs text-zinc-100 resize-y"
            />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setNewTextOpen(false)}
                className="px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={commitNewText}
                className="px-2.5 py-1 rounded bg-[#2a2215] hover:bg-[#382c1b] border border-[#d4af37] text-[#d4af37] text-[11px] font-serif font-bold cursor-pointer"
              >
                Criar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button
              id="btn-handout-new-image"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#1f1f1f] hover:bg-[#2d2417] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-300 hover:text-[#d4af37] text-[11px] font-serif font-bold cursor-pointer disabled:opacity-50"
            >
              {uploading ? <Upload className="w-3.5 h-3.5 animate-pulse" /> : <ImageIcon className="w-3.5 h-3.5" />}
              Imagem
            </button>
            <button
              id="btn-handout-new-text"
              onClick={() => setNewTextOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#1f1f1f] hover:bg-[#2d2417] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-300 hover:text-[#d4af37] text-[11px] font-serif font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Texto
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUploadFile(file);
          }}
        />
      </div>
    </div>
  );
};
