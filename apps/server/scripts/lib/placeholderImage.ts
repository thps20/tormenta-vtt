/**
 * Gera uma imagem PNG "placeholder" (xadrez de duas cores) sem depender de nenhuma lib de
 * imagem — o projeto não tem sharp/canvas/jimp em nenhum package.json. Só usa `zlib` (built-in
 * do Node) para comprimir os pixels crus, que é a única parte "difícil" do formato PNG; o resto
 * é escrever a assinatura + três chunks (IHDR, IDAT, IEND) com CRC-32, como a spec pede.
 *
 * Usado só pelo seed de teste (scripts/seed-test.ts): mapas/handouts de teste precisam de uma
 * URL de imagem válida, mas o conteúdo não importa.
 */
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Tabela de CRC-32 (usada em todo chunk PNG), calculada uma vez. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

type Rgb = readonly [number, number, number];

/**
 * PNG RGB de 8 bits, `width`×`height`, com um xadrez de células `blockSize` px alternando entre
 * `colors[0]` e `colors[1]` — o bastante para reconhecer visualmente qual placeholder é qual sem
 * precisar de arte de verdade.
 */
export function placeholderPng(width: number, height: number, colors: readonly [Rgb, Rgb] = [[100, 116, 139], [71, 85, 105]], blockSize = 64): Buffer {
  const [colorA, colorB] = colors;
  const stride = width * 3 + 1; // +1 = byte de filtro no início de cada linha (0 = "None")
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const isA = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      const [r, g, b] = isA ? colorA : colorB;
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = r;
      raw[pixelStart + 1] = g;
      raw[pixelStart + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidade de bits
  ihdr[9] = 2; // tipo de cor: RGB (sem alpha)
  ihdr[10] = 0; // método de compressão (só existe o 0)
  ihdr[11] = 0; // método de filtro (só existe o 0)
  ihdr[12] = 0; // sem interlace

  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
