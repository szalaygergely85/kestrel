// OB194-SPECK-CHECK-01: counts isolated near-white "speckle" cells (OB-194: white/bright speckles in the tower wall glyph field).
// A speck = a cell with luma >= 240 whose 4 neighbours (left/right/up/down) are ALL < 160. A solid white block (window, sky)
// has white neighbours and is therefore not counted; cells on the image border have fewer neighbours (missing ones count as dark).
// Run: node tools/specks-check.mjs [--max 4] [--cell 2x4] <still.png> [more.png ...]   -> one line per still, exit 1 if any count > --max.
// A still is cut into cells of --cell WxH pixels (default 2x4, ~the 480x180 grid on a 1000x700 still); cell luma = mean of its pixels.
// Spots (OB-194 row of docs/bugs.md: "tower wall, close up", no coordinates are recorded in the row, so the existing tower-wall poses are used;
// take the stills with tools/visqa-sweep.mjs ONLY=tower-door, or flickerLive poses wallNear / wallFar):
//   1. tower-door  x 1488, y 1040, yaw 0,   pitch 6  (tools/visqa-sweep.mjs SPOTS)
//   2. wallNear    x 1496.91, y 1026.06, yaw 333, pitch 1 (game/js/dev/flickerLive.js POSES)
//   3. wallFar     x 1503.27, y 1038.53, yaw 333, pitch 1 (game/js/dev/flickerLive.js POSES)
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WHITE = 240, DARK = 160, DEFAULT_MAX = 4;

/** Pure. luma: array-like of w*h values 0..255 (row-major). Returns the number of isolated near-white cells. */
export function countSpecks(luma, w, h, white = WHITE, dark = DARK) {
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] < white) continue;
      if ((x > 0 && luma[y * w + x - 1] >= dark) || (x < w - 1 && luma[y * w + x + 1] >= dark)) continue;
      if ((y > 0 && luma[(y - 1) * w + x] >= dark) || (y < h - 1 && luma[(y + 1) * w + x] >= dark)) continue;
      n++;
    }
  }
  return n;
}

/** Pure. Mean luma (Rec.601) of cw x ch pixel blocks of an RGBA/RGB image -> { luma, w, h } in cells. */
export function cellLuma(px, width, height, channels, cw = 2, ch = 4) {
  const w = Math.floor(width / cw), h = Math.floor(height / ch), luma = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    let s = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = ((cy * ch + y) * width + cx * cw + x) * channels; s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; }
    luma[cy * w + cx] = Math.round(s / (cw * ch));
  }
  return { luma, w, h };
}

/** Minimal PNG decoder (8-bit, RGB/RGBA/gray, non-interlaced; what Page.captureScreenshot writes). -> { width, height, channels, px }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error('only 8-bit non-interlaced PNG'); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 6: 4 }[ct]; if (!channels) throw new Error('unsupported PNG colour type ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[dst + i - channels] : 0, b = y ? px[dst - stride + i] : 0, c = i >= channels && y ? px[dst - stride + i - channels] : 0;
      let v = raw[src + i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  if (channels === 1) { const rgb = new Uint8Array(width * height * 3); for (let i = 0; i < width * height; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i]; return { width, height, channels: 3, px: rgb }; }
  return { width, height, channels, px };
}

function main() {
  const args = process.argv.slice(2), files = []; let max = DEFAULT_MAX, cw = 2, ch = 4;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max') max = Number(args[++i]);
    else if (args[i] === '--cell') [cw, ch] = args[++i].split('x').map(Number);
    else files.push(args[i]);
  }
  if (!files.length) throw new Error('usage: node tools/specks-check.mjs [--max 4] [--cell 2x4] <still.png> ...');
  let bad = false;
  for (const f of files) {
    const img = decodePng(readFileSync(f)), c = cellLuma(img.px, img.width, img.height, img.channels, cw, ch), n = countSpecks(c.luma, c.w, c.h);
    console.log(`${path.basename(f)}: ${n} specks (${c.w}x${c.h} cells)${n > max ? '  FAIL (> ' + max + ')' : ''}`);
    if (n > max) bad = true;
  }
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error('specks-check: ' + e.message); process.exit(1); }
}
