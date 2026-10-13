// OB-089: mid-distance trees must still be LOD0 (lit full mesh) out to ~20 m; with the old lodCells 150 they flipped to LOD1 at ~9 m.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeInstanceGroup, compactGroup, INSTANCE_STRIDE } from './instances.js';

const src = fs.readFileSync(new URL('../../design/levels/overworld_far.js', import.meta.url), 'utf8');
const m = /var TREE_LODCELLS = (\d+);/.exec(src);
assert.ok(m, 'TREE_LODCELLS present in overworld_far.js');
const lodCells = Number(m[1]);
assert.ok(!/lodCells: 150/.test(src), 'no hard-coded 150 left');

// camera at origin looking +y, z up: clip.y = f*z, clip.w = y; column-major vp[col*4+row]
const f = 1.73, vp = new Float64Array(16); vp[5] = 0; vp[9] = f; vp[1] = 0; vp[7] = 1;
const R = 7.7, rows = 100;
function lodAt(d) {
  const g = makeInstanceGroup('t', 4); g.lodCells = lodCells; g.count = 1;
  g.ib.f32[3] = 0; g.ib.f32[7] = d; g.ib.f32[11] = 0;
  compactGroup(g, null, R, vp, rows);
  return g.drawCount[1] ? 1 : 0;
}
assert.equal(lodAt(10), 0, 'LOD0 at 10 m');
assert.equal(lodAt(20), 0, 'LOD0 at 20 m');
assert.equal(lodAt(60), 1, 'LOD1 far away');
console.log('ob089Lod.test ok, lodCells', lodCells, INSTANCE_STRIDE);
