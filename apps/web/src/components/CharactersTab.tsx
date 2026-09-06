import React, { useState } from "react";
import { BookOpen, Plus, Trash2, Users } from "lucide-react";
import type { Character, CharacterCreatePayload, Participant } from "@tormenta-vtt/shared";
import { canEditCharacter } from "../store/characters";

interface Props {
  characters: Character[];
  participants: Participant[];
  me: Participant;
  onOpen: (characterId: string) => void;
  onCreate: (payload: CharacterCreatePayload) => void;
  onDelete: (characterId: string) => void;
}

/** Aba "Fichas": lista + criação. GM vê todas; jogador vê as de personagem-jogador. */
export const CharactersTab: React.FC<Props> = ({ characters, participants, me, onOpen, onCreate, onDelete }) => {
  const isGm = me.role === "gm";
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"pc" | "npc">("pc");
  const [ownerId, setOwnerId] = useState<string>(isGm ? "" : me.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, kind: isGm ? kind : "pc", ownerId: isGm ? ownerId || null : me.id });
    setName("");
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-200">
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {characters.length === 0 ? (
          <div className="text-center py-10 text-zinc-600 text-xs font-serif">Nenhuma ficha ainda.</div>
        ) : (
          characters.map((c) => {
            const owner = c.ownerId ? participants.find((p) => p.id === c.ownerId)?.nickname : null;
            const mine = canEditCharacter(me, c);
            return (
              <div
                key={c.id}
                id={`character-row-${c.id}`}
                className={`flex items-center gap-2 px-2.5 py-2 rounded border cursor-pointer hover:bg-[#222] ${
                  mine ? "border-[#d4af37]/40 bg-[#2d2417]/20" : "border-[#2d2417] bg-black/20"
                }`}
                onClick={() => onOpen(c.id)}
              >
                <div className="w-7 h-7 rounded-full bg-[#252525] border border-[#3d3d3d] flex items-center justify-center text-[11px] font-serif font-bold text-[#d4af37] shrink-0">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full rounded-full object-cover" /> : c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-zinc-100 truncate">{c.name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    Nível {c.level} • {c.kind === "npc" ? "NPC" : owner ? owner : "sem dono"}
                  </div>
                </div>
                {c.kind === "npc" && <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase">NPC</span>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(c.id);
                  }}
                  className="p-1 text-zinc-500 hover:text-[#d4af37] cursor-pointer"
                  title="Abrir ficha"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                </button>
                {mine && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Apagar a ficha "${c.name}"?`)) onDelete(c.id);
                    }}
                    className="p-1 text-zinc-600 hover:text-red-400 cursor-pointer"
                    title="Apagar ficha"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="p-3 bg-[#121212] border-t border-[#2d2417] space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-widest font-serif font-bold">
          <Users className="w-3 h-3 text-[#d4af37]" /> Nova ficha
        </div>
        <div className="flex items-center gap-2">
          <input
            id="new-character-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do personagem"
            maxLength={80}
            className="flex-1 min-w-0 bg-[#1a1a1a] border border-[#3d3d3d] rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-[#d4af37] text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            id="btn-create-character"
            type="submit"
            disabled={!name.trim()}
            className="bg-[#2d2417] border border-[#d4af37] px-3 py-1.5 rounded-md text-xs text-[#d4af37] font-serif font-bold hover:bg-[#3d311f] disabled:opacity-40 cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Criar
          </button>
        </div>
        {isGm && (
          <div className="flex items-center gap-2 text-[11px]">
            <select value={kind} onChange={(e) => setKind(e.target.value === "npc" ? "npc" : "pc")} className="bg-[#1a1a1a] border border-[#3d3d3d] rounded px-1.5 py-1 text-zinc-200 focus:outline-none focus:border-[#d4af37]">
              <option value="pc">Personagem</option>
              <option value="npc">NPC (só GM vê)</option>
            </select>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="bg-[#1a1a1a] border border-[#3d3d3d] rounded px-1.5 py-1 text-zinc-200 focus:outline-none focus:border-[#d4af37] flex-1 min-w-0">
              <option value="">Dono: apenas GM</option>
              {participants
                .filter((p) => p.role === "player")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Dono: {p.nickname}
                  </option>
                ))}
            </select>
          </div>
        )}
      </form>
    </div>
  );
};
