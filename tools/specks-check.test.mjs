// tools/specks-check.test.mjs: node tools/specks-check.test.mjs
import { deflateSync } from 'node:zlib';
import { countSpecks, cellLuma, decodePng } from './specks-check.mjs';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL ' + m); } };
const W = 40, H = 20;
const img = new Uint8Array(W * H).fill(90);
for (const [x, y] of [[5, 4], [20, 10], [33, 15]]) img[y * W + x] = 255; // 3 isolated specks
ok(countSpecks(img, W, H) === 3, '3 planted specks -> 3');
const win = new Uint8Array(W * H).fill(90);
for (let y = 6; y < 10; y++) for (let x = 12; x < 18; x++) win[y * W + x] = 255; // white window block
ok(countSpecks(win, W, H) === 0, 'white window block -> 0');
const edge = new Uint8Array(W * H).fill(90); edge[0] = 255; // corner speck still counts
ok(countSpecks(edge, W, H) === 1, 'border speck counts');
const grey = new Uint8Array(W * H).fill(90); grey[5 * W + 5] = 255; grey[5 * W + 6] = 170; // bright-ish neighbour (>= 160) -> not isolated
ok(countSpecks(grey, W, H) === 0, 'neighbour >= 160 is not a speck');
// PNG round trip: 8x8 RGBA, one white pixel on dark, cell 1x1
const w = 8, h = 8, rows = [];
for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) { const v = x === 3 && y === 3 ? 255 : 40; r.fill(v, 1 + x * 4, 1 + x * 4 + 3); r[1 + x * 4 + 3] = 255; } rows.push(r); }
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); return b; }; // CRC left 0: the decoder does not check it
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
const d = decodePng(png), c = cellLuma(d.px, d.width, d.height, d.channels, 1, 1);
ok(c.w === 8 && countSpecks(c.luma, c.w, c.h) === 1, 'PNG decode + cell luma + count');
if (fail) process.exit(1); console.log('specks-check tests PASS');
