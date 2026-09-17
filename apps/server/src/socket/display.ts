/**
 * Cast — tela de exibição (docs/plano-cast.md). A tela entra por `display:join` (nunca por
 * `room:join`: não é um `Participant`). Todo o resto (gerar/revogar link, modo de câmera,
 * blackout, enquadramento, miniatura) é GM only — o middleware de somente leitura em
 * `socket/index.ts` garante que um socket de tela não chega em nenhum evento gmOnly.
 */
import {
  DisplayFrameSchema,
  DisplayHandoutViewSchema,
  DisplayJoinSchema,
  DisplaySetBlackoutSchema,
  DisplaySetCameraModeSchema,
  DisplaySetPreviewSchema,
  DisplaySetTabletopHintSchema,
  DisplayViewSchema,
  EmptySchema,
  type Ack,
  type DisplaySnapshot,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  DISPLAY_VIEWER_ID,
  addPreviewDemand,
  displayCount,
  displayTokenMatches,
  getCameraMode,
  isBlackout,
  removePreviewDemand,
  reportTabletopHint,
  setBlackout,
  setCameraMode,
} from "../services/display.js";
import { generateDisplayToken } from "../services/ids.js";
import { buildSnapshot } from "../services/snapshot.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

export function registerDisplayHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on("display:join", async (payload, ack: Ack<DisplaySnapshot>) => {
    const reply: Ack<DisplaySnapshot> = typeof ack === "function" ? ack : () => undefined;
    try {
      const parsed = DisplayJoinSchema.safeParse(payload);
      if (!parsed.success) throw new HandlerError("Dados inválidos");
      const { inviteCode, displayToken } = parsed.data;

      const room = await prisma.room.findUnique({ where: { inviteCode: inviteCode.toUpperCase() } });
      if (!room) throw new HandlerError("Sala não encontrada");
      if (!displayTokenMatches(room, displayToken)) throw new HandlerError("Link de exibição inválido ou revogado");

      socket.data.roomId = room.id;
      socket.data.participantId = DISPLAY_VIEWER_ID;
      socket.data.role = "player";
      socket.data.nickname = "Tela da mesa";
      socket.data.isDisplay = true;

      // Mesma sala `players` de sempre: todo broadcast de mapa (token/névoa/gabarito/pino/desenho/
      // régua) já é filtrado "como jogador" ali — a tela reaproveita o filtro inteiro sem duplicar
      // nada (docs/plano-cast.md §1.4).
      await socket.join([rooms.all(room.id), rooms.players(room.id), rooms.display(room.id)]);

      const snapshot = await buildSnapshot(room, { id: DISPLAY_VIEWER_ID, nickname: "Tela da mesa", role: "player", sessionToken: "" });
      const { cast: _cast, ...rest } = snapshot; // a tela nunca recebe `cast` (token/administração é só do GM)
      const displaySnapshot: DisplaySnapshot = { ...rest, cameraMode: getCameraMode(room.id), blackout: isBlackout(room.id) };

      io.to(rooms.gm(room.id)).emit("display:presence", { count: displayCount(io, room.id) });
      reply({ ok: true, data: displaySnapshot });
    } catch (err) {
      if (err instanceof HandlerError) reply({ ok: false, error: err.message });
      else {
        console.error(err);
        reply({ ok: false, error: "Erro interno do servidor" });
      }
    }
  });

  socket.on(
    "display:create-token",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const token = generateDisplayToken();
        await prisma.room.update({ where: { id: ctx.roomId }, data: { displayToken: token } });
        kickConnectedDisplays(io, ctx.roomId);
        socket.to(rooms.gm(ctx.roomId)).emit("display:tokenChanged", { displayToken: token });
        return { displayToken: token };
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:revoke-token",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        await prisma.room.update({ where: { id: ctx.roomId }, data: { displayToken: null } });
        kickConnectedDisplays(io, ctx.roomId);
        socket.to(rooms.gm(ctx.roomId)).emit("display:tokenChanged", { displayToken: null });
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:set-camera-mode",
    guarded(
      socket,
      DisplaySetCameraModeSchema,
      async ({ mode }, ctx) => {
        setCameraMode(ctx.roomId, mode);
        io.to(rooms.gm(ctx.roomId)).to(rooms.display(ctx.roomId)).emit("display:cameraModeChanged", { mode });
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:set-blackout",
    guarded(
      socket,
      DisplaySetBlackoutSchema,
      async ({ blackout }, ctx) => {
        setBlackout(ctx.roomId, blackout);
        io.to(rooms.gm(ctx.roomId)).to(rooms.display(ctx.roomId)).emit("display:blackoutChanged", { blackout });
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:view",
    guarded(
      socket,
      DisplayViewSchema,
      async (payload, ctx) => {
        // "follow" só repassa se o modo ATUAL da sala é mesmo "follow" (o Mestre pode estar
        // navegando um mapa de preparação com o modo em "livre" — não deveria mexer na tela).
        // "center" (botão Centralizar aqui) sempre repassa, em qualquer modo.
        if (payload.reason === "follow" && getCameraMode(ctx.roomId) !== "follow") return;
        io.to(rooms.display(ctx.roomId)).emit("display:view", payload);
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:handout-view",
    guarded(
      socket,
      DisplayHandoutViewSchema,
      async (payload, ctx) => {
        // Repassa cru: quem decide se cabe aplicar (handout atual bate com `handoutId`) é a tela
        // (`store/cast.ts`). Nunca chega aqui um sussurro — `HandoutOverlay` só liga o polling que
        // emite este evento quando o handout aberto é "para todos" (ver comentário lá).
        io.to(rooms.display(ctx.roomId)).emit("display:handout-view", payload);
      },
      gmOnly,
    ),
  );

  socket.on(
    "display:preview",
    guarded(
      socket,
      DisplaySetPreviewSchema,
      async ({ on }, ctx) => {
        const changed = on ? addPreviewDemand(ctx.roomId, socket.id) : removePreviewDemand(ctx.roomId, socket.id);
        if (changed) io.to(rooms.display(ctx.roomId)).emit("display:previewDemand", { on });
      },
      gmOnly,
    ),
  );

  // Chamados PELA tela (única exceção ao gmOnly acima — ver DISPLAY_ALLOWED_EVENTS/middleware).
  socket.on(
    "display:frame",
    guarded(socket, DisplayFrameSchema, async (payload, ctx) => {
      io.to(rooms.gm(ctx.roomId)).emit("display:frame", payload);
    }),
  );

  socket.on(
    "display:set-tabletop-hint",
    guarded(socket, DisplaySetTabletopHintSchema, async ({ tabletop }, ctx) => {
      reportTabletopHint(ctx.roomId, tabletop);
    }),
  );

  socket.on("disconnect", () => {
    const { roomId, isDisplay } = socket.data;
    if (!roomId) return;
    // Aba de GM com o popover Cast aberto que caiu sem clicar em fechar: solta a demanda dela.
    if (removePreviewDemand(roomId, socket.id)) io.to(rooms.display(roomId)).emit("display:previewDemand", { on: false });
    // A própria tela caiu: avisa o GM de quantas ainda restam (Socket.io já a tirou da sala antes
    // deste evento — `displayCount` já reflete o número certo).
    if (isDisplay) io.to(rooms.gm(roomId)).emit("display:presence", { count: displayCount(io, roomId) });
  });
}

/** Avisa as telas conectadas que o token mudou (novo link ou revogação) e as derruba. */
function kickConnectedDisplays(io: TypedServer, roomId: string): void {
  io.to(rooms.display(roomId)).emit("display:revoked");
  io.in(rooms.display(roomId)).disconnectSockets(true);
}
