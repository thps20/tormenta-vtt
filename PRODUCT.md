# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Quem usa:** o dono do projeto e o grupo de amigos dele. É a ferramenta de uma mesa específica, não um produto aberto ao público (sem planos confirmados de abrir).
- **Mestre (GM):** cria a sala, prepara mapas, grid, névoa, criaturas e encontros, conduz o combate e decide o que cada jogador vê. É quem mais opera a interface, e sob pressão: com a mesa esperando.
- **Jogador:** entra pelo link de convite com um apelido, sem conta. Move os próprios tokens, rola pela ficha ou pelo chat, acompanha a iniciativa e o próprio turno.
- **Trabalho a fazer:** jogar uma sessão inteira de Tormenta20 sem sair do VTT para rolar dados, consultar a ficha, contar iniciativa, medir distância ou aplicar dano.

## Product Purpose

VTT (Virtual Tabletop) web para jogar Tormenta20 com o próprio grupo, online ou numa mesa presencial com o mapa numa tela. Sucesso é a ferramenta sumir durante o jogo: a mesa fica na história, não em cliques, e o Mestre não precisa brigar com a interface para manter o ritmo.

## Positioning

**Automação na medida certa.** O Tormenta VTT faz as contas chatas do Tormenta20 (rolagem no servidor, iniciativa e desempate, dano sugerido pela resistência do alvo, orçamento de deslocamento, expiração de condições por rodada), mas **o Mestre sempre confirma**: o valor aplicado é o que ele aprovou, nunca o que o sistema calculou por conta própria. É mais esperto que um tabuleiro com dados (Owlbear Rodeo) e deliberadamente menos automático e pesado que o Foundry.

## Operating Context

- **Online:** todo mundo no computador (desktop/notebook). Áudio e vídeo ficam fora do VTT.
- **Presencial:** o mapa aparece numa TV ou projetor para uma mesa física, em paralelo ao jogo online. Existe um modo imersivo (§9.22 do SPEC) em que as barras somem por ociosidade.
- **Sessões longas, geralmente à noite:** várias horas seguidas de tela.
- **Hospedagem:** roda na máquina do dono (`make dev`), e os jogadores de fora da rede entram por um túnel Cloudflare temporário (`docs/testar-com-amigos.md`). Não há deploy.
- **Papéis e rituais:** criar sala → mandar link → jogadores entram com apelido → ficha, mapa, combate e chat na mesma tela. O `sessionToken` no `localStorage` reconecta cada pessoa como o mesmo participante.

## Capabilities and Constraints

- **Escopo:** o MVP e a Fase 2 descritos em `docs/SPEC.md` são a fonte da verdade. Feature fora dele só com pedido do dono.
- **Implementado:** sala e convite sem login; mapas múltiplos com grid calibrável e escala; tokens com condições e PV; chat com fórmulas de dados, modos de rolagem (pública, secreta, própria) e sussurros; modo de combate com iniciativa e orçamento de deslocamento; ficha de personagem calculada a partir do JSON do sistema; compêndio e criaturas importados dos packs do Foundry; névoa manual; régua com vértices; gabaritos de área; alvos; handouts e pinos; notas do Mestre; desenho livre; homebrew da sala; macros; desfazer do Mestre; modo imersivo.
- **Controle de informação:** o Mestre decide o que cada um vê (tokens ocultos, névoa, rolagens secretas e às cegas, sussurros) e o servidor filtra antes de enviar. O GM sempre vê tudo, inclusive sussurros entre jogadores.
- **Agnóstico de sistema:** toda regra vive em `packages/shared/systems/<id>.json`. Tormenta20 é o primeiro e, por ora, o único sistema.
- **Idioma:** tudo em português do Brasil.
- **Terminologia:** na interface é sempre **"mapa"**, nunca "cena" (em T20, "cena" é unidade de tempo de jogo). "Mestre"/"GM" e "jogador" são os papéis.
- **Aparelhos:** computador é o alvo. Celular e tablet **não** são alvo confirmado. A TV ou o projetor aparece só como tela de exibição do mapa.
- **Fora do escopo:** contas e login, áudio e vídeo, luz dinâmica e paredes, automação avançada da ficha (efeitos ativos, poderes por nível com escolhas).
- **Em aberto:** o visual definitivo de várias telas (combate, ficha rápida de NPC) está marcado no SPEC como "mínimo e funcional", aguardando telas do AI Studio.

## Brand Commitments

- **Nome:** "Tormenta VTT".
- **Voz:** português do Brasil, com o vocabulário do Tormenta20 (PV, PM, Defesa, perícias, condições como aparecem no livro).
- **Em aberto:** a relação com a marca Tormenta20 (Jambô) não foi definida. Não sugerir afiliação oficial nem usar arte ou logotipo oficial.

## Evidence on Hand

- `docs/SPEC.md`: comportamento completo e decisões; `docs/plano-*.md` e `docs/revisao-*.md`: raciocínio e bordas testadas.
- `packages/shared/systems/tormenta20.json`: regras do sistema. Compêndio importado dos packs do Foundry, com lacunas conhecidas em `scripts/import-report.md`.
- `docs/tipos-para-ui.md`, `docs/tipos-ficha-rapida.md`, `docs/tipos-combate.md` e `docs/tipos-galeria-handouts.md`: contratos de dados prontos para gerar UI.
- **Não existem:** usuários externos, depoimentos, métricas, preço ou licença. Nada disso deve ser inventado.

## Product Principles

1. **O sistema calcula, o Mestre confirma.** Automação sugere e mostra a conta; nenhuma regra é aplicada à revelia de quem conduz a mesa.
2. **A mesa não para pela ferramenta.** Entrar tem que ser um link e um apelido; as ações frequentes do Mestre em combate têm que ser rápidas e, sempre que der, ter atalho de teclado.
3. **Segredo é do Mestre.** Cada informação tem um público explícito (todos, só o GM, só quem rolou, sussurro) e o servidor garante isso, não a interface.
4. **Feito para um grupo, não para um mercado.** O escopo segue o que a mesa realmente usa; nada de recursos de produto público só por completude.
5. **Regras nos dados, não no código.** Um sistema novo entra por JSON, e a interface nunca pressupõe atributos ou perícias do Tormenta20.

## Accessibility & Inclusion

- **Conforto em sessão longa à noite:** várias horas de tela em ambiente escuro. Evitar brilho agressivo e manter texto legível sem cansar.
- **Legível à distância:** quando o mapa vai para TV ou projetor, tokens, condições, anel de turno e a régua precisam ser lidos do outro lado da mesa.
- **Informação que não depende só de cor:** crítico e falha, modo de rolagem e condições já trazem rótulo ou ícone além da cor. Manter assim.
