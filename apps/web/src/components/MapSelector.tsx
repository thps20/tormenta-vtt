import React from "react";
import { ChevronRight, MapPin } from "lucide-react";
import type { Scene } from "@tormenta-vtt/shared";
import { MOTION } from "./MapBar";

interface MapSelectorProps {
  /** Mapa que ESTE GM está vendo. */
  viewingScene: Scene | null;
  /** Mapa ativo da mesa (o que os jogadores veem). */
  activeScene: Scene | null;
  /** Abre os Bastidores na seção Mapas (a lista deixou de ser um dropdown daqui, §9.29). */
  onOpenMaps: () => void;
}

/**
 * Botão de ESTADO do mapa na barra superior (só GM): diz qual mapa este GM está vendo e avisa, em
 * dourado, quando ele não é o ativo da mesa. Clique (ou a tecla M) abre os Bastidores na seção
 * Mapas — onde a lista, a configuração de grid e a calibração passaram a viver (§9.29). Até o passo
 * 2 este botão abria um dropdown de 420 px com o `MapsPanel` dentro: eram duas portas para a mesma
 * coisa, e o dropdown cobria justamente o mapa que o GM estava configurando.
 */
export const MapSelector: React.FC<MapSelectorProps> = ({ viewingScene, activeScene, onOpenMaps }) => {
  const diverging = viewingScene !== null && activeScene !== null && viewingScene.id !== activeScene.id;

  return (
    <button
      id="btn-map-selector"
      type="button"
      onClick={onOpenMaps}
      title="Mapas da sala (M)"
      aria-keyshortcuts="M"
      // Vendo um mapa que não é o ativo da mesa: o único aviso disso na tela, então é o único ponto
      // dourado da barra superior.
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
      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-text-muted" aria-hidden />
    </button>
  );
};
