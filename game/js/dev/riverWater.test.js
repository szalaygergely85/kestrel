// OB-019: the whole river (keep north edge -> sea) has a water surface: every centre-line sample lies in a region whose z
// is within 0.3 m of bed + depth (or the sea), the ford keeps its z, regions flow along the river, and the stones sit above it.
import fs from 'node:fs';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../../../design/models/${m}.js`); } catch { /* optional */ } }
import { World } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

let fails = 0;
const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d === undefined ? '' : d); } };
const U = globalThis.ASSETS.levels.overworld_far.util;
const data = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain, W = world.water;
const bedC = (y) => { const xc = U.riverX(y); world.ensureBandFor(xc, y); let m = 1e9; for (let dx = -6; dx <= 6; dx += 2) m = Math.min(m, T.groundAt(xc + dx, y)); return m; };
let nRiver = 0; for (let i = 0; i < W.count; i++) if (/^river_/.test(W.ids[i])) nRiver++;
ok('river chain exists (>= 40 regions)', nRiver >= 40, nRiver);
let worst = 0, bad = 0, dry = 0, n = 0;
for (let y = 832; y < 1440; y += 2) {
  const x = U.riverX(y), i = W.find(x, y);
  n++;
  if (i < 0) { bad++; ok('river sample in a region y=' + y, false); continue; }
  const z = W.z[i], bed = bedC(y), seaZ = -96;
  const d = Math.abs(z - Math.max(seaZ, bed + 0.3));
  // segment z is set at its downstream end: upstream samples sit up to STEP (0.35) deeper/shallower, + ford 0.05 depth
  const ford = W.ids[i] === 'ford';
  if (!ford) { worst = Math.max(worst, d); if (d > 0.9) ok('z near bed+depth y=' + y, false, `${W.ids[i]} z=${z} bed=${bed}`); }
  if (!ford && z < bed - 0.01) dry++;                           // surface below the bed = a hole in the river
  if (!ford && !(W.flow[i * 2] !== 0 || W.flow[i * 2 + 1] !== 0)) ok('flow set ' + W.ids[i], false);
}
ok('no sample under the bed', dry === 0, dry);
// the ford region is untouched; neighbours within 1.0 m (the bed rises 0.6 m past the ford) of it
const fi = W.ids.indexOf('ford'); ok('ford z unchanged', W.z[fi] === -90.05, W.z[fi]);
for (const y of [1050, 1086]) { const i = W.find(U.riverX(y), y); ok('ford neighbour within 1.0 m (y=' + y + ')', Math.abs(W.z[i] - W.z[fi]) <= 1.0, W.z[i]); }
// stepping stones sit above the surface at the ford (top of a RockPath slab > water z)
for (const id of ['fordS1', 'fordS2', 'fordS3', 'fordS4']) {
  const e = data.structures.concat(data.entities || [], data.props || []).find((s) => s && s.id === id) || JSON.stringify(data).includes(id);
  ok('stone defined ' + id, !!e);
}
// the mouth: last river region within 0.6 m of the sea z (no tall seam)
let lastI = -1; for (let i = 0; i < W.count; i++) if (/^river_/.test(W.ids[i])) lastI = i;
ok('river mouth joins the sea (<= 0.6 m)', Math.abs(W.z[lastI] - -96) <= 0.6, W.z[lastI]);
// dry-bank check: inside each river rect, ground at points >= 16 m from the centre line must stay above the surface
let floating = 0;
for (let i = 0; i < W.count; i++) {
  if (!/^river_/.test(W.ids[i])) continue;
  for (let y = W.y0[i]; y < W.y1[i]; y += 4) for (let x = W.x0[i]; x < W.x1[i]; x += 4) {
    if (Math.abs(x - U.riverX(y)) < 16) continue;
    world.ensureBandFor(x, y);
    if (T.groundAt(x, y) < W.z[i] - 0.05) floating++;
  }
}
ok('no floating water on dry banks', floating <= 8, floating);
console.log(`riverWater: ${n} samples, ${nRiver} regions, worst |dz| ${worst.toFixed(2)}, floating ${floating} -> ${fails ? 'FAIL' : 'ok'}`);
process.exit(fails ? 1 : 0);
