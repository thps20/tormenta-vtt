# Plano: Fog of War manual

Escopo: névoa manual na Mesa. **Fora deste plano**: luz dinâmica, paredes, visão por token, histórico completo de desfazer (ficam para depois).

## Modelo (em `shared`, depois Prisma)

`Scene` ganha `fog`:

```ts
FogConfig = {
  enabled: boolean,            // padrão false
  base: "hidden" | "revealed", // estado base; padrão "hidden"
  shapes: FogShape[],          // aplicadas em ordem
}
FogShape = { id, mode: "reveal" | "hide" } & (
  | { kind: "circle";  cx, cy, r }
  | { kind: "rect";    x, y, width, height }
  | { kind: "polygon"; points: number[] }          // [x1,y1,x2,y2,...], mín. 3 vértices
  | { kind: "stroke";  points: number[]; width }   // pincel: polilinha com largura
)
```

Decisões:
- **`base`** é o que "Revelar tudo"/"Ocultar tudo" setam ao limpar a lista. Sem esse campo seria preciso guardar um retângulo do tamanho do mapa, que quebra se o mapa trocar de tamanho.
- **`stroke`** é o 4º kind, além dos três pedidos. É como um arrasto do pincel vira uma shape só, em vez de dezenas de círculos. Clique único do pincel vira `circle`.
- Ponto visível = começa com `base`; percorre as shapes em ordem e a última que contém o ponto decide. Função pura `isPointRevealed(fog, point)` em `packages/shared/src/fog/`, usada por cliente e servidor, com testes.
- Zod limita pontos por shape (2000) e o servidor limita a lista (abaixo).
- Prisma: `Scene.fog Json` com default, migration `add_scene_fog`.

## Eventos

- **C→S `fog:update { sceneId, op }`** (GM only), com `op` sendo uma de: `add { shape }`, `removeLast` (desfazer último, sem histórico completo), `revealAll`, `hideAll`, `setEnabled { enabled }`. Mandar a operação (e não a lista inteira) evita que dois cliques rápidos do GM sobrescrevam um ao outro.
- **S→C `fog:updated { sceneId, fog }`** com o estado completo. Cliente só substitui. Simples e não desincroniza. Jogadores recebem as shapes porque precisam desenhar a névoa com os buracos.
- **Limite de shapes**: aviso ao GM (toast) ao passar de 400 e recusa acima de 500 com mensagem sugerindo "Revelar/Ocultar tudo" para recomeçar. Sem mesclagem automática de geometria: mesclar polígonos com precisão é complexo e o ganho é pequeno, porque um arrasto já é uma shape só e os pontos do pincel são decimados (típico: 20 a 40 pontos por traço). Fica documentado no SPEC.

## Visibilidade de tokens no servidor

Escolha: **não enviar** o token oculto, reaproveitando o mecanismo que já existe para `visible=false` (jogador recebe `token:deleted`, e `token:updated` quando volta a aparecer). Motivos: nenhuma mudança no `Token`, zero vazamento (nem nome nem existência), e o cliente já trata upsert/remove de forma idempotente.

Regra por participante: GM vê tudo. Jogador vê o token se `visible` e (é dono, ou fog desligado, ou centro em área revelada). Como "é dono" varia por pessoa, o broadcast passa a ser: sala do GM; sala do dono; `players` **except** dono conforme a névoa. Sem consulta ao banco em `token:update` (a cena já vem carregada junto com o token). Após `fog:update`, o servidor reenvia todos os tokens da cena com essa regra. Snapshot filtra do mesmo jeito.

## Renderização (react-konva)

- Camadas: mapa → tokens que **não** controlo → **fog** → tokens que controlo (com o Transformer) → réguas. Para o GM, todos os tokens ficam acima da névoa.
- Layer de fog: retângulo preto do mapa; cada shape em ordem, `reveal` com `destination-out`, `hide` com preto normal.
- Opacidade do GM (0.5): **opacity CSS no elemento canvas da Layer**, não nas shapes. Nas shapes, o `destination-out` a 0.5 só apagaria metade e áreas ocultas sobrepostas ficariam mais escuras que as outras. O Konva desenha cada Layer num `<canvas>` próprio, então isso é barato e exato.
- Cliente também filtra tokens alheios cujo centro está na névoa (jogador), com a mesma função do `shared`. Cobre a corrida entre `fog:updated` e `token:deleted` chegarem fora de ordem.

## Ferramentas (só GM)

- Botão Névoa habilitado na barra, atalho **F** (jogador não entra no modo).
- Painel secundário quando o modo é Fog: Revelar | Ocultar; Pincel | Retângulo | Polígono; slider de tamanho do pincel; botões Desfazer último (Ctrl+Z com o modo Fog ativo), Revelar tudo, Ocultar tudo; toggle "Fog ativo".
- Pincel: pontos acumulados durante o arrasto (descartando os muito próximos), preview desenhado na própria layer de fog, envio ao soltar. Retângulo: arrasto. Polígono: cliques, linha elástica até o ponteiro, duplo clique fecha (mínimo 3 vértices), Esc cancela.
- Mudança otimista na store da sala; ack `ok:false` reverte e mostra toast.

## Commits (nesta ordem)

1. `shared`: schemas de fog, `Scene.fog`, payloads, eventos, `isPointRevealed` + testes, SPEC (modelo e eventos).
2. `server`: migration, serialização, handler `fog:update` com limite, broadcast de token por participante, snapshot.
3. `web`: stores (fog em `room`, sub-modo em `tools`), botão Névoa + atalho F, painel de sub-ferramentas.
4. `web`: layer de fog, divisão das camadas de tokens, filtro de tokens no cliente.
5. `web`: interações de pincel, retângulo e polígono no canvas.
6. SPEC: seção "Fase 2" (ficha de personagem, barra de ferramentas, fog of war) com a decisão do limite e o que ficou fora (luz, paredes, visão por token, histórico de desfazer). O MVP (§1) fica como está.
