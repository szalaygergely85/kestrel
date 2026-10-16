// OB198-DUMP-DIFF-01: "which glyphs flicker" by data. Input = one consecutive frame pair dumped by the live flicker capture
// (`&flickerdump=<pose>:<step>` -> `window.__flicker.dump`, see game/js/dev/flickerLive.js packDump). Output = PNG heat map
// of changed cells + the top changed (glyphA -> glyphB) pairs + change share per kind / material.
// Usage: node tools/frame-diff.mjs <dump.json | flicker-result.json> [--out heat.png] [--scale 4] [--top 10]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

/** Cells whose glyph, kind, mat, pid or colour (fg/bg) differ. Returns { changed:Uint8Array, count, pairs, byKind, byMat }. */
export function diffFrames(dump, top = 10) {
  const { cols, rows, A, B } = dump, n = cols * rows;
  const changed = new Uint8Array(n), pairMap = new Map(), kindMap = new Map(), matMap = new Map();
  let count = 0;
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let i = 0; i < n; i++) {
    const g = A.glyph[i] !== B.glyph[i];
    const key = A.kind[i] !== B.kind[i] || A.mat[i] !== B.mat[i] || A.pid[i] !== B.pid[i];
    const col = A.fg[i] !== B.fg[i] || A.bg[i] !== B.bg[i];
    if (!g && !key && !col) continue;
    changed[i] = 1; count++;
    if (g) bump(pairMap, A.glyph[i] + '>' + B.glyph[i]);
    bump(kindMap, B.kind[i]); bump(matMap, B.mat[i]); // attributed to the current frame's surface
  }
  // stable order: count desc, then key asc
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const pairs = sorted(pairMap).slice(0, top).map(([k, c]) => { const [a, b] = k.split('>').map(Number); return { from: a, to: b, count: c }; });
  const share = (m) => sorted(m).map(([k, c]) => ({ id: +k, count: c, share: count ? c / count : 0 }));
  return { cols, rows, changed, count, pct: n ? (100 * count) / n : 0, pairs, byKind: share(kindMap), byMat: share(matMap) };
}

let CRC = null;
export function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** RGB (3 bytes/px, row-major) -> PNG Buffer. */
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Heat map: changed cell = hot orange, unchanged = dark grey; one `scale` x `scale` block per cell. */
export function heatPng(d, scale = 4) {
  const w = d.cols * scale, h = d.rows * scale, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hot = d.changed[((y / scale) | 0) * d.cols + ((x / scale) | 0)], o = (y * w + x) * 3;
    rgb[o] = hot ? 255 : 24; rgb[o + 1] = hot ? 90 : 24; rgb[o + 2] = hot ? 0 : 28;
  }
  return encodePng(w, h, rgb);
}
const gch = (c) => (c >= 32 && c < 127 ? `'${String.fromCharCode(c)}'` : `#${c}`);
export function report(d) {
  const L = [`changed cells: ${d.count} / ${d.cols * d.rows} (${d.pct.toFixed(2)}%)`, 'top glyph changes:'];
  for (const p of d.pairs) L.push(`  ${gch(p.from)} -> ${gch(p.to)}  x${p.count}`);
  L.push('by kind: ' + d.byKind.map((k) => `${k.id}:${(100 * k.share).toFixed(1)}%`).join(' '));
  L.push('by material (top 10): ' + d.byMat.slice(0, 10).map((k) => `${k.id}:${(100 * k.share).toFixed(1)}%`).join(' '));
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), opt = (k, def) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : def; };
  if (!a[0] || a[0].startsWith('--')) { console.error('usage: node tools/frame-diff.mjs <dump.json> [--out heat.png] [--scale 4] [--top 10]'); process.exit(2); }
  let j = JSON.parse(readFileSync(a[0], 'utf8'));
  if (j.dump) j = j.dump; // a whole flicker result
  if (!j.A || !j.B) { console.error('no frame pair in ' + a[0]); process.exit(2); }
  const d = diffFrames(j, +opt('--top', 10));
  const out = opt('--out', a[0].replace(/\.json$/, '') + '-heat.png');
  writeFileSync(out, heatPng(d, +opt('--scale', 4)));
  console.log(report(d) + '\nheat map: ' + out);
}
