// Generates solid PWA icons (PNG) without any image dependency.
// Draws a rounded green square with a white "P" glyph made of rectangles.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const BG = [22, 163, 74]; // green-600
function draw(size, opaqueBg) {
  const r = size * 0.22;
  // "P" glyph geometry in unit coords
  const stemX0 = 0.30, stemX1 = 0.44, stemY0 = 0.24, stemY1 = 0.78;
  const bowlX1 = 0.70, bowlY0 = 0.24, bowlY1 = 0.56, bowlInnerY0 = 0.34, bowlInnerY1 = 0.46, bowlInnerX1 = 0.58;
  return png(size, (x, y) => {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    // rounded square mask
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    if (!inside && !opaqueBg) return [0, 0, 0, 0];
    const inStem = u >= stemX0 && u <= stemX1 && v >= stemY0 && v <= stemY1;
    const inBowl = u >= stemX0 && u <= bowlX1 && v >= bowlY0 && v <= bowlY1;
    const inHole = u >= stemX1 && u <= bowlInnerX1 && v >= bowlInnerY0 && v <= bowlInnerY1;
    const white = inStem || (inBowl && !inHole);
    return white ? [255, 255, 255, 255] : [...BG, 255];
  });
}
writeFileSync("public/icons/icon-192.png", draw(192, false));
writeFileSync("public/icons/icon-512.png", draw(512, false));
writeFileSync("public/icons/icon-512-maskable.png", draw(512, true));
writeFileSync("public/icons/apple-touch-icon.png", draw(180, true));
console.log("icons written");
