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
// OB-089 part 3: trees stop drawing beyond forest.trees.maxDistM (< bands.near 150, where the far-terrain forest tint starts)
const mm = /maxDistM: (\d+)/.exec(src);
assert.ok(mm, 'forest.trees.maxDistM present');
const maxDistM = Number(mm[1]);
assert.ok(maxDistM > 0 && maxDistM <= 150, 'cut at or before the far forest tint (bands.near 150)');
function drawnAt(d, cut) {
  const g = makeInstanceGroup('t', 4); g.lodCells = lodCells; g.maxDistM = cut; g.count = 1;
  g.ib.f32[3] = 0; g.ib.f32[7] = d; g.ib.f32[11] = 0;
  compactGroup(g, null, R, vp, rows, 0, { x: 0, y: 0, z: 0 });
  return g.drawCount[0] + g.drawCount[1];
}
assert.equal(drawnAt(maxDistM - 5, maxDistM), 1, 'kept inside the cut');
assert.equal(drawnAt(maxDistM + 5, maxDistM), 0, 'not drawn beyond the cut');
assert.equal(drawnAt(maxDistM + 500, 0), 1, 'maxDistM 0 = no cut');
console.log('ob089Lod.test ok, lodCells', lodCells, INSTANCE_STRIDE);
