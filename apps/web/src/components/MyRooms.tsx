import React, { useEffect, useState } from "react";
import { Users, Map as MapIcon, Pencil, Check, X, RotateCcw, KeyRound, Copy, ClipboardPaste } from "lucide-react";
import type { MyRoom } from "@tormenta-vtt/shared";
import { adoptRoom, endMyRoom, listMyRooms, reopenMyRoom, renameMyRoom } from "../lib/api";
import { getOrCreateOwnerKey, getOwnerKey, setOwnerKey } from "../lib/ownerKey";
import { navigate, roomPath } from "../lib/router";

type Tab = "active" | "ended";

const cardClass = "rounded bg-[#141414] border border-[#2d2417] p-4 sm:p-5 shadow-2xl";
const inputClass =
  "w-full bg-[#1a1a1a] border border-[#2d2417] rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#d4af37] transition-colors";

/**
 * "Minhas mesas" (docs/SPEC.md §3.1): salas cujo ownerKey é o deste navegador. Fica escondida
 * (some silenciosamente) enquanto este navegador nunca criou/adotou nenhuma sala — `getOwnerKey`
 * devolve null e não faz sentido gastar uma chamada ao servidor.
 */
export const MyRooms: React.FC = () => {
  const [ownerKey, setOwnerKeyState] = useState(getOwnerKey());
  const [tab, setTab] = useState<Tab>("active");
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const key = getOwnerKey();
    setOwnerKeyState(key);
    if (!key) {
      setRooms([]);
      return;
    }
    try {
      setRooms(await listMyRooms(key, tab));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar suas mesas");
    }
  }, [tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const hasAnyRoom = ownerKey !== null;

  return (
    <div className={`${cardClass} w-full max-w-5xl`}>
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[#2d2417] mb-4">
        <h2 className="text-sm sm:text-base font-serif font-bold text-zinc-100 tracking-wide">Minhas Mesas</h2>
        <OwnerKeyActions onImported={() => void reload()} />
      </div>

      {hasAnyRoom && (
        <div className="flex gap-2 mb-4">
          {(["active", "ended"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-xs font-serif uppercase tracking-wider cursor-pointer border transition-colors ${
                tab === t
                  ? "bg-[#2d2417] border-[#d4af37]/60 text-[#d4af37]"
                  : "bg-transparent border-[#2d2417] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "active" ? "Ativas" : "Encerradas"}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {hasAnyRoom && rooms !== null && rooms.length === 0 && (
        <p className="text-xs text-zinc-500 mb-4">
          {tab === "active" ? "Nenhuma mesa ativa neste navegador ainda." : "Nenhuma mesa encerrada."}
        </p>
      )}

      {!hasAnyRoom && (
        <p className="text-xs text-zinc-500 mb-4">
          Crie uma sala ou adicione uma mesa que você já tem — elas aparecem aqui.
        </p>
      )}

      {rooms !== null && rooms.length > 0 && (
        <ul className="space-y-2 mb-5">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} tab={tab} onChanged={() => void reload()} />
          ))}
        </ul>
      )}

      <AdoptRoomForm onAdopted={() => void reload()} />
    </div>
  );
};

function RoomRow({ room, tab, onChanged }: { room: MyRoom; tab: Tab; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === room.name) return setEditing(false);
    const ownerKey = getOwnerKey();
    if (!ownerKey) return;
    setBusy(true);
    try {
      await renameMyRoom(room.id, { ownerKey, name: trimmed });
      setEditing(false);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Não foi possível renomear");
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    const ownerKey = getOwnerKey();
    if (!ownerKey) return;
    setBusy(true);
    try {
      await reopenMyRoom(room.id, { ownerKey });
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Não foi possível reabrir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded bg-[#1a1a1a] border border-[#2d2417] p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className={`${inputClass} py-1`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  if (e.key === "Escape") {
                    setName(room.name);
                    setEditing(false);
                  }
                }}
              />
              <IconButton title="Salvar" onClick={() => void saveName()} disabled={busy}>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </IconButton>
              <IconButton
                title="Cancelar"
                onClick={() => {
                  setName(room.name);
                  setEditing(false);
                }}
              >
                <X className="w-3.5 h-3.5" />
              </IconButton>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-serif text-zinc-100">{room.name}</span>
              {tab === "active" && (
                <IconButton title="Renomear" onClick={() => setEditing(true)}>
                  <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                </IconButton>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500 font-mono">
            <span className="text-[#d4af37]/80 tracking-widest">{room.inviteCode}</span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {room.participantCount}
            </span>
            <span className="flex items-center gap-1">
              <MapIcon className="w-3 h-3" /> {room.mapCount}
            </span>
            <span>Atividade: {new Date(room.lastActivityAt).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {tab === "active" ? (
            <>
              <button
                type="button"
                onClick={() => navigate(roomPath(room.inviteCode, room.gmSecret))}
                className="px-3 py-1.5 rounded bg-[#2d2417] hover:bg-[#3d3222] border border-[#d4af37]/60 text-[#d4af37] text-xs font-serif uppercase tracking-wider cursor-pointer"
              >
                Abrir
              </button>
              <button
                type="button"
                onClick={() => setConfirmingEnd(true)}
                className="px-3 py-1.5 rounded bg-transparent hover:bg-red-950/40 border border-red-900/60 text-red-400 text-xs font-serif uppercase tracking-wider cursor-pointer"
              >
                Encerrar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void reopen()}
              disabled={busy}
              className="px-3 py-1.5 rounded bg-[#2d2417] hover:bg-[#3d3222] border border-[#d4af37]/60 text-[#d4af37] text-xs font-serif uppercase tracking-wider cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reabrir
            </button>
          )}
        </div>
      </div>

      {rowError && <p className="text-xs text-red-400 mt-2">{rowError}</p>}

      {confirmingEnd && (
        <EndRoomConfirm
          room={room}
          onCancel={() => setConfirmingEnd(false)}
          onEnded={() => {
            setConfirmingEnd(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function EndRoomConfirm({ room, onCancel, onEnded }: { room: MyRoom; onCancel: () => void; onEnded: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed === room.name;

  const confirm = async () => {
    const ownerKey = getOwnerKey();
    if (!ownerKey || !matches) return;
    setBusy(true);
    try {
      await endMyRoom(room.id, { ownerKey, confirmName: typed });
      onEnded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível encerrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded bg-[#0c0c0c] border border-red-900/50 space-y-2">
      <p className="text-xs text-zinc-300">
        Pra encerrar, digite o nome da mesa: <span className="text-zinc-100 font-serif">{room.name}</span>
      </p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} autoFocus />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!matches || busy}
          onClick={() => void confirm()}
          className="px-3 py-1.5 rounded bg-red-950/60 hover:bg-red-900/60 border border-red-800 text-red-300 text-xs font-serif uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Encerrar mesa
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded bg-transparent hover:bg-[#1a1a1a] border border-[#2d2417] text-zinc-400 text-xs font-serif uppercase tracking-wider cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function AdoptRoomForm({ onAdopted }: { onAdopted: () => void }) {
  const [open, setOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [gmSecret, setGmSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    const secret = gmSecret.trim();
    if (!code || !secret) return setError("Informe o código e o segredo de GM.");
    setBusy(true);
    setError(null);
    try {
      await adoptRoom({ inviteCode: code, gmSecret: secret, ownerKey: getOrCreateOwnerKey() });
      setInviteCode("");
      setGmSecret("");
      setOpen(false);
      onAdopted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar essa mesa");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-serif text-zinc-400 hover:text-[#d4af37] underline underline-offset-2 cursor-pointer"
      >
        + Adicionar mesa que já tenho
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="pt-3 border-t border-[#2d2417] space-y-2">
      <p className="text-xs text-zinc-400">
        Uma mesa criada neste navegador antes desta função (ou noutro navegador) some da lista até você
        adicioná-la de volta com o código e o segredo de GM (o mesmo da URL do Mestre).
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          placeholder="Código (ex: T7KQ2M)"
          maxLength={10}
          className={`${inputClass} max-w-[160px] font-mono uppercase`}
        />
        <input
          value={gmSecret}
          onChange={(e) => setGmSecret(e.target.value)}
          placeholder="Segredo de GM (da URL)"
          className={`${inputClass} flex-1 min-w-[200px] font-mono text-xs`}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-[#2d2417] hover:bg-[#3d3222] border border-[#d4af37]/60 text-[#d4af37] text-xs font-serif uppercase tracking-wider cursor-pointer disabled:opacity-50"
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded bg-transparent hover:bg-[#1a1a1a] border border-[#2d2417] text-zinc-400 text-xs font-serif uppercase tracking-wider cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Exportar/importar a identidade do Mestre (docs/SPEC.md §3.1, item 5): mover "Minhas mesas" pra
 *  outro navegador, ou recuperar depois de limpar os dados deste. */
function OwnerKeyActions({ onImported }: { onImported: () => void }) {
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState("");

  const copyKey = async () => {
    const key = getOrCreateOwnerKey();
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* sem clipboard: nada a fazer aqui */
    }
  };

  const importKey = () => {
    const trimmed = pasted.trim();
    if (trimmed.length < 16) return;
    setOwnerKey(trimmed);
    setPasted("");
    setImporting(false);
    onImported();
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => void copyKey()}
        title="Quem tiver esta chave vê e gerencia as mesmas mesas — trate como uma senha."
        className="text-[11px] font-serif text-zinc-400 hover:text-[#d4af37] flex items-center gap-1 cursor-pointer"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copiado" : "Copiar minha chave de Mestre"}
      </button>
      <button
        type="button"
        onClick={() => setImporting((v) => !v)}
        className="text-[11px] font-serif text-zinc-400 hover:text-[#d4af37] flex items-center gap-1 cursor-pointer"
      >
        <ClipboardPaste className="w-3 h-3" />
        Usar uma chave existente
      </button>
      {importing && (
        <div className="flex items-center gap-1.5 w-full">
          <KeyRound className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Cole sua chave de Mestre aqui"
            className={`${inputClass} py-1 text-xs font-mono`}
            onKeyDown={(e) => e.key === "Enter" && importKey()}
          />
          <IconButton title="Usar esta chave" onClick={importKey}>
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1 rounded hover:bg-[#252525] cursor-pointer disabled:opacity-50"
    >
      {children}
    </button>
  );
}
