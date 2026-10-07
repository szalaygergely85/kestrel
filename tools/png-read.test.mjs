// MESH-UVMAP-01: tools/png-read.mjs - synthetic PNGs (all 5 filters, RGB/RGBA/palette/grey) + error cases. node tools/png-read.test.mjs
import assert from 'node:assert';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { readPng, samplePng } from './png-read.mjs';

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t, 'latin1'), d]); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
/** Encodes `px` (rows of spp bytes) with the given per-row filter types (the encoder side of the 5 PNG filters). */
function makePng(w, h, ctype, spp, px, filters, extra = [], depth = 8) {
  const stride = w * spp, rows = [];
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length], row = Buffer.alloc(stride + 1); row[0] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= spp ? px[y * stride + x - spp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= spp && y ? px[(y - 1) * stride + x - spp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      row[x + 1] = (px[y * stride + x] - pred) & 255;
    }
    rows.push(row);
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = depth; ih[9] = ctype;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), ...extra, chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
let n = 0; const ok = (m) => { n++; console.log(`ok - ${m}`); };

const w = 7, h = 5, rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37 + (i >> 3) * 11) & 255);
const img = readPng(makePng(w, h, 6, 4, rgba, [0, 1, 2, 3, 4]));
assert.deepStrictEqual([img.width, img.height], [w, h]); assert.deepStrictEqual([...img.data], [...rgba]); ok('RGBA, filters 0-4 round-trip');
const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 53) & 255);
const i3 = readPng(makePng(w, h, 2, 3, rgb, [4, 3, 2, 1, 0]));
for (let i = 0; i < w * h; i++) assert.deepStrictEqual([...i3.data.slice(i * 4, i * 4 + 4)], [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255]); ok('RGB, filters 4-0');
const idx = new Uint8Array(w * h).map((_, i) => i % 3);
const pl = readPng(makePng(w, h, 3, 1, idx, [1, 4], [chunk('PLTE', Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90]))]));
assert.deepStrictEqual([...pl.data.slice(4, 8)], [40, 50, 60, 255]); ok('palette');
assert.deepStrictEqual(samplePng(pl, 0, 0), [10, 20, 30, 255]); assert.deepStrictEqual(samplePng(pl, 1.0 + 1 / 14, 0), samplePng(pl, 1 / 14, 0)); ok('samplePng wraps');
assert.throws(() => readPng(Buffer.from('nope nope')), /not a PNG/); ok('bad signature');
assert.throws(() => readPng(makePng(2, 2, 0, 1, new Uint8Array(4), [0], [], 16)), /bit depth/); ok('16-bit rejected');
const real = 'design/meshes/quaternius/glTF/PathRocks_Diffuse.png';
if (fs.existsSync(real)) { const r = readPng(fs.readFileSync(real)); assert.ok(r.width === 1024 && r.data.length === 1024 * 1024 * 4); ok('real texture decodes'); }
console.log(`${n} passed`);
