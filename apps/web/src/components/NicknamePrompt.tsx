import React, { useState } from "react";
import { LogIn } from "lucide-react";
import { getLastNickname } from "../lib/session";

/** Aparece ao abrir um link de convite sem sessão salva: pede só o nickname. */
export const NicknamePrompt: React.FC<{ inviteCode: string; error?: string; onSubmit: (nickname: string) => void }> = ({
  inviteCode,
  error,
  onSubmit,
}) => {
  const [nickname, setNickname] = useState(getLastNickname());
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0c0c0c] p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nickname.trim()) onSubmit(nickname.trim());
        }}
        className="w-full max-w-sm rounded bg-[#141414] border border-[#2d2417] p-6 shadow-2xl space-y-4"
      >
        <div>
          <h2 className="text-base font-serif font-bold text-zinc-100">Entrar na sala</h2>
          <p className="text-[11px] text-zinc-400 mt-1">
            Código <span className="font-mono text-[#d4af37]">{inviteCode}</span>. Como quer ser chamado?
          </p>
        </div>
        <input
          autoFocus
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={32}
          placeholder="Seu nickname"
          className="w-full bg-[#1a1a1a] border border-[#2d2417] rounded px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#d4af37]"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full py-2.5 rounded bg-[#d4af37] hover:bg-[#e0bc46] text-black font-serif font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogIn className="w-4 h-4" />
          Entrar
        </button>
      </form>
    </div>
  );
};
