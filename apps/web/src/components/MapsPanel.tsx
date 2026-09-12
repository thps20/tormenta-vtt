import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Edit2,
  Eye,
  FlagTriangleRight,
  GripVertical,
  MapPin,
  MoreVertical,
  NotebookText,
  Play,
  Plus,
  Swords,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { Scene, SceneListItem } from "@tormenta-vtt/shared";
import { orderScenes } from "@tormenta-vtt/shared";
import { uploadImage } from "../lib/api";
import { useThumbnail } from "../lib/thumbnails";
import { toast } from "../store/ui";

export interface MapsPanelProps {
  scenes: Scene[];
  activeSceneId: string | null;
  /** Mapa que ESTE cliente (GM) está vendo — badge "Vendo", some quando coincide com o ativo. */
  viewingSceneId: string | null;
  itemsBySceneId: Record<string, SceneListItem>;
  /** Clique no card: navega sem ativar (scene:enter). */
  onEnter: (sceneId: string) => void;
  /** Botão "Ativar": abre o diálogo "Levar para o mapa" (RoomPage decide). */
  onActivateRequest: (sceneId: string) => void;
  onCreate: (payload: { name: string; mapUrl?: string | null; mapWidth?: number | null; mapHeight?: number | null }) => void;
  onRename: (sceneId: string, name: string) => void;
  onDuplicate: (sceneId: string) => void;
  onDeleteRequest: (sceneId: string) => void;
  onReorder: (sceneIds: string[]) => void;
  /** "Definir ponto de chegada": o próximo clique no canvas grava (RoomPage liga ao VttCanvas). */
  onSetArrivalMode: (sceneId: string) => void;
  onClearArrival: (sceneId: string) => void;
  arrivalPickingSceneId: string | null;
  /** Notas do Mestre sobre este mapa (docs/plano-narracao.md) — abre o mesmo painel do botão da TopBar. */
  onOpenNotes: (sceneId: string) => void;
}

/** "Mapa N": próximo número livre, sem colidir com os nomes já usados. */
function nextMapName(existing: string[]): string {
  let max = 0;
  for (const name of existing) {
    const m = /^Mapa (\d+)$/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Mapa ${max + 1}`;
}

const COMBAT_DOT: Record<string, string> = { rolling: "bg-amber-400", active: "bg-emerald-400", ended: "bg-zinc-500" };

/** Largura do menu ⋯ (w-48) — usada pra calcular a posição do portal. */
const MENU_WIDTH = 192;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Aba "Mapas" do painel lateral (docs/plano-mapas.md §13), só GM. */
export const MapsPanel: React.FC<MapsPanelProps> = ({
  scenes,
  activeSceneId,
  viewingSceneId,
  itemsBySceneId,
  onEnter,
  onActivateRequest,
  onCreate,
  onRename,
  onDuplicate,
  onDeleteRequest,
  onReorder,
  onSetArrivalMode,
  onClearArrival,
  arrivalPickingSceneId,
  onOpenNotes,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const ordered = orderScenes(scenes);

  const handleUploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onCreate({ name: nextMapName(scenes.map((s) => s.name)), mapUrl: res.url, mapWidth: res.width, mapHeight: res.height });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const commitRename = (sceneId: string) => {
    const trimmed = editValue.trim();
    if (trimmed) onRename(sceneId, trimmed);
    setEditingId(null);
  };

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const ids = ordered.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      onReorder(next);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div id="maps-panel" className="flex flex-col h-full bg-[#181614] text-zinc-100 select-none" onClick={() => setOpenMenuId(null)}>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {ordered.map((scene) => {
          const item = itemsBySceneId[scene.id];
          const isActive = scene.id === activeSceneId;
          const isViewing = scene.id === viewingSceneId && !isActive;
          const isEditing = editingId === scene.id;
          return (
            <MapCard
              key={scene.id}
              scene={scene}
              item={item}
              isActive={isActive}
              isViewing={isViewing}
              isEditing={isEditing}
              editValue={editValue}
              isPickingArrival={arrivalPickingSceneId === scene.id}
              menuOpen={openMenuId === scene.id}
              isBeingDragged={draggedId === scene.id}
              isDragTarget={dragOverId === scene.id}
              onEditValueChange={setEditValue}
              onCommitRename={() => commitRename(scene.id)}
              onCancelRename={() => setEditingId(null)}
              onStartRename={() => {
                setEditingId(scene.id);
                setEditValue(scene.name);
                setOpenMenuId(null);
              }}
              onEnter={() => onEnter(scene.id)}
              onActivate={() => onActivateRequest(scene.id)}
              onToggleMenu={() => setOpenMenuId(openMenuId === scene.id ? null : scene.id)}
              onCloseMenu={() => setOpenMenuId(null)}
              onDuplicate={() => {
                onDuplicate(scene.id);
                setOpenMenuId(null);
              }}
              onDelete={() => {
                onDeleteRequest(scene.id);
                setOpenMenuId(null);
              }}
              onSetArrivalMode={() => {
                onSetArrivalMode(scene.id);
                setOpenMenuId(null);
              }}
              onClearArrival={() => {
                onClearArrival(scene.id);
                setOpenMenuId(null);
              }}
              onOpenNotes={() => {
                onOpenNotes(scene.id);
                setOpenMenuId(null);
              }}
              onDragStart={() => setDraggedId(scene.id)}
              onDragOver={() => draggedId && draggedId !== scene.id && setDragOverId(scene.id)}
              onDrop={() => handleDrop(scene.id)}
              onDragEnd={() => {
                setDraggedId(null);
                setDragOverId(null);
              }}
            />
          );
        })}
      </div>

      <div className="p-2.5 border-t border-[#2d2417] flex items-center gap-1.5 shrink-0">
        <button
          id="btn-map-new"
          onClick={() => onCreate({ name: nextMapName(scenes.map((s) => s.name)) })}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#201b15] hover:bg-[#2c241b] border border-[#3b3223] text-amber-200/90 text-[11px] font-serif font-bold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#d4af37]" />
          Novo mapa
        </button>
        <button
          id="btn-map-new-upload"
          onClick={() => !uploading && fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#201b15] hover:bg-[#2c241b] border border-[#3b3223] text-amber-200/90 text-[11px] font-serif font-bold transition-colors cursor-pointer disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5 text-[#d4af37]" />
          {uploading ? "Enviando…" : "Novo por upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUploadFile(f);
          }}
        />
      </div>
    </div>
  );
};

interface MapCardProps {
  scene: Scene;
  item: SceneListItem | undefined;
  isActive: boolean;
  isViewing: boolean;
  isEditing: boolean;
  editValue: string;
  isPickingArrival: boolean;
  menuOpen: boolean;
  isBeingDragged: boolean;
  isDragTarget: boolean;
  onEditValueChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onEnter: () => void;
  onActivate: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetArrivalMode: () => void;
  onClearArrival: () => void;
  onOpenNotes: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const MapCard: React.FC<MapCardProps> = ({
  scene,
  item,
  isActive,
  isViewing,
  isEditing,
  editValue,
  isPickingArrival,
  menuOpen,
  isBeingDragged,
  isDragTarget,
  onEditValueChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onEnter,
  onActivate,
  onToggleMenu,
  onCloseMenu,
  onDuplicate,
  onDelete,
  onSetArrivalMode,
  onClearArrival,
  onOpenNotes,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const thumb = useThumbnail(scene);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Posição do menu ⋯, calculada a partir do botão (portal em document.body — nunca preso ao
  // overflow-y-auto da lista de mapas). `null` no 1º render: o menu ainda é medido fora da tela.
  const [menuPos, setMenuPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  // Mede o menu já montado (fora da tela) e decide left/top ou left/bottom (vira pra cima
  // quando não cabe abaixo do botão) — roda antes do paint, então não pisca na posição errada.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const btn = menuBtnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const btnRect = btn.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const left = clamp(btnRect.right - MENU_WIDTH, 4, window.innerWidth - MENU_WIDTH - 4);
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const openUp = spaceBelow < menuHeight + 8 && btnRect.top > menuHeight + 8;
    setMenuPos(openUp ? { left, bottom: window.innerHeight - btnRect.top + 4 } : { left, top: btnRect.bottom + 4 });
  }, [menuOpen]);

  // Fecha em clique fora, Esc ou rolagem (a posição é fixa; rolar a lista destacaria o menu do
  // botão) — mesmo padrão de RollModeButton.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuBtnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onCloseMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMenu();
    };
    const onScroll = () => onCloseMenu();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen, onCloseMenu]);

  return (
    <div
      id={`map-card-${scene.id}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if (!isEditing) onEnter();
      }}
      className={`group relative flex gap-2.5 p-2 rounded border cursor-pointer transition-all ${
        isActive
          ? "bg-[#252018] border-[#d4af37] shadow-[0_0_10px_rgba(212,175,55,0.2)]"
          : isViewing
            ? "bg-[#201c16] border-[#d4af37]/50"
            : "bg-[#1b1814] border-[#2c2419] hover:border-[#423623] hover:bg-[#201c17]"
      } ${isBeingDragged ? "opacity-40" : ""} ${isDragTarget ? "border-t-2 border-t-[#d4af37]" : ""} ${
        isPickingArrival ? "ring-1 ring-amber-400" : ""
      }`}
    >
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-amber-300 flex items-center"
        onClick={(e) => e.stopPropagation()}
        title="Arrastar para reordenar"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      <div className="w-20 h-[45px] shrink-0 rounded overflow-hidden bg-black/40 border border-black/40 flex items-center justify-center">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <MapPin className="w-4 h-4 text-zinc-600" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        {isEditing ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={editValue}
              maxLength={80}
              onChange={(e) => onEditValueChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename();
                else if (e.key === "Escape") onCancelRename();
              }}
              className="flex-1 min-w-0 bg-[#0f0e0c] border border-[#d4af37] rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none"
            />
            <button onMouseDown={(e) => e.preventDefault()} onClick={onCommitRename} className="p-1 text-emerald-400 cursor-pointer">
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-xs font-serif font-bold text-zinc-100 truncate" title={scene.name}>
            {scene.name}
          </span>
        )}

        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
          <span className="flex items-center gap-0.5" title="Tokens no mapa">
            <Users className="w-3 h-3" />
            {item?.tokenCount ?? "…"}
          </span>
          {item?.combatStatus && (
            <span className="flex items-center gap-1" title={`Combate: ${item.combatStatus}`}>
              <Swords className="w-3 h-3 text-[#d4af37]" />
              <span className={`w-1.5 h-1.5 rounded-full ${COMBAT_DOT[item.combatStatus] ?? "bg-zinc-500"}`} />
            </span>
          )}
          {scene.arrival && (
            <span title="Ponto de chegada definido">
              <FlagTriangleRight className="w-3 h-3 text-amber-400" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isActive && (
            <span className="text-[9px] font-serif font-bold px-1.5 py-0.2 rounded bg-[#d4af37] text-black tracking-wider">ATIVO</span>
          )}
          {isViewing && (
            <span className="text-[9px] font-serif font-bold px-1.5 py-0.2 rounded bg-[#2d2417] text-amber-300 border border-[#d4af37]/40 flex items-center gap-0.5">
              <Eye className="w-2.5 h-2.5" /> VENDO
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end justify-between" onClick={(e) => e.stopPropagation()}>
        {!isActive && (
          <button
            id={`btn-map-activate-${scene.id}`}
            onClick={onActivate}
            title="Ativar este mapa (a mesa toda vai vê-lo)"
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#2a2215] hover:bg-[#382c1b] border border-[#d4af37] text-amber-200 text-[10px] font-serif font-bold transition-all cursor-pointer"
          >
            <Play className="w-3 h-3 text-[#d4af37]" />
            Ativar
          </button>
        )}

        <div className="relative mt-auto">
          <button
            ref={menuBtnRef}
            id={`btn-map-menu-${scene.id}`}
            onClick={onToggleMenu}
            className="p-1 rounded text-zinc-500 hover:text-amber-300 hover:bg-[#2c2419] transition-colors cursor-pointer"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen &&
            createPortal(
              <div
                id={`menu-map-${scene.id}`}
                ref={menuRef}
                role="menu"
                style={{
                  position: "fixed",
                  left: menuPos?.left ?? -9999,
                  top: menuPos?.top,
                  bottom: menuPos?.bottom,
                  width: MENU_WIDTH,
                  visibility: menuPos ? "visible" : "hidden",
                }}
                className="z-50 bg-[#1e1a15] border border-[#d4af37]/70 rounded shadow-2xl p-1 flex flex-col gap-0.5"
              >
                <MenuItem icon={Edit2} label="Renomear" onClick={onStartRename} />
                <MenuItem icon={Copy} label="Duplicar" onClick={onDuplicate} />
                {scene.arrival ? (
                  <MenuItem icon={X} label="Remover ponto de chegada" onClick={onClearArrival} />
                ) : (
                  <MenuItem icon={FlagTriangleRight} label="Definir ponto de chegada" onClick={onSetArrivalMode} />
                )}
                <MenuItem icon={NotebookText} label={scene.hasNotes ? "Notas do mapa (tem nota)" : "Notas do mapa"} onClick={onOpenNotes} />
                <div className="h-px bg-[#2d2417] my-0.5" />
                <MenuItem icon={Trash2} label="Apagar" danger onClick={onDelete} />
              </div>,
              document.body,
            )}
        </div>
      </div>
    </div>
  );
};

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs font-serif transition-colors cursor-pointer flex items-center gap-2 ${
        danger ? "text-red-300 hover:bg-red-950/60" : "text-zinc-200 hover:bg-[#2d2417] hover:text-amber-200"
      }`}
    >
      <Icon className={`w-3 h-3 ${danger ? "text-red-400" : "text-[#d4af37]"}`} />
      <span>{label}</span>
    </button>
  );
}
