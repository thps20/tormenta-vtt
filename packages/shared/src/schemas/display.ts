import { z } from "zod";
import { IdSchema, PositionSchema } from "./common.js";

/**
 * Cast — tela de exibição (docs/plano-cast.md). Schemas dos payloads novos; a tela NUNCA é um
 * `Participant` (não entra no banco, não conta em presença/combate/alvos), então estes schemas não
 * reaproveitam nada de `room.ts`/`payloads.ts` além do básico (`IdSchema`, `PositionSchema`).
 */

export const DisplayCameraModeSchema = z.enum(["follow", "auto", "free"]);
export type DisplayCameraMode = z.infer<typeof DisplayCameraModeSchema>;

/** Entrada da tela: `inviteCode` da sala + o token gerado pelo GM (`Room.displayToken`). */
export const DisplayJoinSchema = z.object({
  inviteCode: z.string().trim().min(1).max(32),
  displayToken: z.string().min(1),
});
export type DisplayJoinPayload = z.infer<typeof DisplayJoinSchema>;

/**
 * Enquadramento efêmero (docs/plano-cast.md §1.3, §4.1): SEMPRE em pixels do MAPA (centro + área
 * visível), nunca em pixels de tela — as duas telas (GM e Cast) têm tamanhos diferentes. `reason`
 * distingue "estou seguindo meu enquadramento normal" (aplicado só se o modo é "follow") de
 * "cliquei em Centralizar aqui" (aplicado em qualquer modo, com pausa de 10s do automático).
 */
export const DisplayViewSchema = z.object({
  reason: z.enum(["follow", "center"]),
  sceneId: IdSchema,
  center: PositionSchema,
  viewWidth: z.number().positive(),
  viewHeight: z.number().positive(),
});
export type DisplayViewPayload = z.infer<typeof DisplayViewSchema>;

/**
 * Enquadramento efêmero do handout aberto "para todos" na tela (docs/revisao-cast.md): zoom/pan
 * que o Mestre está fazendo na imagem, throttled (~150ms) e só emitido pelo GM enquanto há tela
 * conectada. `x`/`y` são o ponto da imagem que fica no CENTRO do enquadramento, em FRAÇÃO do
 * tamanho natural da imagem (não pixels de tela) — mesmo motivo de `DisplayViewSchema.center` usar
 * pixels do mapa: GM e tela têm tamanhos de tela diferentes, só a imagem em si (mesmo asset) é
 * compartilhada entre os dois. Nunca chega à tela se o handout foi mostrado como sussurro (ver
 * `socket/display.ts`/`socket/handout.ts`).
 */
export const DisplayHandoutViewSchema = z.object({
  handoutId: IdSchema,
  zoom: z.number().positive(),
  x: z.number(),
  y: z.number(),
});
export type DisplayHandoutViewPayload = z.infer<typeof DisplayHandoutViewSchema>;

export const DisplaySetCameraModeSchema = z.object({ mode: DisplayCameraModeSchema });
export type DisplaySetCameraModePayload = z.infer<typeof DisplaySetCameraModeSchema>;

/**
 * A tela reporta se a calibração de mesa física está ligada (docs/plano-cast.md §9 decisão 1): só
 * decide o PADRÃO do modo de câmera antes do GM escolher um explicitamente — nunca trava nada.
 */
export const DisplaySetTabletopHintSchema = z.object({ tabletop: z.boolean() });
export type DisplaySetTabletopHintPayload = z.infer<typeof DisplaySetTabletopHintSchema>;

export const DisplaySetBlackoutSchema = z.object({ blackout: z.boolean() });
export type DisplaySetBlackoutPayload = z.infer<typeof DisplaySetBlackoutSchema>;

export const DisplaySetPreviewSchema = z.object({ on: z.boolean() });
export type DisplaySetPreviewPayload = z.infer<typeof DisplaySetPreviewSchema>;

/** Miniatura mandada pela TELA pro GM (docs/plano-cast.md §5): JPEG data URL, tamanho limitado. */
export const DisplayFrameSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/jpeg;base64,/, "esperado JPEG em data URL"),
});
export type DisplayFramePayload = z.infer<typeof DisplayFrameSchema>;

/**
 * Preferências de calibração da mesa física (docs/plano-cast.md §3.3): 100% locais (localStorage
 * da tela, chave `tvtt:cast:tabletop`, NÃO por sala — depende do projetor/mesa, não da campanha).
 * O schema valida o que volta do localStorage (fronteira também, pode estar corrompido/desatualizado).
 */
export const TabletopPrefsSchema = z.object({
  enabled: z.boolean().default(false),
  pxPerCm: z.number().positive().default(20),
  cellCm: z.number().positive().default(2.5),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  labelScale: z.number().min(1).max(4).default(1),
  turnIndicatorCorner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "off"]).default("bottom-right"),
});
export type TabletopPrefs = z.infer<typeof TabletopPrefsSchema>;
