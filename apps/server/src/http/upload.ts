import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { imageSize } from "image-size";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { UploadResult } from "@tormenta-vtt/shared";

/** apps/server/uploads (relativo a este arquivo, funciona em src/ e em dist/). */
export const UPLOADS_DIR = fileURLToPath(new URL("../../uploads/", import.meta.url));

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

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

    const ext = ALLOWED[part.mimetype];
    if (!ext) return reply.code(415).send({ error: "Formato não suportado. Use PNG, JPG ou WebP." });

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: "Arquivo maior que 20 MB" });
    }
    if (part.file.truncated) return reply.code(413).send({ error: "Arquivo maior que 20 MB" });

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
    const filename = `${randomBytes(12).toString("hex")}.${ext}`;
    await writeFile(new URL(filename, `file://${UPLOADS_DIR}`), buffer);

    const result: UploadResult = { url: `/uploads/${filename}`, width: dims.width, height: dims.height };
    return reply.code(201).send(result);
  });
}
