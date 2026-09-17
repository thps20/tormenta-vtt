# Crítica: arquitetura de informação da Mesa

> Data: 2026-09-17 · Método: `/impeccable critique` com duas avaliações independentes (A: revisão de design lendo o código e a tela ao vivo; B: detector automático + medições no navegador). Nada foi implementado.
> Evidência: prints e medições em `C:\Temp\critA-*.png`, `C:\Temp\critB-*.png` e `C:\Temp\critB-*.json` (Edge headless, 1920x1080 e 1366x768, GM e jogador, fora e dentro do combate).

> **Status (2026-09-17): decidido o caminho C**, entregue na ordem do §10, um commit por passo; a paleta de comandos está aprovada. Respostas do §11: a mesa é presencial com projeção (o Cast é a tela limpa, o notebook do Mestre pode ser denso); a cada turno o Mestre olha iniciativa e chat; improviso de mapa acontece "às vezes"; Macros e Notas são de jogar (ficam acessíveis, fora do ⋯).
> Passo 1 (piso comum) implementado: ver `docs/SPEC.md` §9.27.

## Resumo em uma frase

A Mesa empilha **preparar**, **jogar** e **configurar o sistema** na mesma altura. São cerca de 12 superfícies e 48 controles visíveis ao mesmo tempo para o Mestre. O problema principal não é falta de espaço: o mapa ainda fica com 74% da tela em 1920. O problema é que **nada diz ao Mestre o que importa agora**, e as duas coisas mais usadas no combate (chat e iniciativa) ficam em abas que escondem uma à outra.

---

## 1. O que existe hoje (Mestre)

### 1.1 Superfícies

| # | Superfície | Onde | Quando aparece | Controles | Momento |
|---|---|---|---|---|---|
| 1 | Barra superior, lado esquerdo | topo, 56px | sempre | Mapa (M), Handouts (J), Acervo (B), Convite | mapa: ambos · handouts: ambos · acervo: preparar · convite: sistema |
| 2 | Barra superior, lado direito | topo | sempre | Fichas▾, Cast, Volume, Macros, Notas, Configurar Mapa, Lobby (+ selo GM, online, avatares) | Cast: jogar · Config. Mapa: preparar · Volume/Lobby: sistema · resto: ambos |
| 2b | Player de som | dentro da barra superior | só com trilha tocando | 3 | jogar |
| 3 | Barra de ferramentas vertical | esquerda, 46x364 | sempre | Selecionar, Mover, Régua, Área, Desenho, Névoa, Pino, Desfazer, Refazer | ambos (Névoa e Pino pesam mais no preparo) |
| 4 | Sub-barras (Névoa / Área / Desenho) | ao lado da barra de ferramentas | só no modo da ferramenta | 6 a 10 | ambos |
| 5 | Barra inferior (HUD) | canto inferior esquerdo, 527x38 | sempre | zoom ±, ajustar, Snap, Grid, translúcido, Imersivo, + Token | sistema |
| 6 | Dica de atalhos | topo do mapa, ~720x32 | sempre que nada está selecionado | 0 | sistema |
| 7 | Barra de macros | rodapé, centro | se houver macro | 1 a 9 | jogar |
| 8 | Aviso de combate no topo | topo, centro | só para quem tem combatente (para o GM, quase nunca) | 1-2 | jogar |
| 9 | Painel lateral | direita, 384px | sempre (recolhível) | 4 abas: Chat, Iniciativa, Fichas, Preparo | misto |
| 9a | Visão de grupo | topo do painel | se há grupo | 1 chip por PC | jogar |
| 9b | Aba Chat | painel | aba ativa | ~14 (modo de rolagem, sussurro, dano junto, d4…d100, campo) | jogar |
| 9c | Aba Iniciativa | painel | aba ativa | ocioso 1 · combate 11 + 2-3 por linha (5 são preferências) | jogar |
| 9d | Aba Fichas | painel | aba ativa | lista + criar | ambos |
| 9e | Aba Preparo | painel | aba ativa, só GM | passos, itens, iniciar | escrever: preparar · executar: jogar |
| 10 | Card rápido de NPC | canto inferior direito, 360px de largura, quase a altura toda | token de NPC selecionado | 17 | jogar |
| 11 | Inspetor de token | canto superior direito | outro token selecionado | 10 | ambos |
| 12 | Por cima de tudo | modal/gaveta/paleta | sob demanda | ficha, compêndio, Notas, Configurar Mapa → calibração, Levar tokens, handout aberto, pino | — |

**Medições (Avaliação B):**

| Estado | Controles fora do mapa | Barra superior | Barra de ferramentas | Painel | Barra inferior |
|---|---|---|---|---|---|
| GM sem combate (aba Chat) | **48** | 11 | 9 | 19 | 9 |
| GM em combate (aba Iniciativa) | **47** | 11 | 9 | 18 | 9 |
| Jogador | **36** | 5 | 5 | 18 | 8 |

**Área do mapa, sem contar a barra do navegador:**

| Tela | Área do mapa | Com o card de NPC aberto |
|---|---|---|
| 1920x1080 | 74% | — |
| 1366x768 | 63% | cobre mais ~32% do mapa |

### 1.2 Caminhos repetidos

| O quê | Portas de entrada |
|---|---|
| Notas | 4: botão da barra, ícone no Preparo, linha de cada mapa, notas do token |
| Mapa | 4: seletor de mapas, "Configurar Mapa" (em outro canto da barra), arrastar do Acervo, item do Preparo |
| Fichas | 5: menu da barra (o "Nova ficha" dele só pula para a aba), aba Fichas, chips do grupo, card de NPC, duplo clique no token |
| Handouts | 3: botão J, Acervo, Preparo |
| Macros | 4: botão da barra, barra de macros, "salvar como macro" no chat, Acervo |

Vários caminhos não são ruins em si: atalho e caminho visível podem conviver. O ruim é **não haver um lugar principal** para cada coisa.

### 1.3 O que não tem porta visível

- **Criaturas, encontros e homebrew** só abrem por Ctrl+Espaço ou "/". Não há botão na Mesa.
- **Alvos** só por Y ou Alt+clique. As preferências deles ficam dentro do cabeçalho do combate.

### 1.4 Formatos diferentes para coisas parecidas

| Recurso | Formato |
|---|---|
| Mapas | menu suspenso de 420px |
| Handouts, Acervo | diálogo de 760px |
| Cast, Volume | pop-over |
| Fichas (lista) | menu suspenso |
| Notas | modal próprio |
| Configurar Mapa | modal largo |
| Compêndio | paleta flutuante |
| Ficha | gaveta |
| Preparo | aba |
| NPC | card flutuante |

Há ainda **dois dialetos visuais**: Notas, Inspetor, card de NPC, galeria de Handouts e Configurar Mapa usam cores fixas (`#14120f`, `#d4af37`, zinc). O resto usa os tokens do `MapBar.tsx`.

### 1.5 Jogador

A carga é razoável:
- barra superior com 5 controles;
- 5 ferramentas;
- 3 abas.

O problema de arquitetura é quase todo do Mestre. As propostas abaixo mal mudam a tela do jogador.

---

## 2. Nota de saúde (heurísticas de Nielsen)

| # | Heurística | Nota | Problema-chave |
|---|---|---|---|
| 1 | Visibilidade do estado | 3 | Bons sinais (mapa divergente em dourado, ponto em Cast/Notas, turno na alça do painel). Mas o selo "R0" é críptico e as abas aparecem cortadas ("CH…", "IN…", "FIC…"). |
| 2 | Correspondência com o mundo real | 3 | Vocabulário de T20 correto. "Acervo" × "Handouts" × "Preparo" se sobrepõem; "Fog ativo", "Snap" e "Cast" escapam em inglês. |
| 3 | Controle e liberdade | 3 | Desfazer do GM, Esc, saída do imersivo. Apagar mapa usa `window.confirm`. |
| 4 | Consistência | **1** | ~8 formatos de contêiner, 2 dialetos visuais, Notas com 4 portas. |
| 5 | Prevenção de erros | 2 | **Tecla D move o token E troca para Desenho** (`lib/useToolShortcuts.ts:10` × `lib/useTokenMoveShortcuts.ts`, confirmado ao vivo). "Apagar combate" fica no mesmo menu de "Manter visível". |
| 6 | Reconhecer em vez de lembrar | **1** | Criaturas/encontros/homebrew e alvos só por tecla; mais de 20 atalhos de uma letra sem lista em lugar nenhum. |
| 7 | Flexibilidade e eficiência | 2 | Muitos atalhos e macros 1-9, mas nenhum para passar turno, trocar de aba ou focar o chat. |
| 8 | Estética e minimalismo | 2 | 7 botões de mesmo peso no lado direito da barra; dica de atalhos sempre visível; 5 preferências antes do "Próximo". |
| 9 | Recuperação de erros | 3 | Resumo de falhas do Preparo, referências quebradas marcadas, desfazer. |
| 10 | Ajuda e documentação | 2 | Só tooltips e a dica fixa. |
| **Total** | | **22/40** | **Aceitável**: base funcional, organização precisa de trabalho |

### Carga cognitiva: 6 de 8 critérios falham (carga alta)

| Critério | Resultado |
|---|---|
| Foco único | falha: mapa, painel e barra têm o mesmo peso |
| Blocos de até 4 itens | falha: barra direita 7, ferramentas 9, linha de rolagem do chat 11 |
| Agrupamento | falha: a barra mistura preparar, jogar e sistema no mesmo bloco |
| Hierarquia | parcial: dourado bem reservado, barra plana |
| Uma coisa por vez | falha: Chat, Iniciativa e Preparo se excluem na mesma coluna |
| Até 4 opções por decisão | falha: "onde abro X?" tem de 3 a 5 respostas |
| Memória de trabalho | falha: atalhos só na memória; **o rascunho do chat se perde ao trocar de aba** (`ChatTab.tsx:103`, estado local, e a aba desmonta) |
| Revelação progressiva | passa com ressalva: sub-barras e player são condicionais, mas as preferências do combate ficam sempre expostas |

## 3. Veredito de especificidade

**A pele é de Tormenta; o esqueleto é de VTT genérico.**

- **Pele:** tipografia de grimório, dourado reservado para a ação principal, vocabulário do livro.
- **Esqueleto:** barra em cima, ferramentas à esquerda, abas à direita. É a planta do Roll20/Foundry, e a arquitetura não conta nada sobre como um Mestre de T20 conduz uma sessão.

O produto promete "a ferramenta some durante o jogo" (PRODUCT.md). Hoje a ferramenta aparece igual o tempo todo, esteja o Mestre montando o mapa na terça ou rolando iniciativa com cinco pessoas esperando no sábado.

**Detector automático:**
- **Arquivos-alvo:** limpos (0 achados).
- **Pasta de componentes inteira:** 7 avisos `gray-on-color`, todos falsos positivos (o detector cruza cor de hover com cor base).
- **Overlay na página ao vivo, 38 achados.** Os que importam aqui:
  - 13× texto funcional de 10px: "R0", "ROLAR:", "Pública", "Todos", "Dano junto", d4…d100. **Concorda com a Avaliação A.**
  - 1× texto estourando a caixa na aba "Iniciativa". **Concorda com as abas cortadas.**
  - 2× cards aninhados no painel.
- **Descartados:** as 14 "borda fina + sombra larga" são estilo, não arquitetura; as 7 "oclusão de texto" são falso positivo (etiquetas do próprio overlay).

---

## 4. O que funciona

1. **O dourado é disciplinado.** Um único destaque por região (Próximo, Iniciar), e as sub-barras de ferramenta só aparecem no modo delas: revelação progressiva bem feita.
2. **Recolher e modo imersivo foram bem pensados.**
   - Flags separadas (o imersivo não sobrescreve a preferência do painel).
   - Selos de turno e de mensagem na alça.
   - Barras somem por ociosidade.
   - A infraestrutura de "esconder chrome" já existe, e as propostas abaixo a reaproveitam.
3. **Preparo é a ideia certa.**
   - Aponta para os itens em vez de copiá-los e executa em sequência com resumo de falhas.
   - O seletor de mapas avisa quando o Mestre vê um mapa diferente do ativo.
   - É exatamente o tipo de ponte entre preparar e jogar que a reorganização precisa.

## 5. Problemas prioritários

**[P1] Chat e Iniciativa se escondem um ao outro no combate**
- **Por que importa:** no combate o Mestre precisa das duas ao mesmo tempo (ler a rolagem do jogador e passar o turno). Hoje alterna abas a cada ação e perde o rascunho do chat. É o pior momento da jornada, justo quando a mesa está esperando.
- **Correção:** com combate ativo, iniciativa compacta encaixada acima do chat, na mesma coluna; aba só para a gestão completa. Rascunho do chat numa store.
- **Comando sugerido:** `/impeccable layout`

**[P1] A barra superior é uma prateleira plana de 11 controles de três momentos diferentes**
- **Por que importa:**
  - "Configurar Mapa" (preparo) tem o mesmo peso que "Cast" (jogo) e fica colado no "Lobby" (sair).
  - Em 1366, com 2 jogadores ou música tocando, os dois lados da barra se sobrepõem (sobram 16px).
- **Correção:** agrupar por momento (ver caminhos abaixo). O mínimo é separar em três blocos: **mapa**, **mesa ao vivo**, **sistema**.
- **Comando sugerido:** `/impeccable distill`

**[P1] Criaturas, encontros e homebrew não têm porta visível**
- **Por que importa:** soltar um goblin improvisado exige lembrar Ctrl+Espaço. Quem não lembra conclui que o recurso não existe.
- **Correção:** entrada visível no lugar onde o Mestre pensa "preciso de um inimigo". Uma paleta de comandos global (a mesma tecla abre tudo, não só o compêndio).
- **Comando sugerido:** `/impeccable onboard`

**[P1] Tecla D faz duas coisas** (bug, não arquitetura, mas quebra a confiança em todos os atalhos)
- **Por que importa:** com token selecionado, D move o token uma célula e troca para Desenho.
- **Correção:** WASD tem prioridade quando há seleção, ou Desenho muda de tecla.
- **Comando sugerido:** `/impeccable harden`

**[P2] Cabeçalho do combate com 5 preferências de 10px antes do "Próximo"**
- **Por que importa:**
  - A ação mais repetida da noite fica a ~300px do topo, abaixo de configurações que se mexem uma vez por campanha.
  - Não há tecla para passar turno.
- **Correção:** preferências num ícone de engrenagem; Próximo/Anterior no topo do bloco, com atalho.
- **Comando sugerido:** `/impeccable distill`

**[P2] Oito formatos de contêiner e dois dialetos visuais**
- **Por que importa:** o Mestre não cria expectativa de onde as coisas abrem nem de como fecham.
- **Correção:** definir três formatos e usar só eles:
  - **gaveta** para trabalho longo (ficha, preparo, acervo);
  - **pop-over** para ajuste rápido (cast, volume);
  - **diálogo** só para decisão que bloqueia.
- **Comando sugerido:** `/impeccable polish`

**[P2] Abas cortadas e linha de rolagem estourando em 384px**
- **Por que importa:** afeta 1920 e 1366 igualmente ("CH…", "SIM…"); com 4 abas, os rótulos não cabem.
- **Correção:** resolvida em parte ao tirar Preparo do painel. Ver também `/impeccable adapt`.

## 6. Personas

**Mestre com a mesa esperando** (persona do projeto):
- **Improvisar um mapa** passa por ~6 superfícies: M → criar → Configurar Mapa (outro canto) → calibrar → F → Ocultar tudo → ativar → diálogo "Levar tokens".
- **Conferir a rolagem de um jogador** no combate = trocar de aba e perder o que digitava.
- **Soltar uma criatura** = lembrar Ctrl+Espaço.

**Alex (usuário avançado):**
- Não há lista de atalhos nem paleta de comandos; o "/" só abre o compêndio.
- Não há tecla para turno nem para abas.
- O conflito do D ensina a desconfiar dos atalhos.

**Sam (teclado e leitor de tela):**
- As abas não têm `role=tablist`/`aria-selected`.
- O chat não tem `aria-live`, então rolagens novas não são anunciadas.
- Os chips da visão de grupo são `div` com clique, sem `tabIndex` (`PartyView.tsx:204`).
- A barra de ferramentas não navega por setas.
- Há 13 textos funcionais de 10px.

## 7. Observações menores

- A dica de atalhos (~720px) fica sempre visível no topo do mapa. Informação de primeira sessão ocupando espaço em todas.
- "Aproximar (+)" e "Afastar (−)" anunciam teclas que não existem.
- A barra de ferramentas do jogador termina com um divisor solto (`Toolbar.tsx:629`).
- O aviso de combate do topo quase nunca aparece para o GM, então o Mestre não tem o equivalente do "é a vez de X" fora do painel.
- A aba ativa do painel não é lembrada: recarregar volta sempre ao Chat.

---

## 8. Preparar × Jogar: o que é de cada momento

Antes dos caminhos, a separação honesta. **Pouca coisa é de um momento só**, e isso decide qual caminho é viável.

**Só preparar:**
- Configurar Mapa e calibração de grid.
- Upload, tags e edição no Acervo.
- Escrever passos do Preparo.
- Editor de homebrew.
- Criar handouts, salvar encontros.
- Ponto de chegada, ordenar e duplicar mapas.

**Só jogar:**
- Chat e rolagens; iniciativa e combate; alvos e suas preferências.
- Câmera e tela preta do Cast; player de som.
- Macros; "Iniciar passo" do Preparo; "Mostrar para todos"; PV no card de NPC.

**Atravessam os dois:**
- **Mapas:** trocar e ativar, e improvisar.
- **Névoa:** estado inicial e revelar ao vivo.
- **Notas:** escrever antes, ler durante.
- **Fichas de NPC, tokens, pinos, desenho, régua, desfazer.**
- **Compêndio:** montar encontro antes, soltar criatura durante.
- **Acervo:** organizar antes, arrastar durante.
- **Sons:** escolher antes, disparar durante.
- **Preparo:** escrever antes, executar durante.

**Consequência:** o corte certo não é "esconder o preparo durante o jogo". O corte certo é **escrever/editar × usar**. A mesma coisa (Preparo, Acervo, Notas, Sons) tem uma face de edição, pesada, e uma face de uso, leve. Hoje as duas faces aparecem juntas e com o mesmo peso.

**Risco central de qualquer separação:** o Mestre improvisa. Se criar um mapa ou soltar um goblin no meio da sessão exigir "trocar de modo", a separação vira atrito no pior momento. **Toda proposta abaixo precisa de uma porta universal** (paleta de comandos) que alcança qualquer coisa em qualquer estado.

---

## 9. Três caminhos

Os três partem de um **piso comum**, que vale fazer de qualquer jeito porque corrige os P1 que não dependem da escolha:

1. Chat e iniciativa juntos durante o combate (iniciativa compacta acima do chat).
2. Rascunho do chat numa store, fora do estado local da aba.
3. Preferências do combate atrás de uma engrenagem; Próximo/Anterior no topo, com atalho.
4. Corrigir o conflito da tecla D.
5. Subir os atalhos M/J/B dos componentes para hooks (hoje moram dentro dos seletores e morreriam se o seletor desmontasse, o que qualquer reorganização vai causar).
6. Paleta de comandos: a tecla que hoje abre o compêndio passa a achar também mapas, handouts, acervo, notas, sons e ações ("passar turno", "tela preta no Cast").

---

### Caminho A: Mesa única, reagrupada

Nenhum modo. A mesma tela, com a barra superior organizada em três blocos e o preparo movido para fora do painel lateral.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ MESA · Mapa 1 ▾  ⚙   │   Fichas▾  Handouts  Cast  ♪   │   Convite  👥  ⋯  │
│ └── mapa ──────────┘     └── mesa ao vivo ─────────┘     └── sistema ──┘  │
├──┬────────────────────────────────────────────────────┬───────────────────┤
│V │                                                    │ Chat │ Fichas     │
│H │                                                    ├───────────────────┤
│R │                     MAPA                           │ ▸ Rodada 2 · Kael │
│T │                                                    │   [‹] [Próximo ›] │
│D │                                                    │ ───────────────── │
│F │                                                    │ chat…             │
│P │                                                    │                   │
├──┴──────────────── zoom · grid · imersivo · +Token ───┴───────────────────┤
```

- **Barra:**
  - Bloco **mapa** = seletor + engrenagem (Configurar Mapa vira ícone ao lado do nome do mapa, onde pertence).
  - Bloco **mesa ao vivo** = Fichas, Handouts, Cast, Som.
  - Bloco **sistema** = Convite, participantes, menu ⋯ com Macros, Notas, Acervo e Lobby.
- **Painel lateral:** 2 abas (Chat, Fichas). A iniciativa aparece encaixada acima do chat quando há combate; fora de combate, "Iniciar combate" fica no ⋯ ou na paleta.
- **Preparo:** sai do painel e vira gaveta própria, aberta pelo botão Notas/Preparo ou pela paleta. Durante o jogo, um card compacto "Próximo passo: Emboscada na ponte ▸ Iniciar" aparece no topo do painel.

| Prós | Contras |
|---|---|
| Menor custo: é quase só mover slots (a barra já recebe `ReactNode`) | Não resolve a raiz: preparar e jogar continuam na mesma tela, só mais arrumados |
| Nada some; o Mestre não precisa aprender "modos" | O ⋯ vira gaveta de bagunça se não houver disciplina |
| Resolve abas cortadas (2 abas cabem) e a sobreposição em 1366 | Na terça, preparando, o Mestre ainda vê chat vazio ocupando 384px |
| Pode ser entregue em partes pequenas | Configurar Mapa, Acervo e homebrew continuam espalhados em 3 portas |

---

### Caminho B: Dois modos explícitos, "Preparar" e "Jogar"

Um seletor na barra troca o layout inteiro. **O modo muda só a disposição, nunca o que o Mestre pode fazer**: tudo continua alcançável pela paleta.

```
 MODO PREPARAR
┌───────────────────────────────────────────────────────────────────────────┐
│ MESA · [ Preparar | Jogar ]                         Convite  👥  Lobby    │
├──────────────────────┬──┬─────────────────────────────────────────────────┤
│ Mapas │Acervo│Preparo│V │                                                 │
│ Criaturas │ Handouts │H │                                                 │
│──────────────────────│F │                  MAPA                           │
│ ▸ Mapa 1   ● ativo   │P │                                                 │
│   Mapa 2  (ponte)    │D │      (calibração de grid e névoa                │
│   + novo mapa        │  │       ficam em evidência)                       │
│──────────────────────│  │                                                 │
│ Grid: 70px · 1,5 m   │  │                                                 │
│ [Calibrar]           │  │                                                 │
└──────────────────────┴──┴─────────────────────────────────────────────────┘

 MODO JOGAR
┌───────────────────────────────────────────────────────────────────────────┐
│ MESA · Mapa 1 · [ Preparar | Jogar ]      Cast  ♪ ▶ Taverna      👥  ⋯    │
├──┬────────────────────────────────────────────────────┬───────────────────┤
│V │                                                    │ ▸ Próximo passo   │
│H │                                                    │   Emboscada ▸     │
│R │                     MAPA                           ├───────────────────┤
│T │                                                    │ Rodada 2 · Kael   │
│D │                                                    │ [‹]  [Próximo ›]  │
│  │                                                    ├───────────────────┤
│  │                                                    │ chat…             │
└──┴────────────────────────────────────────────────────┴───────────────────┘
```

- **Preparar:**
  - Bancada à esquerda com Mapas (+ grid/calibração inline), Acervo, Preparo (edição), Criaturas & Homebrew, Handouts.
  - Névoa e Pino em destaque na barra de ferramentas.
  - O painel direito some (ou vira Notas).
- **Jogar:**
  - Barra enxuta (nome do mapa, Cast, som tocando, participantes).
  - Coluna direita fixa: próximo passo do Preparo → iniciativa (se houver combate) → chat.
  - Névoa continua na barra de ferramentas (revelar ao vivo), mas sem as ações de montagem.
- **Jogador:** sempre em "Jogar"; o seletor nem aparece.

| Prós | Contras |
|---|---|
| Separação máxima: cada tela fica com poucas coisas e um objetivo claro | **Improvisar custa uma troca de modo**, justo com a mesa esperando. A paleta mitiga, mas o Mestre precisa lembrar dela |
| Casa com o modelo mental que o dono descreveu | "Cadê o Acervo?": estado escondido gera dúvida, e o que é de ambos (Mapas, Névoa, Sons) precisa de regra clara |
| Preparar ganha espaço de verdade (bancada larga, calibração sem modal) | Maior custo: RoomPage.tsx (1377 linhas) precisa de uma store de layout, e o SidePanel hoje desmonta abas |
| Jogar fica perto do que o PRODUCT.md promete ("a ferramenta some") | O Mestre pode esquecer em que modo está; a troca precisa ser muito visível e reversível |
| O modo imersivo vira extensão natural do "Jogar" | Duas telas para manter consistentes a cada feature nova |

---

### Caminho C: Mapa no centro, bastidores à esquerda e mesa à direita (recomendado)

Sem modo, mas com **geografia fixa**: tudo que é de *editar/montar* mora numa gaveta à esquerda ("Bastidores"); tudo que é de *conduzir* mora na coluna à direita ("Mesa"). Cada lado abre e fecha sozinho, com tecla própria. Preparar = bastidores abertos; jogar = bastidores fechados. O Mestre muda de momento sem mudar de tela.

```
 PREPARANDO (bastidores abertos, mesa recolhida)
┌───────────────────────────────────────────────────────────────────────────┐
│ MESA · Mapa 1 ▾                                       Convite  👥  ⋯      │
├───────────────────────┬──┬───────────────────────────────────────────────┬┤
│ BASTIDORES        [«] │V │                                               ││
│ Mapas · Acervo ·      │H │                                               │«│ ← mesa recolhida
│ Criaturas · Preparo · │F │                  MAPA                         ││   (selos: 2 msgs)
│ Handouts · Sons       │P │                                               ││
│───────────────────────│D │                                               ││
│ …conteúdo da seção…   │  │                                               ││
└───────────────────────┴──┴───────────────────────────────────────────────┴┘

 JOGANDO (bastidores fechados, mesa aberta)
┌───────────────────────────────────────────────────────────────────────────┐
│ MESA · Mapa 1 ▾                  Cast  ♪ Taverna        Convite  👥  ⋯    │
├┬──┬────────────────────────────────────────────────────┬──────────────────┤
│»│V │                                                    │ MESA        [»]  │
│ │H │                                                    │ ▸ Emboscada ▸    │ ← próximo passo
│ │R │                    MAPA                            │ Rodada 2 · Kael  │
│ │T │                                                    │ [‹]  [Próximo ›] │
│ │D │                                                    │ Chat │ Fichas    │
│ │  │                                                    │ chat…            │
└┴──┴────────────────────────────────────────────────────┴──────────────────┘
```

- **Bastidores (esquerda, gaveta ~360px):**
  - Mapas (com grid/calibração inline em vez de modal).
  - Acervo, Criaturas & Homebrew (a porta visível que falta hoje).
  - Preparo (edição completa), Handouts, Sons.
  - Uma seção por vez, com tecla própria: as M/J/B atuais passam a abrir a seção certa dos bastidores.
- **Mesa (direita):**
  - Próximo passo do Preparo (uma linha) → iniciativa compacta quando há combate → Chat/Fichas.
  - A aba Preparo some daqui.
- **Barra superior:** fica só com estado (mapa atual e aviso de divergência, Cast, som tocando, participantes, convite) e um ⋯ para Notas, Macros e Lobby.
- **Improvisar no meio do jogo:** M abre os bastidores já na seção Mapas por cima do mapa; Esc fecha; a mesa à direita **não fecha**. O chat continua visível enquanto o Mestre cria o mapa.
- **Em 1366:** abrir um lado recolhe o outro automaticamente (dá para fixar os dois em telas largas).
- **Jogador:** não tem bastidores; vê a coluna Mesa como hoje, com 2 abas em vez de 3.

| Prós | Contras |
|---|---|
| Separa por momento **sem modo**: improvisar é abrir uma gaveta, não trocar de tela | Custo médio: gaveta nova, mover MapsPanel/Acervo/Preparo para dentro dela, store de layout |
| Memória espacial simples: "esquerda = bastidores, direita = mesa" | A barra de ferramentas vertical fica espremida entre a gaveta e o mapa; talvez tenha de flutuar ou ir para o topo do mapa |
| Unifica 8 formatos de contêiner em 2 (gaveta de bastidores, coluna da mesa) + pop-overs | Em 1366, preparar com o chat aberto não cabe; o fechamento automático do outro lado precisa ser previsível |
| Dá casa aos órfãos (Criaturas, Homebrew, Sons) e acaba com as 4 portas de Notas/Mapa | Alguém que prefere o layout atual perde a barra superior cheia de botões diretos (a paleta e as teclas compensam) |
| Reaproveita o que já existe: recolher do painel, flags do imersivo, teclas M/J/B | Precisa de cuidado para o card de NPC e o inspetor não virarem uma terceira coluna |

---

### Comparação rápida

| | A. Reagrupar | B. Dois modos | C. Bastidores × Mesa |
|---|---|---|---|
| Controles visíveis do GM (estimativa) | ~35 | ~20 por modo | ~25 jogando / ~30 preparando |
| Custo de improvisar no jogo | baixo | **alto** (troca de modo) | baixo (abrir gaveta) |
| Separa preparar × jogar | pouco | totalmente | na prática, sim |
| Resolve chat × iniciativa | sim (piso) | sim | sim |
| Porta visível para criaturas/homebrew | não | sim | sim |
| Esforço | pequeno | grande | médio |
| Entrega incremental | fácil | difícil (vira tudo de uma vez) | boa (piso → gaveta → migrar seções) |

## 10. Recomendação

**Caminho C, entregue a partir do piso comum.**

O dono descreveu dois momentos, e está certo. Mas o levantamento mostra que **quase tudo atravessa os dois momentos**, e o Mestre de uma mesa de amigos improvisa muito. Um modo explícito (B) acerta o diagnóstico e erra o custo no pior momento. Reagrupar (A) é barato, mas deixa a terça-feira de preparo com a mesma cara do sábado de jogo.

O C faz a separação pelo espaço em vez de pelo estado:
- o Mestre prepara com os bastidores abertos;
- joga com eles fechados;
- quando precisa improvisar, abre só o que precisa, sem perder a mesa de vista.

**Ordem sugerida** (cada passo se sustenta sozinho):

1. **Piso:** tecla D; iniciativa + chat juntos; rascunho do chat na store; engrenagem das preferências do combate; atalhos M/J/B em hooks.
2. **Barra superior** só com estado e um ⋯. A aba Preparo sai do painel lateral e o card "próximo passo" entra.
3. **Gaveta de Bastidores** com Mapas e Preparo.
4. **Migrar** Acervo, Handouts, Criaturas & Homebrew e Sons para dentro dela; calibração de grid inline.
5. **Paleta de comandos global.**

**Fora do escopo desta crítica, mas tocado por ela:**
- A mudança altera o layout descrito no SPEC (§9.x da Mesa). Quando for implementada, o SPEC precisa ser atualizado no mesmo commit.
- Nenhuma das propostas adiciona feature nova; todas reorganizam o que já existe. A paleta de comandos é a única peça nova e merece confirmação do dono antes.

## 11. Perguntas para decidir

- Em uma sessão real, quantas vezes o Mestre cria ou edita um mapa **durante** o jogo? Se é raro, o custo do caminho B cai muito.
- A mesa presencial (TV/projetor) muda a resposta? O Mestre joga olhando o notebook com tudo aberto, ou o notebook também fica "limpo"?
- O que o Mestre olha **a cada turno**? Se a resposta é "iniciativa e chat", essas duas coisas merecem estar sempre juntas, e o resto pode ficar a um clique.
- Macros e Notas são de jogar ou de preparar para este grupo? A resposta decide se ficam na barra ou no ⋯.
