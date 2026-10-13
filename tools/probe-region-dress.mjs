// WM-01 GEO-PERF: byte hashes + timing of terrain bakes in probe zones (640 x 384 m near zones, 2 m cells) with the world_geo layers installed.
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
import { BandBakeJob } from '../engine/world/bandBake.js';
import { bundleBytes } from '../engine/world/bandCache.js';
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events(), realTrees: true, detail: true });
if (process.argv.includes('--base')) for (const b of Object.values(world.terrain.recipe.geo.biomes)) for (const k of ['boulders', 'ruins', 'reeds', 'wildflowers', 'pebbles']) delete b.detail[k];
const CH = 128, CW = 5, CHH = 3;
const sha = (...bufs) => { const h = createHash('sha1'); for (const b of bufs) h.update(b); return h.digest('hex').slice(0, 16); };
function bake(cx, cy) {
  const job = BandBakeJob.create(world, cx, cy, CW, CHH, null);
  job.step(1e9); const b = job.bundle(); b.bytes = bundleBytes(b); return b;
}
const T = (x) => ({ cx: Math.floor((x[0] - 320) / CH), cy: Math.floor((x[1] - 192) / CH) });
// sample zone centres (x, y) per empty region + the authored zones
export const REGIONS = { glasswater: [1200, 600], northwood: [1660, 600], highPastures: [650, 600], ashMile: [1780, 1100], downs: [1580, 1430],
  signalHill: [720, 1300], heath: [450, 1350], reedmire: [1090, 1510], strand: [1590, 1720], whitecombsFoot: [150, 300] };
export const KEEP = { keep: [1152, 1000], tower: [1480, 1030], ford: [1050, 1070], outwall: [920, 860], westFells: [250, 700] };
const hashBundle = (b) => sha(Buffer.from(b.scatter.x?.buffer || new ArrayBuffer(0)), Buffer.from(b.detail.x.buffer), Buffer.from(b.detail.species.buffer), Buffer.from(b.detail.y.buffer));
if (process.argv.includes('--hash')) {
  const out = {};
  for (const [k, p] of Object.entries(KEEP)) { const z = T(p); out[k] = hashBundle(bake(z.cx, z.cy)); }
  console.log(JSON.stringify(out));
} else {
  const rows = [];
  for (const [k, p] of Object.entries(REGIONS)) {
    const z = T(p), b = bake(z.cx, z.cy), d = b.detail, defs = d.speciesDefs, cnt = {};
    // count placements inside a 400 x 300 m window around the region sample point (dressing only: not logs/stumps/trees)
    const x0 = p[0] - 320, x1 = p[0] + 320, y0 = p[1] - 192, y1 = p[1] + 192; let n = 0;
    for (let i = 0; i < d.count; i++) {
      if (d.x[i] < x0 || d.x[i] > x1 || d.y[i] < y0 || d.y[i] > y1) continue;
      const s = defs[d.species[i]], key = s.mesh || s.model; cnt[key] = (cnt[key] || 0) + 1;
      if (s.mesh && s.mesh !== undefined && !/CommonTree|Pine_/.test(s.mesh)) n++;
    }
    const km2 = (x1 - x0) * (y1 - y0) / 1e6;
    rows.push({ region: k, dressPerKm2: Math.round(n / km2), detail: d.count, trees: b.scatter ? b.scatter.count : 0, MB: +(b.bytes / 1048576).toFixed(2), species: cnt });
  }
  for (const r of rows) console.log(JSON.stringify(r));
}
if (process.argv.includes('--biome')) {
  const bAt = world.terrain.recipe.util.biomeAt;
  for (const [x, y] of [[1500, 1030], [1250, 1050], [1050, 1070], [1000, 1000], [920, 860], [1400, 1100], [1100, 940], [1300, 1000]]) console.log(x, y, bAt(x, y));
  let c = 0; const E = {};
  const b = bake(T([1152, 1000]).cx, T([1152, 1000]).cy), d = b.detail;
  for (let i = 0; i < d.count; i++) { const s = d.speciesDefs[d.species[i]]; if (s.layer >= 1) { E[s.mesh] = (E[s.mesh] || 0) + 1; } }
  console.log('keep zone new-layer placements', JSON.stringify(E));
}
if (process.argv.includes('--keepcheck')) {
  // layer-0 (logs/stumps) points must equal the pre-WM-07 bytes in every authored zone; new layers: 0 placements inside the keep rect
  const out = {}, inKeep = {};
  for (const [k, p] of Object.entries(KEEP)) {
    const z = T(p), d = bake(z.cx, z.cy).detail, xs = [], ys = [], sp = []; let n = 0;
    for (let i = 0; i < d.count; i++) {
      if (d.speciesDefs[d.species[i]].layer === 0) { xs.push(d.x[i]); ys.push(d.y[i]); sp.push(d.species[i]); }
      else if (d.x[i] > 940 && d.x[i] < 1600 && d.y[i] > 930 && d.y[i] < 1130) n++;
    }
    out[k] = sha(Buffer.from(new Float64Array(xs).buffer), Buffer.from(new Uint16Array(sp).buffer), Buffer.from(new Float64Array(ys).buffer)); inKeep[k] = n;
  }
  console.log('layer0', JSON.stringify(out)); console.log('newLayersInKeepRect', JSON.stringify(inKeep));
}
if (process.argv.includes('--types')) {
  for (const k of ['highPastures', 'whitecombsFoot', 'heath', 'ashMile']) {
    const p = REGIONS[k], z = T(p), b = bake(z.cx, z.cy), n = b.near, h = {};
    for (let i = 0; i < n.type.length; i++) { const t = world.terrain.typeName(n.type[i]); h[t] = (h[t] || 0) + 1; }
    console.log(k, JSON.stringify(h));
  }
}
if (process.argv.includes('--slope')) {
  const bAt = world.terrain.recipe.util.biomeAt;
  for (const k of ['highPastures', 'whitecombsFoot']) {
    const p = REGIONS[k], z = T(p), b = bake(z.cx, z.cy), n = b.near; let ok = 0, tot = 0; const bi = {}; const nrm = { x: 0, y: 0, z: 1 };
    for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) {
      const x = n.x0 + 20 + i * 15, y = n.y0 + 20 + j * 9; if (world.terrain.typeName(world.terrain.groundTypeAt(x, y)) !== 'rock') continue;
      tot++; world.terrain.groundNormalAt(x, y, nrm); if (Math.hypot(nrm.x, nrm.y) / nrm.z <= 0.4) ok++; const id = bAt(x, y); bi[id] = (bi[id] || 0) + 1;
    }
    console.log('slope', k, 'rockSamples', tot, 'slope<=0.4', ok, 'biomes', JSON.stringify(bi));
  }
}
if (process.argv.includes('--scan')) {
  const C = [[150, 300], [450, 310], [1000, 320], [1300, 320], [1650, 320], [2000, 300]];
  for (const p of C) {
    const z = T(p), b = bake(z.cx, z.cy), n = b.near, h = {};
    for (let i = 0; i < n.type.length; i++) { const t = world.terrain.typeName(n.type[i]); h[t] = (h[t] || 0) + 1; }
    const d = b.detail; let nb = 0; for (let i = 0; i < d.count; i++) if (d.speciesDefs[d.species[i]].layer >= 1) nb++;
    console.log('scan', p.join(','), 'gentle', (h.grass || 0) + (h.alpine || 0) + (h.flowers || 0), 'rock', h.rock || 0, 'newPlacements', nb);
  }
}
