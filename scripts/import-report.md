# Relatório da importação do compêndio (Foundry → tormenta-vtt)

Gerado por `scripts/import-foundry-compendium.ts` a partir de `/home/thiago/projetos/foundry-tormenta20/packs/_source` (system.json 1.5.015).
Este arquivo é regenerado a cada execução; não edite à mão. Plano e decisões em `docs/plano-importador.md`.

## Entradas geradas por arquivo

| Arquivo | Entradas |
|---|---|
| armor.json | 24 |
| classes.json | 12 |
| consumables.json | 95 |
| gear.json | 160 |
| powers.json | 745 |
| races.json | 16 |
| spells.json | 200 |
| weapons.json | 66 |

## Fora do escopo

Packs ignorados de propósito (criaturas, convocações, macros, tabelas, journals):

| Pack | Documentos |
|---|---|
| ameacas (criaturas (NPCs)) | 83 |
| convocacoes (criaturas convocadas) | 18 |
| habilidades-de-criaturas (habilidades e armas naturais de criaturas) | 61 |
| parceiros (parceiros (regra de NPC)) | 18 |

## Regras aplicadas (decisões do dono do projeto)

- PV inicial das classes = 4 × PV por nível (não existe no Foundry; conferido no livro para Guerreiro, Arcanista, Bárbaro e Ladino).
- Armaduras: `maxAttr` (limite de atributo na Defesa) não é importado; o Foundry traz 0 em todas. Pesadas estão listadas em TODO para conferir no livro.
- Resistência: `resistencia.atributo` do Foundry é ignorado; a CD usa o atributo de conjuração da ficha (`save.attribute = null`).
- Armas: `@for` no dano vira `attribute: "auto"` (a regra `damageAttribute` do sistema decide por tipo de uso); armas mágicas com "+N" no ataque/dano recebem `bonus: N`.
- Poderes `ability` → `habilidade`, `distincao` → `distincao` (opções adicionadas a `power.type` no JSON do sistema).
- Aprimoramentos (effects `onuse`+`self` de magias, poderes e consumíveis) viram `enhancements[{ id: "eN", cost, repeatable, effect? }]`; `repeatable` = flag `aumenta` ("Múltiplas Aplicações"). O texto vai para `descriptions.local.json` na chave `<id>#eN` e a lista continua no fim da descrição ("+N PM: ..."). Truque (custo vazio em magia) e custos negativos ficam só na descrição. Os demais effects (efeitos ativos) não entram mais na descrição.
- Poderes raciais entram em `powers.json` com a raça como tag; o vínculo raça → poderes (`grants` do Foundry) não é modelado no nosso schema.

Aprimoramentos (effects `onuse`+`self`): 568 em 218 entradas, 170 repetíveis (`aumenta`); 15 truques (custo vazio em magia, só na descrição); 291 effects `onuse` sem `self` não modelados (aprimoramentos concedidos a outras magias/ataques, ex.: Familiar Coruja).

Efeito mecânico preenchido só quando o texto inteiro casa um padrão estrito ("aumenta o dano em +XdY", "+XdY de dano", "muda o dano para XdY", "aumenta a cura em +XdY", "aumenta a CD em +N", "muda o alcance para <unidade>", "muda a duração para [N] <unidade>", "muda a área para <texto>", "aumenta o número de alvos em +N"): 1 `areaSet`, 18 `damageDiceAdd`, 8 `durationSet`, 2 `healDiceAdd`, 5 `rangeSet`, 15 `targetsAdd`. Frases compostas ("muda o alcance para médio e a duração para cena") e os demais ficam como só custo e estão listados por categoria no fim deste relatório.

Efeitos ativos (`effects[]` com `changes`) são ignorados de propósito; só a contagem:

| Tipo Foundry | Documentos com efeitos |
|---|---|
| arma | 3 |
| consumivel | 23 |
| equipamento | 59 |
| magia | 164 |
| poder | 371 |
| tesouro | 8 |

## Substituídos por custom.json

Ids que existem em `custom.json` (confirmados no livro) e por isso não foram gerados:

- `anao`
- `arcanista`
- `arco-curto`
- `couro-batido`
- `espada-longa`
- `guerreiro`
- `humano`

## Colisões de id

Nomes repetidos; o id ganhou sufixo (subtipo ou id do Foundry):

- "Lendas e Histórias" (poderes/classe/bardo/lendas-e-histórias.yml) → `lendas-e-historias-bardo`

## TODO (sem correspondência no Foundry ou fora dos nossos enums)

Total: 198 pendências em 14 categorias.

### alcance: valor fora dos nossos enums (gravado "special") (7)

- `controlar-o-clima`: `km`
- `convocacao-instantanea`: `any`
- `desejo`: `spec`
- `intervencao-divina`: `spec`
- `projetar-consciencia`: `any`
- `sonho`: `any`
- `videncia`: `any`

### aprimoramento: sem a flag de múltiplas aplicações (gravado como não repetível) (6)

- `amedrontar`: "afeta todos os alvos válidos a sua escolha dentro do alcance."
- `ancora-dimensional`: "muda o efeito para criar um fio de energia cor de esmeralda que prende o alvo a "
- `area-escorregadia`: "muda a CD dos testes de Acrobacia para 15."
- `area-escorregadia`: "muda a CD dos testes de Acrobacia para 20."
- `arma-espiritual`: "invoca duas armas, permitindo que você contra-ataque (ou ataque, se usar o aprim"
- `arma-espiritual`: "muda o tipo do dano para essência. Requer 2o círculo."

### armadura pesada: limite de atributo na Defesa (maxAttr) não importado; conferir no livro (9)

- `armadura-completa`: Foundry maxAtr = 0
- `armadura-da-luz`: Foundry maxAtr = 0
- `baluarte-anao`: Foundry maxAtr = 0
- `brunea`: Foundry maxAtr = 0
- `carapaca-demoniaca`: Foundry maxAtr = 0
- `cota-de-malha`: Foundry maxAtr = 0
- `loriga-do-centuriao`: Foundry maxAtr = 0
- `loriga-segmentada`: Foundry maxAtr = 0
- `meia-armadura`: Foundry maxAtr = 0

### ataque: perícia vazia ou desconhecida no Foundry (ação de ataque omitida) (7)

- `besta-explosiva`: perícia `(vazia)`
- `ferramenta-agricola`: perícia `(vazia)`
- `ferramenta-pesada`: perícia `(vazia)`
- `lingua-do-deserto`: perícia `(vazia)`
- `martelo-de-carne`: perícia `(vazia)`
- `rolo-de-macarrao`: perícia `(vazia)`
- `vingadora-sagrada`: perícia `(vazia)`

### classe: proficiências não existem no Foundry (12)

- `barbaro`: conferir no livro
- `bardo`: conferir no livro
- `bucaneiro`: conferir no livro
- `cacador`: conferir no livro
- `cavaleiro`: conferir no livro
- `clerigo`: conferir no livro
- `druida`: conferir no livro
- `inventor`: conferir no livro
- `ladino`: conferir no livro
- `lutador`: conferir no livro
- `nobre`: conferir no livro
- `paladino`: conferir no livro

### dano: fórmula que o nosso parser não aceita (ação omitida) (5)

- `alma-de-bronze`: `@nivel + @for`: Caractere inválido "@" em "@nivel"
- `larva-explosiva`: `(4+(@Tormenta2*2))d4`: Caractere inválido "@" em "(4+(@Tormenta2*2))d4"
- `mente-aberrante`: `(1+(@Tormenta2))d6`: Caractere inválido "@" em "(1+(@Tormenta2))d6"
- `raio-arcano`: `(@circulo)d8`: Caractere inválido "@" em "(@circulo)d8"
- `use-seu-poder-para-o-bem`: `(@InquisidordaMagia)d6`: Caractere inválido "@" em "(@InquisidordaMagia)d6"

### dano: referência @ desconhecida (2)

- `fome-de-mana`: `@Tormenta`
- `sangue-acido`: `@Tormenta`

### dano: tipo sem correspondência (gravado sem tipo) (16)

- `campo-de-forca`: `curatpv`
- `cicuta`: `perda`
- `essencia-de-mana`: `curapm`
- `golpe-magico`: `curatpm`
- `homunculo`: `perda`
- `natureza-venenosa`: `perda`
- `nevoa-toxica`: `perda`
- `palavra-primordial`: `perda`
- `peconha-comum`: `perda`
- `peconha-concentrada`: `perda`
- `peconha-potente`: `perda`
- `po-de-lich`: `perda`
- `pocao-de-vitalidade-fantasma`: `curatpv`
- `presas-venenosas`: `perda`
- `sorte-dos-loucos`: `curapm`
- `vitalidade-fantasma`: `curatpv`

### duração: texto livre no Foundry (só a unidade foi mapeada) (20)

- `anular-a-luz`: "Ver Texto"
- `assassino-fantasmagorico`: "cena, até ser descarregada"
- `ate-acertar`: "acertar um ataque ou no fim da cena, o que acontecer primeiro"
- `colera-do-deus-sol`: "5 rodadas"
- `conceder-milagre`: "permanente ou até ser descarregada"
- `controlar-o-clima`: "4d12 horas"
- `controlar-o-tempo`: "veja texto"
- `desejo`: "veja texto"
- `detectar-ameacas`: "Cena, até ser descarregada"
- `dispersar-as-trevas`: "veja texto"
- `guardiao-divino`: "Cena ou até ser descarregado"
- `hipnotismo`: "1d4 Rodadas"
- `missao-divina`: "1 semana ou até ser descarregada"
- `palavra-primordial`: "instantânea ou veja texto"
- `preparacao-de-batalha`: "Permanente até ser descarregada"
- `queda-suave`: "até chegar ao solo ou cena, o que vier primeiro"
- `runa-de-protecao`: "permanente até ser descarregada"
- `servo-divino`: "Cena ou até ser descarregada"
- `sonho`: "Veja Texto"
- `telecinesia`: "sustentada ou instantânea (veja texto)"

### execução: valor fora dos nossos enums (gravado "special") (5)

- `a-qualquer-custo`: `day`
- `autoridade-feudal-cavaleiro`: `hour`
- `criar-flecha-da-morte`: `day`
- `runa-de-protecao`: `hour`
- `sonho`: `minute`

### fórmula: rolagem que o nosso parser não aceita (ação omitida) (3)

- `anatomia-insana`: `1d4cs<=1*@Tormenta2`: Caractere inválido "<" em "1d4cs<=1*@Tormenta2"
- `asas-insetoides`: `7.5+(@Tormenta*1.5)`: Caractere inválido "." em "7.5+(@Tormenta*1.5)"
- `desprezar-a-realidade`: `1d100cs<(min(20+(@Tormenta2*5),50))`: Caractere inválido "<" em "1d100cs<(min(20+(@Tormenta2*5),50))"

### página: sem `source` com "p. N" (76)

- `aggelus`: (vazio)
- `alaude-eletrico`: "Marca pag T20, 001"
- `arco-do-juramento`: "Marca pag T20, 002"
- `armadura-ossea`: (vazio)
- `aumento-de-atributo-carisma`: (vazio)
- `aumento-de-atributo-constituicao`: (vazio)
- `aumento-de-atributo-destreza`: (vazio)
- `aumento-de-atributo-forca`: (vazio)
- `aumento-de-atributo-inteligencia`: (vazio)
- `aumento-de-atributo-sabedoria`: (vazio)
- `aumento-de-atributo`: (vazio)
- `azagaia-dos-relampagos`: (vazio)
- `barbaro`: (vazio)
- `bardo`: (vazio)
- `besta-explosiva`: (vazio)
- `bucaneiro`: (vazio)
- `cacador`: (vazio)
- `cajado-da-destruicao`: (vazio)
- `cajado-da-vida`: (vazio)
- `cajado-do-poder`: (vazio)
- `cavaleiro`: (vazio)
- `clerigo`: (vazio)
- `controlar-ar`: "Errata ADB, Blog da Jambô"
- `dahllan`: (vazio)
- `druida`: (vazio)
- `elfo`: (vazio)
- `espada-baronial`: (vazio)
- `espada-sortuda`: (vazio)
- `florete-fugaz`: (vazio)
- `goblin`: (vazio)
- `golem`: (vazio)
- `hynne`: (vazio)
- `inventor`: (vazio)
- `julgamento-divino-justica`: (vazio)
- `kliren`: (vazio)
- `ladino`: (vazio)
- `lamina-da-luz`: (vazio)
- `lanca-animalesca`: (vazio)
- `lefou`: (vazio)
- `lingua-do-deserto`: (vazio)
- `lutador`: (vazio)
- `maca-do-terror`: (vazio)
- `machado-silvestre`: (vazio)
- `magias-clerigo`: (vazio)
- `martelo-dos-anoes`: (vazio)
- `medusa`: (vazio)
- `minotauro`: (vazio)
- `nobre`: (vazio)
- `odre`: (vazio)
- `osteon`: (vazio)
- `paladino`: (vazio)
- `pocao-de-concentracao-de-combate-cena`: (vazio)
- `pocao-de-enfeiticar`: (vazio)
- `pocao-de-escudo-da-fe-cena`: (vazio)
- `pocao-de-fisico-divino-3-atributos`: (vazio)
- `pocao-de-fisico-divino`: (vazio)
- `pocao-de-invisibilidade-cena`: (vazio)
- `pocao-de-mente-divina`: (vazio)
- `pocao-de-metamorfose`: (vazio)
- `pocao-de-velocidade`: (vazio)
- `pocao-de-visao-mistica`: (vazio)
- `pocao-de-vitalidade-fantasma`: (vazio)
- `pocao-de-voz-divina`: (vazio)
- `protecao-contra-magia`: (vazio)
- `punhal-traicoeiro`: (vazio)
- `qareen`: (vazio)
- `ramo-verdejante`: (vazio)
- `sereia-tritao`: (vazio)
- `silfide`: (vazio)
- `sorte-dos-loucos`: (vazio)
- `sulfure`: (vazio)
- `traje-de-artista`: (vazio)
- `trog`: (vazio)
- `versatilidade`: (vazio)
- `vingadora-sagrada`: (vazio)
- `voz-poderosa`: (vazio)

### raça: sentidos e perícias treinadas não existem no Foundry (16)

- `aggelus`: conferir no livro
- `dahllan`: conferir no livro
- `elfo`: conferir no livro
- `goblin`: conferir no livro
- `golem`: conferir no livro
- `hynne`: conferir no livro
- `kliren`: conferir no livro
- `lefou`: conferir no livro
- `medusa`: conferir no livro
- `minotauro`: conferir no livro
- `osteon`: conferir no livro
- `qareen`: conferir no livro
- `sereia-tritao`: conferir no livro
- `silfide`: conferir no livro
- `sulfure`: conferir no livro
- `trog`: conferir no livro

### resistência: texto sem uma perícia única (14)

- `armadilha-arataca`: "Força ou Acrobacia"
- `assassino-fantasmagorico`: "Vontade Anula, Fortitude Parcial"
- `controlar-agua`: "Veja texto"
- `controlar-ar`: "veja texto"
- `controlar-terra`: "Veja texto"
- `desejo`: "veja texto"
- `despedacar`: "Fortitude parcial ou Reflexos anula"
- `furia-do-panteao`: "veja texto"
- `intervencao-divina`: "veja texto"
- `muralha-elemental`: "veja texto"
- `refletir-magia`: "Fortitude, Reflexo ou Vontade"
- `runa-de-protecao`: "varia (veja o texto)"
- `terremoto`: "veja texto"
- `toque-da-morte`: "Veja texto"

## Aprimoramentos sem efeito mecânico (por categoria)

519 aprimoramentos ficaram como só custo (`effect` ausente) porque o texto não casa nenhum padrão estrito. Não entram no total de TODO; o jogador pode completar o efeito na ficha (modo edição).

### alcance (15)

- `alarme#e1`: muda o alcance para pessoal. A área é emanada a partir de você.
- `aviso#e1`: aumenta o alcance em um fator de 10 (90m para 900m, 900m para 9km e assim por diante).
- `baluarte#e3`: afeta aliados em alcance curto
- `conjurar-elemental#e2`: você convoca um elemental de cada tipo. Quando lança a magia, você pode escolher se cada elemental …
- `criar-ilusao#e4`: também pode criar sons complexos com volume máximo equivalente ao que cinco pessoas podem produzir …
- `despedacar#e6`: muda o alcance para pessoal e a área para esfera de 6m de raio. Todas as criaturas e objetos na áre…
- `escudo-da-fe#e1`: muda a execução para ação padrão, o alcance para toque e a duração para cena.
- `globo-da-verdade#e4`: muda o alcance para longo e o efeito para 10 globos. Todos mostram a mesma cena.
- `luz#e5`: (Apenas Arcanos): muda o alcance para longo e o efeito para cria 4 pequenos globos flutuantes de pu…
- `montaria-arcana#e1`: além do normal, criaturas do tipo animal em alcance curto da montaria devem fazer um teste de Vonta…
- `nevoa#e2`: você pode escolher criaturas no alcance ao lançar a magia; elas enxergam através do efeito. Requer …
- `nevoa#e3`: a nuvem tem um cheiro horrível. No início de seus turnos, qualquer criatura dentro dela, ou qualque…
- `oracao#e3`: muda o alcance para médio. Requer 3º círculo.
- `possessao#e3`: muda a duração para permanente, mas destrói seu corpo original no processo. Uma criatura possuída p…
- `tranca-arcana#e1`: muda o alcance para curto e a duração para instantânea. Em vez do normal, a magia abre portas, baús…

### alvo adicional (150)

- `abencoar-alimentos#e2`: muda a duração para permanente, o alvo para 1 frasco com água e adiciona componente material (pó de…
- `acalmar-animal#e2`: muda o alvo para 1 monstro ou espírito com Inteligência 1 ou 2.
- `acalmar-animal#e4`: muda o alvo para 1 monstro ou espírito. Requer 3o círculo.
- `adaga-mental#e1`: você lança a magia sem gesticular ou
pronunciar palavras (o que permite lançar essa magia de armadu…
- `adaga-mental#e2`: muda a duração para 1 dia. Além do normal, você "finca" a adaga na mente do alvo. Enquanto a magia …
- `aliado-animal#e1`: muda o alvo para 1 animal Minúsculo e a duração para 1 semana. Em vez do normal, o animal se desloc…
- `aliado-animal#e3`: muda o alvo para 2 animais prestativos. Cada animal funciona como um parceiro de um tipo diferente,…
- `alterar-memoria#e1`: muda o alcance para pessoal e o alvo para área cone de 4,5m.
- `alterar-tamanho#e2`: muda o alcance para toque e o alvo para 1 criatura. Em vez do normal, o alvo aumenta uma categoria …
- `alterar-tamanho#e3`: muda o alcance para toque e o alvo para 1 criatura. Em vez do normal, o alvo diminui uma categoria …
- `alterar-tamanho#e4`: muda o alcance para toque, o alvo para 1 criatura, a duração para permanente e a resistência para F…
- `amarras-etereas#e2`: aumenta o número de laços em um alvo a sua escolha em +1. (bônus máximo limitado pelo círculo máxim…
- `amedrontar#e1`: alvos que falhem na resistência ficam apavorados por 1d4+1 rodadas, em vez de apenas 1.
- `amedrontar#e2`: muda o alvo para 1 criatura.
- `amedrontar#e3`: afeta todos os alvos válidos a sua escolha dentro do alcance.
- `ancora-dimensional#e1`: muda o alcance para médio, a área para esfera com 3m de raio e o alvo para criaturas escolhidas.
- `ancora-dimensional#e4`: muda o alvo para área de cubo de 9m, a duração para permanente e adiciona componente material (chav…
- `ancora-dimensional#e5`: muda o alcance para médio, a área para esfera de 3m de raio e o alvo para criaturas escolhidas. Cri…
- `aparencia-perfeita#e1`: muda o alcance para toque e o alvo para 1 humanoide
- `arma-espiritual#e3`: muda a duração para sustentada. Além do normal, uma vez por rodada, você pode gastar uma ação livre…
- `aviso#e2`: se escolher mensagem, o alvo pode enviar uma resposta de até 25 palavras para você até o fim de seu…
- `aviso#e3`: se escolher localização, muda a duração para cena. O alvo sabe onde você está mesmo que você mude d…
- `bencao#e1`: muda o alvo para 1 cadáver e a duração para 1 semana. O cadáver não se decompõe nem pode ser transf…
- `camuflagem-ilusoria#e1`: a imagem do alvo fica mais distorcida, aumentando a chance de falha da camuflagem leve para 50%.
- `camuflagem-ilusoria#e2`: muda o alcance para curto e o alvo para criaturas escolhidas. Requer 4º círculo.
- `circulo-da-justica#e1`: muda a execução para ação padrão, o alcance para pessoal, o alvo para você, a duração para cena e a…
- `comando#e1`: muda o alvo para 1 criatura.
- `compreensao#e2`: muda o alcance para curto e o alvo para criaturas escolhidas. Você pode entender todas as criaturas…
- `compreensao#e3`: muda o alvo para 1 criatura. Em vez do normal, pode vasculhar os pensamentos do alvo para extrair i…
- `compreensao#e4`: muda o alcance para pessoal e o alvo para você. Em vez do normal, você pode falar, entender e escre…
- `concentracao-de-combate#e3`: muda a execução para padrão, o alcance para curto, o alvo para criaturas escolhidas e a duração par…
- `controlar-madeira#e3`: muda o alvo para Enorme ou menor. Requer 3º círculo.
- `controlar-madeira#e4`: muda o alvo para Colossal ou menor. Requer 4º círculo.
- `controlar-plantas#e3`: muda o alcance para pessoal, a área para alvo (você) e a resistência para nenhuma. Em vez do normal…
- `convocacao-instantanea#e2`: muda o alvo para um baú Médio, a duração para permanente e adiciona sacrifício de 1 PM. Em vez do n…
- `convocacao-instantanea#e4`: muda o alvo para 1 objeto de até 10 espaços. Um objeto muito grande ou pesado para aparecer em suas…
- `curar-ferimentos#e2`: também remove uma condição de fadiga do alvo.
- `curar-ferimentos#e4`: muda o alcance para curto e o alvo para criaturas escolhidas.
- `despedacar#e2`: muda o alvo para objeto mundano Médio. Requer 2º círculo.
- `despedacar#e3`: muda o alvo para objeto mundano Grande. Requer 3º círculo.
- `despedacar#e4`: muda o alvo para objeto mundano Enorme. Requer 4º círculo.
- `despedacar#e5`: muda o alvo para objeto mundano Colossal. Requer 5º círculo.
- `despertar-consciencia#e1`: muda o alvo para 1 escultura mundana inanimada. Além do normal, o alvo tem as mesmas característica…
- `dificultar-deteccao#e1`: muda o alvo para área de cubo de 9m. Qualquer criatura ou objeto na área recebe o efeito da magia e…
- `disfarce-ilusorio#e1`: muda o alcance para curto e o alvo para 1 objeto. Você pode, por exemplo, transformar pedaços de fe…
- `disfarce-ilusorio#e2`: muda o alcance para curto e o alvo para 1 criatura. Uma criatura involuntária pode anular o efeito …
- `disfarce-ilusorio#e4`: muda o alcance para curto e o alvo para criaturas escolhidas. Cada criatura pode ter uma aparência …
- `dispersar-as-trevas#e2`: muda o alcance para curto, a área para alvo 1 criatura e a duração para cena. O alvo fica imune a e…
- `enfeiticar#e1`: em vez do normal, você sugere uma ação para o alvo e ele obedece. A sugestão deve ser feita de modo…
- `enfeiticar#e2`: muda o alvo para 1 espírito ou monstro. Requer 3º círculo.
- `enfeiticar#e3`: afeta todos os alvos dentro do alcance.
- `escudo-da-fe#e2`: também fornece ao alvo camuflagem leve contra ataques à distância.
- `esculpir-sons#e1`: aumenta o número de alvos em +1. Todas as criaturas e objetos devem ser afetadas da mesma forma.
- `escuridao#e4`: muda o alvo para 1 criatura e a resistência para Fortitude parcial. Você lança a magia nos olhos do…
- `escuridao#e5`: muda o alcance para pessoal e o alvo para você. Em vez do normal, você é coberto por sombras, receb…
- `ferver-sangue#e2`: muda alvo para criaturas escolhidas. Requer 5º círculo.
- `fisico-divino#e1`: muda o alcance para curto e o alvo para criaturas escolhidas.
- `fisico-divino#e2`: em vez do normal, o alvo recebe +2 nos três atributos físicos. Requer 3º círculo.
- `fisico-divino#e3`: em vez do normal, o alvo recebe +4 no atributo escolhido. Requer 4º círculo.
- `fisico-divino#e4`: em vez do normal, o alvo recebe +4 nos três atributos físicos. Requer 5º círculo.
- `flecha-acida#e1`: além do normal, se o alvo coberto pelo muco ácido estiver usando armadura ou escudo, o item é corro…
- `forma-eterea#e1`: muda o alcance para toque e o alvo para até 5 criaturas voluntárias que estejam de mãos dadas. Depo…
- `hipnotismo#e1`: como o normal, mas alvos que passarem na resistência não sabem que foram vítimas de uma magia.
- `hipnotismo#e2`: muda o alvo para animais ou humanoides escolhidos.
- `imobilizar#e1`: muda o alvo para 1 espírito.
- `imobilizar#e3`: muda o alvo para 1 criatura. Requer 4º círculo
- `infligir-ferimentos#e1`: além do normal, se falhar na resistência, o alvo fica fraco pela cena.
- `infligir-ferimentos#e4`: muda o alcance para curto e o alvo para criaturas escolhidas.
- `invisibilidade#e1`: muda a execução para ação padrão, o alcance para toque e o alvo para 1 criatura ou um objeto Grande…
- `invisibilidade#e3`: muda a duração para sustentada. Em vez do normal, o alvo gera uma esfera de invisibilidade. Não pod…
- `invisibilidade#e4`: muda a execução para ação padrão, o alcance para toque e o alvo para 1 criatura. A magia não é diss…
- `invulnerabilidade#e1`: muda o alcance para curto e o alvo para 1 criatura.
- `lagrimas-da-deusa-da-magia#e1`: muda a área para esfera de 6m de raio e o alvo para criaturas escolhidas.
- `lagrimas-da-deusa-da-magia#e2`: muda a execução para 1 dia e adiciona custo adicional (sacrifício de 1 PM). O alvo da magia precisa…
- `lendas-e-historias#e1`: muda a execução para 1 dia, o alcance para ilimitado e adiciona componente material (cuba de ouro c…
- `libertacao#e2`: além do normal, o alvo pode escolher 20 em todos os testes de Atletismo.
- `libertacao#e3`: além do normal, o alvo pode escolher 20 em todos os testes de Acrobacia e pode fazer todas as manob…
- `libertacao#e4`: muda o alcance para curto e o alvo para até 5 criaturas.
- `ligacao-sombria#e1`: além do normal, o alvo também pode morrer por perda de PV ou se você morrer (um teste de Fortitude …
- `ligacao-telepatica#e2`: muda o alvo para 1 criatura. Em vez do normal, você cria um elo mental que permite que você veja e …
- `luz#e4`: (Apenas Arcanos): muda o alvo para 1 criatura. Você lança a magia nos olhos do alvo, que fica ofusc…
- `luz#e7`: (Apenas Divinos): muda o alcance para toque e o alvo para 1 criatura. Em vez do normal, o alvo é en…
- `manto-de-sombras#e1`: muda o alcance para toque e o alvo para 1 criatura. Requer 4º círculo.
- `mapear#e1`: muda o alvo para 1 criatura e a duração para 1 hora. Em vez do normal, a criatura tocada descobre o…
- `mente-divina#e1`: em vez do normal, o alvo recebe +2 nos três atributos mentais. Requer 3º círculo.
- `mente-divina#e2`: muda o alcance para curto e o alvo para criaturas escolhidas.
- `mente-divina#e3`: em vez do normal, o alvo recebe +4 no atributo escolhido. Requer 4º círculo.
- `mente-divina#e7`: em vez do normal, o alvo recebe +4 nos três atributos mentais. Requer 5º círculo.
- `metamorfose#e3`: muda o alcance para toque, o alvo para 1 criatura e adiciona resistência (Vontade anula).
- `metamorfose#e4`: muda o alcance para médio, o alvo para 1 criatura e a resistência para Vontade anula. Em vez do nor…
- `metamorfose#e7`: além do normal, no início de seus turnos o alvo pode mudar de forma novamente, como uma ação livre,…
- `missao-divina#e1`: muda o alcance para toque, a
duração para permanente e adiciona
penalidade de –1 PM. Em vez do norm…
- `orientacao#e1`: muda a duração para cena. Em vez do normal, escolha um atributo. Sempre que o alvo fizer um teste d…
- `orientacao#e2`: muda a duração para cena. Escolha entre atributos físicos (Força, Destreza e Constituição) ou menta…
- `orientacao#e3`: muda o alvo para criaturas escolhidas. Requer 3º círculo.
- `pele-de-pedra#e1`: muda o alcance para toque e o alvo para 1 criatura.
- `possessao#e2`: enquanto a magia durar e você estiver dentro do alcance do seu corpo original, pode "saltar" de uma…
- `potencia-divina#e3`: muda o alcance para toque e o alvo para 1 criatura. A magia falha se você e o alvo não forem devoto…
- `premonicao#e1`: muda a execução para reação, o alcance para curto, o alvo para 1 criatura e a duração para instantâ…
- `preparacao-de-batalha#e1`: Aumenta o número de alvos em dois e o custo adicional em 1 PM.
- `primor-atletico#e1`: além do normal, o alvo pode escalar paredes e tetos sem precisar fazer testes de Atletismo. Para is…
- `primor-atletico#e3`: além do normal, ao fazer testes de perícias baseadas em Força, Destreza ou Constituição, o alvo pod…
- `protecao-contra-magia#e2`: em vez do normal, o alvo fica imune a uma escola de magia a sua escolha. Requer 4º Círculo.
- `protecao-contra-magia#e3`: em vez do normal, o alvo fica imune a duas escolas de magia a sua escolha. Requer 5º Círculo.
- `protecao-divina#e2`: muda a execução para reação, o alcance para curto e a duração para 1 rodada. Em vez do normal, o al…
- `protecao-divina#e3`: muda o alvo para área de esfera com 3m de raio. Todos os aliados dentro da esfera recebem o bônus d…
- `protecao-divina#e4`: também torna o alvo imune a efeitos mentais e de medo. Requer 3º círculo.
- `purificacao#e3`: também permite que o alvo solte qualquer item amaldiçoado que esteja segurando (mas não remove a ma…
- `purificacao#e4`: também dissipa magias e efeitos prejudiciais de encantamento, necromancia e transmutação afetando o…
- `queda-suave#e1`: muda o alvo para até 10 criaturas ou objetos.
- `queda-suave#e2`: aumenta a categoria de tamanho do alvo em uma
- `raio-do-enfraquecimento#e1`: em vez do normal, se falhar na resistência o alvo fica exausto. Se passar, fica fatigado. Requer 2º…
- `raio-do-enfraquecimento#e2`: em vez do normal, se falhar na resistência o alvo fica exausto. Se passar, fica fatigado. Muda o al…
- `raio-polar#e2`: muda o alvo para área de esfera de 6m de raio. Em vez de um raio, você dispara uma esfera de gelo q…
- `resistencia-a-energia#e2`: muda o alcance para curto e o alvo para criaturas escolhidas. Requer 3º círculo.
- `roubar-a-alma#e1`: o objeto que abriga a alma detém os mesmos PM totais que o alvo. Se estiver empunhando o objeto, vo…
- `roubar-a-alma#e2`: como uma reação ao lançar esta magia, você possui o corpo sem alma do alvo, como na magia Possessão…
- `runa-de-protecao#e2`: muda o alvo para "você" e o alcance para "pessoal". Ao invés do normal, escolha uma magia de 1º cír…
- `salto-dimensional#e2`: muda o alvo para você e uma criatura voluntária. Você pode escolher este aprimoramento mais vezes p…
- `santuario#e2`: também protege o alvo contra efeitos de área. Uma criatura que tente atacar uma área que inclua o a…
- `segunda-chance#e2`: muda o alcance para curto e o alvo para até 5 criaturas.
- `selo-de-mana#e1`: muda o alcance para curto e o alvo para criaturas escolhidas dentro do alcance. Requer 4º círculo.
- `silencio#e1`: muda a área para alvo de 1 objeto. Em vez do normal, o alvo emana uma área de silêncio com 3m de ra…
- `soco-do-mestre#e1`: muda o alcance para pessoal, o alvo para você, a duração para cena e a resistência para nenhuma. Em…
- `sombra-assassina#e1`: muda o alvo para criaturas escolhidas na área.
- `sonho#e2`: aumenta o número de alvos em +1. Todos os alvos compartilham um mesmo sonho (ou pesadelo) entre si …
- `sono#e1`: alvos que falhem na resistência ficam exaustos por 1d4+1 rodadas, em vez de apenas 1.
- `sono#e2`: muda o alvo para criatura.
- `sono#e3`: afeta todos os alvos válidos a sua escolha dentro do alcance.
- `suporte-ambiental#e1`: muda o alcance para curto e o alvo para criaturas escolhidas.
- `sussurros-insanos#e2`: muda o alvo para 1 criatura.
- `sussurros-insanos#e3`: muda o alvo para criaturas escolhidas. Requer 5º círculo.
- `teletransporte#e2`: em vez do normal, a magia teletransporta os alvos para seu santuário — um local familiar e previame…
- `toque-chocante#e3`: muda o alcance para pessoal e o alvo para área: esfera com 6m de raio. Você dispara raios pelas pon…
- `toque-da-morte#e1`: muda o alcance para curto. Em vez de tocar no alvo, você dispara um raio púrpura da ponta de seu de…
- `toque-da-morte#e2`: muda o alcance para curto e o alvo para inimigos no alcance. Em vez de tocar no alvo, você dispara …
- `tranca-arcana#e3`: muda o alvo para 1 objeto de qualquer tamanho, podendo afetar até mesmo os portões de um castelo. R…
- `tranquilidade#e1`: muda o alvo para 1 criatura.
- `tranquilidade#e3`: muda o alcance para médio e o alvo para criaturas escolhidas. Requer 3º círculo.
- `velocidade#e1`: muda o alvo para criaturas escolhidas no alcance. Requer 4º círculo.
- `velocidade#e2`: muda o alcance para pessoal e o alvo para você. Você acelera sua mente, além de seu corpo. A ação a…
- `viagem-arborea#e1`: muda o alcance para toque, o alvo para até cinco criaturas e a duração para instantânea. Os alvos e…
- `viagem-planar#e1`: muda o alvo para até cinco criaturas voluntárias que você esteja tocando.
- `visao-da-verdade#e1`: muda o alcance para toque e o alvo para 1 criatura.
- `visao-da-verdade#e2`: além do normal, o alvo fica com sentidos apurados; ele recebe +10 em todos os testes de Percepção.
- `visao-da-verdade#e3`: além do normal, o alvo escuta falsidades; ele recebe +10 em todos os testes de Intuição.
- `visao-da-verdade#e4`: além do normal, o alvo enxerga através de paredes e barreiras com 30cm de espessura ou menos (as pa…
- `voo#e1`: muda o alcance para toque e o alvo para 1 criatura.
- `voo#e3`: muda o alcance para curto e o alvo para até 10 criaturas. Requer 4° círculo.
- `voz-divina#e1`: você concede um pouco de vida a um cadáver, suficiente para que ele responda a suas perguntas. O co…

### CD (8)

- `area-escorregadia#e2`: muda a CD dos testes de Acrobacia para 15.
- `area-escorregadia#e3`: muda a CD dos testes de Acrobacia para 20.
- `caminhos-da-natureza#e1`: além do normal, a CD para rastrear os alvos em terreno natural aumenta em +10.
- `controlar-madeira#e1`: muda o alcance para pessoal, o alvo para você e a duração para 1 dia. Você e seu equipamento se tra…
- `criar-ilusao#e6`: muda o alcance para longo e o efeito para esfera de 30m de raio. Em vez do normal, você cria um som…
- `semiplano#e1`: adiciona alvo (1 criatura). Você cria uma semiplano labiríntico e expulsa o alvo para ele. A cada r…
- `servos-invisiveis#e2`: você pode comandar os servos para realizar uma única tarefa no seu lugar. Em termos de jogo, eles p…
- `tranca-arcana#e2`: aumenta a CD para abrir o alvo em +5.

### cura fora do padrão (12)

- `cura-pelas-maos#e1`: aumenta a cura em +1d8+1.
- `curar-ferimentos#e1`: aumenta a cura em +1d8+1.
- `ervas-curativas#e1`: aumenta a cura +2d6 PV
- `purificacao#e1`: também cura todos os PV perdidos por veneno.
- `segunda-chance#e1`: aumenta a cura em +20 PV.
- `segunda-chance#e3`: muda o alvo para uma criatura que tenha morrido há até uma rodada. Esta magia pode curá-la.
- `sopro-da-salvacao#e1`: aumenta a quantidade de cura em 1d8+2.
- `sopro-da-salvacao#e2`: além do normal, se um aliado estiver com PV negativos, seus PV são levados a 0 e então a cura é apl…
- `transmutar-objetos#e3`: muda o alcance para toque, o alvo para 1 construto e a duração para instantânea. Em vez do normal, …
- `transmutar-objetos#e4`: muda o alvo para 1 objeto mundano e a duração para instantânea. Em vez do normal, você cura todos o…
- `transmutar-objetos#e6`: aumentar a cura em +1d8.
- `virtude-paladinesca-compaixao#e1`: aumenta a cura em +2d6+1.

### dano fora do padrão (99)

- `amarras-etereas#e3`: em vez do normal, cada laço é destruído automaticamente com um único ataque bem-sucedido; porém, ca…
- `ancora-dimensional#e2`: muda o efeito para criar um fio de energia cor de esmeralda que prende o alvo a um ponto no espaço …
- `ancora-dimensional#e3`: muda o efeito para criar um fio de energia cor de esmeralda que prende o alvo a um ponto no espaço …
- `arma-espiritual#e4`: muda o tipo do dano para essência. Requer 2o círculo.
- `arma-espiritual#e6`: aumenta o dano causado pela arma em +1d6, limitado pelo círculo máximo de magia que você pode lança…
- `arma-magica#e2`: a arma passa a causar +1d6 de dano de ácido, eletricidade, fogo ou frio, escolhido no momento em qu…
- `arma-magica#e3`: muda o bônus de dano do aprimoramento elemental para +2d6. (Custo do aprimoramento incluso)
- `armamento-da-natureza#e4`: aumenta o dano da arma em mais um passo.
- `barragem-elemental#e1`: aumenta o dano de cada esfera em +2d6.
- `barragem-elemental#e2`: muda o tipo de dano de todas as esferas para essência (mas elas ainda causam os outros efeitos como…
- `bola-de-fogo#e2`: muda a área para efeito de esfera flamejante com tamanho Médio e a duração para cena. Em vez do nor…
- `bola-de-fogo#e3`: muda a duração para 1 dia ou até ser descarregada. Em vez do normal, você cria uma pequena pedra fl…
- `campo-de-forca#e1`: muda a execução para reação e a duração para instantânea. Em vez do normal, você recebe redução 30 …
- `campo-de-forca#e3`: muda o alcance para curto, o alvo para outra criatura ou objeto Enorme ou menor e a duração para su…
- `canalizar-energia-positiva-negativa#e1`: Aumenta a cura/dano em 1d6.
- `chuva-de-meteoros#e1`: aumenta o número de meteoros que atingem a área, o que aumenta o dano em +2d6 de impacto e +2d6 de …
- `colera-do-deus-sol#e1`: aumenta o dano em +2d6 (+2d8 contra mortos-vivos).
- `coluna-de-chamas#e1`: aumenta o dano de fogo em +1d6.
- `coluna-de-chamas#e2`: aumenta o dano de luz em +1d6.
- `conjurar-monstro#e10`: o monstro ganha imunidade contra dois tipos de dano.
- `conjurar-monstro#e11`: aumenta o tamanho do monstro para Enorme. Ele tem For 11, Des 1, 110 PV, deslocamento 15m e seu ata…
- `conjurar-monstro#e12`: aumenta o tamanho do monstro para Colossal. Ele tem For 15, Des 0, 180 PV, deslocamento 15m e seu a…
- `conjurar-monstro#e3`: muda o tipo de dano do ataque do monstro para ácido, fogo, frio ou eletricidade.
- `conjurar-monstro#e5`: aumenta o tamanho do monstro para Médio. Ele tem For 4, Des 3, 45 PV, deslocamento 12m e seu ataque…
- `conjurar-monstro#e6`: o monstro ganha resistência 5 contra dois tipos de dano (por exemplo, corte e frio).
- `conjurar-monstro#e7`: o monstro ganha uma nova ordem: Arma de Sopro. Para dar essa ordem você gasta 1 PM, e faz o monstro…
- `conjurar-monstro#e8`: aumenta o tamanho do monstro para Grande. Ele tem For 7, Des 2, 75 PV, deslocamento 12m e seu ataqu…
- `controlar-fogo#e1`: muda a duração para sustentada e a resistência para Reflexos reduz à metade. Em vez do normal, você…
- `controlar-fogo#e2`: aumenta o dano em +1d6 (exceto Chamejar).
- `controlar-fogo#e3`: muda o alvo para 1 criatura composta principalmente por fogo, lava ou magma (como um elemental do f…
- `controlar-madeira#e2`: muda o alvo para área de quadrado com 9m de lado e a duração para cena. Em vez do normal, qualquer …
- `controlar-terra#e2`: muda o alcance para pessoal, o alvo para você e a duração para 1 dia. Você e seu equipamento fundem…
- `cranio-voador#e1`: aumenta o dano em +1d8+1.
- `criar-elementos#e2`: muda o efeito para alvo 1 criatura ou objeto e a resistência para Reflexos reduz à metade. Se escol…
- `criar-elementos#e3`: se escolheu fogo, aumenta o dano inicial de cada chama em +1d6.
- `criar-ilusao#e7`: também criar sensações táteis, como texturas; criaturas que não saibam que é uma ilusão não consegu…
- `cuspir-enxame#e1`: Aumenta o dano em +1d6 a cada 2 outros poderes da tormenta que possui.
- `deflagracao-de-mana#e1`: aumenta o dano em 10.
- `desintegrar#e1`: aumenta o dano total em +2d12 e o dano mínimo em +1d12.
- `despedacar#e1`: aumenta o dano em +1d8+2.
- `enxame-de-pestes#e2`: muda a resistência para Reflexos reduz à metade e o enxame para criaturas maiores, como gatos, guax…
- `enxame-de-pestes#e4`: muda a resistência para Reflexos reduz à metade e o enxame para criaturas elementais. Ele causa 5d1…
- `enxame-rubro#e3`: muda o dano para trevas.
- `erupcao-glacial#e1`: aumenta o dano de frio em +2d6 e o dano de corte em +2d6.
- `erupcao-glacial#e2`: muda a área para cilindro com 6m de raio e 6m de altura e a duração para sustentada. Em vez do norm…
- `escudo-da-fe#e4`: muda a execução para ação padrão, o alcance para toque e a duração para cena. A magia cria uma cone…
- `explosao-de-chamas#e2`: muda a resistência para Reflexos parcial. Se passar, a criatura reduz o dano à metade; se falhar, f…
- `flecha-acida#e3`: aumenta o dano inicial e o dano por rodada em +1d6.
- `forca-dos-penhascos#e1`: Reduz o dano em 10 para cada PM gasto.
- `golpe-elemental#e2`: Dano Ácido
- `golpe-elemental#e3`: Dano Fogo
- `golpe-elemental#e4`: Dano Frio
- `golpe-elemental#e5`: Dano Eletricidade
- `infligir-ferimentos#e2`: aumenta o dano em 1d8+1.
- `infligir-ferimentos#e3`: muda a resistência para nenhum. Como parte da execução da magia, você pode fazer um ataque corpo a …
- `julgamento-divino-vindicacao#e1`: Aumenta o bônus de ataque em +1 e o bônus de dano em +1d8
- `lanca-ignea#e1`: aumenta o dano inicial em +2d6 e o dano do efeito em chamas em +1d6.
- `libertacao#e1`: além do normal, o alvo pode caminhar sobre a água ou outros líquidos com seu deslocamento normal. E…
- `luz#e6`: (Apenas Divinos): a luz é cálida como a do sol. Criaturas que sofrem penalidades e dano pela luz so…
- `mao-poderosa#e1`: aumenta o dano de impacto em +1d6+5.
- `marca-da-obediencia#e2`: sempre que o alvo fizer o teste de Vontade e falhar, a marca causa 3d6 pontos de dano psíquico. Req…
- `marca-da-presa#e1`: Aumenta o Dano
- `miasma-mefitico#e2`: muda o tipo do dano para trevas.
- `muralha-elemental#e2`: muda a duração para sustentada e adiciona uma nova escolha, Essência. A muralha é invisível e indes…
- `muralha-elemental#e3`: aumenta o dano por atravessar a muralha em +2d6.
- `nevoa#e4`: a nuvem tem um tom esverdeado e se torna cáustica. No início de seus turnos, criaturas dentro dela …
- `nevoa#e5`: aumenta o dano de ácido em +2d4.
- `nevoa#e6`: além do normal, a nuvem fica espessa, quase sólida. Qualquer criatura dentro dela tem seu deslocame…
- `pele-de-pedra#e3`: sua pele ganha aspecto e dureza de aço. Você recebe resistência a dano 10. Requer 4º círculo.
- `pele-de-pedra#e4`: muda o alcance para toque, o alvo para 1 criatura, a duração para 1d4 rodadas e adiciona Resistênci…
- `poeira-da-podridao#e1`: aumenta o dano em 1d8+4.
- `potencia-divina#e2`: aumenta a resistência a dano em +5.
- `primor-atletico#e2`: muda a execução para ação de movimento, o alcance para pessoal, o alvo para você e a duração para i…
- `raio-solar#e1`: aumenta o dano ou cura em +1d8 (ou +1d12 em mortos-vivos).
- `raio-solar#e2`: em vez do normal, criaturas vivas a sua escolha na área curam 4d8 pontos de vida; o restante sofre …
- `relampago#e2`: muda a área para alvo (criaturas escolhidas). Em vez do normal, você dispara vários relâmpagos, um …
- `relampago-flamejante#e1`: aumenta o dano das rajadas em +1d6.
- `relampago-flamejante#e2`: aumenta o dano da rajada mista em +2d12.
- `resistencia-a-energia#e3`: muda o efeito para redução de dano contra todos os tipos listados na magia. Requer 3º círculo.
- `seta-infalivel#e1`: muda as setas para lanças de energia que surgem e caem do céu. Cada lança causa 1d8+1 pontos de dan…
- `soco-do-mestre#e4`: muda o tipo do dano para essência.
- `sonho#e1`: transforma o sonho do alvo em um pesadelo. A vítima deve fazer um teste de Vontade. Se falhar, não …
- `sopro-das-uivantes#e1`: aumenta o dano de frio em +2d6.
- `talho-invisivel#e2`: muda o alvo para você e a duração para sustentada. Uma vez por rodada, como uma ação padrão, você p…
- `tempestade-divina#e1`: muda a duração para sustentada. Além do normal, uma vez por rodada você pode gastar uma ação padrão…
- `tempestade-divina#e2`: aumenta o dano de raios (veja acima) em +1d8.
- `tempestade-divina#e3`: se escolheu causar chuva, ela se torna mais grossa, revelando a silhueta de criaturas invisíveis na…
- `tempestade-divina#e4`: se escolheu causar granizo, muda o dano para 2d6 por rodada.
- `tempestade-divina#e5`: se escolheu causar neve, criaturas na área sofrem 2d6 pontos de dano de frio no início de seus turn…
- `tentaculos-de-trevas#e2`: aumenta o dano dos tentáculos em +2d6.
- `toque-chocante#e1`: aumenta o dano em 1d8+1.
- `toque-chocante#e2`: muda a resistências para nenhum. Como parte da execução da magia, você faz um ataque corpo a corpo …
- `toque-vampirico#e1`: muda a resistência para nenhum. Como parte da execução da magia, você pode fazer um ataque corpo a …
- `toque-vampirico#e3`: muda o alcance para pessoal, o alvo para você e a duração para cena. Em vez do normal, a cada rodad…
- `transformacao-de-guerra#e1`: aumenta os bônus na Defesa, testes de ataque e rolagens de dano corpo a corpo em +1, e os PV tempor…
- `transformacao-de-guerra#e2`: adiciona componente material (uma barra de adamante no valor de T$ 100). Sua forma de combate ganha…
- `vestimenta-da-fe#e3`: o objeto também oferece resistência a dano 5. Requer 4º círculo.
- `vitalidade-fantasma#e1`: aumenta os PV temporários recebidos em +1d10. Caso a magia cause dano, em vez disso aumenta o dano …
- `vitalidade-fantasma#e2`: muda o alvo para área: esfera com 6m de raio centrada em você e a resistência para Fortitude reduz …

### duração (37)

- `alarme#e3`: muda a duração para 1 dia ou até ser descarregada e a resistência para Vontade anula. Quando um int…
- `animar-objetos#e1`: muda a duração para permanente e adiciona componente material (prataria no valor de T$ 1.000). Você…
- `augurio#e2`: muda a execução para 10 minutos e a duração para 1 minuto. Em vez do normal, você consulta uma divi…
- `circulo-da-justica#e3`: muda a duração para permanente e adiciona componente material (balança de prata no valor de T$ 5.00…
- `comunhao-com-a-natureza#e1`: muda a execução para 1 minuto e a duração para instantânea. Em vez do normal, você descobre 1d4+1 i…
- `concentracao-de-combate#e1`: muda a execução para padrão e a duração para cena. Requer 2º círculo.
- `concentracao-de-combate#e4`: muda a execução para padrão e a duração para 1 dia. Além do normal, você recebe um sexto sentido qu…
- `condicao#e2`: aumenta a duração para 1 dia.
- `consagrar#e3`: muda a execução para 1 hora, a duração para permanente e adiciona componente material (incenso e ól…
- `controlar-o-clima#e1`: (Apenas Druidas): muda o raio da área para 3km e duração para 1d4 dias.
- `controlar-plantas#e1`: muda a duração para instantânea. Em vez do normal, as plantas na área diminuem, como se tivessem si…
- `criar-ilusao#e1`: muda a duração para sustentada. A cada rodada você pode gastar uma ação livre para mover a imagem o…
- `criar-ilusao#e8`: muda a duração para sustentada. Além do normal, você pode gastar uma ação livre para modificar livr…
- `despertar-consciencia#e2`: muda a duração para permanente e adiciona penalidade de -3 PM.
- `dificultar-deteccao#e2`: muda a duração para 1 semana.
- `escudo-da-fe#e5`: muda a duração para 1 dia. Requer 2º círculo.
- `invisibilidade#e2`: muda a duração para cena. Requer 3º círculo.
- `lanca-ignea#e2`: muda a duração para cena ou até ser descarregada. Em vez do efeito normal, a magia cria quatro dard…
- `luz#e3`: muda a duração para permanente e adiciona componente material (pó de rubi no valor de T$ 50). Reque…
- `marca-da-obediencia#e1`: muda a duração para 1 dia. Se não estiver em combate, a criatura só pode fazer o teste de Vontade a…
- `miragem#e2`: muda a duração para permanente e adiciona componente material (pó de diamante no valor de T$ 1.000)…
- `missao-divina#e2`: aumenta a duração para 1 ano ou até ser descarregada.
- `montaria-arcana#e2`: muda a duração para permanente e adiciona penalidade de -3 PM.
- `oracao#e4`: muda a duração para cena. Requer 4º círculo
- `pele-de-pedra#e5`: como acima, mas com duração permanente. Requer 5º círculo.
- `profanar#e3`: muda a execução para 1 hora, a duração para permanente e adiciona componente material (incenso e ól…
- `projetar-consciencia#e1`: além do normal, sua projeção é capaz de lançar magias que não precisem de componentes materiais e t…
- `refugio#e3`: em vez do normal, cria um espaço extradimensional, similar a uma caverna vazia e escura, que compor…
- `resistencia-a-energia#e1`: muda a duração para 1 dia. Requer 2º círculo.
- `rogar-maldicao#e2`: muda a duração para permanente e resistência para Fortitude parcial. Se passar, a criatura ainda so…
- `semiplano#e2`: muda a duração para permanente e adiciona componente material (maquete do semiplano feito de materi…
- `servo-divino#e1`: muda a duração para 1 dia ou até ser descarregada. O espírito realiza uma tarefa a sua escolha que …
- `servo-divino#e2`: muda a duração para 1 semana ou até ser descarregada. O espírito realiza uma tarefa que exija até u…
- `silencio#e2`: muda a duração para cena. Em vez do normal, nenhum som pode deixar a área, mas criaturas dentro da …
- `teletransporte#e3`: muda a execução para ação completa, a duração para cena e adiciona sacrifício de 1 PM. Em vez do no…
- `velocidade#e3`: muda a duração para cena. A ação adicional que você pode fazer é apenas de movimento. Uma criatura …
- `voo#e2`: muda a duração para 1 dia. Requer 4º círculo.

### outro (198)

- `ajuste-de-mira#e1`: aumentra o bônus em +1.
- `alarme#e2`: além do normal, você também percebe qualquer efeito de adivinhação que seja usado dentro da área ou…
- `aliado-animal#e2`: muda o parceiro para mestre. Requer 3º círculo.
- `alterar-memoria#e2`: você pode alterar ou apagar as memórias das últimas 24 horas.
- `anular-a-luz#e1`: aumenta o bônus na Defesa em +1.
- `anular-a-luz#e2`: muda o círculo máximo de magias dissipadas para 4º. Requer 4º Círculo.
- `anular-a-luz#e3`: muda o círculo máximo de magias dissipadas para 5º. Requer 5º Círculo.
- `ao-por-do-sol#e1`: Novo Efeito
- `arco-arcano#e1`: Arco Encantado
- `area-escorregadia#e1`: aumenta a área em +1 quadrado de 1,5m.
- `arma-espiritual#e1`: além do normal, a arma o protege. Você recebe +1 na Defesa.
- `arma-espiritual#e2`: aumenta o bônus na Defesa em +1.
- `arma-espiritual#e5`: invoca duas armas, permitindo que você contra-ataque (ou ataque, se usar o aprimoramento acima) dua…
- `arma-magica#e1`: aumenta o bônus em +1 (bônus máximo limitado pelo círculo máximo de magia que você pode lançar).
- `armadura-arcana#e1`: muda a execução para reação. Em vez do normal, você cria um escudo mágico que fornece +5 na Defesa …
- `armadura-arcana#e2`: aumenta o bônus na Defesa em +1.
- `armamento-da-natureza#e1`: fornece +1 nos testes de ataque com a arma.
- `armamento-da-natureza#e2`: muda a execução para ação de movimento.
- `armamento-da-natureza#e3`: aumenta o bônus nos testes de ataque em +1.
- `arremesso-de-rochas#e1`: Aumento de raio
- `asas-de-borboleta#e1`: Asas de Borboleta
- `augurio#e1`: muda a execução para 1 minuto. Em vez do normal, você pode consultar uma divindade, fazendo uma per…
- `augurio#e3`: o mestre rola 1d12; a magia só falha em um resultado 1.
- `augurio#e4`: o mestre rola 1d20; a magia só falha em um resultado 1.
- `aura-divina#e1`: aumenta os bônus na Defesa e em testes de resistência em +1.
- `baluarte#e1`: aumenta o bônus em +2
- `baluarte#e2`: afeta aliados adjacentes
- `banimento#e1`: muda a resistência para nenhum. Em vez do normal, devolve automaticamente uma criatura conjurada (c…
- `bencao#e2`: aumenta os bônus em +1, limitado pelo círculo máximo de magia que você pode lançar.
- `buraco-negro#e1`: muda o efeito para que você não seja afetado.
- `caminhos-da-natureza#e2`: aumenta o bônus de deslocamento em +3m.
- `campo-de-forca#e2`: muda os PV temporários ou a RD para 50. Requer 3º círculo.
- `campo-de-forca#e4`: como o aprimoramento acima, mas tudo dentro da esfera fica praticamente sem peso. Uma vez por rodad…
- `campo-de-forca#e5`: muda os PV temporários ou a RD para 70. Requer 4º círculo.
- `circulo-da-justica#e2`: muda a penalidade nas perícias para –10 (se passar na resistência) e –20 (se falhar). Requer 4º cír…
- `circulo-da-restauracao#e1`: aumenta a regeneração de PV em 1d8+1.
- `colera-do-deus-sol#e2`: aumenta a área em +6m de raio.
- `colera-do-deus-sol#e3`: a luz purificadora do Deus-Sol dissipa todas as magias de necromancia ativas na área. Requer 5º cír…
- `comunhao-com-a-natureza#e2`: aumenta o número de dados de auxílio em +2.
- `comunhao-com-a-natureza#e3`: muda o tipo dos dados de auxílio para d6.
- `comunhao-com-a-natureza#e4`: muda o tipo dos dados de auxílio para d8.
- `conceder-milagre#e1`: muda o círculo da magia concedida para 3º e a penalidade de PM para –6.
- `concentracao-de-combate#e2`: além do normal, ao atacar você, um inimigo deve rolar dois dados e usar o pior resultado. Requer 3º…
- `conhecimento-anatomico#e1`: +1d8
- `conjurar-elemental#e1`: o elemental muda para Enorme e recebe dois tipos de aliado indicados no seu elemento.
- `conjurar-monstro#e1`: o monstro ganha deslocamento de escalada ou natação igual ao seu deslocamento terrestre.
- `conjurar-monstro#e2`: aumenta o deslocamento do monstro em +3m.
- `conjurar-monstro#e4`: aumenta os PV do monstro em +10 para cada categoria de tamanho a partir de Pequeno (+10 PV para Peq…
- `conjurar-monstro#e9`: o monstro ganha deslocamento de voo igual ao dobro do deslocamento.
- `conjurar-mortos-vivos#e1`: aumenta o número de mortos-vivos conjurados em +1.
- `conjurar-mortos-vivos#e2`: em vez de esqueletos, conjura carniçais. Requer 3º círculo.
- `conjurar-mortos-vivos#e3`: em vez de esqueletos, conjura sombras. Requer 4º círculo.
- `consagrar#e1`: além do normal, mortos-vivos na área sofrem –2 em testes e Defesa.
- `consagrar#e2`: aumenta as penalidades para mortos-vivos em –1.
- `contato-extraplanar#e1`: aumenta o número de dados de auxílio em +1.
- `contato-extraplanar#e2`: Muda os dados de auxílio para d12. Sempre que rolar um resultado 12 num desses d12, a entidade "sug…
- `controlar-ar#e1`: aumenta o limite de tamanho de criaturas e objetos afetados em um passo.
- `controlar-plantas#e2`: além do normal, criaturas que falhem na resistência também ficam imóveis.
- `controlar-terra#e1`: aumenta o número de cubos de 1,5m em +2.
- `convocacao-instantanea#e1`: além do normal, até 1 hora após ter lançado a magia, você pode gastar uma ação de movimento para en…
- `criar-elementos#e1`: aumenta a quantidade do elemento em um passo (uma categoria de tamanho para água ou terra, +1 quadr…
- `criar-ilusao#e2`: aumenta o efeito da ilusão em +1 cubo de 1,5m.
- `criar-ilusao#e3`: também pode criar ilusões de imagem e sons combinados.
- `criar-ilusao#e5`: também pode criar odores e sensações térmicas, que são percebidos a uma distância igual ao dobro do…
- `cupula-de-repulsao#e1`: a cúpula impede criaturas de se aproximarem a menos de 4,5m de você (ou seja, deve haver dois quadr…
- `cupula-de-repulsao#e2`: além do normal, criaturas afetadas também precisam fazer o teste de resistência se fizerem um ataqu…
- `cura-pelas-maos#e2`: Anular condição (abalado, apavorado, atordoado, cego, doente, exausto, fatigado ou surdo).
- `dance#e1`: Intimidação + Força
- `dance#e2`: Intimidação + Destreza
- `deflagracao-de-mana#e2`: afeta apenas criaturas a sua escolha.
- `desespero-esmagador#e1`: em vez do normal, as condições adquiridas são debilitado e esmorecido.
- `desespero-esmagador#e2`: em vez do normal, afeta qualquer tipo de criatura.
- `desespero-esmagador#e3`: além do normal, criaturas que falhem na resistência ficam aos prantos (em termos de jogo, adquirem …
- `detectar-ameacas#e1`: você descobre também a raça ou espécie e o poder da criatura detectada (determinado pela aura dela)…
- `detectar-ameacas#e2`: além do normal, você não fica surpreso e desprevenido contra perigos detectados com sucesso e receb…
- `disfarce-ilusorio#e3`: a ilusão inclui odores e sensações. Isso muda o bônus em testes de Enganação para disfarce para +20.
- `dispersar-as-trevas#e1`: aumenta o bônus nas resistências em +1.
- `dispersar-as-trevas#e3`: muda o círculo máximo de magias dissipadas para 4º. Requer 4º círculo.
- `dispersar-as-trevas#e4`: muda o círculo máximo de magias dissipadas para 5º. Requer 5º círculo.
- `dissipar-magia#e1`: muda a área para esfera com 9m de raio. Em vez do normal, cria um
efeito de disjunção. Todas as mag…
- `duelo#e1`: Aumenta o bônus em +1
- `duplicata-ilusoria#e1`: cria uma cópia adicional.
- `engenho-de-mana#e1`: em vez de flutuar no ponto em que foi conjurado, o disco flutua atrás de você, mantendo-se sempre a…
- `enxame-de-pestes#e3`: aumenta o número de enxames em +1. Eles não podem ocupar o mesmo espaço. Requer 3º círculo.
- `enxame-rubro#e1`: além do normal, uma criatura que falhe no teste de Reflexos fica agarrada (o enxame escala e cobre …
- `enxame-rubro#e4`: o enxame vira Enorme (quadrado de 6m de lado).
- `enxame-rubro#e5`: o enxame ganha deslocamento de voo 18m e passa a ocupar um cubo ao invés de um quadrado.
- `enxame-rubro#e6`: o enxame inclui parasitas inchados que explodem e criam novos enxames. No início de cada um de seus…
- `ervas-curativas#e2`: Remove Veneno
- `escudo-da-fe#e3`: aumenta o bônus na Defesa em +1.
- `escudo-magico#e1`: aumenta o bônus de defesa em +1.
- `escuridao#e1`: aumenta a área da escuridão em +1,5m de raio.
- `escuridao#e2`: muda o efeito para fornecer camuflagem total por escuridão total. As sombras bloqueiam a visão na á…
- `estrategista#e1`: aliado adicional
- `ferramenta-de-morte#e1`: Novo Efeito
- `fisico-divino#e5`: +2 em Força
- `fisico-divino#e6`: +2 em Destreza
- `fisico-divino#e7`: +2 em Constituição
- `flecha-acida#e2`: aumenta a redução na Defesa em +1.
- `furia#e1`: aumentar os bônus em +1.
- `globo-da-verdade#e1`: o globo mostra uma cena vista até um mês atrás.
- `globo-da-verdade#e2`: o globo mostra uma cena vista até um ano atrás.
- `globo-da-verdade#e3`: ao lançar a magia, você pode tocar um cadáver. O globo mostra a última cena vista por essa criatura.
- `globo-de-invulnerabilidade#e1`: muda o efeito para afetar magias de até 3º círculo. Requer 4º círculo.
- `globo-de-invulnerabilidade#e2`: muda o efeito para afetar magias de até 4º círculo. Requer 5º círculo.
- `gritar-ordens#e1`: Gritar Ordens
- `heroismo#e1`: muda o bônus para +6.
- `hipnotismo#e4`: também afeta espíritos e monstros na área. Requer 2º círculo.
- `hipnotismo#e5`: também afeta construtos, espíritos, monstros e mortos-vivos na área. Requer 3º círculo.
- `ilusao-lacerante#e2`: muda a área para um cubo de 90m. Requer 4º círculo.
- `imagem-espelhada#e1`: aumenta o número de cópias em +1 (e o bônus na Defesa em +2).
- `imagem-espelhada#e2`: além do normal, toda vez que uma cópia é destruída, emite um clarão de luz. A criatura que destruiu…
- `inspiracao#e1`: aumenta o bônus em +1.
- `leque-cromatico#e1`: além do normal, as criaturas afetadas ficam vulneráveis pela cena.
- `leque-cromatico#e2`: também afeta espíritos e monstros na área. Requer 2º círculo.
- `leque-cromatico#e3`: também afeta construtos, espíritos, monstros e mortos-vivos na área. Requer 3º círculo.
- `libertacao#e5`: pode dissipar Aprisionamento.
- `localizacao#e1`: aumenta a área em um fator de 10 (90m para 900m, 900m para 9km e assim por diante).
- `luz#e1`: aumenta a área iluminada em +3m de raio.
- `manobra-maremoto#e1`: Novo Efeito
- `mao-poderosa#e2`: muda o bônus adicional em Misticismo para +20. Requer 5º círculo.
- `mente-divina#e4`: +2 Inteligência
- `mente-divina#e5`: +2 Sabedoria
- `mente-divina#e6`: +2 Carisma
- `metamorfose#e1`: a forma escolhida recebe uma habilidade de sentidos entre faro, visão na penumbra e visão no escuro.
- `metamorfose#e2`: a forma escolhida recebe percepção às cegas. Requer 3º círculo.
- `metamorfose#e5`: se mudar para formas não humanoides, pode escolher uma Forma Selvagem Aprimorada. Requer 3º círculo.
- `metamorfose#e6`: se mudar para formas não humanoides, pode escolher uma Forma Selvagem Superior. Requer 4º círculo.
- `miragem#e1`: além do normal, pode alterar a aparência de criaturas escolhidas na área, como se usando Disfarce I…
- `montaria-arcana#e3`: aumenta o tamanho da montaria em uma categoria. Isso também aumenta o número de criaturas que ela p…
- `montaria-arcana#e4`: muda o nível do aliado para mestre. Requer 3º círculo.
- `muralha-de-ossos#e1`: aumenta o comprimento em +15m e altura em +3m.
- `muralha-de-ossos#e2`: o muro é feito de uma massa de esqueletos animados. Sempre que uma criatura iniciar seu turno adjac…
- `muralha-elemental#e1`: aumenta o comprimento em +15m e altura em +3m, até 60m de comprimento e 9m de altura.
- `musica-nota-azul#e1`: Novo Efeito
- `nevoa#e1`: a magia também funciona sob a água, criando uma nuvem de tinta.
- `nome-na-arena#e1`: Nome na Arena
- `oracao#e1`: aumenta os bônus em +1 (bônus máximo limitado pelo círculo máximo de magia que você pode lançar).
- `oracao#e2`: aumenta as penalidades em –1, limitado pelo círculo máximo de magia que você pode lançar.
- `pedra-de-amolar#e1`: Pedra de amolar
- `perdicao#e1`: aumenta as penalidades em –1, limitado pelo círculo máximo de magia que você pode lançar.
- `pocao-de-escudo-da-fe-cena#e1`: Escudo da Fé
- `possessao#e1`: você ganha acesso às habilidades de raça e classe da criatura.
- `postura-de-combate-muralha-intransponivel#e1`: Aumenta o bônus em defesa e reflexos em +1.
- `potencia-divina#e1`: aumenta o bônus de Força em +1.
- `profanar#e1`: além do normal, mortos-vivos na área recebem +2 na Defesa e +2 em todos os testes.
- `profanar#e2`: aumenta os bônus para mortos-vivos em +1.
- `protecao-contra-magia#e1`: muda o bônus para +10. Requer 4º círculo.
- `protecao-divina#e1`: aumenta o bônus concedido em +1.
- `punir-os-culpados#e1`: Punir os Culpados
- `purificacao#e2`: em vez de uma, remove todas as condições listadas.
- `raio-solar#e3`: criaturas que falhem na resistência ficam cegas por 1d4 rodadas.
- `refugio#e1`: além do normal, os limites do domo são envoltos por uma fumaça escura e espessa, que impede criatur…
- `refugio#e2`: em vez do normal, cria uma cabana que comporta até 10 criaturas Médias. Descansar nesse espaço conc…
- `refugio#e4`: em vez do normal, cria uma mansão extradimensional que comporta até 100 criaturas Médias, com quart…
- `resistencia-a-energia#e10`: Resistência a Trevas
- `resistencia-a-energia#e11`: aumenta a resistência a ácido em +5.
- `resistencia-a-energia#e12`: aumenta a resistência a eletricidade em +5
- `resistencia-a-energia#e13`: aumenta a resistência a fogo em +5
- `resistencia-a-energia#e14`: aumenta a resistência a frio em +5
- `resistencia-a-energia#e15`: aumenta a resistência a luz em +5
- `resistencia-a-energia#e16`: aumenta a resistência a trevas em +5
- `resistencia-a-energia#e4`: muda o efeito para imunidade a um tipo listado na magia. Requer 4º círculo
- `resistencia-a-energia#e5`: Resistência a Ácido
- `resistencia-a-energia#e6`: Resistência a Eletricidade
- `resistencia-a-energia#e7`: Resistência a Fogo
- `resistencia-a-energia#e8`: Resistência a Frio
- `resistencia-a-energia#e9`: Resistência a Luz
- `rogar-maldicao#e1`: aumenta o número de efeitos que você pode escolher em +1. Requer 3º círculo.
- `runa-de-protecao#e3`: como o aprimoramento anterior, mas você pode escolher magias de 2º círculo. Requer 3º
círculo.
- `salto-dimensional#e3`: muda a execução para reação. Em vez do normal, você salta para um espaço adjacente (1,5m), recebend…
- `santuario#e1`: além do normal, escolha um tipo de criatura entre animal, construto ou morto-vivo. Você não pode se…
- `servo-morto-vivo#e1`: muda o componente material para pó de ônix negro (T$ 500). Em vez de um zumbi ou esqueleto, cria um…
- `servo-morto-vivo#e2`: muda o componente material para pó de ônix negro (T$ 500). Em vez de um zumbi ou esqueleto, cria um…
- `servo-morto-vivo#e3`: muda o componente material para ferramentas de embalsamar (T$ 1.000). Em vez de um zumbi ou esquele…
- `servos-invisiveis#e1`: aumenta o número de servos conjurados em 1.
- `seta-infalivel#e2`: muda o número de setas/lanças para três.
- `seta-infalivel#e3`: muda o número de setas/lanças para cinco. Requer 2º círculo.
- `seta-infalivel#e4`: muda o número de setas/lanças para dez. Requer 4º círculo.
- `soco-do-mestre#e3`: aumenta o empurrão em +3m.
- `sopro-da-salvacao#e3`: remove todas as condições listadas, em vez de apenas uma.
- `sopro-das-uivantes#e2`: aumenta o tamanho máximo das criaturas afetadas em uma categoria. Requer 3º círculo.
- `teia#e1`: além do normal, criaturas que falhem na resistência também ficam imóveis.
- `teia#e2`: além do normal, no início de seus turnos a magia afeta novamente qualquer criatura na área, exigind…
- `teia#e3`: aumenta a área em +1 cubo de 1,5m.
- `telecinesia#e1`: aumenta o tamanho máximo da criatura em uma categoria (para Grande, Enorme e Colossal) ou dobra a q…
- `tentaculos-de-trevas#e1`: aumenta o raio da área em +3m.
- `terremoto-da-furia#e1`: +1d6 por categoria de tamanho
- `transmutar-objetos#e1`: aumenta o limite de tamanho do objeto em uma categoria.
- `transmutar-objetos#e2`: aumenta o preço máximo do objeto criado em um fator de x10 (+3 PM por T$ 250 de preço, +6 PM por T$…
- `transmutar-objetos#e5`: como o aprimoramento anterior, mas passa a afetar itens mágicos.
- `vestimenta-da-fe#e1`: o objeto oferece o mesmo bônus em testes de resistência. Requer 3º círculo.
- `vestimenta-da-fe#e2`: aumenta o bônus em +1.
- `vestimenta-da-fe#e4`: Aumenta o bônus em resistência em +1 (relativo ao efeito de +4 PM, que aumenta o bônus fornecido pe…
- `vigor-primal#e1`: Vigor Primal: aumentar 1d12 PV
- `visao-mistica#e1`: recebe visão no escuro.
- `visao-mistica#e3`: também pode enxergar objetos e criaturas invisíveis. Eles aparecem como formas translúcidas.
- `voz-divina#e2`: você pode falar com plantas (normais ou monstruosas) e rochas. Plantas e rochas têm percepção limit…

## Descrições

`descriptions.local.json` gravado com 1288 descrições e 568 textos de aprimoramento (`<id>#eN`), fora do git.

Entradas sem descrição no Foundry (o app mostra "ver livro"): 30.

- `aggelus`
- `barbaro`
- `bardo`
- `bucaneiro`
- `cacador`
- `cavaleiro`
- `clerigo`
- `dahllan`
- `druida`
- `elfo`
- `goblin`
- `golem`
- `grimorio`
- `hynne`
- `inventor`
- `kliren`
- `ladino`
- `lefou`
- `livro-formulas`
- `lutador`
- `medusa`
- `minotauro`
- `nobre`
- `osteon`
- `paladino`
- `qareen`
- `sereia-tritao`
- `silfide`
- `sulfure`
- `trog`
