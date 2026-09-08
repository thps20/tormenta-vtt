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
| **Redimensionar (alças do `Transformer`)** | Anchors do `Konva.Transformer` (Rects internos da própria lib, `VttCanvas.tsx:779-790`) — mousedown neles depende 100% de `getIntersection` acertar aquele Rect específico | **Sim** — testado: `70x70 → 70x70` (nenhuma mudança) | **Médio.** Mesmo padrão do token: no `handleStageMouseDown`, se `mode==="select"` e há um token redimensionável selecionado, calcular geometricamente se o ponteiro está sobre um dos 4 cantos (raio pequeno ao redor de cada anchor, posição já conhecida via `tr.findOne('.top-left')` etc.) e, se sim e o hit não aterrissou lá, `.fire("mousedown")` no anchor certo — o resto (redimensionar de verdade) o próprio Konva já resolve depois de iniciado, como no drag do token. Não precisa reimplementar o Transformer. |
| **Menu de condições (botão direito no token)** | `onContextMenu` só existe no Group do token (`VttCanvas.tsx:979`) — **sem fallback Stage-level nenhum** | **Sim** — testado: popover nunca abre | **Baixo.** Adicionar `onContextMenu` no `<Stage>`: `e.evt.preventDefault()` + `tokenAtPointer()` + `openConditionMenuAt(t)` se o hit não tiver aterrissado no token — cópia quase literal do fallback que `handleStageClick` já faz pro clique. |
| **Caixa de seleção (arrastar no mapa vazio)** | 100% Stage-level (`handleStageMouseDown`/`MouseMove`/`finishSelectionBox`) + `tokensInBox()` geométrico; o retângulo desenhado é só visual, numa layer `listening={false}` | **Não** — testado: seleciona o token dentro da caixa | — |
| **Névoa — pincel** | Stage-level (`fogMouseDown/Move/Up` via `pointerMapPos()`, que usa `getPointerPosition()` nativo, não hit-test) | **Não** — testado: shape nova criada | — |
| **Névoa — retângulo** | idem | **Não** — testado: shape nova criada | — |
| **Névoa — polígono** | Stage-level (`onClick`/`onDblClick` do `<Stage>`) | **Não** — testado (1ª tentativa deu falso-negativo por um `clickCount=2` sintético mal-formado no script de teste; refeito com dois cliques reais em sequência, funciona normal **e** sabotado) | — |
| **Régua** | Stage-level (`handleStageMouseDown/Move/Up` + `pointerMapPos()`) | **Não** — testado: `ruler.start/end` atualiza durante o arrasto | — |
| **Badges de condição (hover/tooltip)** | `conditionTooltipAtPointer()` geométrico, no `mousemove` do Stage (corrigido em `debug-condicoes.md`) | **Não** — já corrigido e testado | — (feito) |
| **Cursor grab/default sobre token** | `tokenAtPointer()` geométrico | **Não** | — |
| **Toque (`onTap` no token, mobile)** | Só shape-level, sem fallback Stage-level dedicado a touch | Não testado (não emulei touch/Brave mobile) | Se um dia importar: mesmo padrão do clique, via evento de toque |

## Resumo

Dois itens realmente quebram: as **alças de redimensionar** (`Transformer`) e o **botão direito
pra abrir o menu de condições**. Seleção, arrasto, caixa de seleção, névoa (as três formas) e régua
já são geométricos ou têm fallback — não precisam de nada.

## Scripts (Windows, CDP)

Cenários desta auditoria em `C:\Temp\vtt-audit*.ps1` (harness `C:\Temp\cdp-lib.ps1`). A bateria
principal roda cada interação com o hit normal e depois com
`Konva.Layer.prototype._getIntersection = () => ({})`, comparando o resultado.
