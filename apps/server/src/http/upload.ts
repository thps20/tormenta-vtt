import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { imageSize } from "image-size";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { UploadAudioResult, UploadResult } from "@tormenta-vtt/shared";

/** apps/server/uploads (relativo a este arquivo, funciona em src/ e em dist/). */
export const UPLOADS_DIR = fileURLToPath(new URL("../../uploads/", import.meta.url));

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_IMAGE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
/** Áudio (docs/plano-preparo.md §1.3): extensão sugerida pelo mimetype do multipart, mas o tipo de
 *  verdade vem dos BYTES iniciais (`detectAudioExt` abaixo) — o mimetype é só o que o navegador
 *  declarou, não prova nada (alguns mandam "audio/mp3", outros "audio/mpeg" pro mesmo arquivo). */
const ALLOWED_AUDIO = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/x-ogg"]);

/**
 * Confere a ASSINATURA do arquivo (magic bytes), não o mimetype declarado pelo cliente: OGG sempre
 * começa com "OggS"; MP3 começa com um cabeçalho ID3 ("ID3") ou, sem tag ID3, direto com um frame
 * sync MPEG (11 bits em 1: byte 0 = 0xFF, byte 1 = 0xE0..0xFF). Devolve a extensão certa ou null se
 * não reconhecer nenhum dos dois — mesmo se o mimetype dizia ser áudio.
 */
function detectAudioExt(buffer: Buffer): "mp3" | "ogg" | null {
  if (buffer.length >= 4 && buffer.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (buffer.length >= 3 && buffer.toString("latin1", 0, 3) === "ID3") return "mp3";
  const [b0, b1] = buffer;
  if (b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0) return "mp3";
  return null;
}

/**
 * POST /api/upload (multipart, campo "file") -> { url, width, height }
 * GET  /uploads/<arquivo>
 *
 * Por enquanto salva em disco. A URL devolvida é relativa ("/uploads/x.png");
 * o web prefixa com a URL do servidor. Assim o banco não fica preso a um host.
 */
export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE, files: 1 } });
  await app.register(fastifyStatic, {
    root: UPLOADS_DIR,
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.post("/api/upload", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "Nenhum arquivo enviado (campo 'file')" });

    const isAudioMimetype = ALLOWED_AUDIO.has(part.mimetype);
    const imageExt = ALLOWED_IMAGE[part.mimetype];
    if (!imageExt && !isAudioMimetype) {
      return reply.code(415).send({ error: "Formato não suportado. Use PNG, JPG, WebP, MP3 ou OGG." });
    }

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: "Arquivo maior que 20 MB" });
    }
    if (part.file.truncated) return reply.code(413).send({ error: "Arquivo maior que 20 MB" });

    if (isAudioMimetype) {
      const audioExt = detectAudioExt(buffer);
      if (!audioExt) return reply.code(400).send({ error: "Não foi possível reconhecer o áudio como MP3 ou OGG" });

      const filename = `${randomBytes(12).toString("hex")}.${audioExt}`;
      await writeFile(new URL(filename, `file://${UPLOADS_DIR}`), buffer);

      const result: UploadAudioResult = { url: `/uploads/${filename}`, kind: "audio" };
      return reply.code(201).send(result);
    }

    let dims: { width?: number; height?: number };
    try {
      dims = imageSize(buffer);
    } catch {
      return reply.code(400).send({ error: "Não foi possível ler a imagem" });
    }
    if (!dims.width || !dims.height) {
      return reply.code(400).send({ error: "Não foi possível ler as dimensões da imagem" });
    }

    // Nome aleatório: evita sobrescrever e não expõe o nome original.
    const filename = `${randomBytes(12).toString("hex")}.${imageExt}`;
    await writeFile(new URL(filename, `file://${UPLOADS_DIR}`), buffer);

    const result: UploadResult = { url: `/uploads/${filename}`, width: dims.width, height: dims.height };
    return reply.code(201).send(result);
  });
}
