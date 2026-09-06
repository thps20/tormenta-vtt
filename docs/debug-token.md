# Debug: área de clique/drag do token (canvas da Mesa)

Histórico da investigação do bug "parte do círculo do token não responde a clique/drag".
O código de instrumentação descrito aqui **já foi removido**; ficou a correção final.

## Sintoma reportado (mouse real, máquina do dono do projeto)

Cliques no centro, em cima, à esquerda e à direita do token tinham alvo `Stage` (classe
`Stage`, sem nome): nem o token nem o `map-background` foram atingidos. Só a região inferior
respondia, acertando um `Rect` de um grupo.

Alvo `Stage` significa que `stage.getIntersection` não achou **shape nenhuma** em nenhuma layer,
nem o fundo do mapa, que cobre a área toda. Nos testes automatizados (Edge headless via CDP,
DPR 1 / 1.25 / 1.5, com e sem imagem de mapa) isso nunca aconteceu: tamanho do Stage igual ao
container, `clientX/Y - rect` igual a `getPointerPosition()`, e todos os pontos acertavam.

## O que foi verificado e descartado

1. **Canvas esticado por CSS**: `stage.width()/height()` igual ao `getBoundingClientRect()` do
   container; os canvases têm `style.width/height` iguais ao Stage; o preflight do Tailwind não
   dá `max-width` a `canvas`; não há regra de `canvas` no `index.css`.
2. **`transform`/`zoom`/`scale` em ancestral**: nenhum. O `translateX` do `index.css` é a
   animação da gaveta da ficha, que é `fixed` e não é ancestral do canvas. Os `scale-*`/`rotate-*`
   encontrados são em botões e ícones.
3. **Ponteiro DOM vs. Konva**: diferença zero nos testes.
4. **Shape sem `fill`**: no Konva 9 o hit é preenchido mesmo sem `fill` (`fillEnabled` é true por
   padrão); a varredura pixel a pixel confirmou. Mesmo assim o `token-hit` ganhou
   `fill="transparent"`, para deixar explícito.
5. **Pan do Stage competindo com o drag do token**: pela regra do Konva o Group registra o
   arraste antes e o Stage desiste. Só falha quando o hit não reconhece o Group, que é o caso do
   sintoma.

## Causa mais provável

`getIntersection` lê pixels do canvas de hit com `getImageData`. Navegadores e extensões com
proteção contra fingerprinting (Brave Shields, Firefox com `privacy.resistFingerprinting`,
CanvasBlocker e similares) embaralham essa leitura. O resultado é exatamente o sintoma: zonas
mortas estáveis e algumas shapes ainda acertando. Como verificar no navegador afetado (console):

```js
const c = document.createElement("canvas"); c.width = c.height = 4;
const x = c.getContext("2d"); x.fillStyle = "#123456"; x.fillRect(0, 0, 4, 4);
new Set(Array.from(x.getImageData(0, 0, 4, 4).data).join(",").split(",")).size
```

Deve dar `4` (só os valores 18, 52, 86 e 255). Qualquer outro número indica leitura embaralhada.

## Correção final (`apps/web/src/components/VttCanvas.tsx`)

A interação com tokens **não depende mais do canvas de hit**:

- `tokenAtPointer()`: acha o token sob o ponteiro por geometria (distância ao centro, raio +
  borda), usando `getPointerPosition()` e a transformação do Stage. Último da lista tem prioridade.
- `onMouseMove` do Stage: `stage.draggable(!sobreToken)` e cursor. Sem pan enquanto há token sob
  o mouse, então o Stage nunca compete com o drag do token. Não mexe em nada durante um arraste.
- `onMouseDown` do Stage: se o hit do Konva não entregou o evento ao Group do token, repassa um
  `mousedown` ao Group, e o próprio Konva inicia o drag dele (mesmo caminho de sempre).
- `onClick` do Stage: seleciona o token por geometria quando o hit falhou; clique no fundo
  deseleciona.
- Token: só desenho com `listening={false}`; um único `Circle` invisível `token-hit`, último
  filho, para quando o hit funciona. Motivo: o Konva só dispara `click` quando mousedown e
  mouseup caem na mesma shape, e várias shapes empilhadas perdiam cliques na fronteira entre elas.

Testado com o hit sabotado (`Konva.Layer.prototype._getIntersection = () => ({})`, que faz
`getIntersection` devolver `null` sempre): cliques selecionam, clique no mapa deseleciona, drags
pela borda movem o token, pan do mapa funciona, cursor "grab" sobre o token.

## Scripts (Windows, CDP)

`C:\Temp\vtt-fix.ps1` roda a bateria acima nos dois modos (hit normal e sabotado).
`C:\Temp\vtt-hit6.ps1`/`vtt-hit7.ps1` fazem a varredura pixel a pixel do círculo.
