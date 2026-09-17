import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cast, Check, Copy, ExternalLink, Crosshair, Moon, RefreshCw, Unlink } from "lucide-react";
import type { DisplayCameraMode } from "@tormenta-vtt/shared";
import { displayPath } from "../../lib/router";
import { useRoom } from "../../store/room";
import { useCast } from "../../store/cast";
import { FLOAT_MENU, MOTION, TOP_BAR_BUTTON, pressedClass } from "../MapBar";

const MENU_WIDTH = 300;

const CAMERA_MODES: { key: DisplayCameraMode; label: string }[] = [
  { key: "follow", label: "Seguir o Mestre" },
  { key: "auto", label: "Automático" },
  { key: "free", label: "Livre" },
];

interface CastMenuProps {
  /** "Centralizar aqui" (docs/plano-cast.md §4.1): manda o enquadramento ATUAL do Mestre pra tela,
   *  em qualquer modo de câmera. Ausente (sem mapa aberto) = botão não aparece. */
  onCenterHere?: () => void;
}

/**
 * Botão "Cast" da TopBar (só GM, docs/plano-cast.md §5): cria/copia o link da tela de exibição,
 * modo de câmera, blackout, "Centralizar aqui" e a miniatura do que a tela está mostrando. Estado
 * de token/modo/blackout/miniatura vem de `store/cast.ts` (broadcast já sincroniza entre abas do
 * GM) — só `onCenterHere` precisa vir de fora (RoomPage é quem tem o enquadramento do `VttCanvas`).
 */
export const CastMenu: React.FC<CastMenuProps> = ({ onCenterHere }) => {
  const inviteCode = useRoom((s) => s.room?.inviteCode);
  const displayToken = useCast((s) => s.displayToken);
  const displayCount = useCast((s) => s.displayCount);
  const cameraMode = useCast((s) => s.cameraMode);
  const blackout = useCast((s) => s.blackout);
  const previewFrame = useCast((s) => s.previewFrame);
  const createLink = useCast((s) => s.createLink);
  const revokeLink = useCast((s) => s.revokeLink);
  const setCameraMode = useCast((s) => s.setCameraMode);
  const setBlackout = useCast((s) => s.setBlackout);
  const setPreviewWanted = useCast((s) => s.setPreviewWanted);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setPreviewWanted(true);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      setPreviewWanted(false);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - MENU_WIDTH - 4)), top: r.bottom + 4 });
    setOpen(true);
  };

  const link = inviteCode && displayToken ? `${window.location.origin}${displayPath(inviteCode, displayToken)}` : null;

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignora */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openNewWindow = () => {
    if (!link) return;
    window.open(link, "tvtt-cast", "popup,width=1280,height=720");
  };

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button id="btn-topbar-cast" type="button" onClick={toggleMenu} title="Cast: tela de exibição para a mesa" aria-expanded={open} className={`${TOP_BAR_BUTTON} relative`}>
        <Cast className="w-3.5 h-3.5 text-text-muted" />
        <span className="hidden md:inline">Cast</span>
        {displayCount > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-success" aria-hidden />}
      </button>

      {open &&
        createPortal(
          <div id="cast-menu" ref={menuRef} role="menu" style={{ position: "fixed", left: menuPos.left, top: menuPos.top, width: MENU_WIDTH }} className={`z-50 p-3 space-y-3 ${FLOAT_MENU}`}>
            {!link ? (
              <div className="flex flex-col gap-2">
                <p className="text-12 text-text-muted leading-snug">
                  Cria um link só de leitura pra uma segunda tela (TV, monitor deitado ou projetor sobre a mesa).
                </p>
                <button
                  type="button"
                  onClick={() => void createLink()}
                  className="w-full flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border border-border text-13 font-medium text-text hover:bg-surface-2 cursor-pointer focus-ring"
                >
                  <Cast className="w-3.5 h-3.5" />
                  Criar link de exibição
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border border-border text-13 font-medium text-text hover:bg-surface-2 cursor-pointer focus-ring"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copiado" : "Copiar link"}
                  </button>
                  <button
                    type="button"
                    onClick={openNewWindow}
                    title="Abrir em nova janela (arraste para o projetor)"
                    className="h-8 w-8 grid place-items-center rounded-ui border border-border text-text hover:bg-surface-2 cursor-pointer focus-ring"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-11 text-text-muted">{displayCount > 0 ? `${displayCount} tela${displayCount > 1 ? "s" : ""} conectada${displayCount > 1 ? "s" : ""}` : "Nenhuma tela conectada ainda"}</p>

                {previewFrame && (
                  <img src={previewFrame} alt="Miniatura da tela de exibição" className="w-full rounded-ui border border-border object-contain bg-black" />
                )}

                <div className="pt-2 border-t border-border space-y-1.5">
                  <span className="text-11 font-ui font-semibold text-text-muted uppercase tracking-wide">Modo de câmera</span>
                  <div className="flex gap-1">
                    {CAMERA_MODES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => void setCameraMode(m.key)}
                        className={`flex-1 h-7 rounded-ui border text-12 font-medium cursor-pointer ${MOTION} ${pressedClass(cameraMode === m.key)}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {onCenterHere && (
                  <button
                    type="button"
                    onClick={onCenterHere}
                    className="w-full flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border border-border text-13 font-medium text-text hover:bg-surface-2 cursor-pointer focus-ring"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    Centralizar aqui
                  </button>
                )}

                <div className="pt-2 border-t border-border flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setBlackout(!blackout)}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border text-13 font-medium cursor-pointer ${MOTION} ${pressedClass(blackout)}`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    {blackout ? "Reativar tela" : "Blackout"}
                  </button>
                </div>

                <div className="pt-2 border-t border-border flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void createLink()}
                    title="Gera um link novo; a tela atual desconecta"
                    className="flex-1 flex items-center justify-center gap-1.5 h-7 px-2 rounded-ui border border-border text-12 text-text hover:bg-surface-2 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Gerar novo link
                  </button>
                  <button
                    type="button"
                    onClick={() => void revokeLink()}
                    className="flex-1 flex items-center justify-center gap-1.5 h-7 px-2 rounded-ui border border-border text-12 text-danger hover:bg-surface-2 cursor-pointer"
                  >
                    <Unlink className="w-3 h-3" />
                    Revogar
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
