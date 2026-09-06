import React, { useState } from "react";
import { Swords, Crown, Copy, Check, LogIn, PlusCircle, ArrowRight, Dices, KeyRound } from "lucide-react";
import { createRoom } from "../lib/api";
import { navigate, roomPath } from "../lib/router";
import { getLastNickname, setLastNickname, setSessionToken } from "../lib/session";
import { useRoom } from "../store/room";

/**
 * Tela inicial: criar sala (vira GM) ou entrar com código (vira jogador).
 * A sala é criada no servidor (POST /api/rooms); o código vem de lá.
 */
export const Lobby: React.FC = () => {
  const lastNick = getLastNickname();

  // Criar sala
  const [roomName, setRoomName] = useState("");
  const [createNickname, setCreateNickname] = useState(lastNick);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; gmSecret: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Entrar
  const [joinNickname, setJoinNickname] = useState(lastNick);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleCreateRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = roomName.trim();
    const nickname = createNickname.trim();
    if (!name) return setCreateError("Dê um nome para a sala.");
    if (!nickname) return setCreateError("Informe seu nickname.");
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createRoom({ name, nickname });
      // Guarda a sessão do GM para o room:join reconectar como o mesmo participante.
      setSessionToken(res.room.inviteCode, "gm", res.sessionToken);
      setLastNickname(nickname);
      setCreated({ code: res.room.inviteCode, gmSecret: res.gmSecret });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Não foi possível criar a sala");
    } finally {
      setCreating(false);
    }
  };

  const handleProceedToCreatedRoom = () => {
    if (created) navigate(roomPath(created.code, created.gmSecret));
  };

  const handleJoinRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nickname = joinNickname.trim();
    const code = joinCode.trim().toUpperCase();
    if (!nickname) return setJoinError("Por favor, informe seu nickname.");
    if (!code) return setJoinError("Por favor, informe o código da sala.");
    setJoinError(null);
    // Inicia o join já com o nickname; a página da sala vê que está em andamento e não repete.
    void useRoom.getState().join({ inviteCode: code, gmSecret: null, nickname });
    navigate(roomPath(code));
  };

  const copyToClipboard = async (text: string, isLink: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* sem clipboard: o input é selecionável */
    }
    if (isLink) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  const inviteLink = created ? `${window.location.origin}${roomPath(created.code)}` : "";

  const inputClass =
    "w-full bg-[#1a1a1a] border border-[#2d2417] rounded px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#d4af37] transition-colors";
  const labelClass = "block text-xs font-serif font-medium text-zinc-300 mb-1.5";

  return (
    <div
      id="lobby-screen"
      className="h-screen w-full bg-[#0c0c0c] text-zinc-100 flex flex-col items-center justify-between p-4 sm:p-6 lg:p-10 select-none overflow-y-auto"
    >
      <header className="w-full max-w-5xl flex flex-col items-center text-center mt-2 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded border border-[#d4af37]/60 bg-[#1a1a1a] flex items-center justify-center shadow-lg shadow-black/60">
            <Swords className="w-5 h-5 text-[#d4af37]" />
          </div>
          <span className="text-[11px] font-mono tracking-widest text-[#d4af37] uppercase border-y border-[#2d2417] py-0.5 px-2">
            VIRTUAL TABLETOP
          </span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-serif font-black tracking-wider text-zinc-100 flex items-center justify-center gap-3">
          TORMENTA <span className="text-[#d4af37]">VTT</span>
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-zinc-400 font-sans max-w-lg">Mesa Virtual de RPG • Tormenta20</p>
        <div className="w-24 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/50 to-transparent mt-4" />
      </header>

      <main className="w-full max-w-5xl flex-1 flex flex-col gap-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Card 1: Criar Sala */}
          <div id="card-create-room" className="rounded bg-[#141414] border border-[#2d2417] p-5 sm:p-6 shadow-2xl relative flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#2d2417] mb-5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded bg-[#1a1a1a] border border-[#2d2417] text-[#d4af37]">
                  <Crown className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-serif font-bold text-zinc-100 tracking-wide">Criar Sala</h2>
                  <p className="text-[11px] text-zinc-400">Inicie uma nova mesa como Mestre (GM)</p>
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#1a1a1a] text-[#d4af37] border border-[#2d2417]">
                GM
              </span>
            </div>

            {!created ? (
              <form onSubmit={handleCreateRoomSubmit} className="space-y-4">
                <div>
                  <label htmlFor="create-room-name" className={labelClass}>
                    Nome da Sala
                  </label>
                  <input
                    id="create-room-name"
                    type="text"
                    value={roomName}
                    onChange={(e) => {
                      setRoomName(e.target.value);
                      setCreateError(null);
                    }}
                    placeholder="Ex: A Fortaleza dos Reis Antigos"
                    maxLength={80}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="create-nickname" className={labelClass}>
                    Seu Nickname
                  </label>
                  <input
                    id="create-nickname"
                    type="text"
                    value={createNickname}
                    onChange={(e) => {
                      setCreateNickname(e.target.value);
                      setCreateError(null);
                    }}
                    placeholder="Ex: Mestre Arton"
                    maxLength={32}
                    className={inputClass}
                  />
                  {createError && <p className="mt-1.5 text-xs text-red-400">{createError}</p>}
                </div>
                <div className="pt-2">
                  <button
                    id="btn-submit-create-room"
                    type="submit"
                    disabled={creating}
                    className="w-full py-2.5 px-4 rounded bg-[#2d2417] hover:bg-[#3d3222] border border-[#d4af37]/60 hover:border-[#d4af37] text-[#d4af37] hover:text-amber-200 font-serif font-bold text-xs tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50"
                  >
                    <PlusCircle className="w-4 h-4" />
                    {creating ? "Criando..." : "Criar Sala"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded bg-[#1a1a1a] border border-[#2d2417]">
                  <span className="text-[11px] font-serif uppercase tracking-wider text-zinc-400 block mb-1">Código da Sala</span>
                  <div className="flex items-center justify-between">
                    <span id="display-created-code" className="text-2xl font-mono font-black tracking-widest text-[#d4af37]">
                      {created.code}
                    </span>
                    <CopyButton copied={copiedCode} onClick={() => copyToClipboard(created.code, false)} />
                  </div>
                </div>

                <div className="p-3 rounded bg-[#1a1a1a] border border-[#2d2417]">
                  <span className="text-[11px] font-serif uppercase tracking-wider text-zinc-400 block mb-1">
                    Link de Convite (jogadores)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteLink}
                      className="flex-1 bg-[#141414] border border-[#2d2417] rounded px-2.5 py-1.5 text-xs font-mono text-zinc-300 select-all focus:outline-none"
                    />
                    <CopyButton copied={copiedLink} onClick={() => copyToClipboard(inviteLink, true)} />
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1.5">
                    Sua URL de GM contém um segredo. Não compartilhe a URL do seu navegador, só este link.
                  </p>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    id="btn-enter-created-room"
                    type="button"
                    onClick={handleProceedToCreatedRoom}
                    className="flex-1 py-2.5 px-4 rounded bg-[#d4af37] hover:bg-[#e0bc46] text-black font-serif font-bold text-xs tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-black/80 cursor-pointer"
                  >
                    <span>Entrar na Mesa</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Entrar em Sala */}
          <div id="card-join-room" className="rounded bg-[#141414] border border-[#2d2417] p-5 sm:p-6 shadow-2xl relative flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#2d2417] mb-5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded bg-[#1a1a1a] border border-[#2d2417] text-[#d4af37]">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-serif font-bold text-zinc-100 tracking-wide">Entrar em Sala</h2>
                  <p className="text-[11px] text-zinc-400">Acesse uma mesa em andamento com seu código</p>
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#1a1a1a] text-zinc-400 border border-[#2d2417]">
                Jogador
              </span>
            </div>

            <form onSubmit={handleJoinRoomSubmit} className="space-y-4">
              <div>
                <label htmlFor="join-nickname" className={labelClass}>
                  Seu Nickname
                </label>
                <input
                  id="join-nickname"
                  type="text"
                  value={joinNickname}
                  onChange={(e) => {
                    setJoinNickname(e.target.value);
                    setJoinError(null);
                  }}
                  placeholder="Ex: Valerius, o Paladino"
                  maxLength={32}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="join-code" className={labelClass}>
                  Código da Sala
                </label>
                <input
                  id="join-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setJoinError(null);
                  }}
                  placeholder="Ex: T7KQ2M"
                  maxLength={10}
                  className={`${inputClass} font-mono tracking-widest text-[#d4af37] uppercase`}
                />
              </div>
              {joinError && <p className="text-xs text-red-400">{joinError}</p>}
              <div className="pt-2">
                <button
                  id="btn-submit-join-room"
                  type="submit"
                  className="w-full py-2.5 px-4 rounded bg-[#1a1a1a] hover:bg-[#252525] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-200 hover:text-[#d4af37] font-serif font-bold text-xs tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  Entrar na Sala
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-5xl text-center mt-8 py-3 border-t border-[#2d2417]/50 text-[11px] text-zinc-500 font-sans flex items-center justify-center gap-1.5">
        <Dices className="w-3.5 h-3.5 text-[#d4af37]" />
        <span>Sem cadastro: sua sessão fica salva neste navegador.</span>
      </footer>
    </div>
  );
};

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded bg-[#252525] hover:bg-[#2e2e2e] border border-[#3d3d3d] text-xs font-serif text-zinc-200 hover:text-[#d4af37] transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copiado</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copiar</span>
        </>
      )}
    </button>
  );
}
