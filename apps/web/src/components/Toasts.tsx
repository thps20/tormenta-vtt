import { AlertTriangle, Info, X } from "lucide-react";
import { useUi } from "../store/ui";
import { FLOAT_SURFACE, MOTION } from "./MapBar";

/** Avisos no canto inferior direito (ex.: servidor rejeitou uma mudança). */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          // Erro: superfície neutra com filete e ícone em --danger (nunca texto sobre fundo colorido).
          className={`flex items-start gap-2.5 p-3 text-13 text-text ${FLOAT_SURFACE} ${t.kind === "error" ? "border-danger/70" : ""}`}
        >
          {t.kind === "error" ? (
            <AlertTriangle className="w-4 h-4 mt-px shrink-0 text-danger" />
          ) : (
            <Info className="w-4 h-4 mt-px shrink-0 text-text-muted" />
          )}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Fechar aviso"
            className={`focus-ring -m-1 grid place-items-center w-6 h-6 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
