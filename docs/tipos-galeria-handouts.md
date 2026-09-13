# Tipos — galeria de handouts

Bloco único (sem imports) pra colar em outra ferramenta de prototipagem de UI. Espelha os tipos reais
de `packages/shared/src/schemas/handout.ts` e `pin.ts` (Zod, fonte da verdade no código), só que
como `type`/`interface` puro e sem os schemas de validação.

```typescript
// ===================== Tipos =====================

/** Handout: item da biblioteca da sala (imagem ou texto) que o GM mostra ou fixa no mapa. */
export type Handout =
  | {
      kind: "image";
      id: string;
      roomId: string;
      name: string;
      tags: string[];
      createdAt: string; // ISO datetime
      imageUrl: string;
      width: number;
      height: number;
    }
  | {
      kind: "text";
      id: string;
      roomId: string;
      name: string;
      tags: string[];
      createdAt: string; // ISO datetime
      text: string;
    };

export type HandoutKind = Handout["kind"];

/**
 * Pino de handout fixado no mapa — aqui só a variante `kind: "handout"` da união maior de pinos
 * (que também tem pino de nota), já que é só o que a galeria precisa pra saber "isso já tá fixado".
 * Cópia denormalizada do Handout no momento de fixar: editar o handout original depois não
 * atualiza o pino.
 */
export type HandoutPin =
  | {
      kind: "image";
      id: string;
      sceneId: string;
      x: number;
      y: number;
      visible: boolean;
      handoutId: string;
      name: string;
      imageUrl: string;
      width: number;
      height: number;
    }
  | {
      kind: "text";
      id: string;
      sceneId: string;
      x: number;
      y: number;
      visible: boolean;
      handoutId: string;
      name: string;
      text: string;
    };

/** Participante da sala — só o necessário pro menu "Mostrar para...". */
export interface Participant {
  id: string;
  nickname: string;
  role: "gm" | "player";
  connected: boolean;
}

/** Alvo de "Mostrar": sala toda, ou um jogador específico (sussurro visual — só ele + o GM veem). */
export type HandoutShowTarget = "all" | { participantId: string };

/** Patch de edição: só nome/tags — trocar a imagem ou o texto é apagar e criar de novo. */
export interface HandoutPatch {
  name?: string;
  tags?: string[];
}

/** Dados pro novo handout de texto (upload de imagem já entra pronto, ver onUpload). */
export interface HandoutCreateTextInput {
  name: string;
  text: string;
  tags?: string[];
}

/** Callbacks da galeria de handouts. */
export interface HandoutGalleryCallbacks {
  /** Mostra o handout pra sala toda (overlay em tela cheia + card no chat). */
  onShowToAll: (handoutId: string) => void;
  /** Mostra o handout só pra um jogador (sussurro visual). */
  onShowTo: (handoutId: string, participantId: string) => void;
  /** Fixa o handout como pino no mapa atual. */
  onPinToMap: (handoutId: string) => void;
  /** Edita nome/tags de um handout existente. */
  onEdit: (handoutId: string, patch: HandoutPatch) => void;
  /** Apaga um handout da biblioteca. */
  onDelete: (handoutId: string) => void;
  /** Sobe uma nova imagem e cria um handout `kind: "image"`. */
  onUpload: (file: File) => void;
  /** Cria um novo handout `kind: "text"`. */
  onCreateText: (input: HandoutCreateTextInput) => void;
  /** Filtra a galeria pelas tags selecionadas (lista vazia = sem filtro). */
  onTagFilter: (tags: string[]) => void;
  /** Filtra a galeria pelo texto buscado no nome. */
  onSearch: (query: string) => void;
}

// ===================== Mock =====================

export const mockParticipants: Participant[] = [
  { id: "p-gm", nickname: "Mestre Aurelio", role: "gm", connected: true },
  { id: "p-1", nickname: "Kael", role: "player", connected: true },
  { id: "p-2", nickname: "Sora", role: "player", connected: true },
  { id: "p-3", nickname: "Bran", role: "player", connected: false },
];

export const mockHandouts: Handout[] = [
  {
    kind: "image",
    id: "h-1",
    roomId: "room-1",
    name: "Mapa de Valkaria",
    tags: ["mapa", "cidade"],
    createdAt: "2026-08-01T14:20:00.000Z",
    imageUrl: "/uploads/valkaria-mapa.jpg",
    width: 1600,
    height: 1200,
  },
  {
    kind: "image",
    id: "h-2",
    roomId: "room-1",
    name: "Retrato do Barão Nogueira",
    tags: ["npc", "vilão"],
    createdAt: "2026-08-02T09:05:00.000Z",
    imageUrl: "/uploads/barao-nogueira.jpg",
    width: 800,
    height: 1000,
  },
  {
    kind: "image",
    id: "h-3",
    roomId: "room-1",
    name: "Adaga Amaldiçoada",
    tags: ["item", "tesouro"],
    createdAt: "2026-08-03T18:40:00.000Z",
    imageUrl: "/uploads/adaga-amaldicoada.jpg",
    width: 900,
    height: 900,
  },
  {
    kind: "image",
    id: "h-4",
    roomId: "room-1",
    name: "Ruínas do Templo Esquecido",
    tags: ["mapa", "masmorra"],
    createdAt: "2026-08-05T11:15:00.000Z",
    imageUrl: "/uploads/templo-esquecido.jpg",
    width: 1920,
    height: 1440,
  },
  {
    kind: "image",
    id: "h-5",
    roomId: "room-1",
    name: "Brasão da Casa Cardoso",
    tags: ["npc", "família"],
    createdAt: "2026-08-06T20:30:00.000Z",
    imageUrl: "/uploads/brasao-cardoso.jpg",
    width: 512,
    height: 512,
  },
  {
    kind: "text",
    id: "h-6",
    roomId: "room-1",
    name: "Carta Encontrada no Cofre",
    tags: ["pista", "npc"],
    createdAt: "2026-08-07T08:00:00.000Z",
    text: "Se estás lendo isto, é porque o Barão finalmente confiou em ti — ou porque me traiu. De qualquer forma, o ouro está sob a terceira lápide do cemitério velho.",
  },
  {
    kind: "text",
    id: "h-7",
    roomId: "room-1",
    name: "Lenda do Lago Negro",
    tags: ["lenda", "pista"],
    createdAt: "2026-08-08T16:45:00.000Z",
    text: "Dizem os anciãos que nas noites sem lua algo se move sob as águas do Lago Negro, e que quem ousa navegá-las nunca mais é visto com o rosto que tinha.",
  },
  {
    kind: "text",
    id: "h-8",
    roomId: "room-1",
    name: "Regras da Arena de Duelos",
    tags: ["regra"],
    createdAt: "2026-08-09T12:00:00.000Z",
    text: "1. Sem magia. 2. Sem venenos. 3. O combate termina na primeira gota de sangue. 4. Quebrar as regras acima é sentença de morte imediata.",
  },
];

/** Um handout (h-1) já está fixado como pino no mapa atual — pra mostrar o estado "já fixado" na galeria. */
export const mockHandoutPins: HandoutPin[] = [
  {
    kind: "image",
    id: "pin-1",
    sceneId: "scene-1",
    x: 640,
    y: 480,
    visible: true,
    handoutId: "h-1",
    name: "Mapa de Valkaria",
    imageUrl: "/uploads/valkaria-mapa.jpg",
    width: 1600,
    height: 1200,
  },
];
```
