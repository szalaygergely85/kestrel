#!/usr/bin/env node
// tools/gen-river-water.mjs - OB-019: real water surface for the river (The Braid) from the keep north edge to the sea.
// Chain of flat rect water regions `river_NN` (engine water.js has only flat rect/circle), cut where the bed slope would
// make a step > STEP m, z = highest centre-bed ground of the segment + DEPTH, flow along the river. The ford region
// (y 1058-1080) stays as authored; river rects stop at its edges. Rewrites the `river_*` entries of the world json (canonical form).
//   node tools/gen-river-water.mjs [--dry-run]
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';

export const RIVER = { y0: 832, y1: 1446, fordY0: 1058, fordY1: 1080, depth: 0.3, step: 0.35, minLen: 8, maxLen: 24, margin: 13, flowSpeed: 0.9, seaZ: -96 };
const FILE = 'content/worlds/world_m1.world.json';
const dry = process.argv.includes('--dry-run');
const U = globalThis.ASSETS.levels.overworld_far.util;
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
const bed = (y) => { const xc = U.riverX(y); world.ensureBandFor(xc, y); let m = 1e9; for (let dx = -6; dx <= 6; dx += 2) m = Math.min(m, T.groundAt(xc + dx, y)); return m; };

const segs = [];
const R = RIVER;
for (const [a, b] of [[R.y0, R.fordY0], [R.fordY1, R.y1]]) {
  let y = a;
  while (y < b - 0.01) {
    // longest segment whose bed drop (from its start) stays under STEP, within [minLen, maxLen]
    let L = R.minLen;
    while (L < R.maxLen && y + L + 2 <= b && Math.abs(bed(y) - bed(Math.min(b, y + L + 2))) <= R.step) L += 2;
    let ye = Math.min(b, y + L);
    if (b - ye < R.minLen) ye = b; // no sliver at the end
    segs.push([y, ye]); y = ye;
  }
}
const out = segs.map(([ya, yb], i) => {
  let xmin = 1e9, xmax = -1e9;
  for (let y = ya; y <= yb + 1e-6; y += 2) { const x = U.riverX(y); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
  const depth = yb >= 1420 ? Math.max(0.02, R.depth * (R.y1 - yb) / (R.y1 - 1420)) : R.depth; // taper into the sea level at the mouth
  let bmax = -1e9; for (let y = ya; y <= yb + 1e-6; y += 2) bmax = Math.max(bmax, bed(y)); // highest bed of the segment: no dry hole at its upstream end
  const z = Math.max(R.seaZ, +(bmax + depth).toFixed(2));
  const dxdy = (U.riverX(yb) - U.riverX(ya)) / (yb - ya), n = Math.hypot(dxdy, 1);
  const f = (v) => +(v * R.flowSpeed).toFixed(3);
  return { id: `river_${String(i + 1).padStart(2, '0')}`, look: 'water', rect: [+(xmin - R.margin).toFixed(1), ya, +(xmax + R.margin).toFixed(1), yb], shape: 'rect', z, flow: [f(dxdy / n), f(1 / n)] };
});
if (dry) { console.log(out.length + ' regions'); out.forEach((o) => console.log(o.id, JSON.stringify(o.rect), o.z)); process.exit(0); }
data.water = data.water.filter((w) => !/^river_d+$/.test(w.id));
const si = data.water.findIndex((w) => w.id === 'sea');
if (si < 0) throw new Error('sea region not found');
data.water.splice(si, 0, ...out);
fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
console.log(`gen-river-water: ${out.length} regions river_01..river_${out.length}`);
