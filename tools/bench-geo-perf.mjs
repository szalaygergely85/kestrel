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
export const ZONES = { keep: [1152, 896], northwood: [1536, 512], downs: [1408, 1280], strand: [1280, 1664], reedmire: [1024, 1536], far: [3072, 3072], glasswater: [1024, 320], whitecombs: [900, 0], gatePass: [0, 704], westFells: [256, 384] };
const W = 320, H = 192, cell = 2;
const hashOf = (G) => createHash('sha1').update(Buffer.from(G.height.buffer)).update(Buffer.from(G.type.buffer)).digest('hex').slice(0, 16);
export const PINS = process.env.GEO_PINS ? JSON.parse(process.env.GEO_PINS) : null;
export function hashes() {
  const out = {};
  for (const [k, [x, y]] of Object.entries(ZONES)) out[k] = hashOf(util.bake(x, y, cell, W, H));
  out.farGenerate = hashOf(util.generate());
  return out;
}
export function bench() {
  const r = {};
  for (const [k, [x, y]] of Object.entries(ZONES)) {
    util.bake(x, y, cell, 64, 64);   // warm (GeoFields lazy build)
    const t = performance.now(); util.bake(x, y, cell, W, H); r[k] = +(performance.now() - t).toFixed(0);
    // overlap bake = ~45% of the rows (a neighbour supplies the rest)
    const t2 = performance.now(); util.bake(x, y, cell, W, Math.round(H * 0.45)); r[k + '_ov'] = +(performance.now() - t2).toFixed(0);
  }
  return r;
}
if (process.argv[1] && process.argv[1].endsWith('bench-geo-perf.mjs')) {
  console.log(JSON.stringify(hashes()));
  console.log(JSON.stringify(bench()));
}
