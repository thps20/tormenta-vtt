import React, { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Plus, User } from "lucide-react";
import type { Character, Participant } from "@tormenta-vtt/shared";

interface CharacterMenuProps {
  me: Participant;
  participants: Participant[];
  /** Fichas visíveis para este usuário (o GM vê todas). */
  characters: Character[];
  onOpenCharacter: (characterId: string) => void;
  /** Jogador sem ficha: abre a gaveta no estado vazio. */
  onOpenEmpty: () => void;
  /** GM: leva ao formulário de nova ficha (aba Fichas do painel lateral). */
  onNewCharacter: () => void;
}

const btnClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#252525] hover:bg-[#2d2417] border border-[#3d3d3d] hover:border-[#d4af37] text-zinc-200 hover:text-[#d4af37] text-xs font-serif font-bold transition-colors cursor-pointer shadow-sm";

/**
 * Botão de ficha na barra superior.
 * Jogador: "Meu personagem" abre a própria ficha (ou o estado vazio para criar).
 * GM: "Fichas" abre um menu com todas as fichas da sala.
 */
export const CharacterMenu: React.FC<CharacterMenuProps> = ({ me, participants, characters, onOpenCharacter, onOpenEmpty, onNewCharacter }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (me.role !== "gm") {
    const mine = characters.find((c) => c.ownerId === me.id) ?? null;
    return (
      <button id="btn-my-character" onClick={() => (mine ? onOpenCharacter(mine.id) : onOpenEmpty())} title={mine ? `Abrir a ficha de ${mine.name}` : "Criar seu personagem"} className={btnClass}>
        <Avatar character={mine} />
        <span className="hidden md:inline">{mine ? mine.name : "Meu personagem"}</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button id="btn-characters-menu" onClick={() => setOpen((v) => !v)} title="Fichas da sala" className={btnClass}>
        <BookOpen className="w-3.5 h-3.5 text-[#d4af37]" />
        <span className="hidden md:inline">Fichas</span>
        <span className="text-[10px] font-mono px-1 rounded bg-[#141414] text-zinc-400">{characters.length}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id="characters-menu" className="absolute right-0 top-full mt-1 w-72 max-h-96 overflow-y-auto rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl z-40 text-zinc-200">
          {characters.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 font-serif">Nenhuma ficha na sala.</div>
          ) : (
            <ul className="py-1">
              {characters.map((c) => {
                const owner = c.ownerId ? participants.find((p) => p.id === c.ownerId)?.nickname : null;
                return (
                  <li key={c.id}>
                    <button
                      id={`menu-character-${c.id}`}
                      onClick={() => {
                        setOpen(false);
                        onOpenCharacter(c.id);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#252525] text-left cursor-pointer"
                    >
                      <Avatar character={c} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">{c.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate">
                          Nível {c.level} • {c.kind === "npc" ? "NPC" : (owner ?? "sem dono")}
                        </div>
                      </div>
                      {c.kind === "npc" && <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase">NPC</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            id="btn-menu-new-character"
            onClick={() => {
              setOpen(false);
              onNewCharacter();
            }}
            className="w-full flex items-center justify-center gap-1 px-3 py-2 border-t border-[#2d2417] text-xs text-[#d4af37] hover:bg-[#2d2417] font-serif font-bold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Nova ficha
          </button>
        </div>
      )}
    </div>
  );
};

const Avatar: React.FC<{ character: Character | null }> = ({ character }) => (
  <div className="w-5 h-5 rounded-full overflow-hidden border border-[#d4af37]/60 bg-zinc-800 flex items-center justify-center shrink-0 text-[9px] font-serif font-bold text-[#d4af37]">
    {character?.imageUrl ? <img src={character.imageUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : character ? character.name.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
  </div>
);
