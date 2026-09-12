import React, { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import type { NotesSearchResultItem } from "@tormenta-vtt/shared";
import { emitAck } from "../store/connection";
import { toast } from "../store/ui";

export interface NotesPanelTarget {
  kind: "scene" | "token";
  id: string;
  name: string;
}

export interface NotesPanelProps {
  target: NotesPanelTarget;
  /** Troca o alvo mostrado (clique num resultado da busca) — mesmo painel, sem fechar/reabrir. */
  onChangeTarget: (target: NotesPanelTarget) => void;
  /** Chamado sempre que o alvo é um mapa (inclusive ao trocar via busca), pra o canvas acompanhar. */
  onGoToScene: (sceneId: string) => void;
  onClose: () => void;
}

/**
 * Notas do Mestre (docs/plano-narracao.md), por mapa ou por token: o texto nunca vem no
 * Scene/Token normal (só `hasNotes: boolean`) — carregado sob demanda aqui (`scene:get-notes`/
 * `token:get-notes`) e salvo ao sair do campo (`scene:set-notes`/`token:set-notes`). Busca simples
 * (contains) na sala inteira no mesmo painel: clicar num resultado troca o alvo mostrado.
 */
export const NotesPanel: React.FC<NotesPanelProps> = ({ target, onChangeTarget, onGoToScene, onClose }) => {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NotesSearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const req = target.kind === "scene" ? emitAck("scene:get-notes", { sceneId: target.id }) : emitAck("token:get-notes", { tokenId: target.id });
    void req.then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        toast(res.error);
        setNotes("");
      } else {
        setNotes(res.data.notes);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.id]);

  const save = async (text: string) => {
    const res =
      target.kind === "scene" ? await emitAck("scene:set-notes", { sceneId: target.id, notes: text }) : await emitAck("token:set-notes", { tokenId: target.id, notes: text });
    if (!res.ok) toast(res.error);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    const res = await emitAck("notes:search", { query: q });
    setSearching(false);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    setResults(res.data.items);
  };

  const openResult = (item: NotesSearchResultItem) => {
    if (item.kind === "scene") {
      onGoToScene(item.sceneId);
      onChangeTarget({ kind: "scene", id: item.sceneId, name: item.name });
    } else {
      onGoToScene(item.sceneId);
      onChangeTarget({ kind: "token", id: item.tokenId, name: item.name });
    }
    setResults(null);
    setQuery("");
  };

  return (
    <div id="notes-panel" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col bg-[#14120f] border border-[#3d311f] rounded-lg shadow-2xl text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b border-[#2d2417] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">{target.kind === "scene" ? "Nota do mapa" : "Nota do token"}</div>
            <div className="font-serif font-bold text-sm text-amber-200 truncate" title={target.name}>
              {target.name}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2 border-b border-[#2d2417] shrink-0">
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
              placeholder="Buscar nas notas da sala…"
              className="flex-1 bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-[#d4af37]"
            />
            <button
              onClick={() => void runSearch()}
              disabled={!query.trim() || searching}
              className="p-1.5 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-300 hover:text-[#d4af37] disabled:opacity-40 cursor-pointer"
              title="Buscar"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          {results && (
            <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
              {results.length === 0 ? (
                <div className="text-[11px] text-zinc-500 italic px-1">Nada encontrado.</div>
              ) : (
                results.map((item) => (
                  <button
                    key={item.kind === "scene" ? `s-${item.sceneId}` : `t-${item.tokenId}`}
                    onClick={() => openResult(item)}
                    className="w-full text-left px-2 py-1.5 rounded bg-[#1a1713] hover:bg-[#25201a] border border-[#2d2417] cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="px-1 rounded bg-zinc-800 text-zinc-400 uppercase text-[9px] tracking-wide">{item.kind === "scene" ? "mapa" : "token"}</span>
                      <span className="font-semibold text-zinc-200 truncate">{item.name}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">{item.snippet}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="p-3 flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="text-xs text-zinc-500 italic">Carregando…</div>
          ) : (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void save(notes)}
              placeholder="Nada anotado ainda — só você vê isso."
              className="flex-1 w-full bg-[#0f0e0c] border border-[#2d2417] rounded px-2 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#d4af37] resize-none"
            />
          )}
        </div>
      </div>
    </div>
  );
};
