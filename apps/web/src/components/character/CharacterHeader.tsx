import React from "react";
import { Award, Edit3, Eye, Shield, User, X } from "lucide-react";
import type { Character, CharacterPatch, ComputedCharacter, Participant, SystemDefinition } from "@tormenta-vtt/shared";
import { NumInput, Select, TextInput } from "./fields";

interface CharacterHeaderProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  participants: Participant[];
  me: Participant;
  canEdit: boolean;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onPatch: (patch: CharacterPatch) => void;
  onClose: () => void;
}

/**
 * Cabeçalho da ficha: identidade (avatar, nome, nível/XP), tipo e dono (só GM)
 * e os traços livres do sistema (traitFields[]: raça, origem, divindade...).
 */
export const CharacterHeader: React.FC<CharacterHeaderProps> = ({
  def,
  character,
  computed,
  participants,
  me,
  canEdit,
  isEditMode,
  onToggleEditMode,
  onPatch,
  onClose,
}) => {
  const isGm = me.role === "gm";
  const ownerName = character.ownerId ? (participants.find((p) => p.id === character.ownerId)?.nickname ?? "Jogador") : "Apenas GM";
  const nextLevelXp = def.level.xpTable?.[computed.level];

  const setTrait = (key: string, value: string) => onPatch({ traits: { ...character.traits, [key]: value } });

  return (
    <div className="bg-[#141414] border-b border-[#2d2417] p-4 text-zinc-100 relative">
      {/* Linha de cima: título, alternar edição e fechar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-5 h-5 text-[#d4af37] shrink-0" />
          <span className="text-xs uppercase tracking-widest text-[#d4af37] font-serif font-bold truncate">Ficha de Personagem • {def.name}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <button
              onClick={onToggleEditMode}
              id="btn-toggle-edit-mode"
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-serif font-bold transition-all cursor-pointer border ${
                isEditMode
                  ? "bg-[#d4af37] text-zinc-950 border-[#d4af37] shadow-[0_0_10px_rgba(212,175,55,0.3)]"
                  : "bg-[#1e1e1e] text-zinc-300 border-[#383838] hover:border-[#d4af37] hover:text-[#d4af37]"
              }`}
              title={isEditMode ? "Mudar para modo visualização" : "Mudar para modo edição"}
            >
              {isEditMode ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
              <span>{isEditMode ? "Visualizar" : "Editar"}</span>
            </button>
          )}

          <button onClick={onClose} id="btn-close-char-sheet" className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#262626] transition-colors cursor-pointer" title="Fechar ficha">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Identidade: avatar + nome + nível/XP */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-lg bg-[#1e1e1e] border-2 border-[#3d3220] overflow-hidden shadow-md flex items-center justify-center">
            {character.imageUrl ? (
              <img src={character.imageUrl} alt={character.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-[#d4af37]/60" />
            )}
          </div>
          {isEditMode && (
            <div className="mt-1">
              <TextInput
                value={character.imageUrl ?? ""}
                onCommit={(v) => onPatch({ imageUrl: v.trim() || null })}
                placeholder="URL da imagem"
                className="w-16 text-[9px] px-1"
                title="URL do avatar"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            {isEditMode ? (
              <TextInput
                id="sheet-name"
                value={character.name}
                onCommit={(name) => name.trim() && onPatch({ name: name.trim() })}
                className="text-lg font-serif font-bold text-[#d4af37] px-2 w-full max-w-sm"
                placeholder="Nome do personagem"
                maxLength={80}
              />
            ) : (
              <h2 className="text-xl font-serif font-bold text-[#d4af37] truncate tracking-wide">{character.name || "Herói sem nome"}</h2>
            )}

            <div className="flex items-center gap-2 shrink-0">
              {character.kind === "npc" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider font-serif font-bold">NPC</span>}
              <div
                className="flex items-center gap-1.5 bg-[#1e1912] border border-[#d4af37]/40 px-2.5 py-1 rounded shadow-sm"
                title={nextLevelXp !== undefined ? `Próximo nível: ${nextLevelXp.toLocaleString()} XP` : undefined}
              >
                <Award className="w-3.5 h-3.5 text-[#d4af37]" />
                <span className="text-xs font-serif font-bold text-amber-200">Nível {computed.level}</span>
                {def.level.xpTable && (
                  <>
                    <span className="text-zinc-500 text-xs">|</span>
                    <span className="text-xs font-mono text-zinc-300">{character.xp.toLocaleString()} XP</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Edição: nível, XP e (GM) tipo/dono */}
          {isEditMode && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
              <label className="flex items-center gap-1 text-zinc-400">
                Nível
                <NumInput id="sheet-level" value={character.level} onCommit={(v) => onPatch({ level: Math.max(0, Math.min(def.level.max, Math.floor(v ?? 0))) })} />
              </label>
              {def.level.xpTable && (
                <label className="flex items-center gap-1 text-zinc-400">
                  XP
                  <NumInput value={character.xp} onCommit={(v) => onPatch({ xp: Math.max(0, Math.floor(v ?? 0)) })} className="w-20" />
                </label>
              )}
              {isGm && (
                <>
                  <Select
                    value={character.kind}
                    onChange={(kind) => onPatch({ kind: kind === "npc" ? "npc" : "pc" })}
                    options={[
                      { value: "pc", label: "Personagem" },
                      { value: "npc", label: "NPC (só GM vê)" },
                    ]}
                    title="Tipo da ficha"
                  />
                  <Select
                    value={character.ownerId ?? ""}
                    onChange={(v) => onPatch({ ownerId: v || null })}
                    options={[{ value: "", label: "Dono: apenas GM" }, ...participants.filter((p) => p.role === "player").map((p) => ({ value: p.id, label: `Dono: ${p.nickname}` }))]}
                    title="Jogador que controla a ficha"
                  />
                </>
              )}
            </div>
          )}
          {!isEditMode && <div className="mt-1 text-[11px] text-zinc-500 font-serif">Dono: {ownerName}</div>}

          {/* Traços livres do sistema (raça, origem, divindade...) */}
          {def.traitFields.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2.5">
              {def.traitFields.map((trait) => {
                const val = character.traits[trait.key] ?? "";
                const display = trait.type === "enum" ? (trait.options?.find((o) => o.key === val)?.label ?? val) : val;
                return (
                  <div key={trait.key} className="flex flex-col bg-[#0f0f0f] border border-[#222] px-2 py-1 rounded min-w-0">
                    <span className="text-[10px] uppercase font-serif text-zinc-500 font-semibold tracking-wider">{trait.label}</span>
                    {isEditMode ? (
                      trait.type === "enum" ? (
                        <Select
                          value={val}
                          onChange={(v) => setTrait(trait.key, v)}
                          options={[{ value: "", label: "Selecione…" }, ...(trait.options ?? []).map((o) => ({ value: o.key, label: o.label }))]}
                          className="px-1"
                        />
                      ) : (
                        <TextInput value={val} onCommit={(v) => setTrait(trait.key, v)} className="px-1" maxLength={500} />
                      )
                    ) : (
                      <span className="text-xs font-serif text-zinc-200 truncate">{display || "—"}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
