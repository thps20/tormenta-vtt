import { AlertTriangle, Info, X } from "lucide-react";
import { useUi } from "../store/ui";

/** Avisos no canto inferior direito (ex.: servidor rejeitou uma mudança). */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 p-3 rounded border text-xs shadow-2xl ${
            t.kind === "error"
              ? "bg-red-950/90 border-red-800 text-red-100"
              : "bg-[#1a1a1a]/95 border-[#2d2417] text-zinc-200"
          }`}
        >
          {t.kind === "error" ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          ) : (
            <Info className="w-4 h-4 shrink-0 text-[#d4af37]" />
          )}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-zinc-400 hover:text-zinc-100 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
