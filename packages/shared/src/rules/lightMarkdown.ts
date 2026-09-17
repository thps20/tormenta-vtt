/**
 * Markdown leve (docs/plano-preparo.md §2.5): `**negrito**`, `*itálico*`, `# título`, listas
 * `-`/`1.`, `> citação`. Devolve uma árvore simples; quem monta DOM é o web (sem
 * `dangerouslySetInnerHTML` em lugar nenhum — a árvore é só dados, nunca HTML).
 */
export type LightMarkdownInline = { type: "text"; text: string } | { type: "bold" | "italic"; children: LightMarkdownInline[] };

export type LightMarkdownBlock =
  | { type: "heading"; children: LightMarkdownInline[] }
  | { type: "paragraph"; children: LightMarkdownInline[] }
  | { type: "quote"; children: LightMarkdownInline[] }
  | { type: "list"; ordered: boolean; items: LightMarkdownInline[][] };

/** `**negrito**`/`*itálico*` não aninham entre si nesta versão — o primeiro marcador fechado vence. */
function parseInline(text: string): LightMarkdownInline[] {
  const nodes: LightMarkdownInline[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    const bold = match[1];
    const italic = match[2];
    if (bold !== undefined) nodes.push({ type: "bold", children: [{ type: "text", text: bold }] });
    else if (italic !== undefined) nodes.push({ type: "italic", children: [{ type: "text", text: italic }] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push({ type: "text", text: text.slice(lastIndex) });
  return nodes.length > 0 ? nodes : [{ type: "text", text: "" }];
}

const UNORDERED_ITEM = /^-\s+(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;

export function parseLightMarkdown(source: string): LightMarkdownBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: LightMarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "heading", children: parseInline(trimmed.slice(2)) });
      i++;
      continue;
    }
    if (trimmed.startsWith("> ")) {
      blocks.push({ type: "quote", children: parseInline(trimmed.slice(2)) });
      i++;
      continue;
    }
    const firstUnordered = UNORDERED_ITEM.exec(trimmed);
    const firstOrdered = ORDERED_ITEM.exec(trimmed);
    if (firstUnordered || firstOrdered) {
      const ordered = firstOrdered !== null;
      const marker = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
      const items: LightMarkdownInline[][] = [];
      while (i < lines.length) {
        const lineMatch = marker.exec((lines[i] ?? "").trim());
        if (!lineMatch) break;
        items.push(parseInline(lineMatch[1] ?? ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    blocks.push({ type: "paragraph", children: parseInline(trimmed) });
    i++;
  }
  return blocks;
}
