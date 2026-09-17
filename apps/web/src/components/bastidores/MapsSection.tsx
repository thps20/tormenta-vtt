import React from "react";
import { ArrowLeft } from "lucide-react";
import type { Scene } from "@tormenta-vtt/shared";
import { MapsPanel, type MapsPanelProps } from "../MapsPanel";
import { MOTION } from "../MapBar";

interface MapsSectionProps {
  maps: MapsPanelProps;
  /** Mapa que este GM está vendo — pro aviso de divergência. */
  viewingScene: Scene | null;
  /** Mapa ativo da mesa (o que os jogadores veem). */
  activeScene: Scene | null;
}

/**
 * Seção "Mapas" dos Bastidores (docs/SPEC.md §9.29): a lista que era o dropdown do `MapSelector`
 * (`MapsPanel`: miniaturas, criar, renomear, duplicar, apagar, reordenar, ativar, ponto de chegada).
 * Quando o GM está vendo um mapa diferente do ativo, as duas ações do aviso ("Ir para o ativo",
 * "Ativar este") ficam no topo, onde estavam no dropdown.
 *
 * Imagem, grid e calibração continuam no modal "Configurar Mapa" (`MapConfigModal`), aberto pela
 * engrenagem ao lado do nome do mapa (§9.28) — não migraram para cá.
 */
export const MapsSection: React.FC<MapsSectionProps> = ({ maps, viewingScene, activeScene }) => {
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

      <MapsPanel {...maps} />
    </div>
  );
};
