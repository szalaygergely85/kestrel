#!/usr/bin/env node
// tools/gen-river-water.mjs v2 - RIVER-04 / OB-019 (docs/architecture.md 38.45 (4)): the Braid as `river` water shapes.
// Replaces the 49 flat `river_NN` rects. Emits two `river` shapes along x = riverX(y), halfW = interp3(G.river.poly, y, 2):
//   braid_upper  source y 100 -> y 396 (north of the Glasswater dam shelf at -57.2), braid_outlet  lake rect edge y 544 -> the cliff lip y 600 (clip: glasswater),
//   braid  from the outlet-cliff foot y 605 -> y 1520 inside the sea (clip: sea). The outlet cliff is a carved notch with the `braidFalls` waterfall (world `waterfalls`).
//   RIVER-04 arch: free runs between pinned vertices (lake z, ford z, sea z) are fitted separately; banks are sampled at hw + 1.5 (ribbon edge).
// z = lowest ground over the inner 60 % of the cross-section + DEPTH (0.4 m: wadeable almost everywhere, D-064 owner rule), then
//   <= lowest bank ground (+-halfW) - 0.1, = lake z inside Glasswater, = ford z over the ford, easing to the sea z at the clip, running-min downstream.
// The ford region keeps its `block` (draw:false: the river shape draws there). Rewrites the water list of the world json (canonical form).
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
import { applyAllRiverEdits } from './editor/riverEdits.js'; // ED-WATER-03: world.riverEdits (water-surface z offset + per-point width), same function as the editor

export const RIVER = { y0: 128, upEnd: 470, lakeOut: 544, shelfEnd: 603, cliffEnd: 605, yEnd: 1480, step: 8, depth: 0.4, bankGap: 0.1, bankOut: 1.5, fordY0: 1058, fordY1: 1088, fordZ: -89.85, /* OB-090 */ /* OB-090: was -90.04 = ford bar level (-90.05): zero depth = a pale foam sheet */
  lakeZ: -58, seaZ: -96, fallsY: 603.5 };
const FILE = 'content/worlds/world_m1.world.json';
const dry = process.argv.includes('--dry-run');
const U = globalThis.ASSETS.levels.overworld_far.util, G = globalThis.ASSETS.levels.world_geo;
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.water = data.water.filter((w) => !/^river_\d+$/.test(w.id) && !/^braid/.test(w.id)); // idempotent: load the terrain without our own water
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain, R = RIVER;
const interp3 = (p, y, k) => { if (y <= p[0][0]) return p[0][k]; for (let i = 1; i < p.length; i++) if (y <= p[i][0]) { const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][k] + t * (p[i][k] - p[i - 1][k]); } return p[p.length - 1][k]; };
const ground = (x, y) => { world.ensureBandFor(x, y); return T.groundAt(x, y); };

const ys = (a, b) => { const o = []; for (let y = a; y < b - 1e-6; y += R.step) o.push(y); o.push(b); return o; };
/** Vertices {x, y, hw, z} with z raw = bed + depth, bank-capped. */
function raw(list) {
  return list.map((y) => {
    const x = U.riverX(y), hw = +interp3(G.river.poly, y, 2).toFixed(2);
    const tx = U.riverX(y + 1) - U.riverX(y - 1), tl = Math.hypot(tx, 2), nx = 2 / tl, ny = -tx / tl;   // unit normal of the flow (RIVER-04 arch: cross-sections
    let bed = 1e9;                                                                                     // perpendicular to the river, like the ribbon rows)
    for (let k = -2; k <= 2; k++) bed = Math.min(bed, ground(x + k * 0.3 * hw * nx, y + k * 0.3 * hw * ny));
    const bo = hw + R.bankOut, bank = Math.min(ground(x - bo * nx, y - bo * ny), ground(x + bo * nx, y + bo * ny));   // banks at the ribbon feather edge
    return { x: +x.toFixed(2), y, hw, z: bed + R.depth, bank, pin: false };
  });
}
const up = raw(ys(R.y0, R.upEnd)), shelf = raw(ys(R.lakeOut, R.shelfEnd)), down = raw(ys(R.cliffEnd, R.yEnd));
{ const lipV = shelf[shelf.length - 1], prev = shelf[shelf.length - 2]; lipV.z = prev.z - 0.4; } // OB-214: the lip vertex (y 603) samples the notch below it (bed -77 within the perpendicular cross-section): hold it 0.4 m under the vertex before, as the committed json always did (-60.013)
shelf[0].z = R.lakeZ; shelf[0].pin = true; up[up.length - 1].z = R.lakeZ; up[up.length - 1].pin = true; // upper reach ends in the lake (dam-shelf channel, arch RIVER-04)                                        // leaves the Glasswater rect at the lake surface (the rect draws inside)
for (const v of down) if (v.y >= R.fordY0 && v.y <= R.fordY1) { v.z = R.fordZ; v.pin = true; }
down[down.length - 1].z = R.seaZ; down[down.length - 1].pin = true;                    // ends inside the sea rect at its z // flat over the ford region (ties go to the river: it comes first in the list)
// per river: least-squares NON-INCREASING fit (PAVA) of bed + depth, so one pit in the ground does not drag the whole reach down; pinned vertices
// (lake edge, ford) weigh 1000. Then the bank cap and a final running-min (z must never rise), pre-ford >= ford z.
function isoDec(v, w) {
  const bz = [], bw = [], bn = [];                     // blocks: mean, weight, count
  for (let i = 0; i < v.length; i++) {
    bz.push(v[i]); bw.push(w[i]); bn.push(1);
    while (bz.length > 1 && bz[bz.length - 2] < bz[bz.length - 1]) { // a rise: merge the last two blocks
      const k = bz.length - 1, W2 = bw[k - 1] + bw[k];
      bz[k - 1] = (bz[k - 1] * bw[k - 1] + bz[k] * bw[k]) / W2; bw[k - 1] = W2; bn[k - 1] += bn[k]; bz.pop(); bw.pop(); bn.pop();
    }
  }
  const o = []; for (let k = 0; k < bz.length; k++) for (let j = 0; j < bn[k]; j++) o.push(bz[k]);
  return o;
}
for (const list of [up, shelf, down]) {                // fit each free run between pinned vertices on its own (RIVER-04 arch: a deep pool above the
  for (let i = 0; i < list.length;) {                    // ford must not drag the reach below the ford down); the run starts at <= the pin before it
    if (list[i].pin) { i++; continue; }                  // and never drops below the pin after it (backwater)
    let j = i; while (j < list.length && !list[j].pin) j++;
    const run = list.slice(i, j), f = isoDec(run.map((v) => v.z), run.map(() => 1)), floor = j < list.length ? list[j].z : -Infinity;
    let zm = i > 0 ? list[i - 1].z : Infinity;
    run.forEach((v, k) => { const nearFord = v.y > R.fordY0 - 24 && v.y < R.fordY1 + 24; // the authored ford bar sits above its banks: no bank cap there
      zm = Math.min(zm, nearFord ? f[k] : Math.min(f[k], v.bank - R.bankGap)); v.z = Math.max(zm, floor); });
    i = j;
  }
}
for (const v of down) if (v.y < R.fordY0) v.z = Math.max(v.z, R.fordZ);
for (const v of up) v.z = Math.max(v.z, R.lakeZ);                               // the upper reach never runs below the lake it feeds (inlet backwater) // upstream of the ford never below the ford z (non-increasing kept)
// the mouth: the last vertex is pinned at the sea z (above) and the run before it never drops below it (backwater), so the
// river follows its bed until the estuary bed sinks under the sea surface (y ~1470) and ends inside the sea rect (RIVER-04 arch).
const all = [up, shelf, down];
let worst = 0; for (const l of all) for (let i = 1; i < l.length; i++) worst = Math.max(worst, (l[i - 1].z - l[i].z) / Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y));
const path = (l) => l.map((v) => [v.x, v.y, +v.z.toFixed(3), v.hw]);
const rivers0 = [
  { id: 'braid_upper', shape: 'river', look: 'river', path: path(up), clip: ['glasswater'] },
  { id: 'braid_outlet', shape: 'river', look: 'river', path: path(shelf), clip: ['glasswater'] },
  { id: 'braid', shape: 'river', look: 'river', path: path(down), clip: ['sea'] },
];
const rivers = applyAllRiverEdits(rivers0, data.riverEdits); // no riverEdits -> identical regions, output byte-identical
if (dry) { console.log(`${up.length}+${shelf.length}+${down.length} verts, worst slope ${worst.toFixed(3)}`); for (const r of rivers) console.log(r.id, JSON.stringify(r.path.filter((_, i) => i % 12 === 0))); process.exit(0); }
const out = JSON.parse(fs.readFileSync(FILE, 'utf8'));
out.water = out.water.filter((w) => !/^river_\d+$/.test(w.id) && !/^braid/.test(w.id));
const fi = out.water.findIndex((w) => w.id === 'ford');
if (fi < 0) throw new Error('ford region not found');
out.water[fi].draw = false;                                   // physics / block only: the river shape draws the surface here
out.water[fi].note = 'WS2-07 / RIVER-04: stepping-stone ford block (draw:false: the river shape draws the water); no swimming: D-064';
out.water.splice(fi, 0, ...rivers);                           // lower index than ford/sea/glasswater: wins z ties
{ // RIVER-04 (arch): the outlet cliff is a vertical notch (world_geo poly 603/605) -> one waterfall sheet from the outlet end to the plunge reach
  const lipZ = shelf[shelf.length - 1].z, footZ = down[0].z, y = R.fallsY, x = U.riverX(y), hw = interp3(G.river.poly, y, 2);
  const tx = U.riverX(y + 1) - U.riverX(y - 1), ty = 2, n = Math.hypot(tx, ty), ux = tx / n, uy = ty / n;   // downstream tangent
  const outDeg = +((Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360).toFixed(1), drop = +(lipZ - footZ).toFixed(3);
  if (!(drop >= 2 && drop <= 20)) throw new Error('braidFalls drop out of 2..20 m: ' + drop);
  const lip = [x + uy * hw, y - ux * hw, x - uy * hw, y + ux * hw].map((v) => +v.toFixed(2));
  out.waterfalls = (out.waterfalls || []).filter((w) => w.id !== 'braidFalls');
  // OB-213: out 4.5 m/s (throw ~8.3 m) so the sheet clears the grassy ramp under the east half of the lip and lands in the plunge reach (was 1.5: green slope cut the falls)
  out.waterfalls.push({ id: 'braidFalls', lip, z: +lipZ.toFixed(3), drop, outDeg, out: 4.5, look: 'waterfall' });
}
fs.writeFileSync(FILE, stringifyContent(out), 'utf8');
console.log(`gen-river-water v2: ${up.length}+${shelf.length}+${down.length} verts, worst slope ${worst.toFixed(3)}`);
