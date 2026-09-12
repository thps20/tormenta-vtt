/**
 * Monta (ou remonta do zero) a sala fixa "Mesa de Teste": convite, participantes, mapas, fichas,
 * tokens e handouts prontos para abrir e brincar, sem passar pelos eventos socket (grava direto
 * pelo Prisma, como o importador do compêndio grava direto nos JSONs).
 *
 *   make seed-test
 *   # ou, de dentro de apps/server:
 *   pnpm run seed:test
 *
 * Idempotente: a primeira coisa que faz é apagar a sala "Mesa de Teste" anterior (por nome) —
 * o `onDelete: Cascade` do schema leva junto participantes, mapas, tokens, fichas, handouts etc.
 * Nenhuma outra sala é tocada. Precisa do Postgres no ar (`make up`) e das migrations aplicadas
 * (`make db-migrate`, ou `make dev` já roda `prisma migrate deploy` — ver apps/server/src/index.ts
 * se houver dúvida).
 *
 * Itens montados (docs/testar-com-amigos.md tem o resumo para humanos):
 * - Sala com GM "Mestre" e jogadora "Ana", código e sessionTokens fixos.
 * - Mapas "Taverna" (ativo, com imagem placeholder), "Estrada" (ponto de chegada definido) e
 *   "Cripta" (névoa ligada, metade revelada).
 * - Ficha "Kael" (de Ana: Humano Guerreiro 3, armas, armadura, 1 poder, 2 magias — uma com área
 *   esfera, outra com área cone) e "Thorin" (NPC do GM, Anão — deslocamento 6 m da raça).
 * - Tokens na Taverna: Kael, Thorin, três goblins do compêndio (um invisível, um sangrando), um
 *   Ogro 2×2 caído, e uma Carroça de cenário sem ficha.
 *  - Handouts (uma imagem, um texto) e um pino no mapa.
 * - Combate NÃO iniciado; PV/PM de Kael e Thorin cheios (as criaturas do compêndio já vêm assim).
 *
 * Regra número 1 do projeto: nada aqui conhece uma chave de sistema além das que o próprio
 * compêndio/JSON do Tormenta20 já declara — os itens da Kael/Thorin/goblins/Ogro são cópias reais
 * do compêndio (`entryToItem`/`entryToCharacter`, as mesmas funções que `compendium:spawn-creature`
 * usa), não objetos inventados à mão.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  CharacterDataSchema,
  DEFAULT_MAP_SIZE,
  FogConfigSchema,
  GridConfigSchema,
  computeCharacter,
  createDefaultCharacterData,
  creatureColor,
  entryToCharacter,
  entryToItem,
  getSystemDefinition,
  type CharacterData,
  type CompendiumCreatureEntry,
  type CompendiumEntry,
  type CompendiumItemEntry,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { getSystemCompendium } from "@tormenta-vtt/shared/compendium";
import { placeholderPng } from "./lib/placeholderImage.js";

const prisma = new PrismaClient();

// --- Identidade fixa da sala de teste (idempotência + URLs previsíveis) ----------------------
const ROOM_NAME = "Mesa de Teste";
const SYSTEM_ID = "tormenta20";
const INVITE_CODE = "TESTE1";
const GM_SECRET = "mesa-de-teste-gm-secret"; // RoomSchema.gmSecret exige >= 16 caracteres
const GM_SESSION_TOKEN = "mesa-de-teste-mestre-token";
const ANA_SESSION_TOKEN = "mesa-de-teste-ana-token";

const MAP_WIDTH = DEFAULT_MAP_SIZE.width; // 1600 — mesmo fallback que o cliente usa sem mapa
const MAP_HEIGHT = DEFAULT_MAP_SIZE.height; // 1100
const TAVERNA_CELL = 70;

const UPLOADS_DIR = fileURLToPath(new URL("../uploads/", import.meta.url));

/** Prisma tipa campos `Json` como `Prisma.InputJsonValue`; os objetos abaixo já vêm de um schema
 *  Zod (ou são simples o bastante pra não precisar), então isto é só o cast. */
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

function writeUpload(filename: string, data: Buffer): string {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  writeFileSync(join(UPLOADS_DIR, filename), data);
  return `/uploads/${filename}`;
}

// --- Atalhos para o compêndio ------------------------------------------------------------------

function findEntry(compendium: CompendiumEntry[], id: string): CompendiumEntry {
  const entry = compendium.find((e) => e.id === id);
  if (!entry) throw new Error(`Compêndio: entrada "${id}" não encontrada`);
  return entry;
}
function itemEntry(compendium: CompendiumEntry[], id: string): CompendiumItemEntry {
  const entry = findEntry(compendium, id);
  if (entry.type !== "item") throw new Error(`Compêndio: "${id}" não é um item`);
  return entry;
}
function creatureEntry(compendium: CompendiumEntry[], id: string): CompendiumCreatureEntry {
  const entry = findEntry(compendium, id);
  if (entry.type !== "creature") throw new Error(`Compêndio: "${id}" não é uma criatura`);
  return entry;
}

/** PV/PM "cheios": calcula o máximo (computeCharacter) e copia para `current` de cada recurso.
 *  Só precisa disto para fichas montadas do zero (createDefaultCharacterData nasce com `current: 0`,
 *  como uma ficha em branco de verdade) — as criaturas do compêndio já vêm com o PV do bloco. */
function withFullResources(def: SystemDefinition, data: CharacterData): CharacterData {
  const computed = computeCharacter(def, data);
  const resources = { ...data.resources };
  for (const [key, info] of Object.entries(computed.resources)) {
    const current = resources[key];
    resources[key] = { current: info.max, temp: current?.temp ?? 0, maxOverride: current?.maxOverride ?? null };
  }
  return CharacterDataSchema.parse({ ...data, resources });
}

// --- Fichas --------------------------------------------------------------------------------

/** Kael: PC de Ana. Humano Guerreiro nível 3, com arma corpo a corpo, à distância, armadura, um
 *  poder ativo e duas magias do compêndio (uma com área esfera, outra com área cone — pedido
 *  explícito do cenário de teste, pra exercitar a ferramenta "Área" do mapa nos dois formatos). */
function buildKael(def: SystemDefinition, compendium: CompendiumEntry[]): CharacterData {
  const item = (id: string) => itemEntry(compendium, id);

  const guerreiro = entryToItem(def, item("guerreiro"), randomUUID);
  guerreiro.fields.levels = 3;
  guerreiro.fields.initial = true; // primeira/única classe: conta como "classe inicial" (PV do 1º nível)

  const humano = entryToItem(def, item("humano"), randomUUID);

  const espadaLonga = entryToItem(def, item("espada-longa"), randomUUID);
  espadaLonga.equipped = true;
  const arcoCurto = entryToItem(def, item("arco-curto"), randomUUID);
  arcoCurto.equipped = true;
  const couroBatido = entryToItem(def, item("couro-batido"), randomUUID);
  couroBatido.equipped = true;

  const ataqueEspecial = entryToItem(def, item("ataque-especial"), randomUUID); // poder ativo (1 PM)
  const alarme = entryToItem(def, item("alarme"), randomUUID); // magia, área esfera
  const desesperoEsmagador = entryToItem(def, item("desespero-esmagador"), randomUUID); // magia, área cone

  const data = CharacterDataSchema.parse({
    ...createDefaultCharacterData(def),
    attributes: {
      for: { base: 3 },
      des: { base: 1 },
      con: { base: 2 },
      int: { base: -1 },
      sab: { base: 0 },
      car: { base: 0 },
    },
    // fortitude/luta vêm treinadas pela classe (skillsGranted do Guerreiro); reflexos é escolha própria.
    skills: { reflexos: { trained: true, other: 0, attribute: null } },
    size: "medio",
    spellcastingAttribute: "int",
    items: [guerreiro, humano, espadaLonga, arcoCurto, couroBatido, ataqueEspecial, alarme, desesperoEsmagador],
  });
  return withFullResources(def, data);
}

/** Thorin: NPC do GM. Só precisa da raça Anão (deslocamento 6 m, contra o padrão 9 m) para validar
 *  `{race.movement}` (§9.11 do SPEC); ganha uma arma e atributos básicos para não ficar vazio.
 *  PV/PM: `resources[key].max` só existe por fórmula de NÍVEL DE CLASSE no Tormenta20 (§ resources
 *  em tormenta20.json) — sem classe (Thorin é só um NPC avulso, não um "Guerreiro" de verdade),
 *  `computeCharacter` cairia em 0. `maxOverride` é a mesma saída que o compêndio usa pras
 *  criaturas prontas (ex.: o Ogro abaixo tem `maxOverride: 130`) — um número digitado à mão. */
function buildThorin(def: SystemDefinition, compendium: CompendiumEntry[]): CharacterData {
  const item = (id: string) => itemEntry(compendium, id);

  const anao = entryToItem(def, item("anao"), randomUUID);
  const espada = entryToItem(def, item("espada-longa"), randomUUID);
  espada.equipped = true;

  const data = CharacterDataSchema.parse({
    ...createDefaultCharacterData(def),
    attributes: { for: { base: 2 }, des: { base: 0 }, con: { base: 3 }, int: { base: 0 }, sab: { base: 1 }, car: { base: 0 } },
    skills: {
      luta: { trained: true, other: 0, attribute: null },
      fortitude: { trained: true, other: 0, attribute: null },
    },
    resources: { pv: { current: 0, temp: 0, maxOverride: 30 }, pm: { current: 0, temp: 0, maxOverride: 0 } },
    size: "medio",
    items: [anao, espada],
  });
  return withFullResources(def, data);
}

async function main(): Promise<void> {
  // 1. Idempotência: apaga a sala de teste anterior (cascade cuida do resto) antes de recriar.
  const previous = await prisma.room.findFirst({ where: { name: ROOM_NAME } });
  if (previous) {
    await prisma.room.delete({ where: { id: previous.id } });
    console.log(`Sala "${ROOM_NAME}" anterior apagada (id ${previous.id}).`);
  }

  const def = getSystemDefinition(SYSTEM_ID);
  const compendium = getSystemCompendium(SYSTEM_ID).entries;

  // 2. Sala + participantes.
  const room = await prisma.room.create({
    data: { name: ROOM_NAME, inviteCode: INVITE_CODE, gmSecret: GM_SECRET, systemId: SYSTEM_ID },
  });
  const mestre = await prisma.participant.create({
    data: { roomId: room.id, nickname: "Mestre", role: "gm", sessionToken: GM_SESSION_TOKEN },
  });
  const ana = await prisma.participant.create({
    data: { roomId: room.id, nickname: "Ana", role: "player", sessionToken: ANA_SESSION_TOKEN },
  });

  // 3. Mapas.
  const tavernaMapUrl = writeUpload("seed-test-taverna.png", placeholderPng(MAP_WIDTH, MAP_HEIGHT, [[87, 57, 34], [62, 39, 22]], 80));
  const taverna = await prisma.scene.create({
    data: {
      roomId: room.id,
      name: "Taverna",
      mapUrl: tavernaMapUrl,
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      grid: toJson(GridConfigSchema.parse({ cellSize: TAVERNA_CELL })),
      order: 0,
    },
  });
  const estrada = await prisma.scene.create({
    data: {
      roomId: room.id,
      name: "Estrada",
      grid: toJson(GridConfigSchema.parse({ cellSize: 100 })),
      order: 1,
      arrival: toJson({ x: Math.round(MAP_WIDTH / 2), y: Math.round(MAP_HEIGHT / 2) }),
    },
  });
  const cripta = await prisma.scene.create({
    data: {
      roomId: room.id,
      name: "Cripta",
      grid: toJson(GridConfigSchema.parse({ cellSize: 70 })),
      order: 2,
      // "Metade revelada": base escondida, com um retângulo revelando a metade esquerda do mapa
      // padrão (sem mapUrl, o cliente desenha DEFAULT_MAP_SIZE — a shape usa o mesmo tamanho).
      fog: toJson(
        FogConfigSchema.parse({
          enabled: true,
          base: "hidden",
          shapes: [{ id: randomUUID(), mode: "reveal", kind: "rect", x: 0, y: 0, width: MAP_WIDTH / 2, height: MAP_HEIGHT }],
        }),
      ),
    },
  });
  await prisma.room.update({ where: { id: room.id }, data: { activeSceneId: taverna.id } });

  // 4. Fichas.
  const kael = await prisma.character.create({
    data: { roomId: room.id, ownerId: ana.id, name: "Kael", kind: "pc", data: toJson(buildKael(def, compendium)) },
  });
  const thorin = await prisma.character.create({
    data: { roomId: room.id, ownerId: null, name: "Thorin", kind: "npc", data: toJson(buildThorin(def, compendium)) },
  });

  // NPCs de bloco pronto (mesma função que compendium:spawn-creature usa) — já nascem com PV cheio.
  const goblinTemplate = creatureEntry(compendium, "goblin-salteador");
  const ogroTemplate = creatureEntry(compendium, "ogro");
  async function spawnNpc(entry: CompendiumCreatureEntry, name: string) {
    const built = entryToCharacter(def, entry, randomUUID, { name });
    return prisma.character.create({ data: { roomId: room.id, ownerId: null, name: built.name, kind: built.kind, data: toJson(built.data) } });
  }
  const [goblin1, goblin2, goblin3, ogro] = await Promise.all([
    spawnNpc(goblinTemplate, "Goblin 1"),
    spawnNpc(goblinTemplate, "Goblin 2"),
    spawnNpc(goblinTemplate, "Goblin 3"),
    spawnNpc(ogroTemplate, "Ogro"),
  ]);
  const goblinColor = creatureColor(def, goblinTemplate);
  const ogroColor = creatureColor(def, ogroTemplate);
  const ogroCells = Math.max(1, Math.round(def.sizes.find((s) => s.key === "grande")?.tokenCells ?? 1));

  // 5. Tokens na Taverna.
  await prisma.token.createMany({
    data: [
      { sceneId: taverna.id, name: "Kael", x: 280, y: 280, cells: 1, ownerId: ana.id, color: "#2563eb", characterId: kael.id },
      { sceneId: taverna.id, name: "Thorin", x: 420, y: 280, cells: 1, ownerId: null, color: "#16a34a", characterId: thorin.id },
      {
        sceneId: taverna.id,
        name: "Goblin 1",
        x: 700,
        y: 490,
        cells: 1,
        ownerId: null,
        color: goblinColor,
        characterId: goblin1.id,
        conditions: toJson([{ key: "sangrando" }]),
      },
      { sceneId: taverna.id, name: "Goblin 2", x: 770, y: 490, cells: 1, ownerId: null, color: goblinColor, characterId: goblin2.id },
      {
        sceneId: taverna.id,
        name: "Goblin 3",
        x: 840,
        y: 490,
        cells: 1,
        ownerId: null,
        color: goblinColor,
        characterId: goblin3.id,
        visible: false, // "um goblin invisível" — só o GM enxerga
      },
      {
        sceneId: taverna.id,
        name: "Ogro",
        x: 980,
        y: 420,
        cells: ogroCells,
        ownerId: null,
        color: ogroColor,
        characterId: ogro.id,
        // Fora de combate não expira: fica permanente mesmo, como o cenário pede.
        conditions: toJson([{ key: "caido" }]),
      },
      {
        sceneId: taverna.id,
        name: "Carroça",
        x: 180,
        y: 560,
        // Token não quadrado (2x1) não é mais suportado (Token.cells é um lado só,
        // docs/plano-grid.md D1): arredonda pro maior lado.
        cells: 2,
        ownerId: null,
        color: "#92400e",
        // Sem characterId: token de cenário puro, não entra em combate nem tem PV.
      },
    ],
  });

  // 6. Handouts (biblioteca + um pino no mapa).
  const handoutImageUrl = writeUpload("seed-test-handout.png", placeholderPng(800, 600, [[180, 83, 9], [120, 53, 15]], 48));
  const handoutImage = await prisma.handout.create({
    data: { roomId: room.id, name: "Retrato do vilão", kind: "image", imageUrl: handoutImageUrl, width: 800, height: 600, tags: ["teste"] },
  });
  await prisma.handout.create({
    data: {
      roomId: room.id,
      name: "Bilhete rasgado",
      kind: "text",
      text: '"Não confie no taberneiro. Ele sabe mais do que finge." — encontrado no bolso do corpo, no beco atrás da Taverna.',
      tags: ["teste", "pista"],
    },
  });
  await prisma.pin.create({
    data: {
      sceneId: taverna.id,
      handoutId: handoutImage.id,
      x: 520,
      y: 650,
      visible: true,
      name: handoutImage.name,
      kind: "image",
      imageUrl: handoutImage.imageUrl,
      width: handoutImage.width,
      height: handoutImage.height,
    },
  });

  // Pino de nota (docs/plano-narracao.md), pra quem for testar já ver um exemplo.
  await prisma.pin.create({
    data: {
      sceneId: taverna.id,
      kind: "note",
      x: 260,
      y: 300,
      visible: false,
      name: "O taberneiro mente",
      text: "Ele conhece o vilão de outra vida — não conta pra ninguém, nem se perguntarem direto.",
    },
  });

  // 7. Resumo para quem for abrir o navegador.
  const webUrl = process.env.SEED_TEST_WEB_URL ?? "http://localhost:5173";
  console.log(`
${ROOM_NAME} pronta (sistema ${SYSTEM_ID}).

Mapas: Taverna (ativo) · Estrada · Cripta
Fichas: Kael (Humano Guerreiro 3, de Ana) · Thorin (NPC do GM, Anão)
Tokens na Taverna: Kael, Thorin, Goblin 1/2/3 (o 3 é invisível), Ogro 2x2, Carroça (cenário)
Handouts: "Retrato do vilão" (imagem, fixado na Taverna) · "Bilhete rasgado" (texto)
Combate: não iniciado.

--- Mestre --------------------------------------------------------------
Abra direto — "?gm=" já loga como "${mestre.nickname}"; "?session=" reconecta pelo sessionToken
fixo (some da URL sozinho ao carregar, ver docs/testar-com-amigos.md):
  ${webUrl}/room/${INVITE_CODE}?gm=${GM_SECRET}&session=${GM_SESSION_TOKEN}

--- Ana (jogadora, dona da ficha da Kael) ---------------------------------
Abra direto — reconecta como "${ana.nickname}" pelo sessionToken fixo, sem pedir nickname nem
criar uma jogadora nova (que não seria dona dos tokens da Kael):
  ${webUrl}/room/${INVITE_CODE}?session=${ANA_SESSION_TOKEN}

--- Fallback (sem tocar na URL) --------------------------------------------
Código de convite: ${INVITE_CODE}
Nickname da jogadora: Ana (entrar pelo link sem "?gm=" nem "?session=" e digitar "Ana" no prompt)
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
