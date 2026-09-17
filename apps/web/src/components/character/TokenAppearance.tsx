import React, { useMemo, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { normalizeTokenCells, resolveTokenDefaults, type SystemDefinition, type TokenDefaults } from "@tormenta-vtt/shared";
import { uploadImage } from "../../lib/api";
import { fmtUnit } from "../../lib/format";
import { toast } from "../../store/ui";
import { TOKEN_COLORS } from "../TokenInspector";

interface Props {
  def: SystemDefinition;
  /** `Character.tokenDefaults` cru (null = ainda não definida). */
  defaults: TokenDefaults | null;
  /** Nome da ficha: a miniatura sem imagem desenha a inicial, igual ao token no mapa. */
  name: string;
  isEditMode: boolean;
  onChange: (next: TokenDefaults) => void;
}

/**
 * Aparência que a ficha usa ao virar token no mapa (SPEC §9.30): miniatura + imagem, tamanho em
 * células e cor. Usado no cabeçalho da ficha e na ficha rápida do NPC — os dois editam o MESMO
 * `tokenDefaults` por `character:update`, sem evento novo.
 *
 * Os tamanhos oferecidos saem de `def.sizes[].tokenCells` (Regra nº 1: nada de "Médio = 1" no
 * código); sistema sem portes declarados cai numa escada genérica de células.
 */
export const TokenAppearance: React.FC<Props> = ({ def, defaults, name, isEditMode, onChange }) => {
  const appearance = resolveTokenDefaults(defaults);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /** Uma opção por TAMANHO distinto (dois portes com o mesmo `tokenCells` viram uma linha só). */
  const sizeOptions = useMemo(() => {
    const byCells = new Map<number, string>();
    for (const size of def.sizes) {
      const cells = normalizeTokenCells(size.tokenCells);
      if (!byCells.has(cells)) byCells.set(cells, size.label);
    }
    if (byCells.size === 0) for (const cells of [0.5, 1, 2, 3, 4]) byCells.set(cells, "");
    if (!byCells.has(appearance.cells)) byCells.set(appearance.cells, "");
    return [...byCells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([cells, label]) => ({ cells, label: `${fmtUnit(cells)} célula${cells > 1 ? "s" : ""}${label ? ` · ${label}` : ""}` }));
  }, [def.sizes, appearance.cells]);

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onChange({ ...appearance, imageUrl: res.url });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2" id="token-appearance">
      <div
        title={`Aparência no mapa: ${fmtUnit(appearance.cells)} célula${appearance.cells > 1 ? "s" : ""}`}
        className="w-10 h-10 shrink-0 rounded-full bg-[#1e1e1e] overflow-hidden flex items-center justify-center text-xs font-serif font-bold text-zinc-200"
        style={{ boxShadow: `0 0 0 2px ${appearance.color}` }}
      >
        {appearance.imageUrl ? (
          <img src={appearance.imageUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        ) : (
          (name.charAt(0) || "?").toUpperCase()
        )}
      </div>

      {isEditMode && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleImage(e.target.files?.[0])} />
          <button
            type="button"
            id="btn-token-appearance-image"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#3d3d3d] hover:border-[#d4af37] text-[10px] text-zinc-300 hover:text-[#d4af37] cursor-pointer disabled:opacity-50"
            title="Imagem do token (não é o retrato da ficha)"
          >
            <ImagePlus className="w-3 h-3" />
            {uploading ? "Enviando…" : appearance.imageUrl ? "Trocar" : "Enviar"}
          </button>
          {appearance.imageUrl && (
            <button
              type="button"
              onClick={() => onChange({ ...appearance, imageUrl: null })}
              className="text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer"
            >
              remover
            </button>
          )}
          <select
            id="token-appearance-cells"
            value={appearance.cells}
            onChange={(e) => onChange({ ...appearance, cells: Number(e.target.value) })}
            title="Tamanho do token, em células do grid"
            className="bg-[#141414] border border-[#2d2417] rounded px-1.5 py-0.5 text-[10px] text-zinc-200 focus:outline-none focus:border-[#d4af37]"
          >
            {sizeOptions.map((o) => (
              <option key={o.cells} value={o.cells}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {TOKEN_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => onChange({ ...appearance, color: c })}
                title={`Cor do token: ${c}`}
                className={`w-3.5 h-3.5 rounded-full border cursor-pointer ${appearance.color === c ? "border-white scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
