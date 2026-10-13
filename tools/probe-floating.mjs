import { BandBakeJob, bundleBytes } from "../engine/dev.js";
import { inPolygon } from './map-loop-waypoints.mjs';
// Run: node tools/bench-geo-perf.mjs [--hash]   (--hash prints the pinned-hash table; default prints ms and checks the pins)
import { createHash } from 'node:crypto';
import { World } from '../engine/index.js';
import { Events } from '../engine/dev.js';
import paletteMod from '../design/palette.js';
import farMod from '../design/levels/overworld_far.js';
import geoMod from '../design/levels/world_geo.js';
import detailPassMod from '../design/detail-pass.js';
import m0 from '../design/models/lantern.js';
import m1 from '../design/models/lever.js';
import m2 from '../design/models/voxel_props.js';
import m3 from '../design/models/boulder.js';
import m4 from '../design/models/rubble.js';
import m5 from '../design/models/wreckage.js';
import m6 from '../design/models/relay.js';
import m7 from '../design/models/sword.js';
import m8 from '../design/models/m3_props.js';
import m9 from '../design/models/far_tower.js';
import m10 from '../design/models/ferrum_lights.js';
import m11 from '../design/models/title.js';
import m12 from '../design/models/voxel_world.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
globalThis.window = globalThis.window || globalThis;
paletteMod; farMod; geoMod; detailPassMod; m0; m1; m2; m3; m4; m5; m6; m7; m8; m9; m10; m11; m12;
const { assets } = await loadTestAssets();
registerQuestBehaviours();
const A = globalThis.ASSETS.levels, recipe = A.overworld_far, util = recipe.util;
A.world_geo.util.installGeo(util);
World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events() });   // registers the structures like the game (stamps, ring blends)
// WM-07 probe: placements/km^2 per region (dressing species) + bundle bytes at one sample zone per region, and a hash of
// the scatter + detail of the authored keep zones (must not change when biome rows change).
// Run: node tools/probe-region-dress.mjs [--hash]
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events(), realTrees: true, detail: true });
// OB-131 probe: scatter trees whose trunk base floats above the drawn ground.
// gap = tree z - lowest drawn ground under the trunk footprint (centre + 8 points on the trunk radius, bilinear on the
// bundle's near band). > 0.25 m = floating. Run: node tools/probe-floating.mjs [--step K] [--top N] [--max-gap M]
const BPTS = assets.world('world_m1').bounds.pts;
const CH = 128, CW = 5, CHH = 3, arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const step = arg('--step', 2), top = arg('--top', 5), maxGap = arg('--max-gap', 0.25);
const sp = world.terrain.recipe.recipe.forest.trees.species;
function treeGap(near, x, y, z, trunkR) {
  let lo = Infinity;
  for (let k = -1; k < 8; k++) {
    const a = k * Math.PI / 4, h = util.gridHeight(near, x + (k < 0 ? 0 : trunkR * Math.cos(a)), y + (k < 0 ? 0 : trunkR * Math.sin(a)));
    if (h !== null && h < lo) lo = h;
  }
  return lo === Infinity ? 0 : z - lo;
}
const FAR = process.argv.includes("--far"); const farG = world.terrain._farGridDraw;
const bad = []; let n = 0; const seen = new Set();
for (let cy = -1; cy < 16; cy += step) for (let cx = -2; cx < 19; cx += step) {
  if (!inPolygon(BPTS, cx * CH + 320, cy * CH + 192)) continue;
  const job = BandBakeJob.create(world, cx, cy, CW, CHH, null); job.step(1e9); const b = job.bundle(); const s = b.scatter;
  if (!s) continue;
  for (let i = 0; i < s.count; i++) {
    const key = s.x[i].toFixed(2) + ',' + s.y[i].toFixed(2); if (seen.has(key)) continue; seen.add(key); n++;
    const r = sp[s.species[i]].trunkR, gap = treeGap(FAR ? farG : b.near, s.x[i], s.y[i], s.z[i], r);
    if (gap > maxGap) bad.push({ x: +s.x[i].toFixed(1), y: +s.y[i].toFixed(1), z: +s.z[i].toFixed(2), sp: s.species[i], r, gap: +gap.toFixed(2), centreGap: +(s.z[i] - util.gridHeight(b.near, s.x[i], s.y[i])).toFixed(2) });
  }
}
bad.sort((a, b) => b.gap - a.gap);
for (const t of bad.slice(0, top)) console.log(JSON.stringify(t));
console.log('trees', n, 'floating(>' + maxGap + ')', bad.length, 'maxGap', bad.length ? bad[0].gap : 0);
// Placed tree meshes (world structures): base = z + mesh bbox min z * scale (-0.24), footprint radius 0.74 * scale (CommonTree root flare).
const placed = [];
for (const s of assets.world('world_m1').structures) {
  if (!s.mesh || !/Tree/.test(s.mesh) || !s.origin) continue;
  const sc = s.scale || 1, r = 0.74 * sc; let lo = Infinity;
  for (let k = -1; k < 8; k++) { const a = k * Math.PI / 4, h = world.terrain.heightAt(s.origin.x + (k < 0 ? 0 : r * Math.cos(a)), s.origin.y + (k < 0 ? 0 : r * Math.sin(a))); if (h < lo) lo = h; }
  placed.push({ id: s.id, mesh: s.mesh, x: s.origin.x, y: s.origin.y, z: s.origin.z, gap: +(s.origin.z - 0.24 * sc - lo).toFixed(2), centre: +(s.origin.z - world.terrain.heightAt(s.origin.x, s.origin.y)).toFixed(2) });
}
placed.sort((a, b) => b.gap - a.gap);
console.log('placed trees', placed.length, 'over', maxGap + ':', placed.filter((p) => p.gap > maxGap).length);
for (const p of placed.slice(0, top)) console.log(JSON.stringify(p));
if (process.argv.includes('--placed-all')) { const by = {}; for (const p of placed) { const k = p.id.replace(/\d+$/, ''); (by[k] ||= []).push(p.centre); } for (const [k, v] of Object.entries(by)) console.log(k, v.length, 'centre min/max', Math.min(...v), Math.max(...v)); }
