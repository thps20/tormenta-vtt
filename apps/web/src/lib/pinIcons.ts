import type { PinIconDef, SystemDefinition } from "@tormenta-vtt/shared";

/**
 * Ícone/cor de pino de nota (docs/plano-narracao.md): "da lista do JSON do sistema ou padrão".
 * Ícone de pino não é regra de RPG (nenhuma mecânica lê isto) — é mobília de UI, mesmo espírito de
 * `TOKEN_COLORS` em `TokenInspector.tsx` — por isso o padrão embutido mora aqui no web, não no JSON
 * do sistema (Regra nº 1 do CLAUDE.md é sobre REGRA de sistema; aparência de pino não é uma).
 */
const DEFAULT_PIN_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 3v18'/><path d='M4 4h13l-3 4 3 4H4'/></svg>";

/** Paleta padrão (sem `pinIcons` no sistema, ou pra além dos que o sistema já declara). */
export const DEFAULT_PIN_ICONS: PinIconDef[] = [
  { key: "flag", label: "Bandeira", icon: DEFAULT_PIN_ICON_SVG, color: "#d4af37" },
  {
    key: "eye",
    label: "Segredo",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z'/><circle cx='12' cy='12' r='3'/></svg>",
    color: "#a855f7",
  },
  {
    key: "warning",
    label: "Perigo",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3 2 20h20L12 3Z'/><line x1='12' y1='9' x2='12' y2='14'/><circle cx='12' cy='17' r='0.6' fill='currentColor'/></svg>",
    color: "#dc2626",
  },
  {
    key: "help",
    label: "Pista",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.3-.8.8-.8 1.4v.4'/><circle cx='12' cy='17' r='0.6' fill='currentColor'/></svg>",
    color: "#22d3ee",
  },
];

/** Lista efetiva: a do sistema primeiro (se houver), depois o padrão embutido. */
export function resolvePinIcons(def: SystemDefinition | null | undefined): PinIconDef[] {
  return [...(def?.pinIcons ?? []), ...DEFAULT_PIN_ICONS];
}

/** Acha o ícone escolhido por chave; `undefined` = usa o padrão embutido (primeiro da lista, "flag"). */
export function findPinIcon(icons: PinIconDef[], key: string | undefined): PinIconDef {
  return icons.find((i) => i.key === key) ?? DEFAULT_PIN_ICONS[0]!;
}
