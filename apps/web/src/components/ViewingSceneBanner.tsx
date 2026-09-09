import React from "react";
import { MapPin } from "lucide-react";

interface ViewingSceneBannerProps {
  viewingName: string;
  activeName: string;
  onGoToActive: () => void;
  onActivateThis: () => void;
}

/**
 * Faixa de aviso (docs/plano-mapas.md §4), só GM, só quando `viewingSceneId !== activeSceneId` —
 * sem ela o erro mais provável desta feature é o GM editar um mapa achando que a mesa está vendo.
 */
export const ViewingSceneBanner: React.FC<ViewingSceneBannerProps> = ({ viewingName, activeName, onGoToActive, onActivateThis }) => (
  <div
    id="viewing-scene-banner"
    className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-lg bg-[#14120e]/95 border border-amber-500/60 text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.85)] backdrop-blur-md"
  >
    <div className="flex items-center gap-2 text-amber-200 text-xs font-serif">
      <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
      <span>
        Você está em <strong className="text-amber-300">{viewingName}</strong>. O mapa ativo é <strong className="text-amber-300">{activeName}</strong>.
      </span>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        id="btn-banner-go-active"
        onClick={onGoToActive}
        className="px-2.5 py-1 rounded bg-[#2d2417] hover:bg-[#3d311f] border border-amber-500/50 text-amber-200 text-[11px] font-serif font-bold cursor-pointer"
      >
        Ir para o ativo
      </button>
      <button
        id="btn-banner-activate-this"
        onClick={onActivateThis}
        className="px-2.5 py-1 rounded bg-[#2a2215] hover:bg-[#382c1b] border border-[#d4af37] text-[#d4af37] text-[11px] font-serif font-bold cursor-pointer"
      >
        Ativar este
      </button>
    </div>
  </div>
);
