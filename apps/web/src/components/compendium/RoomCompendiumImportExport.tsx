import React, { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Upload, X } from "lucide-react";
import { CompendiumEntrySchema, type RoomCompendiumImportResult } from "@tormenta-vtt/shared";
import { useCompendium } from "../../store/compendium";
import { toast } from "../../store/ui";
import { Dialog } from "../Dialog";

export interface RoomCompendiumImportExportProps {
  onClose: () => void;
}

/**
 * "Exportar"/"Importar" o compêndio da sala inteiro como um arquivo .json (docs/plano-compendio-sala.md,
 * decisão confirmada: só o homebrew do compêndio, não a sala inteira — mapas/tokens/handouts ficam
 * de fora). Sem rota HTTP nova: exportar é só texto, cabe numa resposta de socket normal
 * (compendium:room-export) — o Blob/download acontecem só aqui, no cliente.
 */
export const RoomCompendiumImportExport: React.FC<RoomCompendiumImportExportProps> = ({ onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [overwriteConflicts, setOverwriteConflicts] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<RoomCompendiumImportResult | null>(null);

  const exportRoom = async () => {
    setExporting(true);
    const entries = await useCompendium.getState().exportRoom();
    setExporting(false);
    if (!entries) return;
    if (entries.length === 0) {
      toast("A sala ainda não tem nenhum item homebrew pra exportar");
      return;
    }
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compendio-sala-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickFile = () => {
    setFileError(null);
    setResult(null);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (file: File) => {
    setFileError(null);
    setResult(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setFileError("Arquivo não é um JSON válido.");
      return;
    }
    const parsed = CompendiumEntrySchema.array().safeParse(raw);
    if (!parsed.success) {
      setFileError("Arquivo não tem o formato de um compêndio da sala exportado por aqui.");
      return;
    }
    setImporting(true);
    const outcome = await useCompendium.getState().importRoom(parsed.data, overwriteConflicts);
    setImporting(false);
    if (outcome) setResult(outcome);
  };

  return (
    <Dialog onClose={onClose} ariaLabel="Exportar/importar compêndio da sala" maxWidthClassName="max-w-sm">
      <div className="contents">
        <div className="shrink-0 flex items-start justify-between gap-2 p-3 border-b border-[#2d2417]">
          <div className="text-sm font-serif font-bold text-amber-200">Compêndio da sala</div>
          <button id="room-compendium-close" onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Fechar (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">Exportar</div>
            <p className="text-zinc-400 font-serif">Baixa um arquivo .json com todo o homebrew desta sala, pra levar a outra.</p>
            <button
              id="room-compendium-export"
              onClick={() => void exportRoom()}
              disabled={exporting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#1a1814] border border-zinc-700 text-zinc-200 hover:border-[#d4af37] hover:text-[#d4af37] cursor-pointer transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Baixar .json
            </button>
          </div>

          <div className="space-y-1.5 pt-3 border-t border-[#2d2417]">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-serif">Importar</div>
            <p className="text-zinc-400 font-serif">Traz o homebrew de um arquivo exportado de outra sala.</p>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-serif cursor-pointer select-none">
              <input id="room-compendium-overwrite" type="checkbox" checked={overwriteConflicts} onChange={(e) => setOverwriteConflicts(e.target.checked)} className="cursor-pointer" />
              Sobrescrever conflitos (id que já existe na sala)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFileChosen(file);
              }}
            />
            <button
              onClick={pickFile}
              disabled={importing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#1a1814] border border-zinc-700 text-zinc-200 hover:border-[#d4af37] hover:text-[#d4af37] cursor-pointer transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" /> {importing ? "Importando…" : "Escolher arquivo…"}
            </button>

            {fileError && (
              <div className="flex items-start gap-1.5 p-2 rounded bg-red-950/30 border border-red-900/40 text-red-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {fileError}
              </div>
            )}
            {result && (
              <div className="flex items-start gap-1.5 p-2 rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>
                    {result.imported} importada{result.imported === 1 ? "" : "s"}, {result.overwritten} sobrescrita{result.overwritten === 1 ? "" : "s"}, {result.skipped.length} pulada
                    {result.skipped.length === 1 ? "" : "s"}.
                  </div>
                  {result.skipped.length > 0 && (
                    <ul className="text-[10px] text-emerald-300/80 list-disc pl-4 space-y-0.5">
                      {result.skipped.map((s) => (
                        <li key={s.id}>
                          {s.name}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
