// (setup as probe-region-dress.mjs)
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
// WMP-08 probe: the 10 heaviest grid zones (bundle MB, trees, detail, colliders) across the whole map.
// Run: node tools/probe-heavy-zones.mjs [--top N] [--step K]

const BPTS = assets.world('world_m1').bounds.pts;
const CH = 128, CW = 5, CHH = 3, arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const top = arg('--top', 10), step = arg('--step', 2);
const rows = [];
for (let cy = -1; cy < 16; cy += step) for (let cx = -2; cx < 19; cx += step) {
  if (!inPolygon(BPTS, cx * CH + 320, cy * CH + 192)) continue;   // zone centre outside the bounds polygon: unreachable, skip
  const job = BandBakeJob.create(world, cx, cy, CW, CHH, null); job.step(1e9); const b = job.bundle(), bytes = bundleBytes(b);
  rows.push({ cx, cy, x: cx * CH + 320, y: cy * CH + 192, MB: +(bytes / 1048576).toFixed(2), trees: b.scatter ? b.scatter.count : 0, detail: b.detail ? b.detail.count : 0, col: b.detailCol && b.detailCol.count != null ? b.detailCol.count : 0 });
}
rows.sort((a, b) => b.MB - a.MB);
for (const r of rows.slice(0, top)) console.log(JSON.stringify(r));
if (!rows.length) rows.push({ MB: 0 });
console.log('zones', rows.length, 'maxMB', rows[0].MB, 'over4', rows.filter((r) => r.MB > 4).length);
if (process.argv.includes('--parts')) {
  const z = rows[0], b = BandBakeJob.create(world, z.cx, z.cy, CW, CHH, null); b.step(1e9); const u = b.bundle();
  const sb = (o) => { let n = 0; if (o && typeof o === 'object') for (const v of Object.values(o)) n += ArrayBuffer.isView(v) ? v.byteLength : (v && typeof v === 'object' && !Array.isArray(v) ? sb(v) : 0); return n; };
  for (const k of ['near', 'scatter', 'detail', 'trunks', 'detailCol', 'nav']) console.log(k, (sb(u[k]) / 1048576).toFixed(2), 'MB');
  console.log('classMap', u.classMap ? (u.classMap.byteLength / 1048576).toFixed(2) : 0);
}
if (process.argv.includes('--species')) {
  const z = process.argv.includes('--cx') ? { cx: arg('--cx', 0), cy: arg('--cy', 0) } : rows[0], j = BandBakeJob.create(world, z.cx, z.cy, CW, CHH, null); j.step(1e9); const u = j.bundle(), d = u.detail, c = {};
  for (let i = 0; i < d.count; i++) { const s = d.speciesDefs[d.species[i]]; const k = (s.mesh || s.model) + (s.collider ? ' [col]' : '') + ' L' + s.layer; c[k] = (c[k] || 0) + 1; }
  console.log(JSON.stringify(c)); console.log('detailCol keys', Object.keys(u.detailCol), Object.entries(u.detailCol).map(([k, v]) => k + ':' + (v && v.byteLength || (v && v.length))).join(' '));
}
if (process.argv.includes('--biomemap')) {
  const bAt = world.terrain.recipe.util.biomeAt, h = {};
  for (let y = 0; y < 2300; y += 128) { let s = ''; for (let x = 0; x < 2900; x += 128) s += bAt(x + 64, y + 64); console.log(String(y).padStart(5), s); }
}
