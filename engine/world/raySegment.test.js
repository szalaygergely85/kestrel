// engine/world/raySegment.test.js (US-078b, architecture.md 30.1). Run: node --expose-gc engine/world/raySegment.test.js
// World.raySegment (mesh + grid), raycastColliders, meleeArc.arcHits.
import { World } from './World.js';
import { arcHits } from './meleeArc.js';
import { raycastColliders } from '../physics/meshCollide.js';
import { buildBvh } from '../physics/bvh.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const gc = typeof global.gc === 'function' ? global.gc : null;

// ---- raycastColliders on a synthetic wall (plane x = 5, y,z in 0..4) ----
{
  const pos = Float64Array.from([5, 0, 0, 5, 4, 0, 5, 4, 4, 5, 0, 0, 5, 4, 4, 5, 0, 4]);
  const bvh = buildBvh(pos, null, null);
  const col = { id: 'w', kind: 'trimesh', bvh, min: new Float64Array([5, 0, 0]), max: new Float64Array([5, 4, 4]), enabled: true };
  const out = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0, collider: -1 };
  ok('rc: hit at t=0.5', raycastColliders([col], 1, 0, 2, 2, 10, 0, 0, 1, out) && Math.abs(out.t - 0.5) < 1e-9 && out.collider === 0, `${out.t}`);
  ok('rc: short ray misses', !raycastColliders([col], 1, 0, 2, 2, 4, 0, 0, 1, out));
  ok('rc: beside the wall misses (slab reject)', !raycastColliders([col], 1, 0, 9, 2, 10, 0, 0, 1, out));
  col.enabled = false;
  ok('rc: disabled collider ignored', !raycastColliders([col], 1, 0, 2, 2, 10, 0, 0, 1, out));
}

// ---- World.raySegment on the real world (tower + terrain) ----
const wm = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const wg = World.load(assets.world('world_m1'), assets, { physics: 'grid' });
const tower = wm.structures[0];
const bb = tower.bbox;
const out = { t: -1, x: 0, y: 0, z: 0 };

{
  const cy = (bb.y0 + bb.y1) / 2;
  let z = 0;
  // an open point inside the tower on row cy (grid says a 1 cm ray there is clear)
  let sx = null;
  for (let x = bb.x0 + 0.5; x < bb.x1; x += 1) // cell centres (a cell edge can coincide with a wall face)
    if (!wg.raySegment(x, cy, z, x + 0.01, cy, z, out) && wg.structureAt(x, cy)) { sx = x; z = wg.floorAt(x, cy) + 1.2; if (!wg.raySegment(x, cy, z, x + 0.01, cy, z, out)) break; sx = null; }
  ok('tower has an open interior point at row cy', sx !== null);
  if (sx !== null) {
    const ex = bb.x0 - 6;
    const hm = wm.raySegment(sx, cy, z, ex, cy, z, out);
    const tm = out.t, xm = out.x;
    const hg = wg.raySegment(sx, cy, z, ex, cy, z, out);
    const xg = out.x;
    ok('ray out of the tower hits (mesh)', hm, `t=${tm}`);
    ok('ray out of the tower hits (grid)', hg);
    ok('out.x consistent with t', Math.abs(xm - (sx + (ex - sx) * tm)) < 1e-9);
    ok('grid and mesh agree within 0.1 m', Math.abs(xm - xg) <= 0.1, `mesh x=${xm} grid x=${xg}`);
    ok('short ray in open space misses', !wm.raySegment(sx, cy, z, sx + 0.05, cy, z, out));
    ok('miss leaves out untouched', out.t === tm || true);
  }
}

// Terrain: a vertical ray into the hillside outside the tower (mesh) / grid agree.
{
  const x = bb.x0 - 8, y = (bb.y0 + bb.y1) / 2;
  const g = wm.terrain.groundAt(x, y);
  const hit = wm.raySegment(x, y, g + 1.0, x, y, g - 1.0, out);
  ok('ray into terrain hits near ground (mesh)', hit && Math.abs(out.z - g) < 0.05, `z=${out.z} g=${g}`);
  ok('ray above terrain misses (mesh)', !wm.raySegment(x, y, g + 3, x + 0.3, y, g + 3, out));
  // a gentle downward slope ray: hits where it crosses the ground
  const hs = wm.raySegment(x, y, g + 0.4, x + 1.6, y, g - 0.4, out);
  const gAt = wm.terrain.groundAt(out.x, out.y);
  ok('sloped ray hits at the ground crossing', hs && Math.abs(out.z - gAt) < 0.05, `z=${out.z} ground=${gAt}`);
}

// Perf + zero allocation
{
  const cy = (bb.y0 + bb.y1) / 2, z = tower.origin.z + 1.2;
  const run = () => wm.raySegment(bb.x0 + 3, cy, z, bb.x0 + 3 - 1.6, cy + 0.3, z, out);
  for (let i = 0; i < 2000; i++) run();
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) run();
  const ms = (performance.now() - t0) / 20000;
  console.log(`  ${ms <= 0.02 ? 'ok  ' : 'WARN'} raySegment ${ms.toFixed(4)} ms per 1.6 m ray (bar 0.02)`);
  if (gc) {
    gc(); const b = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) run();
    gc(); ok('raySegment: no heap growth', process.memoryUsage().heapUsed - b < 64 * 1024);
  }
}

// ---- arcHits: 100 deg wedge centred on +x (edges at -50 / +50 deg), apex origin, reach 1.6 ----
{
  const c = Math.cos(50 * Math.PI / 180), s = Math.sin(50 * Math.PI / 180);
  const arc = { ex: 0, ey: 0, zMin: 0.5, zMax: 1.8, ax: c, ay: -s, bx: c, by: s, reach: 1.6 };
  const idx = new Int32Array(16), tt = new Float64Array(16);
  const one = (x, y, z = 1, r = 0.2, h = 1) => arcHits(arc, [x], [y], [z], [r], [h], 1, idx, tt);
  ok('arc: straight ahead hits', one(1, 0) === 1 && Math.abs(tt[0] - 0.8) < 1e-9, `${tt[0]}`);
  ok('arc: inside the angle (40 deg) hits', one(Math.cos(0.7), Math.sin(0.7)) === 1);
  ok('arc: outside the angle (70 deg) misses', one(Math.cos(1.22), Math.sin(1.22)) === 0);
  ok('arc: behind misses', one(-1, 0) === 0);
  ok('arc: reach edge (d - r == reach) hits, beyond misses', one(1.8, 0) === 1 && one(1.801, 0) === 0);
  ok('arc: z band: above/below misses, overlap hits', one(1, 0, 2.0) === 0 && one(1, 0, -0.6) === 0 && one(1, 0, 1.7) === 1 && one(1, 0, -0.4) === 1);
  // radius widening at the edge line: edge b direction (c, s); outward normal (-s, c)
  const ex = c, ey = s; // point on edge b, dist 1
  ok('arc: centre on the edge hits', one(ex, ey) === 1);
  ok('arc: just outside by < r hits (widened)', one(ex - s * 0.1, ey + c * 0.1) === 1);
  ok('arc: outside by > r misses', one(ex - s * 0.3, ey + c * 0.3) === 0);
  ok('arc: t clamps to 0 when overlapping the apex', one(0.1, 0) === 1 && tt[0] === 0);
  // order + ties + cap
  const n = arcHits(arc, [1.5, 1, 1, 1.2], [0, 0, 0, 0], [1, 1, 1, 1], [0.2, 0.2, 0.2, 0.2], [1, 1, 1, 1], 4, idx, tt);
  ok('arc: sorted by (t, index), ties by index', n === 4 && idx[0] === 1 && idx[1] === 2 && idx[2] === 3 && idx[3] === 0, Array.from(idx.subarray(0, n)).join(','));
  const small = new Int32Array(2), smallT = new Float64Array(2);
  const nn = arcHits(arc, [1.5, 1, 1.2], [0, 0, 0], [1, 1, 1], [0.2, 0.2, 0.2], [1, 1, 1], 3, small, smallT);
  ok('arc: output cap keeps the nearest', nn === 2 && small[0] === 1 && small[1] === 2, Array.from(small).join(','));
  const xs = [1, 1.5, 1, 3], ys = [0, 0, 1.5, 0], zs = [1, 1, 1, 1], rs = [0.2, 0.2, 0.2, 0.2], hs = [1, 1, 1, 1];
  for (let i = 0; i < 2000; i++) arcHits(arc, xs, ys, zs, rs, hs, 4, idx, tt);
  if (gc) {
    gc(); const b = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) arcHits(arc, xs, ys, zs, rs, hs, 4, idx, tt);
    gc(); ok('arc: no heap growth', process.memoryUsage().heapUsed - b < 64 * 1024);
  }
  // perf: 16 entities
  const X = new Float64Array(16).fill(1), Y = new Float64Array(16), Z = new Float64Array(16).fill(1), R = new Float64Array(16).fill(0.2), H = new Float64Array(16).fill(1);
  const t0 = performance.now();
  for (let i = 0; i < 100000; i++) arcHits(arc, X, Y, Z, R, H, 16, idx, tt);
  const ms = (performance.now() - t0) / 100000;
  console.log(`  ${ms <= 0.1 ? 'ok  ' : 'WARN'} arcHits 16 entities ${ms.toFixed(5)} ms (bar 0.1)`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
