// S8-B2-11: encode/decode round trip of the LOD1 preview data and the glyph-grid rasteriser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeCandidate } from './mesh-lod-preview.mjs';
const { rasterize, decode } = createRequire(import.meta.url)('../design/preview/lib/asciiTriRaster.js');

// a 2-triangle quad (soup) facing +z, 2 m wide, plus one tri in a second range
const pos = [-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 0, 0, 1, 2, 0, -1, 2, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1];
const json = { pos, triCount: 3, ranges: [{ start: 0, count: 2, part: 'q#0:wood' }, { start: 2, count: 1, part: 'q#0:leaf' }] };
const bbox = [-1, 0, 0, 1, 2, 1];
const cand = encodeCandidate(json, bbox, { wood: '#aa5522' });
assert.equal(cand.tris, 3);
assert.equal(cand.ranges[0].color, '#aa5522');
assert.equal(cand.ranges[1].color, '#888888'); // unknown key falls back
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const { pos: p2, idx } = decode(cand, b64);
assert.equal(idx.length, 9);
assert.equal(p2.length / 3, 7, "welded: 7 unique corners");
for (let i = 0; i < idx.length; i++) for (let a = 0; a < 3; a++) assert.ok(Math.abs(p2[idx[i] * 3 + a] - pos[i * 3 + a]) < 1e-4, 'quantisation under 0.1 mm');

// rasteriser: the quad (2 x 2 m) at 6 m, 45 deg view, 20 rows -> covers a centred block, nothing at the corners
const r = rasterize(p2, idx, { cols: 40, rows: 20, dist: 6, yaw: 0, center: [0, 1, 0.3], fov: 45 });
assert.equal(r.tri[0], -1);
assert.ok(r.tri[10 * 40 + 20] >= 0, 'centre cell covered');
assert.ok(r.covered > 20 && r.covered < 400, `covered ${r.covered}`);
const r2 = rasterize(p2, idx, { cols: 40, rows: 20, dist: 12, yaw: 0, center: [0, 1, 0.3], fov: 45 });
assert.ok(r2.covered < r.covered, 'smaller when farther');
console.log('mesh-lod-preview.test OK');
