import React, { useState } from "react";
import { Crown, Copy, Check, Users, MapPin, NotebookText, Settings, Zap } from "lucide-react";
import type { Participant, RoomPublic, Scene } from "@tormenta-vtt/shared";
import { roomPath } from "../lib/router";
import { MOTION, TOP_BAR_BUTTON } from "./MapBar";

interface TopBarProps {
  room: RoomPublic;
  scene: Scene | null;
  participants: Participant[];
  me: Participant;
  /** "Sair para o Lobby" mora no menu ⋯ (montado pela página) — a barra não tem mais o botão. */
  /** Só o GM: engrenagem ao lado do nome do mapa (era o botão "Configurar Mapa" do lado direito). */
  onOpenMapConfig?: () => void;
  /** Só o GM, e só quando há mapa sendo visto (docs/plano-narracao.md, botão "Notas"). */
  onOpenMapNotes?: () => void;
  /** Botão de ficha ("Meu personagem" / "Fichas"), montado pela página. */
  characterMenu?: React.ReactNode;
  /** Seletor de mapa (`MapSelector`), montado pela página — só GM. Sem ele, mostra só o nome do mapa ativo. */
  mapSelector?: React.ReactNode;
  /** Menu "⋯" do fim da barra (`TopBarOverflowMenu`): preparar (Handouts, Acervo, Preparo) e sistema
   *  (Lobby). Os diálogos de Handouts/Acervo continuam montados pela página, fora daqui. */
  overflowMenu?: React.ReactNode;
  /** Abre o criador de macro (docs/SPEC.md §9.20) — GM e jogador, é preferência pessoal. */
  onOpenMacros?: () => void;
  /** Botões de Handouts/Acervo viraram itens do ⋯; os componentes (diálogos) são montados pela
   *  página e entram aqui só pra continuarem no DOM enquanto abertos. */
  hiddenSelectors?: React.ReactNode;
  /** Botão "Cast" (`CastMenu`, docs/plano-cast.md §5), montado pela página — só GM. */
  castMenu?: React.ReactNode;
  /** Player da trilha tocando agora (`AudioPlayer`, docs/plano-preparo.md §3.3) — só GM, só
   *  quando há trilha (a página decide `undefined` quando não há nada tocando). */
  audioPlayer?: React.ReactNode;
  /** Botão de volume (`VolumeControl`, docs/plano-preparo.md §3.3) — todo mundo, sempre montado. */
  volumeControl?: React.ReactNode;
}

export const TopBar: React.FC<TopBarProps> = ({
  room,
  scene,
  participants,
  me,
  onOpenMapConfig,
  onOpenMapNotes,
  characterMenu,
  mapSelector,
  overflowMenu,
  hiddenSelectors,
  onOpenMacros,
  castMenu,
  audioPlayer,
  volumeControl,
}) => {
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
      className="font-ui h-14 bg-surface-1 border-b border-border px-5 flex items-center justify-between gap-4 select-none z-20 shrink-0"
    >
      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h1 className="font-title text-16 font-semibold uppercase tracking-[0.08em] text-text truncate">{room.name}</h1>
          <span className="text-12 text-text-muted shrink-0">{room.systemId.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1 -ml-2 text-13 text-text-muted">
          {mapSelector ?? (
            <span className="flex items-center gap-1.5 h-7 px-2 text-text">
              <MapPin className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-text-muted">Mapa</span>
              <span className="font-title text-13 font-semibold uppercase tracking-[0.06em]">{scene?.name ?? "Sem mapa"}</span>
            </span>
          )}
          {/* Configurar Mapa mora onde o mapa está: engrenagem colada no nome (docs/SPEC.md §9.28). */}
          {isGM && onOpenMapConfig && (
            <button
              id="btn-topbar-map-config"
              onClick={onOpenMapConfig}
              title="Configurar imagem do mapa e grid (apenas GM)"
              aria-label="Configurar mapa"
              className={`focus-ring flex items-center justify-center h-7 w-7 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="w-px h-4 bg-border mx-1" aria-hidden />
          <button
            onClick={handleCopyInvite}
            title="Copiar link de convite para jogadores"
            className={`focus-ring group flex items-center gap-1.5 h-7 px-2 rounded-ui hover:bg-surface-2 cursor-pointer ${MOTION}`}
          >
            <span className="text-text-muted">Convite</span>
            <code className="font-data text-13 text-text tracking-wider">{room.inviteCode}</code>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success" aria-label="Copiado" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-text-muted group-hover:text-text" />
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {gm && (
          <div id="gm-indicator-badge" className="hidden md:flex items-center gap-1.5 text-13" title="Mestre da mesa">
            <Crown className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="text-text-muted">GM</span>
            <span className="font-medium text-text">{gm.nickname}</span>
          </div>
        )}

        <div className="h-6 w-px bg-border hidden sm:block" aria-hidden />

        {/* Lista de participantes (avatares) */}
        <div className="flex items-center gap-2">
          <div className="items-center gap-1 text-text-muted hidden sm:flex" title="Online / participantes">
            <Users className="w-3.5 h-3.5" />
            <span className="font-data text-12 tabular-nums">
              {onlineCount}/{participants.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {participants.map((player) => {
              const isGm = player.role === "gm";
              const isCurrent = player.id === me.id;
              return (
                <div
                  key={player.id}
                  id={`participant-avatar-${player.id}`}
                  title={`${player.nickname} (${isGm ? "GM" : "Jogador"})${player.connected ? " - Online" : " - Offline"}`}
                  className={`relative group ${player.connected ? "" : "opacity-45"}`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center bg-surface-2 text-12 font-semibold ${
                      isCurrent ? "border-2 border-text text-text" : "border border-border text-text-muted"
                    }`}
                  >
                    {isGm ? "GM" : player.nickname.charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-surface-1 ${player.connected ? "bg-success" : "bg-border"}`}
                  />
                  <div className="absolute right-0 top-10 pointer-events-none hidden group-hover:flex flex-col items-center z-40">
                    <div className="bg-surface-2 border border-border text-12 text-text px-2 py-1 rounded-ui shadow-float whitespace-nowrap">
                      <span className="font-semibold">{player.nickname}</span>
                      {isGm && <span className="ml-1 text-text-muted">[GM]</span>}
                      {isCurrent && <span className="ml-1 text-text-muted">(Você)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-1">
          {characterMenu}
          {castMenu}
          {audioPlayer}
          {volumeControl}
          {onOpenMacros && (
            <button
              id="btn-topbar-macros"
              onClick={onOpenMacros}
              title="Nova macro (barra na parte de baixo da tela, teclas 1-9 disparam as suas)"
              className={TOP_BAR_BUTTON}
            >
              <Zap className="w-3.5 h-3.5 text-text-muted" />
              <span className="hidden md:inline">Macros</span>
            </button>
          )}
          {isGM && onOpenMapNotes && scene && (
            <button
              id="btn-topbar-map-notes"
              onClick={onOpenMapNotes}
              title={scene.hasNotes ? "Notas do Mestre sobre este mapa (há notas; só você vê)" : "Notas do Mestre sobre este mapa (só você vê)"}
              className={`${TOP_BAR_BUTTON} relative`}
            >
              <NotebookText className="w-3.5 h-3.5 text-text-muted" />
              <span className="hidden md:inline">Notas</span>
              {/* Mapa com notas: ponto discreto no canto (antes o botão inteiro ficava dourado). */}
              {scene.hasNotes && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-text" aria-hidden />}
            </button>
          )}

          {overflowMenu}
          {hiddenSelectors}
        </div>
      </div>
    </header>
  );
};
