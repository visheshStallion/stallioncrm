/**
 * Generates the PWA icons (our own simple mark: a white chevron on the primary colour – no third-party art).
 *   node scripts/make-icons.mjs
 */
import fs from "node:fs";
import zlib from "node:zlib";

function crc32(buf) {
  let c;
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pad) {
  const bg = [0x15, 0x65, 0xd0];
  const fg = [0xff, 0xff, 0xff];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inner = size * (1 - 2 * pad);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // two stacked chevrons ("forward"), drawn in the padded inner square
      const u = (x - size * pad) / inner;
      const v = (y - size * pad) / inner;
      const band = (off) => Math.abs(v - 0.5) * 0.9 + off;
      const on = u >= 0 && u <= 1 && v >= 0.12 && v <= 0.88 && ((u > 0.62 - band(0) && u < 0.8 - band(0)) || (u > 0.92 - band(0) && u < 1.1 - band(0)));
      const p = y * (size * 3 + 1) + 1 + x * 3;
      const c = on ? fg : bg;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/icon-192.png", png(192, 0.12));
fs.writeFileSync("public/icons/icon-512.png", png(512, 0.12));
fs.writeFileSync("public/icons/icon-maskable-512.png", png(512, 0.24));
console.log("icons written");
