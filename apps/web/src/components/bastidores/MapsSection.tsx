import React from "react";
import { ArrowLeft, Sliders } from "lucide-react";
import type { GridConfig, Scene, SystemDefinition } from "@tormenta-vtt/shared";
import { MapsPanel, type MapsPanelProps } from "../MapsPanel";
import { MOTION } from "../MapBar";
import { MapGridInline } from "./MapGridInline";

interface MapsSectionProps {
  maps: MapsPanelProps;
  /** Mapa que este GM está vendo (o que a parte de grid/calibração configura). */
  viewingScene: Scene | null;
  /** Mapa ativo da mesa (o que os jogadores veem) — pro aviso de divergência. */
  activeScene: Scene | null;
  systemDef: SystemDefinition | null;
  onSetMap: (map: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null }) => void;
  onUpdateGrid: (patch: Partial<GridConfig>) => void;
}

/**
 * Seção "Mapas" dos Bastidores (docs/SPEC.md §9.29): a lista que era o dropdown do `MapSelector`
 * (`MapsPanel`: miniaturas, criar, renomear, duplicar, apagar, reordenar, ativar, ponto de chegada)
 * e, abaixo, imagem/grid/escala/calibração do mapa VISTO — antes um modal (`MapConfigModal`).
 * Quando o GM está vendo um mapa diferente do ativo, as duas ações do aviso ("Ir para o ativo",
 * "Ativar este") ficam no topo, onde estavam no dropdown.
 */
export const MapsSection: React.FC<MapsSectionProps> = ({ maps, viewingScene, activeScene, systemDef, onSetMap, onUpdateGrid }) => {
  const diverging = viewingScene !== null && activeScene !== null && viewingScene.id !== activeScene.id;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {diverging && activeScene && viewingScene && (
        <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
          <button
            id="btn-maps-section-go-active"
            type="button"
            onClick={() => maps.onEnter(activeScene.id)}
            className={`focus-ring flex-1 flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border border-border hover:bg-surface-2 text-13 font-medium text-text cursor-pointer ${MOTION}`}
          >
            <ArrowLeft className="w-3.5 h-3.5 text-text-muted" />
            Ir para o ativo
          </button>
          <button
            id="btn-maps-section-activate-this"
            type="button"
            onClick={() => maps.onActivateRequest(viewingScene.id)}
            className={`focus-ring flex-1 h-8 px-2 rounded-ui border border-border hover:bg-surface-2 text-13 font-medium text-text cursor-pointer ${MOTION}`}
          >
            Ativar este
          </button>
        </div>
      )}

      {/* Lista de mapas: mantém a própria rolagem e o rodapé de criar/enviar. */}
      <div className="flex-1 min-h-0">
        <MapsPanel {...maps} />
      </div>

      {/* Configuração do mapa visto: rolagem própria, até ~metade da altura da gaveta. */}
      {viewingScene && (
        <section className="shrink-0 max-h-[52%] overflow-y-auto scrollbar-thin border-t border-border">
          <h3 className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface-1 px-2.5 py-2 font-title text-13 font-bold uppercase tracking-widest text-text">
            <Sliders className="w-3.5 h-3.5 text-text-muted" aria-hidden />
            <span className="truncate">Configurar “{viewingScene.name}”</span>
          </h3>
          <MapGridInline scene={viewingScene} systemDef={systemDef} onSetMap={onSetMap} onUpdateGrid={onUpdateGrid} />
        </section>
      )}
    </div>
  );
};
