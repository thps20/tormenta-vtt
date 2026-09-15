---
target: "a Mesa (RoomPage: canvas, barra superior, barras flutuantes, faixas de aviso, painel lateral, visão de grupo)"
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/thiago/projetos/tormenta-vtt/apps/web/src/components/RoomPage.tsx"
target_fingerprint: "sha256:757d8a27d88fd6301e993242967751133b121ffc5b48b4e67076d9b9801a55a0"
target_path: /home/thiago/projetos/tormenta-vtt/apps/web/src/components/RoomPage.tsx
timestamp: 2026-09-15T01-09-49Z
slug: apps-web-src-components-roompage-tsx
---
# Crítica: a Mesa (RoomPage)
Método: dual-agent (A: revisão de design · B: detector + navegador). Sala "Mesa de Teste", GM e jogadora, 1280/1500/1920.

## Heurísticas (24/40, Aceitável)
1 Visibilidade 2 — status de conexão nunca renderizado; socket caído = tela idêntica
2 Mundo real 3 — vocabulário T20 ok; "Fog ativo", Snap, Grid, Token, Lobby em inglês
3 Controle 3 — undo do GM; Revelar/Ocultar/Limpar tudo instantâneos
4 Consistência 2 — 3 fontes misturadas, ~5 estilos de botão; jogador vê Próximo/Anterior mortos
5 Prevenção 2 — "Apagar combate" um clique sem confirmação
6 Reconhecimento 3 — kbd nas dicas; sintaxe /r só em placeholder cortado
7 Eficiência 3 — sem atalho para Próximo turno
8 Minimalismo 2 — ~44 botões, dica permanente, 15+ dourados por vista
9 Recuperação 2 — queda de socket silenciosa
10 Ajuda 2 — sem cola de atalhos nem orientação do jogador

## Especificidade
Tema escuro de fantasia sobre VTT genérico; grimório (docs/design/DESIGN.md) não migrado (planejado, index.css). Inter no corpo (index.css:82, detector overused-font), Plex 0 usos, #d4af37 555× vs accent 24×, Cinzel 364×, 17 glows, 9–11 fundos off-token.
Detector CLI: 7 gray-on-color (todos falsos positivos de hover) + 1 overused-font real. Navegador: 51/25/62/41 achados (undersized-ui-text 36, nested-cards, thin-border-wide-shadow em #vtt-toolbar/#vtt-hud-bottom, dark-glow, low-contrast 3.1:1 badges de aba, text-overflow "INICIA…", text-occlusion da dica da névoa 97%, skipped-heading). Overlays só em /mnt/c/Temp/critique-b/*-overlay.png (headless).

## Pontos fortes
1. Público da informação rotulado (rolagem secreta + Revelar, modo, sussurro)
2. Turno amarrado painel ↔ mapa (chip TURNO, anel tracejado "0/9 m")
3. Toolbar: aria-pressed, kbd, atalhos, some no imersivo (Toolbar.tsx:88-104)

## Problemas prioritários
1. [P1] Mapa não é o herói: abre a 46%, sem refit em resize/imersivo (1920 imersivo = 1/3 da tela), faixa de dica permanente colide com banner. Fix: fit inicial, refit no imersivo, dica efêmera, turno legível sobre o mapa. → layout, adapt
2. [P1] Identidade grimório não aplicada → sem hierarquia. Fix: tokens, font-ui/font-data, Cinzel só em títulos, sem glow/ping, um dourado por vista. → typeset, quieter
3. [P1] Combate do GM: sem atalho Próximo/Anterior, 5 checkboxes acima da lista, "Rolar que faltam" cortado, Apagar combate sem confirmação, jogador vê botões mortos (CombatPanel.tsx:444-466), iniciativa de NPC com valores no card público do chat. Fix: popover de preferências, N/Shift+N, esconder nav p/ jogador, card GM-only, confirmar/desfazer. → distill, harden
4. [P1] Queda de conexão invisível (useConnection.status não renderizado). Fix: faixa "Sem conexão…" em --danger, avatares offline cinza, bloquear emits. → harden
5. [P2] Legibilidade/a11y: 204× 10px, 59× 9px, 6× 8px; zinc-600 ~2.25:1; foco invisível; tooltips só hover; 16 alvos <24px. Fix: escala 12/13/14, focus-visible accent, tooltip no foco, alvos ≥24px. → audit, typeset

## Personas
Alex: turno exige mouse; dano 3 passos; Fichas duplicado; draw toolbar 20 controles cortada.
Sam: foco invisível; ordem de Tab começa no chat; tooltips hover; condições ícone+title; Cinzel 9–10px.
Mestre sob pressão: mapa pequeno na TV; sem refit; nomes ilegíveis; dourado com glow cansa; queda invisível; Apagar combate a um clique.
Jogador novato: vê Próximo/Anterior mortos; "INICIA…"; sintaxe cortada; grupo vazio sem cue.

## Menores
Caixa "VTT" com borda; TORMENTA20 como chip; CONVITE alvo 19px; "Configurar Mapa" quebra em 1280; névoa quebra rótulos em 1500; vazio da Iniciativa mistura fontes + glow; mapa ativo ≠ visto só no seletor; avatares sobrepostos; "Adicionar" 9px.

## Perguntas
1. Modo imersivo como outro layout?
2. Um trilho único do Mestre?
3. Dourado = só turno?
4. Preferências de combate são config da sala?
