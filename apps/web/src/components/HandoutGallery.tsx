import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  LayoutGrid,
  List,
  Upload,
  FilePlus,
  X,
  Eye,
  Users,
  MapPin,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Scroll,
  Tag,
  ChevronDown,
  AlertCircle,
  GripHorizontal,
  MoreVertical,
} from "lucide-react";
import type { Handout, HandoutCreatePayload, HandoutPatch, HandoutShowTarget, Participant, Pin } from "@tormenta-vtt/shared";
import { assetUrl, uploadImage } from "../lib/api";
import { useHandouts } from "../store/handouts";
import { useHandoutDrag } from "../lib/useHandoutDrag";
import { toast } from "../store/ui";
import { Dialog } from "./Dialog";

export interface HandoutGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  handouts: Handout[];
  /** Pinos do MAPA VISTO agora — só pra mostrar o selo "no mapa" (§9.10); nota não conta. */
  pins: Pin[];
  /** Pra listar jogadores nos menus "Mostrar para...". */
  participants: Participant[];
  /** Falso quando a sala ainda não tem mapa nenhum sendo visto — desabilita "Fixar no mapa". */
  canPinToMap: boolean;
  onCreate: (payload: HandoutCreatePayload) => void;
  onEdit: (id: string, patch: HandoutPatch) => void;
  onDelete: (id: string) => void;
  onShow: (id: string, target: HandoutShowTarget) => void;
  /** Fixa no centro do mapa visto agora (clique, sem arrastar) — mesmo `pin:create` do arrasto. */
  onPinToMap: (id: string) => void;
}

/** "Handout N": próximo número livre, sem colidir com os nomes já usados — mesma ideia de `nextMapName` (MapsPanel). */
function nextHandoutName(existing: string[]): string {
  let max = 0;
  for (const name of existing) {
    const m = /^Handout (\d+)$/.exec(name);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `Handout ${max + 1}`;
}

/** Miniatura pequena (card/linha): imagem de verdade, ou ícone de texto. */
const Thumb: React.FC<{ h: Handout; className: string }> = ({ h, className }) =>
  h.kind === "image" ? (
    <img src={assetUrl(h.imageUrl) ?? undefined} alt={h.name} className={`${className} object-cover`} />
  ) : (
    <div className={`${className} flex items-center justify-center`}>
      <Scroll className="w-4 h-4 text-amber-400/80" />
    </div>
  );

interface MenuPos {
  left: number;
  top?: number;
  bottom?: number;
}

const MENU_WIDTH = 176;

/** Posição (`position: fixed`) de um menu ancorado a um botão: gruda embaixo dele, ou em cima se
 *  não tiver espaço embaixo (mesma ideia de MapsPanel#menuPos, adaptada pra um botão qualquer em
 *  vez de um ref fixo — os cards da grade são muitos e mudam de card pra card). */
function menuPositionFromButton(btn: HTMLElement): MenuPos {
  const r = btn.getBoundingClientRect();
  const left = Math.max(4, Math.min(r.left, window.innerWidth - MENU_WIDTH - 4));
  const spaceBelow = window.innerHeight - r.bottom;
  if (spaceBelow < 160 && r.top > spaceBelow) return { left, bottom: window.innerHeight - r.top + 4 };
  return { left, top: r.bottom + 4 };
}

/**
 * Menu pequeno ancorado a um botão (⋯ do card da grade, "Mostrar para..."): portal em
 * `document.body`, `position: fixed` calculada a partir do botão que abriu — sai da clipagem do
 * `overflow-y-auto` da grade (mesmo problema/solução de `MapsPanel`/`PartyView`, cada um com sua
 * própria cópia pequena — não compartilhada num arquivo à parte, mesmo espírito de
 * `useHandoutDrag`/`useCompendiumDrag`). Fecha em clique fora (exclui o próprio botão que abriu,
 * senão reabriria sozinho no mesmo clique) e rolagem da grade; Esc fecha só ESTE menu, capturado
 * no `window` **antes** de chegar no `Dialog` da galeria — senão Esc fecharia a galeria inteira
 * por baixo (mesmo truque de `useHandoutDrag`, Esc durante o arrasto cancela só o arrasto).
 */
function AnchoredMenu({ anchorEl, pos, onClose, children }: { anchorEl: HTMLElement; pos: MenuPos; onClose: () => void; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorEl.contains(t) || menuRef.current?.contains(t)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchorEl, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_WIDTH }}
      className="z-[105] bg-[#1a1611] border border-[#3d311f] rounded-lg shadow-2xl py-1 text-left"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Biblioteca de handouts da sala (docs/SPEC.md §9.10): busca por nome/tag/conteúdo, filtro por
 * tag, grade ou lista, prévia grande com zoom (imagem) ou "manuscrito" (texto), e as ações de
 * sempre — mostrar (pra todos ou sussurro pra um jogador; `HandoutSelector` fecha a galeria
 * sozinha nesse momento, o overlay do handout fica visível sem o diálogo por cima, e reabre
 * quando o overlay fecha de novo), fixar no mapa (clique, no centro do mapa visto agora, ou
 * arrastar o card até o ponto exato — mesmo mecanismo de sempre, `useHandoutDrag`/
 * `HandoutDragGhost`), editar nome/tags, apagar. No card da grade, só as 2 ações mais comuns
 * (mostrar pra todos, fixar no mapa) aparecem grandes no hover; o resto (mostrar pra alguém,
 * editar, apagar) fica atrás do "⋯", um `AnchoredMenu` — portal em `document.body`, sai da
 * clipagem do `overflow-y-auto` da grade (mesmo problema/solução de `MapsPanel`/`PartyView`).
 * Substitui o antigo dropdown `HandoutsPanel`: agora é o `Dialog` padrão do projeto (portal, Esc,
 * clique fora), aberto pelo `HandoutSelector` da TopBar.
 */
export const HandoutGallery: React.FC<HandoutGalleryProps> = ({
  isOpen,
  onClose,
  handouts,
  pins,
  participants,
  canPinToMap,
  onCreate,
  onEdit,
  onDelete,
  onShow,
  onPinToMap,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedHandoutId, setSelectedHandoutId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);

  const [isCreatingText, setIsCreatingText] = useState(false);
  const [newTextName, setNewTextName] = useState("");
  const [newTextContent, setNewTextContent] = useState("");
  const [newTextTags, setNewTextTags] = useState("");

  const [editingHandout, setEditingHandout] = useState<Handout | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /** Menu "Mostrar para..." (todos + cada jogador) aberto agora, e de qual handout/botão. */
  const [showToMenu, setShowToMenu] = useState<{ handoutId: string; anchorEl: HTMLElement; pos: MenuPos } | null>(null);
  /** Menu "⋯" do card da grade aberto agora (Mostrar para.../Editar/Apagar). */
  const [cardMenu, setCardMenu] = useState<{ handoutId: string; anchorEl: HTMLElement; pos: MenuPos } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Arrastar um card pro mapa: mesmo mecanismo de sempre (pointer events, ghost fica por conta de
  // `HandoutDragGhost`, montado uma vez em RoomPage). `dragging` deixa o `Dialog` inerte
  // (pointer-events-none) enquanto isso — o alvo de soltura "mapa" usa `document.elementFromPoint`
  // (`lib/dropTargets.ts`), que só enxerga o mapa por baixo se este diálogo sair da frente.
  const { onCardPointerDown } = useHandoutDrag();
  const dragging = useHandouts((s) => s.drag !== null);

  useEffect(() => setZoomLevel(1), [selectedHandoutId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    handouts.forEach((h) => h.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [handouts]);

  const filteredHandouts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return handouts.filter((h) => {
      if (q) {
        const matchesName = h.name.toLowerCase().includes(q);
        const matchesTag = h.tags.some((t) => t.toLowerCase().includes(q));
        const matchesText = h.kind === "text" && h.text.toLowerCase().includes(q);
        if (!matchesName && !matchesTag && !matchesText) return false;
      }
      if (selectedTags.length > 0 && !selectedTags.every((t) => h.tags.includes(t))) return false;
      return true;
    });
  }, [handouts, searchQuery, selectedTags]);

  const selectedHandout = useMemo(
    () => handouts.find((h) => h.id === selectedHandoutId) ?? filteredHandouts[0] ?? null,
    [handouts, selectedHandoutId, filteredHandouts],
  );

  const isPinned = (handoutId: string) => pins.some((p) => p.kind !== "note" && p.handoutId === handoutId);

  const handleToggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

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

  const handleCreateTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTextName.trim() || !newTextContent.trim()) return;
    onCreate({
      kind: "text",
      name: newTextName.trim(),
      text: newTextContent.trim(),
      tags: newTextTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    });
    setIsCreatingText(false);
    setNewTextName("");
    setNewTextContent("");
    setNewTextTags("");
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHandout) return;
    onEdit(editingHandout.id, {
      name: editName.trim() || editingHandout.name,
      tags: editTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    });
    setEditingHandout(null);
  };

  const handleOpenEdit = (h: Handout) => {
    setEditingHandout(h);
    setEditName(h.name);
    setEditTags(h.tags.join(", "));
  };

  const playerParticipants = useMemo(() => participants.filter((p) => p.role === "player"), [participants]);

  if (!isOpen) return null;

  /** Linhas do menu "Mostrar para..." (todos + cada jogador) — reaproveitadas no ⋯ do card da
   *  grade e no rodapé da prévia, sempre dentro de um `AnchoredMenu`. */
  const showToMenuItems = (handoutId: string) => (
    <>
      <div className="px-2.5 py-1 text-[10px] font-serif font-bold text-amber-300/70 border-b border-[#2d2417] uppercase tracking-wider">Revelar para:</div>
      <button
        type="button"
        onClick={() => {
          onShow(handoutId, "all");
          setShowToMenu(null);
        }}
        className="w-full px-2.5 py-1.5 text-xs text-amber-200 hover:bg-[#2b2216] flex items-center gap-1.5 transition-colors cursor-pointer"
      >
        <Users className="w-3 h-3 text-[#d4af37]" />
        <span className="font-semibold">Todos na sala</span>
      </button>
      <div className="h-[1px] bg-[#2d2417] my-0.5" />
      {playerParticipants.length === 0 && <p className="px-2.5 py-1 text-[11px] text-zinc-500">Nenhum jogador na sala</p>}
      {playerParticipants.map((player) => (
        <button
          key={player.id}
          type="button"
          onClick={() => {
            onShow(handoutId, { participantId: player.id });
            setShowToMenu(null);
          }}
          className="w-full px-2.5 py-1.5 text-xs text-zinc-300 hover:text-amber-100 hover:bg-[#2b2216] flex items-center justify-between gap-1 transition-colors cursor-pointer"
        >
          <span className="truncate">{player.nickname}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${player.connected ? "bg-green-500" : "bg-zinc-600"}`} />
        </button>
      ))}
    </>
  );

  /** Linhas do menu "⋯" do card da grade: o resto das ações que não cabem como ícone grande no
   *  hover (Mostrar para... abre o mesmo `AnchoredMenu` de sempre, ancorado no mesmo botão "⋯"). */
  const cardMenuItems = (handout: Handout) => (
    <>
      <button
        type="button"
        onClick={() => {
          if (!cardMenu) return;
          const { anchorEl, pos } = cardMenu;
          setCardMenu(null);
          setShowToMenu({ handoutId: handout.id, anchorEl, pos });
        }}
        className="w-full text-left px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-[#241d15] hover:text-amber-200 flex items-center gap-2 transition-colors cursor-pointer"
      >
        <Users className="w-3.5 h-3.5 text-zinc-400" />
        Mostrar para...
      </button>
      <button
        type="button"
        onClick={() => {
          setCardMenu(null);
          handleOpenEdit(handout);
        }}
        className="w-full text-left px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-[#241d15] hover:text-amber-200 flex items-center gap-2 transition-colors cursor-pointer"
      >
        <Pencil className="w-3.5 h-3.5 text-zinc-400" />
        Editar
      </button>
      <div className="h-[1px] bg-[#2d2417] my-0.5" />
      <button
        type="button"
        onClick={() => {
          setCardMenu(null);
          setDeleteConfirmId(handout.id);
        }}
        className="w-full text-left px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950/40 hover:text-red-200 flex items-center gap-2 transition-colors cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Apagar
      </button>
    </>
  );

  return (
    <Dialog onClose={onClose} ariaLabel="Biblioteca de Handouts" maxWidthClassName="max-w-[760px]" inert={dragging}>
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

      <div id="handout-gallery" className="h-[min(620px,80vh)] flex flex-col text-zinc-200">
        {/* ================= HEADER ================= */}
        <div className="shrink-0 bg-[#1f1a14] border-b border-[#3d311f] px-4 py-3 flex flex-col gap-2.5 rounded-t-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#2b2216] border border-[#d4af37]/60 flex items-center justify-center text-[#d4af37] shadow-inner shrink-0">
                <Scroll className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-base font-bold text-amber-100 tracking-wide flex items-center gap-2">
                  Biblioteca de Handouts
                  <span className="text-[11px] font-sans font-normal px-2 py-0.5 rounded-full bg-[#2b2216] border border-[#d4af37]/30 text-[#d4af37]">
                    {handouts.length} itens
                  </span>
                </h2>
                <p className="text-[11px] text-amber-200/60 font-sans truncate">Imagens, pistas e manuscritos para revelar ou fixar no mapa</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                id="btn-upload-handout-image"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#272016] hover:bg-[#382c1e] border border-[#d4af37]/50 hover:border-[#d4af37] text-amber-200 text-xs font-serif font-bold transition-all shadow-sm cursor-pointer active:scale-95 disabled:opacity-50"
                title="Enviar imagem do seu dispositivo"
              >
                <Upload className={`w-3.5 h-3.5 text-[#d4af37] ${uploading ? "animate-pulse" : ""}`} />
                <span className="hidden sm:inline">{uploading ? "Enviando…" : "Enviar imagem"}</span>
              </button>

              <button
                id="btn-create-handout-text"
                type="button"
                onClick={() => setIsCreatingText(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3a1d1d] hover:bg-[#4f2727] border border-red-700/60 hover:border-red-500 text-amber-100 text-xs font-serif font-bold transition-all shadow-sm cursor-pointer active:scale-95"
                title="Criar novo manuscrito ou carta de texto"
              >
                <FilePlus className="w-3.5 h-3.5 text-amber-300" />
                <span className="hidden sm:inline">Novo texto</span>
              </button>

              <div className="h-5 w-[1px] bg-[#3d311f] mx-0.5" />

              <div className="flex items-center bg-[#120f0c] p-0.5 rounded-lg border border-[#3d311f]">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded transition-all cursor-pointer ${viewMode === "grid" ? "bg-[#2d2417] text-[#d4af37] shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                  title="Visualização em Grade"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded transition-all cursor-pointer ${viewMode === "list" ? "bg-[#2d2417] text-[#d4af37] shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                  title="Visualização em Lista"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                id="btn-close-handout-gallery"
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg bg-[#1a1611] hover:bg-[#2b2216] text-zinc-400 hover:text-amber-200 border border-transparent hover:border-[#d4af37]/30 transition-all cursor-pointer"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                id="input-handout-search"
                type="text"
                placeholder="Buscar por nome, tag ou conteúdo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 transition-colors"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className={`text-[10px] uppercase font-bold px-2 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer ${
                  selectedTags.length === 0 ? "bg-[#d4af37] text-black font-semibold" : "bg-[#221c15] text-zinc-400 hover:text-amber-200 border border-[#3d311f]"
                }`}
              >
                Todas
              </button>
              {allTags.map((tag) => {
                const isActive = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleTag(tag)}
                    className={`text-[10px] font-medium px-2 py-1 rounded-md transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                      isActive
                        ? "bg-[#854d0e] text-amber-100 border border-amber-400/80 shadow-sm"
                        : "bg-[#1c1813] text-amber-200/70 hover:text-amber-100 hover:bg-[#272118] border border-[#3d311f]"
                    }`}
                  >
                    <Tag className="w-2.5 h-2.5 opacity-60" />
                    <span>#{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ================= CORPO: lista + prévia ================= */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className={`flex flex-col border-r border-[#3d311f] overflow-y-auto ${selectedHandout ? "w-[300px] shrink-0" : "w-full"}`}>
            {filteredHandouts.length === 0 ? (
              <div id="handout-empty-state" className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[#241d14] border border-[#3d311f] flex items-center justify-center text-amber-400/60 mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="font-serif text-sm font-bold text-amber-200 mb-1">Nenhum handout encontrado</h3>
                <p className="text-xs text-zinc-400 max-w-[240px] mb-4">
                  {searchQuery || selectedTags.length > 0
                    ? "Nenhum item corresponde aos filtros ativos. Tente limpar a busca."
                    : "Envie ilustrações ou crie manuscritos de texto para sua biblioteca de aventura."}
                </p>
                {searchQuery || selectedTags.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedTags([]);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#2b2216] border border-[#d4af37]/40 text-amber-200 text-xs font-serif font-bold hover:bg-[#382c1e] transition-colors cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-[#272016] border border-[#d4af37]/60 text-amber-200 text-xs font-serif font-bold hover:bg-[#382c1e] transition-colors cursor-pointer"
                    >
                      Enviar imagem
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingText(true)}
                      className="px-3 py-1.5 rounded-lg bg-[#3a1d1d] border border-red-700/60 text-amber-100 text-xs font-serif font-bold hover:bg-[#4f2727] transition-colors cursor-pointer"
                    >
                      Novo texto
                    </button>
                  </div>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="p-3 grid grid-cols-2 gap-2.5 auto-rows-max">
                {filteredHandouts.map((handout) => {
                  const isSelected = selectedHandout?.id === handout.id;
                  const pinned = isPinned(handout.id);
                  return (
                    <div
                      key={handout.id}
                      id={`handout-card-${handout.id}`}
                      onClick={() => setSelectedHandoutId(handout.id)}
                      onPointerDown={(e) => onCardPointerDown(e, handout.id)}
                      title="Arraste para o mapa para fixar como pino"
                      className={`group relative rounded-lg border flex flex-col overflow-hidden transition-all cursor-grab active:cursor-grabbing select-none ${
                        isSelected ? "border-[#d4af37] bg-[#221c14] ring-1 ring-[#d4af37]/40" : "border-[#332819] bg-[#1a1611] hover:border-[#d4af37]/50 hover:bg-[#221c15]"
                      }`}
                    >
                      <div className="relative aspect-video w-full bg-[#120f0c] overflow-hidden flex items-center justify-center border-b border-[#2b2216]">
                        {handout.kind === "image" ? (
                          <img
                            src={assetUrl(handout.imageUrl) ?? undefined}
                            alt={handout.name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full p-2.5 bg-gradient-to-br from-[#261f16] to-[#17130e] flex flex-col justify-between text-left">
                            <div className="flex items-center gap-1.5 text-amber-400/80 mb-1">
                              <Scroll className="w-3.5 h-3.5 shrink-0 text-[#d4af37]" />
                              <span className="text-[10px] font-serif font-bold uppercase tracking-wider text-amber-200/80">Manuscrito</span>
                            </div>
                            <p className="text-[10px] text-amber-100/75 italic line-clamp-3 leading-relaxed font-serif">&quot;{handout.text}&quot;</p>
                          </div>
                        )}

                        {pinned && (
                          <div
                            className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 text-[9px] font-serif font-bold flex items-center gap-1 shadow-md"
                            title="Este handout está fixado como pino no mapa atual"
                          >
                            <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                            <span>no mapa</span>
                          </div>
                        )}

                        <div className="absolute bottom-1.5 right-1.5 px-1 py-0.5 rounded bg-black/70 text-[9px] font-mono text-zinc-300 backdrop-blur-xs">
                          {handout.kind === "image" ? "IMG" : "TXT"}
                        </div>

                        {/* Hover: só as 2 ações principais, grandes — o resto vai no menu "⋯" (evita
                            lotar o card e nunca cobre o nome, que fica fora desta miniatura). */}
                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 z-20">
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onShow(handout.id, "all");
                            }}
                            className="p-2.5 rounded-full bg-[#2b2216] hover:bg-[#3d311f] text-amber-300 hover:text-amber-100 border border-[#d4af37]/50 transition-colors shadow-lg cursor-pointer"
                            title="Mostrar para todos"
                          >
                            <Eye className="w-5 h-5" />
                          </button>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPinToMap(handout.id);
                            }}
                            disabled={!canPinToMap}
                            className={`p-2.5 rounded-full border transition-colors shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              pinned ? "bg-emerald-950/80 border-emerald-500 text-emerald-300" : "bg-[#241d15] hover:bg-[#33291d] text-zinc-200 hover:text-zinc-100 border-[#3d311f]"
                            }`}
                            title={canPinToMap ? "Fixar no centro do mapa atual" : "Nenhum mapa aberto"}
                          >
                            <MapPin className="w-5 h-5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            const btn = e.currentTarget;
                            setCardMenu((prev) => (prev?.handoutId === handout.id ? null : { handoutId: handout.id, anchorEl: btn, pos: menuPositionFromButton(btn) }));
                          }}
                          className="absolute top-1.5 right-1.5 z-20 p-1 rounded bg-black/60 hover:bg-black/80 text-zinc-300 hover:text-amber-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Mais ações"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-2 flex flex-col gap-1">
                        <h4 className="font-serif text-xs font-bold text-amber-100 truncate leading-tight" title={handout.name}>
                          {handout.name}
                        </h4>
                        {handout.tags.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {handout.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[9px] px-1 py-0.2 rounded bg-[#2b2216] border border-[#44341f] text-amber-300/80 font-mono truncate max-w-[80px]">
                                #{tag}
                              </span>
                            ))}
                            {handout.tags.length > 2 && <span className="text-[9px] text-zinc-500 font-mono">+{handout.tags.length - 2}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 flex flex-col gap-1.5">
                {filteredHandouts.map((handout) => {
                  const isSelected = selectedHandout?.id === handout.id;
                  const pinned = isPinned(handout.id);
                  return (
                    <div
                      key={handout.id}
                      id={`handout-list-item-${handout.id}`}
                      onClick={() => setSelectedHandoutId(handout.id)}
                      onPointerDown={(e) => onCardPointerDown(e, handout.id)}
                      title="Arraste para o mapa para fixar como pino"
                      className={`group flex items-center justify-between p-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing select-none ${
                        isSelected ? "border-[#d4af37] bg-[#221c14] ring-1 ring-[#d4af37]/30" : "border-[#332819] bg-[#1a1611] hover:border-[#d4af37]/40 hover:bg-[#221c15]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Thumb h={handout} className="w-9 h-9 rounded bg-[#120f0c] border border-[#3d311f] shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-serif text-xs font-bold text-amber-100 truncate">{handout.name}</span>
                            {pinned && (
                              <span className="px-1 py-0.2 rounded bg-emerald-950 border border-emerald-600/60 text-emerald-400 text-[8px] font-serif font-bold shrink-0 flex items-center gap-0.5">
                                <MapPin className="w-2 h-2" />
                                no mapa
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[9px] text-zinc-500 font-mono uppercase">{handout.kind}</span>
                            {handout.tags.map((t) => (
                              <span key={t} className="text-[9px] text-amber-300/70 font-mono">
                                #{t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onShow(handout.id, "all");
                          }}
                          className="p-1 rounded bg-[#272015] hover:bg-[#382c1e] text-amber-300 border border-[#d4af37]/30 transition-colors"
                          title="Mostrar para todos"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPinToMap(handout.id);
                          }}
                          disabled={!canPinToMap}
                          className="p-1 rounded bg-[#201a13] hover:bg-[#2d2419] text-zinc-300 border border-[#3d311f] transition-colors disabled:opacity-40"
                          title={canPinToMap ? "Fixar no centro do mapa atual" : "Nenhum mapa aberto"}
                        >
                          <MapPin className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(handout);
                          }}
                          className="p-1 rounded bg-[#201a13] hover:bg-[#2d2419] text-zinc-400 hover:text-zinc-200 border border-[#3d311f] transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(handout.id);
                          }}
                          className="p-1 rounded bg-[#2c1313] hover:bg-[#421b1b] text-red-300 border border-red-900/60 transition-colors"
                          title="Apagar"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ================= PRÉVIA ================= */}
          {selectedHandout ? (
            <div id="handout-preview-panel" className="flex-1 flex flex-col bg-[#14110d] overflow-hidden min-w-0">
              <div className="shrink-0 p-3 bg-[#1c1813] border-b border-[#3d311f] flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded font-bold ${
                        selectedHandout.kind === "image" ? "bg-blue-950 border border-blue-600/60 text-blue-300" : "bg-amber-950 border border-amber-600/60 text-amber-300"
                      }`}
                    >
                      {selectedHandout.kind === "image" ? "Imagem" : "Texto"}
                    </span>
                    <h3 className="font-serif text-sm font-bold text-amber-100 truncate" title={selectedHandout.name}>
                      {selectedHandout.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400 flex-wrap">
                    {selectedHandout.tags.length > 0 && (
                      <div className="flex items-center gap-1">
                        {selectedHandout.tags.map((tag) => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.2 rounded bg-[#261f15] border border-[#3d311f] text-amber-300/80 font-mono">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {isPinned(selectedHandout.id) && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 text-[9px] font-serif font-bold flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                        Fixado no mapa
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-[#241d15] border border-[#3d311f] text-[10px] text-amber-300/80 shrink-0"
                  title="Arraste o card, na lista à esquerda, para fora até o mapa"
                >
                  <GripHorizontal className="w-3 h-3" />
                  <span>Arrastar p/ mapa</span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 flex items-center justify-center relative bg-[#0e0c09]">
                {selectedHandout.kind === "image" ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#1a1611]/90 border border-[#3d311f] rounded-lg p-1 shadow-lg backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                        className="p-1 rounded hover:bg-[#2c2217] text-zinc-400 hover:text-amber-200 transition-colors"
                        title="Diminuir zoom"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[10px] font-mono text-amber-300 px-1 select-none">{Math.round(zoomLevel * 100)}%</span>
                      <button
                        type="button"
                        onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                        className="p-1 rounded hover:bg-[#2c2217] text-zinc-400 hover:text-amber-200 transition-colors"
                        title="Aumentar zoom"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoomLevel(1)}
                        className="p-1 rounded hover:bg-[#2c2217] text-zinc-400 hover:text-amber-200 transition-colors ml-0.5 border-l border-[#3d311f] pl-1.5"
                        title="Redefinir zoom"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="w-full h-full flex items-center justify-center overflow-auto p-2">
                      <img
                        src={assetUrl(selectedHandout.imageUrl) ?? undefined}
                        alt={selectedHandout.name}
                        style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center center", transition: "transform 0.15s ease-out" }}
                        className="max-w-full max-h-full object-contain rounded border border-[#3d311f] shadow-2xl"
                      />
                    </div>

                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 border border-[#3d311f] text-[10px] font-mono text-zinc-400 backdrop-blur-xs">
                      {selectedHandout.width} × {selectedHandout.height} px
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full overflow-y-auto p-4 flex flex-col justify-start items-center">
                    <div className="w-full max-w-md bg-[#241d15] border-2 border-[#5c4627] rounded-lg p-5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] relative">
                      <div className="absolute top-1 left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-[#d4af37]/60" />
                      <div className="absolute top-1 right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-[#d4af37]/60" />
                      <div className="absolute bottom-1 left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-[#d4af37]/60" />
                      <div className="absolute bottom-1 right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-[#d4af37]/60" />

                      <div className="text-center pb-3 mb-3 border-b border-[#3d311f]">
                        <h4 className="font-serif text-sm font-bold text-[#d4af37] tracking-wider uppercase">{selectedHandout.name}</h4>
                        <span className="text-[10px] text-amber-200/50 font-serif italic">Documento arquivado</span>
                      </div>
                      <div className="font-serif text-sm text-amber-100/90 leading-relaxed whitespace-pre-wrap selection:bg-[#d4af37]/30">{selectedHandout.text}</div>
                      <div className="mt-5 pt-3 border-t border-[#3d311f] flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                        <span>{selectedHandout.text.length} caracteres</span>
                        <span>{new Date(selectedHandout.createdAt).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 p-3 bg-[#1c1813] border-t border-[#3d311f] flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    id="btn-preview-show-all"
                    type="button"
                    onClick={() => onShow(selectedHandout.id, "all")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2e2315] hover:bg-[#42321c] border border-[#d4af37] text-amber-200 hover:text-amber-100 text-xs font-serif font-bold transition-all cursor-pointer active:scale-95"
                    title="Revelar em tela cheia para todos os jogadores na sala"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#d4af37]" />
                    <span>Mostrar para todos</span>
                  </button>

                  <button
                    id="btn-preview-show-to"
                    type="button"
                    onClick={(e) => {
                      const handoutId = selectedHandout.id;
                      const btn = e.currentTarget;
                      setShowToMenu((prev) => (prev?.handoutId === handoutId ? null : { handoutId, anchorEl: btn, pos: menuPositionFromButton(btn) }));
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#221c15] hover:bg-[#2f261d] border border-[#3d311f] hover:border-[#d4af37]/50 text-zinc-300 hover:text-amber-200 text-xs font-serif font-medium transition-colors cursor-pointer"
                    title="Revelar em segredo para um jogador específico (sussurro visual)"
                  >
                    <Users className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Mostrar para...</span>
                    <ChevronDown className="w-3 h-3 text-zinc-500" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    id="btn-preview-pin-map"
                    type="button"
                    onClick={() => onPinToMap(selectedHandout.id)}
                    disabled={!canPinToMap}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-serif font-semibold transition-all cursor-pointer disabled:opacity-40 ${
                      isPinned(selectedHandout.id) ? "bg-emerald-950/80 border-emerald-500/80 text-emerald-300 hover:bg-emerald-900/90" : "bg-[#221c15] hover:bg-[#2f261d] border-[#3d311f] hover:border-[#d4af37]/50 text-zinc-200"
                    }`}
                    title={canPinToMap ? "Fixa no centro do mapa visto agora — arrastar o card mira o ponto exato" : "Nenhum mapa aberto"}
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isPinned(selectedHandout.id) ? "No mapa (+)" : "Fixar no mapa"}</span>
                  </button>

                  <button
                    id="btn-preview-edit"
                    type="button"
                    onClick={() => handleOpenEdit(selectedHandout)}
                    className="p-1.5 rounded-lg bg-[#221c15] hover:bg-[#2f261d] border border-[#3d311f] hover:border-[#d4af37]/40 text-zinc-300 hover:text-amber-200 transition-colors cursor-pointer"
                    title="Editar título e tags"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id="btn-preview-delete"
                    type="button"
                    onClick={() => setDeleteConfirmId(selectedHandout.id)}
                    className="p-1.5 rounded-lg bg-[#2b1414] hover:bg-[#3f1c1c] border border-red-900/60 hover:border-red-600/80 text-red-300 hover:text-red-100 transition-colors cursor-pointer"
                    title="Apagar handout"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-zinc-500 text-xs font-serif">Selecione um handout à esquerda para visualizar em detalhes</div>
          )}
        </div>
      </div>

      {cardMenu &&
        (() => {
          const handout = handouts.find((h) => h.id === cardMenu.handoutId);
          return (
            handout && (
              <AnchoredMenu anchorEl={cardMenu.anchorEl} pos={cardMenu.pos} onClose={() => setCardMenu(null)}>
                {cardMenuItems(handout)}
              </AnchoredMenu>
            )
          );
        })()}

      {showToMenu && (
        <AnchoredMenu anchorEl={showToMenu.anchorEl} pos={showToMenu.pos} onClose={() => setShowToMenu(null)}>
          {showToMenuItems(showToMenu.handoutId)}
        </AnchoredMenu>
      )}

      {/* ================= NOVO TEXTO ================= */}
      {isCreatingText && (
        <Dialog onClose={() => setIsCreatingText(false)} ariaLabel="Novo handout de texto" maxWidthClassName="max-w-md">
          <div className="p-4 flex flex-col gap-3 text-zinc-200">
            <div className="flex items-center justify-between pb-2 border-b border-[#3d311f]">
              <h3 className="font-serif text-sm font-bold text-amber-200 flex items-center gap-2">
                <Scroll className="w-4 h-4 text-[#d4af37]" />
                Novo Handout de Texto
              </h3>
              <button type="button" onClick={() => setIsCreatingText(false)} className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer" title="Fechar (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTextSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-serif font-bold text-amber-300/80 uppercase mb-1">Título / Nome do Manuscrito</label>
                <input
                  autoFocus
                  type="text"
                  required
                  placeholder="Ex: Carta com o Selo do Bispo..."
                  value={newTextName}
                  onChange={(e) => setNewTextName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-serif font-bold text-amber-300/80 uppercase mb-1">Tags (separadas por vírgula)</label>
                <input
                  type="text"
                  placeholder="pista, carta, nobre"
                  value={newTextTags}
                  onChange={(e) => setNewTextTags(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-serif font-bold text-amber-300/80 uppercase mb-1">Conteúdo do Manuscrito</label>
                <textarea
                  required
                  rows={6}
                  placeholder="Escreva a mensagem, lenda, enigma ou pista encontrada pelos aventureiros..."
                  value={newTextContent}
                  onChange={(e) => setNewTextContent(e.target.value)}
                  className="w-full p-3 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 focus:outline-none font-serif leading-relaxed resize-y"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#3d311f]">
                <button type="button" onClick={() => setIsCreatingText(false)} className="px-3 py-1.5 rounded-lg bg-[#241d15] hover:bg-[#2e251b] text-zinc-300 text-xs font-serif cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3a1d1d] hover:bg-[#502727] border border-red-700/60 text-amber-100 text-xs font-serif font-bold transition-colors cursor-pointer shadow-md">
                  Criar Manuscrito
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* ================= EDITAR ================= */}
      {editingHandout && (
        <Dialog onClose={() => setEditingHandout(null)} ariaLabel="Editar handout" maxWidthClassName="max-w-sm">
          <div className="p-4 flex flex-col gap-3 text-zinc-200">
            <div className="flex items-center justify-between pb-2 border-b border-[#3d311f]">
              <h3 className="font-serif text-sm font-bold text-amber-200 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#d4af37]" />
                Editar Handout
              </h3>
              <button type="button" onClick={() => setEditingHandout(null)} className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer" title="Fechar (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-serif font-bold text-amber-300/80 uppercase mb-1">Nome</label>
                <input
                  autoFocus
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-serif font-bold text-amber-300/80 uppercase mb-1">Tags (separadas por vírgula)</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#120f0c] border border-[#3d311f] focus:border-[#d4af37] rounded-lg text-amber-100 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#3d311f]">
                <button type="button" onClick={() => setEditingHandout(null)} className="px-3 py-1.5 rounded-lg bg-[#241d15] hover:bg-[#2e251b] text-zinc-300 text-xs font-serif cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#2e2315] hover:bg-[#40301d] border border-[#d4af37] text-amber-200 text-xs font-serif font-bold transition-colors cursor-pointer shadow-md">
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* ================= CONFIRMAR EXCLUSÃO ================= */}
      {deleteConfirmId && (
        <Dialog onClose={() => setDeleteConfirmId(null)} ariaLabel="Apagar handout" maxWidthClassName="max-w-sm">
          <div className="p-4 flex flex-col gap-3 text-zinc-200">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <h3 className="font-serif text-sm font-bold text-red-200">Apagar Handout?</h3>
            </div>
            <p className="text-xs text-zinc-300">Tem certeza que deseja apagar este item da biblioteca? Ele deixará de aparecer na lista do Mestre.</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-red-900/40">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="px-3 py-1.5 rounded-lg bg-[#261d1d] hover:bg-[#332727] text-zinc-300 text-xs font-serif cursor-pointer">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(deleteConfirmId);
                  setDeleteConfirmId(null);
                  if (selectedHandoutId === deleteConfirmId) setSelectedHandoutId(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-[#611a1a] hover:bg-[#832323] border border-red-600 text-white text-xs font-serif font-bold transition-colors cursor-pointer shadow-md"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
};
