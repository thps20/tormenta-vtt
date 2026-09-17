import React from "react";
import { parseLightMarkdown, type LightMarkdownInline } from "@tormenta-vtt/shared";

/** Monta os nós de `parseLightMarkdown` (shared) em elementos React — nunca `dangerouslySetInnerHTML`,
 *  a árvore é só dados (docs/plano-preparo.md §2.5). */
function renderInline(nodes: LightMarkdownInline[], keyPrefix: string): React.ReactNode {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === "text") return <React.Fragment key={key}>{node.text}</React.Fragment>;
    if (node.type === "bold") return <strong key={key}>{renderInline(node.children, key)}</strong>;
    return <em key={key}>{renderInline(node.children, key)}</em>;
  });
}

/** Notas do preparo em markdown leve (§2.5): `**negrito**`, `*itálico*`, `# título`, listas, `> citação`. */
export const LightMarkdownView: React.FC<{ source: string; className?: string }> = ({ source, className }) => {
  const blocks = parseLightMarkdown(source);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        if (block.type === "heading") return <p key={key} className="font-title font-bold text-sm text-text">{renderInline(block.children, key)}</p>;
        if (block.type === "quote")
          return (
            <blockquote key={key} className="border-l-2 border-border pl-2 text-text-muted italic">
              {renderInline(block.children, key)}
            </blockquote>
          );
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={key} className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
              {block.items.map((item, j) => (
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInline(block.children, key)}
          </p>
        );
      })}
    </div>
  );
};
