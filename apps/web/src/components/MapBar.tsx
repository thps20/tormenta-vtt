import React from "react";

/**
 * Peças compartilhadas da camada sobre o mapa (identidade "grimório", docs/design/DESIGN.md):
 * barra de ferramentas, HUD inferior, barras secundárias (névoa, desenho, área), menus do HUD e
 * a barra superior. Uma peça só por tipo de controle, para todas as barras terem o mesmo peso.
 *
 * Regras que estas classes seguem:
 * - Superfície flutuante = surface-1 + filete de 1px + shadow-float (sombra com deslocamento).
 * - Dourado (accent) NÃO aparece aqui: "ligado"/"escolhido" é um pressionado neutro
 *   (surface-2 + texto pergaminho). O dourado fica para a ferramenta ativa, o turno e a ação
 *   principal — quem usa estas peças decide isso por fora.
 * - Texto nunca abaixo de 12px; Plex Sans (font-ui) na raiz de cada barra.
 */

/** Superfície de uma barra/painel flutuante sobre o mapa. */
export const FLOAT_SURFACE = "font-ui rounded-ui bg-surface-1 border border-border shadow-float text-text-muted";

/** Transição padrão das barras (120–180ms, ease-out). */
export const MOTION = "transition-colors duration-150 ease-out";

/** Botão da barra superior (Fichas, Macros, Notas, Configurar mapa). */
export const TOP_BAR_BUTTON = `focus-ring flex items-center gap-1.5 h-8 px-3 rounded-ui border border-border bg-surface-1 hover:bg-surface-2 text-13 font-medium text-text whitespace-nowrap cursor-pointer ${MOTION}`;

/** Popover/dropdown ancorado numa barra (menus do HUD, menu de fichas). */
export const FLOAT_MENU = `${FLOAT_SURFACE} text-text`;

/** Estado de um controle de alternância/segmento: pressionado neutro ou em repouso. */
export function pressedClass(pressed: boolean): string {
  return pressed
    ? "bg-surface-2 text-text border-border"
    : "border-transparent text-text-muted hover:bg-surface-2 hover:text-text";
}

/** `<kbd>` de atalho dentro de dicas. */
export const KBD = "px-1 rounded-sm bg-bg border border-border font-data text-12 leading-4 text-text-muted";

export function BarDivider({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  return orientation === "vertical" ? <div className="w-px h-5 bg-border mx-0.5 shrink-0" /> : <div className="h-px w-full bg-border my-0.5" />;
}

type IconType = React.ComponentType<{ className?: string }>;

/**
 * Grupo de botões mutuamente exclusivos (forma da névoa, tipo de traço, forma de área). O rótulo
 * some em telas menores que `lg`; o `title` continua dizendo o que é.
 */
export function BarSegmented<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
}: {
  items: Array<{ value: T; label: string; Icon: IconType }>;
  value: T;
  onChange: (v: T) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {items.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          id={`${idPrefix}-${v}`}
          type="button"
          aria-pressed={value === v}
          title={label}
          onClick={() => onChange(v)}
          className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui border text-12 font-medium cursor-pointer ${MOTION} ${pressedClass(value === v)}`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Botão com ícone + texto, ação imediata (Revelar tudo, Limpar meus...). */
export function BarTextButton({
  id,
  title,
  onClick,
  children,
}: {
  id: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      onClick={onClick}
      className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui border border-transparent text-12 font-medium text-text-muted hover:bg-surface-2 hover:text-text whitespace-nowrap cursor-pointer ${MOTION}`}
    >
      {children}
    </button>
  );
}

/** Alternância com ícone + texto (Névoa ativa, Todos veem, Snap...). */
export function BarToggle({
  id,
  pressed,
  title,
  onClick,
  children,
  className = "",
}: {
  id?: string;
  pressed: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui border text-12 font-medium whitespace-nowrap cursor-pointer ${MOTION} ${pressedClass(pressed)} ${className}`}
    >
      {children}
    </button>
  );
}

/** Botão só de ícone (zoom, desfazer da névoa). Sempre com `title` e `aria-label`. */
export function BarIconButton({
  id,
  title,
  disabled,
  onClick,
  children,
}: {
  id?: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`focus-ring grid place-items-center w-7 h-7 rounded-ui text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted disabled:cursor-not-allowed cursor-pointer ${MOTION}`}
    >
      {children}
    </button>
  );
}

/** Contagem discreta no fim da barra ("3 formas", "12 traços"); `warn` destaca acima do limite. */
export function BarCount({ warn, title, children }: { warn: boolean; title: string; children: React.ReactNode }) {
  return (
    <span className={`font-data text-12 tabular-nums px-1.5 whitespace-nowrap ${warn ? "text-text font-semibold" : "text-text-muted"}`} title={title}>
      {warn && <span className="inline-block w-1.5 h-1.5 mr-1 rounded-full bg-danger align-middle" aria-hidden />}
      {children}
    </span>
  );
}
