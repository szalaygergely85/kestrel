import assert from 'node:assert/strict';
import { diffFrames, heatPng, crc32, report } from './frame-diff.mjs';

const cols = 8, rows = 4, n = cols * rows;
const mk = () => ({ glyph: new Array(n).fill(65), kind: new Array(n).fill(1), mat: new Array(n).fill(7), pid: new Array(n).fill(0), fg: new Array(n).fill(0x112233), bg: new Array(n).fill(0) });
const A = mk(), B = mk();
for (const [i, g] of [[0, 66], [3, 66], [9, 67], [20, 66], [31, 66]]) B.glyph[i] = g; // 5 changed cells
B.kind[31] = 2;
const d = diffFrames({ cols, rows, A, B });
assert.equal(d.count, 5); assert.equal(d.changed.reduce((s, v) => s + v, 0), 5);
assert.deepEqual(d.pairs, [{ from: 65, to: 66, count: 4 }, { from: 65, to: 67, count: 1 }]); // count desc, stable
assert.deepEqual(diffFrames({ cols, rows, A, B }).pairs, d.pairs);
assert.equal(d.byKind[0].id, 1); assert.equal(d.byKind[0].count, 4); assert.equal(d.byKind[1].id, 2);
assert.ok(/changed cells: 5 \/ 32/.test(report(d)));
// colour-only change counts as changed, with no glyph pair
const C = mk(); C.fg[5] = 0x445566;
const dc = diffFrames({ cols, rows, A, B: C }); assert.equal(dc.count, 1); assert.equal(dc.pairs.length, 0);

const png = heatPng(d, 2);
assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let off = 8; const types = [];
while (off < png.length) { // every chunk CRC valid
  const len = png.readUInt32BE(off), type = png.toString('latin1', off + 4, off + 8);
  assert.equal(png.readUInt32BE(off + 8 + len), crc32(png.subarray(off + 4, off + 8 + len)), type + ' crc');
  types.push(type); off += 12 + len;
}
assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
assert.equal(png.readUInt32BE(16), cols * 2); assert.equal(png.readUInt32BE(20), rows * 2);
assert.equal(crc32(Buffer.from('IEND')), 0xae426082); // known PNG IEND CRC
console.log('[frame-diff.test.mjs] ok');
