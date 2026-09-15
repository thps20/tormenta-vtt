---
target: painel lateral (abas Chat/Iniciativa/Fichas, cards de rolagem e de item, painel de combate, visão de grupo)
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/thiago/projetos/tormenta-vtt/apps/web/src/components/SidePanel.tsx"
target_fingerprint: "sha256:6f3460f67a6eb6885586ba1188d66331a8cf1c71e907be6089475455b9923f78"
target_path: /home/thiago/projetos/tormenta-vtt/apps/web/src/components/SidePanel.tsx
timestamp: 2026-09-15T02-02-24Z
slug: apps-web-src-components-sidepanel-tsx
---
# Crítica: painel lateral da Mesa (abas Chat/Iniciativa/Fichas, cards do chat, combate, visão de grupo)
Método: dual-agent (A: revisão de design · B: detector + navegador). GM + jogadora, 1500x900 e 1280x800.

## Heurísticas (18/40, Fraco)
1 Visibilidade 2 — crítico mal se destaca (todo total é dourado 24px); "Aplicado −17" em alvo de 7 PV, sem "caído"
2 Mundo real 3 — vocabulário T20 ok; "R0", "Dano junto", "sem dono", "Manter visível/Pausar"
3 Controle 2 — "Apagar combate" 1 clique (CombatPanel.tsx:363); chat rola sozinho (ChatTab.tsx:125)
4 Consistência 1 — tema antigo vs MapBar grimório; dourado = turno/PV médio/toggle/GM/total; card item azul vs rolagem dourada
5 Prevenção 2 — Aplicar confirma, mas Confirmar cortado; jogador vê Anterior/Próximo (CombatPanel.tsx:443)
6 Reconhecimento 2 — sintaxe /r /gmr /pr /w só no placeholder cortado; macro só no hover
7 Eficiência 1 — sem atalho Próximo/Anterior; sem Enter no Aplicar; reordenar só por arraste
8 Minimalismo 1 — losango, brilho, Cinzel caixa alta, cartão por mensagem, 5 checkboxes, 82% do texto <12px
9 Recuperação 2 — toasts/revert por ack; sem desfazer Aplicar no card
10 Ajuda 2 — tooltips e Dica; ajuda de comandos enterrada

## Especificidade
Conteúdo muito T20 (PV/PM, CD, selos de dano do JSON, "Rolado", Aplicar com resistência); pele genérica de "RPG escuro" (tema antigo, index.css:92). 45% do texto renderizado em Cinzel.
Detector CLI: 0 achados (classes arbitrárias Tailwind não são vistas). Grep: #d4af37 138×, tokens grimório 0, font-ui/title/data 0, focus-ring 0, tabular-nums 0, text-[7–11px] 111, glows sem offset 7, zinc 163, focus-visible 0.
Overlay: Chat 76, Iniciativa 39, Fichas 27, menu rolagem 79. TP: undersized-ui-text, dark-glow (CombatPanel.tsx:536,546), low-contrast (badges 3,1:1; horários 2,25:1), text-overflow ("INICIA…"), ai-color-palette (PM sky, ItemCardMessage.tsx:85). nested-cards misto (faixas full-bleed = FP; mensagens-cartão = TP).

## Pontos fortes
1. Segredo visível (rodapé + Revelar, placeholder para quem não vê, modo dentro do campo, "Rolado").
2. Aplicar dano = "sistema calcula, Mestre confirma" (ApplyDamageButton.tsx:441).
3. Dirigido por dados (tokenBar, resources[], cor de dano do JSON).

## Problemas prioritários
- [P1] Painel fora do grimório e da escala tipográfica → typeset, quieter. Portar para peças do MapBar: font-ui, font-data tabular-nums, Cinzel só nas abas, 12/13/14, pressedClass, focus-ring, sem brilho/shadow-inner/losango.
- [P1] Combate lento/frágil para o GM: sem atalho N/Shift+N, 11 controles antes do 1º combatente (5 linhas em 1280x800), Apagar sem confirmar, "Rolar que faltam" cortado, jogador vê Anterior/Próximo → distill, harden.
- [P1] Crítico/falha só por cor; pico achatado (ChatTab.tsx:333,394,397); 1 natural = "5" vermelho sem "Falha" → clarify, typeset.
- [P1] Aplicar dano quebra no fim: popover absolute recortado (ApplyDamageButton.tsx:208), registro mostra pedido não efetivo, sem "caído", esmeralda fora da paleta, autoscroll → harden.
- [P2] Toda mensagem é cartão; card de magia despeja ~15 linhas; cartão-em-cartão → distill.

## Personas
Mestre sob pressão: cabeçalho ~280px, TURNO quebra com nome longo, Apagar 1 clique, "−17", autoscroll, alterna Chat↔Iniciativa.
Alex: sem atalho de turno; Adiar/Surpresa via ⋯ 14px; Aplicar só mouse; dados rápidos só 1dX.
Sam: abas sem role=tab/aria-selected; foco padrão; horários 2,25:1 a 9px; ícones sem aria-label; chat sem aria-live; reordenar só arraste; condição "Z".
Primeira viagem: Anterior/Próximo mortos; "R0"; placeholder-manual; "Dano junto" dourado; "Pública ▾" vs "Todos ▾".

## Menores
Badge do Chat = total, não não lidas; "0/9" + campo "9" sem rótulo; Encerrar com borda vermelha; estado vazio com ícone em círculo + brilho (CombatPanel.tsx:155); window.confirm em apagar ficha; aba Fichas duplica menu; ml-3/mr-3 estilo mensageiro; sussurro roxo/item azul; "Handout" (HandoutCardMessage.tsx:38); tooltip com combat:start (CombatPanel.tsx:410); PV média dourada; animate-pulse; iniciativa em lote de NPC pública segue rollMode do GM (SPEC §3.5) mas painel esconde o valor.

## Perguntas
1. Chat é log ou feed? 2. Total de dado deveria ser dourado? 3. Ordem de turno como faixa sempre visível em vez de aba? 4. Iniciativa de NPC deveria nascer secreta?
