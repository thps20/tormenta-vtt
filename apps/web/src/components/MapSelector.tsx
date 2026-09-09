import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import type { Scene } from "@tormenta-vtt/shared";
import { MapsPanel, type MapsPanelProps } from "./MapsPanel";
import { isTyping } from "../lib/isTyping";

interface MapSelectorProps {
  /** Mapa que ESTE GM está vendo. */
  viewingScene: Scene | null;
  /** Mapa ativo da mesa (o que os jogadores veem). */
  activeScene: Scene | null;
  /** Repassadas direto pro MapsPanel dentro do dropdown. */
  maps: MapsPanelProps;
  /** Dispara `scene:list` sob demanda, ao abrir (RoomPage decide — só a store conhece o evento). */
  onOpen: () => void;
}

/**
 * Botão-seletor de mapa da TopBar (só GM): substitui a antiga aba "Mapas" do SidePanel e a faixa
 * `ViewingSceneBanner` (docs/revisao-mapas.md). Clique ou a tecla M (fora de campo de texto) abrem
 * um dropdown largo com o mesmo conteúdo de antes (`MapsPanel`); Esc ou clique fora fecham. Quando
 * o GM está vendo um mapa diferente do ativo da mesa, o botão fica em destaque e o topo do dropdown
 * ganha "Ir para o ativo"/"Ativar este" — o aviso que antes era a faixa acima do canvas.
 */
export const MapSelector: React.FC<MapSelectorProps> = ({ viewingScene, activeScene, maps, onOpen }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const diverging = viewingScene !== null && activeScene !== null && viewingScene.id !== activeScene.id;

  const openDropdown = () => {
    onOpen();
    setOpen(true);
  };

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Tecla M (fora de campo de texto) abre/fecha; Esc fecha.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (open) setOpen(false);
        else openDropdown();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        id="btn-map-selector"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        title="Mapas da sala (M)"
        className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-serif transition-colors cursor-pointer max-w-[280px] ${
          diverging
            ? "bg-[#2a2215] border-amber-500/60 text-amber-300 hover:border-amber-400"
            : "bg-transparent border-transparent text-zinc-300 hover:text-[#d4af37]"
        }`}
      >
        <MapPin className={`w-3.5 h-3.5 shrink-0 ${diverging ? "text-amber-400" : "text-[#d4af37]"}`} />
        <span className="truncate">
          {diverging
            ? `Vendo ${viewingScene?.name} · ativo: ${activeScene?.name}`
            : `Mapa: ${viewingScene?.name ?? "Sem mapa"}`}
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id="map-selector-dropdown"
          className="absolute left-0 top-full mt-1 w-[420px] max-h-[70vh] flex flex-col rounded bg-[#181614] border border-[#2d2417] shadow-2xl z-50 overflow-hidden"
        >
          {diverging && activeScene && viewingScene && (
            <div className="flex items-center gap-1.5 p-2 border-b border-[#2d2417] bg-[#14120e] shrink-0">
              <button
                id="btn-map-selector-go-active"
                onClick={() => {
                  maps.onEnter(activeScene.id);
                  setOpen(false);
                }}
                className="flex-1 px-2.5 py-1 rounded bg-[#2d2417] hover:bg-[#3d311f] border border-amber-500/50 text-amber-200 text-[11px] font-serif font-bold cursor-pointer"
              >
                ← Ir para o ativo
              </button>
              <button
                id="btn-map-selector-activate-this"
                onClick={() => {
                  maps.onActivateRequest(viewingScene.id);
                  setOpen(false);
                }}
                className="flex-1 px-2.5 py-1 rounded bg-[#2a2215] hover:bg-[#382c1b] border border-[#d4af37] text-[#d4af37] text-[11px] font-serif font-bold cursor-pointer"
              >
                Ativar este
              </button>
            </div>
          )}

          <MapsPanel
            {...maps}
            onEnter={(sceneId) => {
              maps.onEnter(sceneId);
              setOpen(false);
            }}
            onSetArrivalMode={(sceneId) => {
              // O próximo clique precisa acontecer no canvas: o dropdown não pode ficar no caminho.
              maps.onSetArrivalMode(sceneId);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
};
