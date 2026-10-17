import { BandBakeJob, bundleBytes } from "../engine/dev.js";
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
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events(), realTrees: true, detail: true });
// OB-131 regression: no tree floats (> 0.25 m) above the lowest ground under its root. Placed tree meshes in world_m1 (all) +
// scatter trees of the 3 zones around the start (drawn near band). Probe for the whole map: node tools/probe-floating.mjs
import assert from 'node:assert/strict';
const MAX_GAP = 0.25;
const sp = world.terrain.recipe.recipe.forest.trees.species;
const lowest = (get, x, y, r) => { let lo = Infinity; for (let k = -1; k < 8; k++) { const a = k * Math.PI / 4, h = get(x + (k < 0 ? 0 : r * Math.cos(a)), y + (k < 0 ? 0 : r * Math.sin(a))); if (h !== null && h < lo) lo = h; } return lo; };
let worst = 0, nPlaced = 0;
for (const s of assets.world('world_m1').structures) {
  if (!s.mesh || !/Tree|Pine/.test(s.mesh) || !s.origin) continue;
  const sc = s.scale || 1, gap = s.origin.z + assets.mesh(s.mesh).bbox[2] * sc - lowest((x, y) => world.terrain.heightAt(x, y), s.origin.x, s.origin.y, 0.74 * sc);
  assert.ok(gap <= MAX_GAP, `placed tree ${s.id} floats ${gap.toFixed(2)} m`); worst = Math.max(worst, gap); nPlaced++;
}
let nScatter = 0;
for (const [cx, cy] of [[9, 7], [10, 7], [11, 7]]) {
  const job = BandBakeJob.create(world, cx, cy, 5, 3, null); job.step(1e9); const b = job.bundle(), s = b.scatter;
  for (let i = 0; s && i < s.count; i++) {
    const gap = s.z[i] - lowest((x, y) => util.gridHeight(b.near, x, y), s.x[i], s.y[i], sp[s.species[i]].trunkR);
    assert.ok(gap <= MAX_GAP, `scatter tree at ${s.x[i].toFixed(1)},${s.y[i].toFixed(1)} floats ${gap.toFixed(2)} m`); nScatter++;
  }
}
assert.ok(nPlaced > 30);
console.log(`floatingTrees ok: ${nPlaced} placed + ${nScatter} scatter trees, worst placed gap ${worst.toFixed(2)} m`);
