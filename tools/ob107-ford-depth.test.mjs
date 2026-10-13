// OB-107: at the ford the river is one continuous water surface with a SHALLOW crossing: along the centreline
// the surface is above the ground everywhere (stepping stones are props, not terrain), depth over the bar 0.15-0.5 m.
// Run: node tools/ob107-ford-depth.test.mjs
import fs from 'node:fs';
import '../design/palette.js'; import '../design/detail-pass.js';
import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (d === undefined ? '' : ' ' + d)); };
const U = globalThis.ASSETS.levels.overworld_far.util;
const data = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' });
const wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
let dmin = 9, dmax = -9, wet = 0, n = 0, barMin = 9, barMax = -9;
for (let y = 1050; y <= 1086; y += 1) {
  const x = U.riverX(y); w.ensureBandFor(x, y);
  for (let dx = -3; dx <= 3; dx += 1) {                     // channel core, +-3 m of the centreline
    n++; const g = w.terrain.groundAt(x + dx, y);
    if (!w.waterAt(x + dx, y, wa)) continue;
    const d = wa.surfaceZ - g; wet++; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
    if (y >= 1066 && y <= 1077) { barMin = Math.min(barMin, d); barMax = Math.max(barMax, d); }   // the crossing (stone lane y 1066.6-1069.6 .. bar)
  }
}
ok('every channel-core sample is wet', wet === n, wet + '/' + n);
ok('surface above ground everywhere in the channel core (min depth ' + dmin.toFixed(2) + ')', dmin > 0);
ok('depth over the bar 0.15-0.5 m (' + barMin.toFixed(2) + '..' + barMax.toFixed(2) + ')', barMin >= 0.149 && barMax <= 0.5);
ok('wadeable everywhere (max ' + dmax.toFixed(2) + ' <= 1.0)', dmax <= 1.0);
process.exit(fail ? 1 : 0);
