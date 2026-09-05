import React, { useRef, useState } from "react";
import { Eye, EyeOff, ImagePlus, Trash2, User, X } from "lucide-react";
import type { Participant, Token, TokenPatch } from "@tormenta-vtt/shared";
import { uploadImage } from "../lib/api";
import { toast } from "../store/ui";

/** Paleta de cores para tokens (só visual, não é regra de sistema). */
export const TOKEN_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#9333ea", "#d97706", "#0891b2", "#d4af37", "#71717a"];

interface TokenInspectorProps {
  token: Token;
  participants: Participant[];
  me: Participant;
  onPatch: (patch: TokenPatch) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Painel do token selecionado. GM edita tudo (nome, cor, dono, visibilidade,
 * imagem); o dono pode apagar; os demais só leem.
 */
export const TokenInspector: React.FC<TokenInspectorProps> = ({ token, participants, me, onPatch, onDelete, onClose }) => {
  const isGm = me.role === "gm";
  const canDelete = isGm || token.ownerId === me.id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState(token.name);

  // Se outro cliente renomear, acompanha (padrão "estado derivado" do React).
  const [prevName, setPrevName] = useState(token.name);
  if (prevName !== token.name) {
    setPrevName(token.name);
    setName(token.name);
  }

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== token.name) onPatch({ id: token.id, name: trimmed });
    else setName(token.name);
  };

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onPatch({ id: token.id, imageUrl: res.url });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ownerName = token.ownerId ? (participants.find((p) => p.id === token.ownerId)?.nickname ?? "Jogador") : "Apenas GM";

  return (
    <div id="token-inspector-overlay" className="absolute top-4 left-4 z-10 w-64 p-3 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-200">
      <div className="flex items-center justify-between border-b border-[#2d2417] pb-2 mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-4 h-4 rounded-full border border-[#d4af37] shrink-0" style={{ backgroundColor: token.color }} />
          {isGm ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              maxLength={64}
              className="flex-1 min-w-0 bg-transparent text-xs font-serif font-bold text-[#d4af37] tracking-wide focus:outline-none border-b border-transparent focus:border-[#d4af37]"
            />
          ) : (
            <span className="text-xs font-serif font-bold text-[#d4af37] tracking-wide truncate">{token.name}</span>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer" title="Fechar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 text-xs">
        <Row label="Posição">
          <span className="font-mono text-zinc-300 text-[11px]">
            {Math.round(token.x)}, {Math.round(token.y)} • {Math.round(token.width)}×{Math.round(token.height)}
          </span>
        </Row>

        <Row label="Dono" icon={<User className="w-3.5 h-3.5 text-[#d4af37]" />}>
          {isGm ? (
            <select
              value={token.ownerId ?? ""}
              onChange={(e) => onPatch({ id: token.id, ownerId: e.target.value || null })}
              className="bg-[#141414] border border-[#2d2417] rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37] max-w-[140px]"
            >
              <option value="">Apenas GM</option>
              {participants
                .filter((p) => p.role === "player")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
            </select>
          ) : (
            <span className="text-zinc-300 text-[11px]">{ownerName}</span>
          )}
        </Row>

        {isGm && (
          <>
            <Row label="Cor">
              <div className="flex items-center gap-1">
                {TOKEN_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onPatch({ id: token.id, color: c })}
                    title={c}
                    className={`w-4 h-4 rounded-full border cursor-pointer ${token.color === c ? "border-white scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Row>

            <Row label="Visível">
              <button
                onClick={() => onPatch({ id: token.id, visible: !token.visible })}
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-serif font-bold cursor-pointer ${
                  token.visible ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "bg-[#252525] text-zinc-400 border-[#3d3d3d]"
                }`}
              >
                {token.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {token.visible ? "Todos veem" : "Só o GM"}
              </button>
            </Row>

            <Row label="Imagem">
              <div className="flex items-center gap-1">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleImage(e.target.files?.[0])} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-[10px] text-zinc-300 hover:text-[#d4af37] cursor-pointer disabled:opacity-50"
                >
                  <ImagePlus className="w-3 h-3" />
                  {uploading ? "Enviando…" : token.imageUrl ? "Trocar" : "Enviar"}
                </button>
                {token.imageUrl && (
                  <button onClick={() => onPatch({ id: token.id, imageUrl: null })} className="text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer">
                    remover
                  </button>
                )}
              </div>
            </Row>
          </>
        )}

        {canDelete && (
          <div className="pt-2 border-t border-[#2d2417]">
            <button
              onClick={() => {
                if (window.confirm(`Apagar o token "${token.name}"?`)) onDelete();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-red-900/60 text-red-400 hover:bg-red-950/40 text-[11px] font-serif font-bold cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Apagar token
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-400 flex items-center gap-1.5 shrink-0">
        {icon}
        {label}:
      </span>
      {children}
    </div>
  );
}
