# Auditoria: dependência do canvas de hit do Konva

Pedido: pela lição de [debug-condicoes.md](debug-condicoes.md) ("qualquer interação nova no canvas
não pode depender do canvas de hit do Konva"), auditar toda interação no canvas — Transformer,
caixa de seleção, névoa (pincel/retângulo/polígono), régua, menu de contexto, hover — e dizer qual
ainda depende de `getIntersection`/eventos em shapes em vez de geometria.

**Sem corrigir nada aqui** — só o levantamento. Testado ao vivo (Edge headless/CDP), com
`Konva.Layer.prototype._getIntersection = () => ({})` (mesma sabotagem de
[debug-token.md](debug-token.md)), comparando com o hit normal. Uma primeira leitura de código deu
uma suspeita a mais (polígono da névoa) que não se confirmou — era defeito do script de teste, não
do produto; ficou registrado abaixo para não repetir o erro.

## A regra que separa seguro de quebrado

Um handler ligado direto no `<Stage>` sempre dispara: quando o hit falha, o alvo do evento degrada
para o próprio Stage, que trivialmente "borbulha" pra si mesmo. Um handler ligado numa shape/Group
específica (`Circle`, `Rect`, anchor do `Transformer`, o `Group` do token) só dispara se
`getIntersection` resolver certo pra ela — e é isso que quebra sob proteção anti-fingerprinting
(Brave Shields, `privacy.resistFingerprinting`, CanvasBlocker).

## Tabela

| Item | Mecanismo atual | Quebra em Brave? | Esforço p/ migrar |
|---|---|---|---|
| **Selecionar token (clique)** | `handleStageClick` (Stage-level) com fallback geométrico `tokenAtPointer()` — já corrigido em `debug-token.md` | **Não** — testado: seleciona | — |
| **Arrastar token** | `handleStageMouseDown` dá `.fire("mousedown")` no Group quando o hit falha; o drag-move usa o listener nativo do Konva, não hit-test por frame | **Não** — testado: move | — |
| **Redimensionar (alças do `Transformer`)** | ~~Anchors do `Konva.Transformer`... só `getIntersection`~~ **Corrigido**: `resizeAnchorAtPointer()` geométrico em `handleStageMouseDown`, mesmo padrão do token | **Corrigido** — ver seção abaixo | Feito |
| **Menu de condições (botão direito no token)** | ~~`onContextMenu` só no Group do token, sem fallback~~ **Corrigido**: `handleStageContextMenu` no `<Stage>` com `tokenAtPointer()` | **Corrigido** — ver seção abaixo | Feito |
| **Caixa de seleção (arrastar no mapa vazio)** | 100% Stage-level (`handleStageMouseDown`/`MouseMove`/`finishSelectionBox`) + `tokensInBox()` geométrico; o retângulo desenhado é só visual, numa layer `listening={false}` | **Não** — testado: seleciona o token dentro da caixa | — |
| **Névoa — pincel** | Stage-level (`fogMouseDown/Move/Up` via `pointerMapPos()`, que usa `getPointerPosition()` nativo, não hit-test) | **Não** — testado: shape nova criada | — |
| **Névoa — retângulo** | idem | **Não** — testado: shape nova criada | — |
| **Névoa — polígono** | Stage-level (`onClick`/`onDblClick` do `<Stage>`) | **Não** — testado (1ª tentativa deu falso-negativo por um `clickCount=2` sintético mal-formado no script de teste; refeito com dois cliques reais em sequência, funciona normal **e** sabotado) | — |
| **Régua** | Stage-level (`handleStageMouseDown/Move/Up` + `pointerMapPos()`) | **Não** — testado: `ruler.start/end` atualiza durante o arrasto | — |
| **Badges de condição (hover/tooltip)** | `conditionTooltipAtPointer()` geométrico, no `mousemove` do Stage (corrigido em `debug-condicoes.md`) | **Não** — já corrigido e testado | — (feito) |
| **Cursor grab/default sobre token** | `tokenAtPointer()` geométrico | **Não** | — |
| **Toque (`onTap` no token, mobile)** | Só shape-level, sem fallback Stage-level dedicado a touch | Não testado (não emulei touch/Brave mobile) | Se um dia importar: mesmo padrão do clique, via evento de toque |

## Resumo

Dos dois itens que quebravam, **os dois foram corrigidos**. Seleção, arrasto, caixa de seleção,
névoa (as três formas) e régua já eram geométricos ou tinham fallback — não precisaram de nada.

## Corrigido: menu de condições (botão direito)

`handleStageContextMenu`, ligado no `<Stage>`: `e.evt.preventDefault()` + `tokenAtPointer()`
(geométrico) + `openConditionMenuAt(t)` quando o hit não aterrissou no token — cópia do fallback
que `handleStageClick` já fazia pro clique. Konva já tem esse fallback pronto do lado dele
(`Stage._contextmenu`, em `konva/lib/Stage.js`, dispara no próprio Stage quando `getIntersection`
não acha nada); só faltava alguém escutando lá.

Pista falsa registrada pra não repetir: a 1ª rodada de teste deu "não abre" com o hit sabotado, e
por um instante pareceu que o fallback não disparava. Era o mesmo atraso de timer do Edge headless
em segundo plano já documentado na memória do projeto (~1s) — com log temporário dava pra ver
`openConditionMenuAt`/`setConditionMenu` rodando certinho; só o DOM ainda não tinha repintado no
momento em que o script checava. Refeito com mais espera, sem log.

## Corrigido: alças de redimensionar (`Transformer`)

`resizeAnchorAtPointer()`, geométrico (distância ao centro de cada alça habilitada — mesma lista
`RESIZE_ANCHOR_NAMES` que o `Transformer` usa em `enabledAnchors`, pras duas nunca divergirem —,
com a mesma folga de 6px que o token-hit já usa), chamado em `handleStageMouseDown` antes do
fallback de token. `.fire("mousedown")` na alça certa quando o hit não aterrissou nela; o Konva
assume dali — o `Transformer` não usa o drag nativo do Konva pra redimensionar (ele mesmo cancela
o próprio drag em `anchor.on('dragstart', () => anchor.stopDrag())` e implementa o resize via um
`window.addEventListener('mousemove', ...)` interno), então o `.fire()` só precisa disparar o
`_handleMouseDown` da lib, que já monta esse listener sozinho.

Duas pistas falsas registradas pra não repetir:
1. Instrumentar o evento Konva `dragmove` da própria alça sempre dava 0 disparos, parecendo
   confirmar quebra — mas o `Transformer` cancela esse drag de propósito (ver acima); o resize de
   verdade passa por um listener nativo do `window`, invisível ao `dragmove` do Konva. Sinal
   errado, não bug — só se via com `Konva.Transformer.prototype._handleMouseMove` monkey-patchado.
2. Com um arrasto de só 25px de tela, a alça redimensionava por dentro (`tr.width()` crescia de 55
   pra 79px, confirmado no monkey-patch), mas a store nunca atualizava — nem com o hit normal.
   Era **snap-to-grid**: escala ~1.42 sobre um token de 70px dá ~99.6px, que o snap arredonda pra
   baixo pro múltiplo de célula mais próximo (1 célula = 70px) — sem mudança visível. Nada
   quebrado; o arrasto de teste é que era pequeno demais pra passar do limiar de arredondamento.
   Refeito com o snap desligado e um arrasto maior.

## Scripts (Windows, CDP)

Cenários desta auditoria em `C:\Temp\vtt-audit*.ps1` (harness `C:\Temp\cdp-lib.ps1`). A bateria
principal roda cada interação com o hit normal e depois com
`Konva.Layer.prototype._getIntersection = () => ({})`, comparando o resultado.

`C:\Temp\vtt-audit-fixes.ps1` é o teste de regressão dos dois itens corrigidos nesta seção — roda
sozinho (cria sala e token, sem depender de estado anterior), com os dois no hit normal e
sabotado, e falha ruidosamente se algum voltar a quebrar. Rodar depois de qualquer mudança em
`handleStageMouseDown`, `handleStageContextMenu`, no `Transformer` ou no `ConditionMenu`.
