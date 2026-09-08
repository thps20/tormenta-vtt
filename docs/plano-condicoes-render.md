# Plano: ajuste no render dos marcadores de condição (TokenNode)

Pedido original:

> Ajuste no render dos marcadores de condição no TokenNode:
> - Em vez de espalhar dentro do token, desenhe-os como uma coluna vertical encostada na borda direita do
>   token, de cima para baixo, começando no topo. Os ícones devem ficar DENTRO da área da célula/grid que o
>   token ocupa (bounding box do token), sobrepondo apenas a beirada do círculo — nunca avançando sobre a
>   célula vizinha, para não atrapalhar tokens adjacentes.
> - Tamanho do ícone proporcional ao token (ex.: ~22% do lado da célula, com mínimo e máximo em px na tela),
>   com fundo circular escuro semitransparente atrás de cada ícone para legibilidade sobre qualquer imagem.
> - Se não couberem 6 na altura do token, use duas colunas (a segunda à esquerda da primeira) antes de cair no
>   "+N". Tokens 2x2 ou maiores ganham mais espaço automaticamente.
> - Coloque os marcadores em z-order acima dos tokens vizinhos (layer própria ou último filho do Group com
>   listening={false}), para que um token adjacente não os cubra.
> - Abaixo de um zoom mínimo (ícones ficariam < ~10px), esconda os ícones e mostre só um pequeno contador
>   numérico no canto, para não virar ruído.
> - Tooltip continua no hover. Deixe um comentário explicando a geometria para o próximo ajuste.
> Mostre um esboço da geometria antes de implementar.

## Modelo de coordenadas

Tudo em coordenadas **locais do Group do token** (origem no canto superior-esquerdo da bounding box,
`(0,0)` a `(token.width, token.height)` — a própria área da célula/grid que o token ocupa).

```
(0,0)                         (width,0)
  ┌───────────────────────────────┐
  │                              ◐1│  ← primeiro badge: centro em (width-r, r)
  │            ●●●               ◐2│     topo do círculo encosta em y=0
  │          ●     ●             ◐3│     lado direito encosta em x=width
  │         ●   T   ●            ◐4│
  │          ●     ●             ◐5│  ← empilha p/ baixo: passo = 2r + gap
  │            ●●●               ◐6│
  │                                │
  └───────────────────────────────┘
(0,height)                    (width,height)
```

Como o círculo do token é **inscrito** na bounding box (raio = metade do lado menor), ele só toca as
bordas nos 4 pontos cardeais — os cantos ficam vazios. Uma coluna encostada na borda direita, de cima a
baixo, cai naturalmente sobretudo nesses "cantos vazios", tocando o círculo só perto do meio da altura.
Isso já entrega sozinho o "sobrepor só a beirada" pedido.

## Fórmulas

```
cellSide = min(token.width, token.height)          // já é o que tokenRadius() usa
sizeScreenCru = cellSide * 0.22 * stageScale        // 22% do lado, em px de TELA

se sizeScreenCru < MIN_PX (10):
    → não desenha coluna nenhuma; desenha só um contador pequeno,
      em tamanho de tela FIXO (independente do zoom), no canto superior direito
    → return

sizeScreen = clamp(sizeScreenCru, MIN_PX, MAX_PX)   // 10..24 px de tela
size       = sizeScreen / stageScale                // volta pra unidades do mapa
r          = size / 2
gap        = size * 0.2
step       = 2r + gap                                // passo vertical E horizontal (grade)

rows       = max(1, floor((token.height - 2r) / step) + 1)   // quantos cabem numa coluna
maxSlots   = min(6, 2 * rows)                                 // teto de sempre (6) x o que cabe em 2 colunas
// se sobrar mais que maxSlots, o ÚLTIMO slot vira "+N" em vez do ícone
visibleCount = conditions.length > maxSlots ? maxSlots - 1 : min(conditions.length, maxSlots)
hiddenCount  = conditions.length - visibleCount

para o slot i (0-based, preenchendo a coluna da direita até `rows`, depois a de trás):
    col      = floor(i / rows)        // 0 = coluna direita (encostada), 1 = próxima à esquerda
    rowInCol = i % rows
    x = (width - r) - col * step
    y = r + rowInCol * step
```

`r` ainda é limitado por `min(r, token.width/2, token.height/2)` como cinto de segurança (token
redimensionado bem menor que uma célula não deveria nunca estourar a bounding box).

Um token 2x2+ não precisa de tratamento especial: `token.height` maior → `rows` maior → tudo cabe numa
coluna só "automaticamente" (é só consequência da fórmula, não um caso à parte).

## Esboço com overflow (6 condições, token baixo, só cabem 4 por coluna)

```
┌───────────────────┐
│                  ◐1│
│                  ◐2│
│        T       ◐3◐5│   coluna 1 (esquerda) preenche depois da coluna 0 (direita)
│                  ◐4│
└───────────────────┘
```
Se nem 2 colunas dessem conta de 6, o último slot vira "+N" (mesmo conceito de antes).

## Fallback de zoom (contador)

Abaixo do limiar (~10px de tela), em vez da coluna: um badge pequeno e fixo no canto (não escala com o
zoom — usa `scale={{x:1/stageScale, y:1/stageScale}}` nesse Group, truque padrão do Konva pra "UI que não
deve encolher/crescer com o conteúdo") só com `N`. Sem tooltip nesse modo (resumo, não lista) —
**pendente de confirmação**: ok assim, ou quer tooltip com a lista ali também?

## Pontos em aberto (pendentes de confirmação antes de implementar)

**1. z-order "acima dos vizinhos".** Duas opções levantadas: layer própria, ou último filho do Group com
`listening={false}`. Testado ao vivo (CDP): o hover do tooltip *precisa* de `listening` ligado no badge —
não dá pra usar `listening={false}` nele sem quebrar "Tooltip continua no hover". Proposta: manter os
badges como **último filho do próprio Group do token** (garante que nada do próprio token — imagem,
moldura — os cobre; é o que já foi corrigido na rodada anterior), com `listening` normal só nos badges.
Isso NÃO garante 100% que um token vizinho com zIndex maior nunca cubra a borda, mas como o círculo é
inscrito (não usa a bounding box inteira) e os badges ficam dentro da própria bounding box, tokens
adjacentes do mesmo tamanho não vão se tocar na prática. Uma layer própria (acima de tudo) resolveria de
vez, mas ficaria **acima da névoa também** — a partição atual (`tokens-layer-below-fog` / `tokens-layer`)
existe justamente pra token alheio ficar visualmente "sob a névoa" pro GM; uma layer global de badges
vazaria esse efeito. Preferência pela opção mais simples (último filho do Group) — a confirmar.

**2. Números.** `0.22` do lado, `10–24px` de tela, teto de `6` — defaults propostos, a confirmar ou ajustar.
