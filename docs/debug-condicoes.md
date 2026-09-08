# Debug: tooltip dos marcadores de condição (canvas da Mesa)

Histórico da investigação do bug "condições específicas (sempre as mesmas) não mostram o tooltip
no hover". A instrumentação descrita aqui **já foi removida**; ficou a correção final.

Irmão de [debug-token.md](debug-token.md): é a **mesma causa raiz** (canvas de hit do Konva
embaralhado por proteção anti-fingerprinting), reaparecendo num recurso novo que foi construído
no mecanismo antigo. Se um dia aparecer um terceiro sintoma do tipo "no canvas, uma parte não
responde ao mouse", comece por aqui.

## Sintoma reportado (mouse real, máquina do dono do projeto)

- Tela: um token com 38 condições → 5 badges + "+33".
- Alguns badges mostravam tooltip no hover, outros nunca — **sempre as mesmas condições**,
  independentemente da posição delas na coluna.
- Com `console.log` no `mouseenter` do badge: **nenhum log, em nenhum nível**, nem nos badges que
  mostravam tooltip.
- O log do Vite não mostrava `hmr update` desde que o dev server subiu.

## Duas tentativas que erraram o alvo (e por quê)

1. **"É o menu por cima do token"** — o `ConditionMenu` abria ancorado no ponto do clique, que num
   botão direito é sempre em cima do próprio token, e cobria a linha de baixo da coluna de badges.
   Era um problema real (corrigido: o popover agora nasce ao lado do token), mas não era **este**
   problema.
2. **"É o token vizinho cobrindo o tooltip"** — o tooltip era filho do Group do token, e tokens são
   Groups irmãos na mesma layer: o desenhado depois pintava por cima. Medido com dois tokens
   colados, sobravam 9 px visíveis (dava pra ler uma letra de "Cego" e nada de "Sobrecarregado").
   Também era real (corrigido: só o tooltip subiu para a última camada), e também não era **este**.

O erro de método nas duas: eu verificava se o nó `Label` **existia**, nunca se ele estava
**visível**, e testava sempre com um token isolado, num navegador (Edge headless) cujo canvas de
hit funciona. Ambiente de teste sem o defeito do ambiente real = bug irreproduzível.

## Instrumentação que fechou o diagnóstico

Para cada uma das 38 condições, medido ao vivo via CDP:

| verificação | resultado |
|---|---|
| SVG → data URI (`#` codificado, viewBox, não-ASCII) | 38/38 ok |
| `Image` isolado, com e sem `crossOrigin` | 38/38 carregam, todos 150x150 |
| `useImage` dentro do badge | 38/38 `imagemCarregou: true` |
| `mouseenter` no centro (sobre o ícone) e no anel de fundo | 38/38 disparam, hit no `Circle` |
| cadeia de `listening` acima do badge | toda `true` |
| tooltip existe e está dentro do canvas | 38/38 |

Ou seja: **no ambiente de teste nada falhava**. O que fechou o caso foi rodar a mesma bateria com o
canvas de hit sabotado, do jeito que `debug-token.md` prescreve:

```js
Konva.Layer.prototype._getIntersection = () => ({}); // getIntersection devolve null sempre
```

```
HIT NORMAL    -> 6 de 6 badges com tooltip
HIT SABOTADO  -> 0 de 6                      <- nenhum mouseenter, nenhum log
com hit sabotado, clique no token seleciona? True   <- token sobrevive (já era geométrico)
```

## Causa

O hover dos badges dependia do **canvas de hit do Konva** (`getIntersection` → `getImageData`),
embaralhado por proteção anti-fingerprinting (Brave Shields, `privacy.resistFingerprinting`,
CanvasBlocker e afins). Consequências que batem exatamente com o relato:

- `mouseenter` nunca dispara → **nenhum log**, em nível nenhum (não é build velho nem edição
  perdida: o log estava no arquivo certo, o evento é que não chegava).
- A leitura embaralhada produz **zonas mortas estáveis** → sempre as mesmas condições falhando,
  independentemente da posição.

Como conferir no navegador afetado, ver `debug-token.md` (o snippet do `getImageData` deve dar `4`).

## Correção final

- **`apps/web/src/lib/conditionLayout.ts`** (novo): a geometria dos badges (posição e tamanho de
  cada slot, colunas, "+N", contador de zoom baixo) virou função **pura**, fonte única para o
  desenho e para o hit. Se as duas contas divergirem, o mouse erra o alvo — por isso mora junto.
- **`VttCanvas.conditionTooltipAtPointer()`**: acha o badge sob o ponteiro por geometria (distância
  ao centro), no `onMouseMove` do Stage, do mesmo jeito que `tokenAtPointer` faz para tokens. Cobre
  badge, "+N" e contador pelo mesmo caminho.
- **Badges viraram só desenho** (`listening={false}`), como as decorações do token.
- Tooltip limpo ao trocar de ferramenta e ao começar um arraste (os outros modos não calculam
  hover, então um balão aberto ficaria pendurado).
- Ícone que falhe no load cai na **inicial** da condição (antes caía no rótulo inteiro, que quebrava
  em várias linhas e vazava para fora do círculo — o usuário miraria fora da área de hit).

Testado com o hit sabotado: **38/38 badges, o "+N" e o contador** mostram tooltip.

## Testes que seguram a regressão

- `apps/web/src/lib/conditionLayout.test.ts` — 11 casos, entre eles o que garante que **todo slot
  desenhado é alcançável pelo hit**, em várias contagens de condição e zooms.
- `packages/shared/src/test/systems.test.ts` — todo ícone de `conditions[]` faz parse, tem `viewBox`
  e `xmlns`, e sobrevive ao round-trip do data URI com o `#` codificado (mais os contraexemplos que
  provam que essas checagens reprovam de verdade).

## Lição para a próxima feature no canvas

Qualquer interação nova no canvas (hover, clique, arraste) **não pode depender do canvas de hit do
Konva**. Faça por geometria, com a conta compartilhada entre desenho e hit, e rode o cenário CDP nos
dois modos (hit normal e sabotado) antes de dar por concluído. Verificar que "o nó existe" não é
verificar que "o usuário vê/alcança".

## Scripts (Windows, CDP)

Os cenários desta investigação ficaram em `C:\Temp\vtt-*.ps1` (mesmo harness de `debug-token.md`:
`C:\Temp\cdp-lib.ps1`). O que interessa reproduzir é a bateria de hover em todos os badges rodando
duas vezes, com e sem `Konva.Layer.prototype._getIntersection = () => ({})`.
