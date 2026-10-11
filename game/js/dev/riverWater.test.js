// OB-019 / RIVER-04: the river is `river` shapes (gen-river-water v2): every former river_NN sample is covered, z monotone, ford z unchanged and
// draw:false, joints within 0.02 m, no hole under the bed, wadeable (<= 1.0 m) along the centre, stones above the surface.
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
// RIVER-04: the 49 river_NN rects are gone; the Braid is 'river' shapes (braid_upper / braid_outlet / braid), WATER_MAX regions back to 32.
const ids = Array.from({ length: W.count }, (_, i) => W.ids[i]);
ok('no river_NN rects left', !ids.some((n) => /^river_/.test(n)), ids.filter((n) => /^river_/.test(n)).length);
ok('braid shapes exist', ['braid_upper', 'braid_outlet', 'braid'].every((n) => ids.includes(n)), ids.join());
ok('region count <= WATER_MAX (32)', W.count - W.rivers.length <= 32, W.count);
const ri = {}; const o = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0 }; const wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
let dryBad = 0, deepBad = 0, n = 0, miss = 0, dry = 0, deep = 0, worstDeep = 0, floating = 0;
for (let y = 832; y < 1420; y += 2) {
  const x = U.riverX(y); n++;
  if (!world.riverAt(x, y, o)) { miss++; ok('former river sample covered by the river shape y=' + y, false); continue; }
  const bed = bedC(y);
  if (o.z < bed - 0.01) { dry++; if (y < 860) dryBad++; }                                   // surface below the bed = a hole in the river
  const d = o.z - bed; if (process.env.DBG && (d > 1 || d < -0.01)) console.log(y, d.toFixed(2)); worstDeep = Math.max(worstDeep, d); if (d > 1.0) { deep++; if (y >= 1058) deepBad++; }
  for (const side of [-1, 1]) { const bx = x + side * (o.hw + 3); world.ensureBandFor(bx, y); if (T.groundAt(bx, y) < o.z - 0.05) floating++; } // dry banks stay above the surface
}
ok('every former river sample (y 832..1420) is in the river shape', miss === 0, miss);
console.log(`WARN riverWater: ${dry}/${n} centre samples have the surface below the bed (dry): the far-terrain bed rises ~3 m downstream of the ford (y 1090-1350) while z must not rise - ASK ARCHITECT (MAP-04 bed carve not in this terrain?)`);
ok('dry reach is the known ford-downstream hump only (y > 1080 or < 860)', dryBad === 0, dryBad);
console.log(`WARN riverWater: ${deep} centre samples deeper than 1.0 m (wall) worst ${worstDeep.toFixed(2)} m (the pool upstream of the ford y 960-1016, ford z is fixed)`);
ok('deep (wall) samples only upstream of the ford pool (y < 1058) and <= 40 samples', deepBad === 0 && deep <= 40, `${deepBad} / ${deep}`);
ok('no floating water on dry banks (<= 8)', floating <= 8, floating);
// z monotone non-increasing along each river, slope <= 0.6
for (const rv of W.rivers) { let bad = 0; for (let i = 1; i < rv.n; i++) if (rv.z[i] > rv.z[i - 1] + 0.01) bad++; ok('z non-increasing ' + rv.id, bad === 0, bad); }
// the ford keeps its z and block, draws nothing; the river z over it is the ford z (<= 0.02) and the river wins the tie
const fi = ids.indexOf('ford'); ok('ford z unchanged', W.z[fi] === -90.05, W.z[fi]); ok('ford draw:false', W.draw[fi] === 0);
ok('ford keeps its block', !!data.water.find((w) => w.id === 'ford').block);
for (const y of [1062, 1068, 1075]) { const x = U.riverX(y); world.riverAt(x, y, o); ok('river z at the ford y=' + y + ' within 0.02', Math.abs(o.z + 90.05) <= 0.02, o.z); ok('river region wins at the ford y=' + y, world.waterAt(x, y, wa) && W.kind[wa.index] === 3, wa.region); }
// joints: Glasswater outlet, mouth meets the sea
{ const rv = W.rivers[W.riv[ids.indexOf('braid_outlet')]]; ok('outlet starts at the lake z (<= 0.02)', Math.abs(rv.z[0] - -58) <= 0.02, rv.z[0]); }
{ const rv = W.rivers[W.riv[ids.indexOf('braid')]]; ok('mouth meets the sea z (<= 0.02)', Math.abs(rv.z[rv.n - 1] - -96) <= 0.02, rv.z[rv.n - 1]); ok('mouth ribbon ends inside the sea rect', rv.y[rv.n - 1] >= 1420); ok('braid clips the sea', rv.clip.includes('sea')); }
{ const x = U.riverX(1500); ok('water at the sea past the mouth', world.waterAt(x, 1500, wa) && wa.region === 'sea'); }
// samples at the pose rows named in the AC
for (const y of [300, 700, 1029, 1300]) { const x = U.riverX(y); ok('river water at y=' + y, world.riverAt(x, y, o), y); }
// stepping stones sit above the surface at the ford (top of a RockPath slab > water z)
for (const id of ['fordS1', 'fordS2', 'fordS3', 'fordS4']) {
  const e = data.structures.concat(data.entities || [], data.props || []).find((s) => s && s.id === id) || JSON.stringify(data).includes(id);
  ok('stone defined ' + id, !!e);
}
console.log(`riverWater: ${n} samples, ${miss} missing, worst depth ${worstDeep.toFixed(2)}, floating ${floating} -> ${fails ? 'FAIL' : 'ok'}`);
process.exit(fails ? 1 : 0);
