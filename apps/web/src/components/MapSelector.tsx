import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, MapPin } from "lucide-react";
import type { Scene } from "@tormenta-vtt/shared";
import { MapsPanel, type MapsPanelProps } from "./MapsPanel";
import { isTyping } from "../lib/isTyping";
import { FLOAT_MENU, MOTION } from "./MapBar";

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
        aria-expanded={open}
        // Vendo um mapa que não é o ativo da mesa: o único aviso disso na tela, então é o único
        // ponto dourado da barra superior.
        className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui border text-13 cursor-pointer max-w-[320px] ${MOTION} ${
          diverging ? "bg-surface-2 border-accent/60 text-accent" : "border-transparent text-text hover:bg-surface-2"
        }`}
      >
        <MapPin className={`w-3.5 h-3.5 shrink-0 ${diverging ? "" : "text-text-muted"}`} />
        {diverging ? (
          <span className="truncate">
            Vendo <span className="font-title font-semibold uppercase tracking-[0.06em]">{viewingScene?.name}</span> · ativo:{" "}
            <span className="font-title font-semibold uppercase tracking-[0.06em]">{activeScene?.name}</span>
          </span>
        ) : (
          <span className="truncate">
            <span className="text-text-muted">Mapa </span>
            <span className="font-title font-semibold uppercase tracking-[0.06em]">{viewingScene?.name ?? "Sem mapa"}</span>
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150 ease-out ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id="map-selector-dropdown"
          className={`absolute left-0 top-full mt-1 w-[420px] max-h-[70vh] flex flex-col z-50 overflow-hidden ${FLOAT_MENU}`}
        >
          {diverging && activeScene && viewingScene && (
            <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
              <button
                id="btn-map-selector-go-active"
                onClick={() => {
                  maps.onEnter(activeScene.id);
                  setOpen(false);
                }}
                className={`focus-ring flex-1 flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-ui border border-border hover:bg-surface-2 text-13 font-medium text-text cursor-pointer ${MOTION}`}
              >
                <ArrowLeft className="w-3.5 h-3.5 text-text-muted" />
                Ir para o ativo
              </button>
              <button
                id="btn-map-selector-activate-this"
                onClick={() => {
                  maps.onActivateRequest(viewingScene.id);
                  setOpen(false);
                }}
                className={`focus-ring flex-1 h-8 px-2.5 rounded-ui border border-border hover:bg-surface-2 text-13 font-medium text-text cursor-pointer ${MOTION}`}
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
