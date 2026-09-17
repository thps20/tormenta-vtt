import React, { useState } from "react";
import { Check, Loader2, RotateCcw, X } from "lucide-react";

export interface PrepRunItem {
  id: string;
  /** "▶ Tocar *Taverna* (loop)" etc. — já montada pelo chamador a partir de kind+options+nome. */
  description: string;
}

type ItemResult = { ok: boolean; error?: string };

/**
 * "Iniciar este passo" (docs/plano-preparo.md §2.3, com o ajuste do dono do projeto: o resumo é um
 * DIÁLOGO, não um toast). Três fases: confirmar a lista → executar em sequência (espera cada ack,
 * continua mesmo se uma falhar) → resumo com "Tentar de novo os que falharam". `runOne` executa UM
 * item (referência quebrada já chega aqui como uma falha pronta, motivo "Apagado do acervo" — quem
 * monta `items` decide isso antes de abrir o diálogo).
 */
export const PrepRunDialog: React.FC<{
  items: PrepRunItem[];
  runOne: (id: string) => Promise<ItemResult>;
  onFinished: (ranAtLeastOnce: boolean) => void;
}> = ({ items, runOne, onFinished }) => {
  const [phase, setPhase] = useState<"confirm" | "running" | "summary">("confirm");
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [ran, setRan] = useState(false);

  const runSequence = async (ids: string[]) => {
    setPhase("running");
    setRan(true);
    for (const id of ids) {
      const result = await runOne(id);
      setResults((r) => ({ ...r, [id]: result }));
    }
    setPhase("summary");
  };

  const close = () => onFinished(ran);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={phase === "running" ? undefined : close}>
      <div className="font-ui w-[420px] max-h-[70vh] bg-surface-1 border border-border rounded-ui shadow-float flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <h3 className="font-title font-bold text-sm text-text">
            {phase === "confirm" ? "Iniciar este passo?" : phase === "running" ? "Executando..." : "Resumo"}
          </h3>
          {phase !== "running" && (
            <button onClick={close} className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
          {items.length === 0 && <p className="text-sm text-text-muted">Nenhum item automático (⚡) neste passo.</p>}
          {items.map((item) => {
            const result = results[item.id];
            return (
              <div key={item.id} className="flex items-center gap-2 text-sm text-text">
                {phase === "confirm" && <span className="w-4 shrink-0" />}
                {phase !== "confirm" && !result && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-text-muted" />}
                {result?.ok && <Check className="w-4 h-4 shrink-0 text-success" />}
                {result && !result.ok && <X className="w-4 h-4 shrink-0 text-danger" />}
                <div className="min-w-0">
                  <p className="truncate">{item.description}</p>
                  {result && !result.ok && <p className="text-xs text-danger">{result.error ?? "Falhou"}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border shrink-0">
          {phase === "confirm" && (
            <>
              <button onClick={close} className="focus-ring px-3 py-1.5 rounded-ui text-sm text-text-muted hover:text-text cursor-pointer">
                Cancelar
              </button>
              <button
                disabled={items.length === 0}
                onClick={() => void runSequence(items.map((i) => i.id))}
                className="focus-ring px-3 py-1.5 rounded-ui bg-accent text-bg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Confirmar
              </button>
            </>
          )}
          {phase === "summary" && (
            <>
              {Object.values(results).some((r) => !r.ok) && (
                <button
                  onClick={() => void runSequence(items.filter((i) => results[i.id] && !results[i.id]!.ok).map((i) => i.id))}
                  className="focus-ring flex items-center gap-1.5 px-3 py-1.5 rounded-ui border border-border text-sm text-text hover:bg-surface-2 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Tentar de novo os que falharam
                </button>
              )}
              <button onClick={close} className="focus-ring px-3 py-1.5 rounded-ui bg-accent text-bg text-sm font-bold cursor-pointer">
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
