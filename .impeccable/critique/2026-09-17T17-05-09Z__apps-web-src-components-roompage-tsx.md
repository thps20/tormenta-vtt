---
target: arquitetura de informação da Mesa (GM)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/thiago/projetos/tormenta-vtt/apps/web/src/components/RoomPage.tsx"
target_fingerprint: "sha256:ca7fbf9d4c71430a99178d2b14a04c06e08723f4aadf25851a86f2785bc6e5a4"
target_path: /home/thiago/projetos/tormenta-vtt/apps/web/src/components/RoomPage.tsx
timestamp: 2026-09-17T17-05-09Z
slug: apps-web-src-components-roompage-tsx
---
# Crítica: arquitetura de informação da Mesa

> Data: 2026-09-17 · Método: `/impeccable critique` com duas avaliações independentes (A: revisão de design lendo o código e a tela ao vivo; B: detector automático + medições no navegador). Nada foi implementado.
> Evidência: prints e medições em `C:\Temp\critA-*.png`, `C:\Temp\critB-*.png` e `C:\Temp\critB-*.json` (Edge headless, 1920x1080 e 1366x768, GM e jogador, fora e dentro do combate).

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
