// tools/export/png.js (CHARGEN-06, docs/architecture.md 38.29 item 6): browser-safe PNG writer, no zlib, no fs.
// encodePng(w, h, rgba) -> Uint8Array   (8-bit RGBA, filter 0, zlib "stored" blocks: deterministic, same bytes everywhere)
// paletteTexture(rgbList) -> {width:16, height:16, rgba, png}  texel i = rgbList[i] (alpha 255), the rest transparent-black.
// Round-trips through tools/png-read.mjs (tests).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream made of stored (uncompressed) deflate blocks. */
export function zlibStored(data) {
  const nBlocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + 5 * nBlocks + 4);
  const dv = new DataView(out.buffer);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < nBlocks; b++) {
    const start = b * 65535, len = Math.min(65535, data.length - start);
    out[o++] = b === nBlocks - 1 ? 1 : 0;
    dv.setUint16(o, len, true); dv.setUint16(o + 2, ~len & 0xffff, true); o += 4;
    out.set(data.subarray(start, start + len), o); o += len;
  }
  dv.setUint32(o, adler32(data), false);
  return out;
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)), false);
  return out;
}

export function encodePng(w, h, rgba) {
  if (!(w > 0 && h > 0) || rgba.length !== 4 * w * h) throw new Error(`encodePng: need ${4 * w * h} RGBA bytes for ${w}x${h}, got ${rgba.length}`);
  const raw = new Uint8Array((4 * w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(4 * w * y, 4 * w * (y + 1)), (4 * w + 1) * y + 1); // filter byte 0
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false); dv.setUint32(4, h, false);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, no interlace
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const PALETTE_TEX_SIZE = 16; // 16 x 16 = 256 texels >= MAX_MATERIALS (255)

/** rgbList: [[r,g,b] 0..255, ...] (<= 256). */
export function paletteTexture(rgbList) {
  if (rgbList.length > PALETTE_TEX_SIZE * PALETTE_TEX_SIZE) throw new Error(`paletteTexture: ${rgbList.length} colours, max 256`);
  const rgba = new Uint8Array(4 * PALETTE_TEX_SIZE * PALETTE_TEX_SIZE);
  rgbList.forEach((c, i) => {
    for (let k = 0; k < 3; k++) {
      const v = c[k];
      if (!(v >= 0 && v <= 255)) throw new Error(`paletteTexture: colour ${i} component ${k} out of range (${v})`);
      rgba[4 * i + k] = Math.round(v);
    }
    rgba[4 * i + 3] = 255;
  });
  return { width: PALETTE_TEX_SIZE, height: PALETTE_TEX_SIZE, rgba, png: encodePng(PALETTE_TEX_SIZE, PALETTE_TEX_SIZE, rgba) };
}

/** UV (texel centre) of palette texel i in the 16x16 texture. */
export function texelUv(i) {
  return [((i % PALETTE_TEX_SIZE) + 0.5) / PALETTE_TEX_SIZE, (((i / PALETTE_TEX_SIZE) | 0) + 0.5) / PALETTE_TEX_SIZE];
}
