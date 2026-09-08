import React, { useRef, useState } from "react";
import { BookOpen, Eye, EyeOff, Heart, ImagePlus, Sparkles, Trash2, User, X } from "lucide-react";
import type { Character, ConditionDef, Participant, Token, TokenPatch } from "@tormenta-vtt/shared";
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
  /** Fichas que este usuário pode vincular (GM: todas; jogador: as suas). */
  linkableCharacters: Character[];
  onLinkCharacter: (characterId: string | null) => void;
  onOpenCharacter: (characterId: string) => void;
  /** conditions[] do sistema da sala (ver SystemDefinitionSchema); vazio se o sistema ainda não carregou. */
  conditions: ConditionDef[];
  /** Abre o ConditionMenu (VttCanvas decide a posição a partir do clique). */
  onOpenConditions: (e: React.MouseEvent) => void;
}

/**
 * Painel do token selecionado. GM edita tudo (nome, cor, dono, visibilidade,
 * imagem); o dono pode apagar; os demais só leem.
 */
export const TokenInspector: React.FC<TokenInspectorProps> = ({
  token,
  participants,
  me,
  onPatch,
  onDelete,
  onClose,
  linkableCharacters,
  onLinkCharacter,
  onOpenCharacter,
  conditions,
  onOpenConditions,
}) => {
  const isGm = me.role === "gm";
  const canDelete = isGm || token.ownerId === me.id;
  const canLink = isGm || token.ownerId === me.id;
  // Ficha vinculada que este usuário não vê (ex.: NPC do GM): mostra sem deixar trocar.
  const linkedHidden = token.characterId !== null && !linkableCharacters.some((c) => c.id === token.characterId);
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

  // PV do token solto (sem ficha): só o GM edita, e só enquanto não há characterId
  // (com ficha vinculada, quem manda é o recurso tokenBar dela — ver ResourcesBlock).
  const [hpCurrent, setHpCurrent] = useState(String(token.hp?.current ?? 0));
  const [hpMax, setHpMax] = useState(String(token.hp?.max ?? 0));
  const [prevHp, setPrevHp] = useState(token.hp);
  if (prevHp !== token.hp) {
    setPrevHp(token.hp);
    setHpCurrent(String(token.hp?.current ?? 0));
    setHpMax(String(token.hp?.max ?? 0));
  }

  const commitHp = () => {
    const current = Math.trunc(Number(hpCurrent)) || 0;
    const max = Math.max(0, Math.trunc(Number(hpMax)) || 0);
    onPatch({ id: token.id, hp: { current, max } });
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
    <div id="token-inspector-overlay" className="absolute top-4 right-4 z-10 w-64 p-3 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-200">
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

        <Row label="Ficha" icon={<BookOpen className="w-3.5 h-3.5 text-[#d4af37]" />}>
          <div className="flex items-center gap-1 min-w-0">
            {canLink ? (
              <select
                id="token-character-select"
                value={linkedHidden ? "__hidden" : (token.characterId ?? "")}
                onChange={(e) => onLinkCharacter(e.target.value || null)}
                className="bg-[#141414] border border-[#2d2417] rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37] max-w-[120px]"
              >
                <option value="">Nenhuma</option>
                {linkedHidden && (
                  <option value="__hidden" disabled>
                    (ficha do GM)
                  </option>
                )}
                {linkableCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-zinc-300 text-[11px] truncate">
                {token.characterId ? (linkableCharacters.find((c) => c.id === token.characterId)?.name ?? "(ficha do GM)") : "Nenhuma"}
              </span>
            )}
            {token.characterId && !linkedHidden && (
              <button onClick={() => onOpenCharacter(token.characterId!)} className="text-[10px] text-[#d4af37] hover:underline cursor-pointer shrink-0" title="Abrir ficha">
                abrir
              </button>
            )}
          </div>
        </Row>

        {canLink && conditions.length > 0 && (
          <Row label="Condições" icon={<Sparkles className="w-3.5 h-3.5 text-[#d4af37]" />}>
            <button
              onClick={onOpenConditions}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-[10px] text-zinc-300 hover:text-[#d4af37] cursor-pointer"
            >
              {token.conditions.length > 0 ? `${token.conditions.length} ativa${token.conditions.length > 1 ? "s" : ""}` : "Nenhuma"}
            </button>
          </Row>
        )}

        {isGm && token.characterId === null && (
          <Row label="PV" icon={<Heart className="w-3.5 h-3.5 text-[#d4af37]" />}>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={hpCurrent}
                onChange={(e) => setHpCurrent(e.target.value)}
                onBlur={commitHp}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-12 bg-[#141414] border border-[#2d2417] rounded px-1 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37]"
                title="PV atual"
              />
              <span className="text-zinc-500">/</span>
              <input
                type="number"
                value={hpMax}
                onChange={(e) => setHpMax(e.target.value)}
                onBlur={commitHp}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-12 bg-[#141414] border border-[#2d2417] rounded px-1 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#d4af37]"
                title="PV máximo"
              />
              {token.hp && (
                <button
                  onClick={() => onPatch({ id: token.id, hp: null })}
                  title="Parar de rastrear PV deste token"
                  className="text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer"
                >
                  remover
                </button>
              )}
            </div>
          </Row>
        )}

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
