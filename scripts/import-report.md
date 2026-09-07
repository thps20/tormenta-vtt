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
- Aprimoramentos (effects `onuse`+`self` de magias, poderes e consumíveis) viram `enhancements[{ id: "eN", cost, repeatable }]`; `repeatable` = flag `aumenta` ("Múltiplas Aplicações"). O texto vai para `descriptions.local.json` na chave `<id>#eN` e a lista continua no fim da descrição ("+N PM: ..."). Truque (custo vazio em magia) e custos negativos ficam só na descrição. Os demais effects (efeitos ativos) não entram mais na descrição.
- Poderes raciais entram em `powers.json` com a raça como tag; o vínculo raça → poderes (`grants` do Foundry) não é modelado no nosso schema.

Aprimoramentos (effects `onuse`+`self`): 568 em 218 entradas, 170 repetíveis (`aumenta`); 15 truques (custo vazio em magia, só na descrição); 291 effects `onuse` sem `self` não modelados (aprimoramentos concedidos a outras magias/ataques, ex.: Familiar Coruja).

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
