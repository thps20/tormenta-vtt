import React, { useState } from "react";
import { Crown, Copy, Check, Users, MapPin, LogOut, Settings } from "lucide-react";
import type { Participant, RoomPublic, Scene } from "@tormenta-vtt/shared";
import { roomPath } from "../lib/router";

interface TopBarProps {
  room: RoomPublic;
  scene: Scene | null;
  participants: Participant[];
  me: Participant;
  onLeaveToLobby: () => void;
  /** Só o GM recebe este handler (botão "Configurar Mapa"). */
  onOpenMapConfig?: () => void;
  /** Botão de ficha ("Meu personagem" / "Fichas"), montado pela página. */
  characterMenu?: React.ReactNode;
  /** Seletor de mapa (`MapSelector`), montado pela página — só GM. Sem ele, mostra só o nome do mapa ativo. */
  mapSelector?: React.ReactNode;
}

export const TopBar: React.FC<TopBarProps> = ({ room, scene, participants, me, onLeaveToLobby, onOpenMapConfig, characterMenu, mapSelector }) => {
  const [copied, setCopied] = useState(false);
  const isGM = me.role === "gm";

  // Copia o link de convite dos jogadores (sem o segredo do GM).
  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${roomPath(room.inviteCode)}`);
    } catch {
      /* ignora */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const gm = participants.find((p) => p.role === "gm");
  const onlineCount = participants.filter((p) => p.connected).length;

  return (
    <header
      id="vtt-topbar"
      className="h-14 bg-[#1a1a1a] border-b border-[#2d2417] px-5 flex items-center justify-between select-none shadow-lg z-20 shrink-0"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded border border-[#d4af37] flex items-center justify-center bg-[#252525] shadow-inner shrink-0">
            <span className="text-[#d4af37] text-xs font-serif font-bold tracking-tighter">VTT</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="font-serif text-base md:text-lg font-bold tracking-wide text-[#d4af37] truncate">{room.name}</h1>
              <span className="px-2 py-0.5 rounded bg-[#252525] border border-[#3d3d3d] text-[10px] uppercase tracking-widest text-zinc-400 font-mono shrink-0">
                {room.systemId.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
              {mapSelector ?? (
                <span className="flex items-center gap-1 text-zinc-300">
                  <MapPin className="w-3.5 h-3.5 text-[#d4af37]" />
                  Mapa: {scene?.name ?? "Sem mapa"}
                </span>
              )}
              <span className="text-zinc-600">•</span>
              <button
                onClick={handleCopyInvite}
                title="Copiar link de convite para jogadores"
                className="group flex items-center gap-1 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <span className="text-zinc-400">CONVITE:</span>
                <code className="font-mono text-zinc-300 group-hover:text-[#d4af37] bg-[#252525] px-2 py-0.5 rounded text-[10px] border border-[#3d3d3d] uppercase tracking-wider">
                  {room.inviteCode}
                </code>
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 ml-0.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 ml-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {gm && (
          <div
            id="gm-indicator-badge"
            className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded bg-[#252525] border border-[#d4af37]/60 text-xs shadow-sm"
          >
            <Crown className="w-3.5 h-3.5 text-[#d4af37] shrink-0" />
            <span className="text-[#d4af37] text-[10px] uppercase tracking-widest font-serif font-bold">GM:</span>
            <span className="font-medium text-zinc-200">{gm.nickname}</span>
          </div>
        )}

        <div className="h-6 w-[1px] bg-[#2d2417] mx-1 hidden sm:block"></div>

        {/* Lista de participantes (avatares) */}
        <div className="flex items-center gap-2 pl-1">
          <div className="items-center gap-1.5 text-xs text-zinc-400 mr-1 hidden sm:flex font-mono">
            <Users className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px]">
              {onlineCount}/{participants.length}
            </span>
          </div>

          <div className="flex items-center -space-x-2">
            {participants.map((player) => {
              const isGm = player.role === "gm";
              const isCurrent = player.id === me.id;
              return (
                <div
                  key={player.id}
                  id={`participant-avatar-${player.id}`}
                  title={`${player.nickname} (${isGm ? "GM" : "Jogador"})${player.connected ? " - Online" : " - Offline"}`}
                  className={`relative group transition-transform hover:scale-110 hover:z-30 ${
                    player.connected ? "opacity-100" : "opacity-40 grayscale"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg ${
                      isGm
                        ? "border-2 border-[#d4af37] bg-zinc-800 text-[#d4af37] font-serif z-20"
                        : isCurrent
                          ? "border-2 border-blue-500 bg-zinc-700 text-blue-200"
                          : "border border-[#3d3d3d] bg-zinc-700 text-zinc-300"
                    }`}
                  >
                    {isGm ? "GM" : player.nickname.charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[#1a1a1a] ${
                      player.connected ? "bg-green-500" : "bg-zinc-600"
                    }`}
                  />
                  <div className="absolute right-0 top-10 pointer-events-none hidden group-hover:flex flex-col items-center z-40">
                    <div className="bg-[#0c0c0c] border border-[#2d2417] text-[11px] text-zinc-200 px-2 py-1 rounded shadow-xl whitespace-nowrap">
                      <span className="font-semibold">{player.nickname}</span>
                      {isGm && <span className="ml-1 text-[#d4af37] text-[10px] font-serif font-bold">[GM]</span>}
                      {isCurrent && <span className="ml-1 text-blue-400 text-[10px]">(Você)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-2">
          {characterMenu}
          {isGM && onOpenMapConfig && (
            <button
              id="btn-topbar-map-config"
              onClick={onOpenMapConfig}
              title="Configurar imagem do mapa e grid (apenas GM)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2d2417] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-200 hover:text-[#d4af37] text-xs font-serif font-bold transition-colors cursor-pointer shadow-sm"
            >
              <Settings className="w-3.5 h-3.5 text-[#d4af37]" />
              <span className="hidden md:inline">Configurar Mapa</span>
            </button>
          )}

          <button
            id="btn-topbar-leave-lobby"
            onClick={onLeaveToLobby}
            title="Voltar ao Lobby"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-300 hover:text-[#d4af37] text-xs font-serif font-semibold transition-colors cursor-pointer shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lobby</span>
          </button>
        </div>
      </div>
    </header>
  );
};
