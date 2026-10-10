// ENV-01a2 (37.4). Run: node engine/mesh/scatterFeed.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vegTintObjectId } from './vegTint.js';
import { bindDetailInstances, feedDetail, removeDetailInstances, DETAIL_OBJECT_BASE } from './scatterFeed.js';
import { InstanceGroups, createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE,
  INST_OBJECT_ID, INST_FLAGS, MAX_INSTANCE_GROUPS, MAX_INSTANCES_PER_FRAME } from './instances.js';
import { INST_FLAG_SWAY } from './sway.js';
import { World } from '../world/World.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/levels/overworld_far.js';
import '../../design/models/lantern.js';
import '../../design/models/lever.js';
import '../../design/models/voxel_props.js';
import '../../design/models/boulder.js';
import '../../design/models/rubble.js';
import '../../design/models/wreckage.js';
import '../../design/models/relay.js';
import '../../design/models/sword.js';
import '../../design/models/m3_props.js';
import '../../design/models/far_tower.js';
import '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

if (!global.gc) {
  const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const cfg = { maxDraw: 37, refeedM: 4, layers: [{ drawM: 13 }] };
const points = [], tileStart = [0], tileM = 4, tx0 = -3, ty0 = -4, tilesX = 8, tilesY = 7;
for (let y = 0; y < tilesY; y++) {
  for (let x = 0; x < tilesX; x++) {
    for (let n = 0; n < 12; n++) {
      points.push({ x: (tx0 + x) * tileM + (n % 4) + 0.125,
        y: (ty0 + y) * tileM + Math.floor(n / 4) + 0.75, z: n * 0.125 - 0.05,
        yawDeg: (n * 37) % 360, species: n % 2, r2: (7 + n * 0.5) ** 2 });
    }
    tileStart.push(points.length);
  }
}
const detail = { count: points.length, tileM, tx0, ty0, tilesX, tilesY,
  tileStart: Uint32Array.from(tileStart), speciesDefs: [
    { model: 'tuft', shadow: false, lodCells: 4, sway: true }, { model: 'rock', shadow: true, lodCells: 6 },
    { model: 'unused', shadow: false, lodCells: 4 }],
  x: Float64Array.from(points, p => p.x), y: Float64Array.from(points, p => p.y),
  z: Float64Array.from(points, p => p.z), yawDeg: Int16Array.from(points, p => p.yawDeg),
  species: Uint16Array.from(points, p => p.species), r2: Float32Array.from(points, p => p.r2) };
const registry = () => {
  const instances = new InstanceGroups();
  instances.bindPool({ models: new Map([['tuft', {}], ['rock', {}]]) });
  return instances;
};
const instances = registry(), binding = bindDetailInstances(detail, instances, cfg, 485);
ok(binding.groups.length === 2 && binding.groups.every(g => g.ib.capacity === cfg.maxDraw));
ok(binding.groups[0].lodCells === 4 && binding.groups[0].castShadow === false);
ok(binding.groups[1].lodCells === 6 && binding.groups[1].castShadow === true);
ok(binding.groups.every(g => g.count === 0));
ok(binding.groupOf instanceof Uint8Array && binding.groupOf[2] === 255);
const one = createInstanceBuffer(1);
for (let i = 0; i < detail.count; i++) {
  writeUnitInstance(one, 0, detail.x[i], detail.y[i], detail.z[i], detail.yawDeg[i], DETAIL_OBJECT_BASE | i, 0);
  if (detail.speciesDefs[detail.species[i]].sway) { one.u32[INST_FLAGS] |= INST_FLAG_SWAY; one.u32[INST_OBJECT_ID] = vegTintObjectId(DETAIL_OBJECT_BASE | i, i, detail.x[i], detail.y[i]); } // FOLIAGE-SWAY-01 part 2 + AUD-47
  for (let w = 0; w < INSTANCE_STRIDE; w++) assert.equal(binding.master.u32[i * INSTANCE_STRIDE + w], one.u32[w]);
}
checks++;

// FOLIAGE-SWAY-01 part 2: flagged species ('tuft', 0) carries INST_FLAG_SWAY on every instance; rock (1) never does.
// (The full-word loop above already proves every other INST_FLAGS bit, e.g. aligned, is unchanged by the OR.)
for (let i = 0; i < detail.count; i++) {
  const bits = binding.master.u32[i * INSTANCE_STRIDE + INST_FLAGS];
  if (detail.species[i] === 0) ok((bits & INST_FLAG_SWAY) !== 0);
  else ok((bits & INST_FLAG_SWAY) === 0);
}

// Independent oracle sorts the whole band's tiles, then scans placements.
function brute(x, y, cap) {
  const tx = Math.floor(x / tileM), ty = Math.floor(y / tileM), tiles = [];
  for (let i = 0; i < tilesX * tilesY; i++) {
    const dx = i % tilesX + tx0 - tx, dy = Math.floor(i / tilesX) + ty0 - ty;
    tiles.push({ i, dx, dy, d2: dx * dx + dy * dy });
  }
  tiles.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
  const selected = [[], []]; let count = 0;
  for (const tile of tiles) {
    for (let i = detail.tileStart[tile.i]; i < detail.tileStart[tile.i + 1]; i++) {
      const dx = detail.x[i] - x, dy = detail.y[i] - y;
      if (dx * dx + dy * dy >= detail.r2[i]) continue;
      selected[detail.species[i]].push(i);
      if (++count === cap) return selected;
    }
  }
  return selected;
}
for (let p = 0; p < 20; p++) {
  const x = -20 + p * 2.125, y = -19 + ((p * 7) % 20) * 1.875;
  const selected = brute(x, y, cfg.maxDraw), fed = feedDetail(binding, x, y, true);
  assert.equal(fed, selected[0].length + selected[1].length);
  for (let s = 0; s < 2; s++) {
    const g = binding.groups[s]; assert.equal(g.count, selected[s].length);
    for (let j = 0; j < g.count; j++) {
      assert.equal(g.ib.u32[j * INSTANCE_STRIDE + INST_OBJECT_ID] & 0xFFFFF, (DETAIL_OBJECT_BASE | selected[s][j]) & 0xFFFFF); // AUD-47: bits 20+ may carry the veg tint
      for (let w = 0; w < INSTANCE_STRIDE; w++) {
        assert.equal(g.ib.u32[j * INSTANCE_STRIDE + w], binding.master.u32[selected[s][j] * INSTANCE_STRIDE + w]);
      }
    }
  }
  checks++;
}
// FOLIAGE-SWAY-01 part 2: the per-frame raw-word re-feed (feedDetail) carries INST_FLAG_SWAY along for every fed
// 'tuft' (species 0) instance and never sets it on 'rock' (species 1, group index 1).
ok(binding.groups[0].count > 0 && Array.from({ length: binding.groups[0].count },
  (_, j) => binding.groups[0].ib.u32[j * INSTANCE_STRIDE + INST_FLAGS]).every(bits => (bits & INST_FLAG_SWAY) !== 0));
ok(binding.groups[1].count === 0 || Array.from({ length: binding.groups[1].count },
  (_, j) => binding.groups[1].ib.u32[j * INSTANCE_STRIDE + INST_FLAGS]).every(bits => (bits & INST_FLAG_SWAY) === 0));
feedDetail(binding, 0, 0, true);
ok(binding.fed === cfg.maxDraw);
// Sentinels prove the early return makes no writes, rather than rewriting identical words.
const sentinels = binding.groups.map(g => {
  g.ib.u32.fill(0xdeadbeef); g.count = 19;
  return Buffer.from(g.ib.u32.buffer).toString('hex');
});
const cachedFed = binding.fed;
ok(feedDetail(binding, 3.9, 0, false) === cachedFed && binding.lastX === 0 && binding.lastY === 0);
ok(binding.groups.every((g, i) => g.count === 19 && Buffer.from(g.ib.u32.buffer).toString('hex') === sentinels[i]));
feedDetail(binding, 3.9, 0, true);
ok(binding.lastX === 3.9 && binding.groups.some(g => g.ib.u32[0] !== 0xdeadbeef));
feedDetail(binding, 7.9, 0, false);
ok(binding.lastX === 7.9);
feedDetail(binding, -100, -100, true);
ok(binding.fed === 0 && binding.groups.every(g => g.count === 0));

const unbounded = bindDetailInstances(detail, registry(), { ...cfg, maxDraw: detail.count }, 0);
const px = detail.x[0], py = detail.y[0], r = Math.sqrt(detail.r2[0]);
feedDetail(unbounded, px + r, py, true);
ok(!unbounded.groups[0].ib.u32.some((word, i) => i % INSTANCE_STRIDE === INST_OBJECT_ID &&
  i < unbounded.groups[0].count * INSTANCE_STRIDE && (word & 0xFFFFF) === DETAIL_OBJECT_BASE));
feedDetail(unbounded, px + r - 0.0001, py, true);
ok(unbounded.groups[0].ib.u32.some((word, i) => i % INSTANCE_STRIDE === INST_OBJECT_ID &&
  i < unbounded.groups[0].count * INSTANCE_STRIDE && (word & 0xFFFFF) === DETAIL_OBJECT_BASE));
const tiny = { ...detail, count: 1, tileStart: new Uint32Array(tilesX * tilesY + 1).fill(1) };
tiny.tileStart[0] = 0;
const tinyBinding = bindDetailInstances(tiny, registry(), cfg);
ok(tinyBinding.groups.length === 1 && tinyBinding.groups[0].ib.capacity === 1);

const missing = registry(); missing.pool.models.delete('rock');
assert.throws(() => bindDetailInstances(detail, missing, cfg), /missing voxel model rock/); checks++;
ok(missing.groups.length === 0);
const full = registry();
for (let i = 0; i < MAX_INSTANCE_GROUPS - 1; i++) full.group('tuft', 1);
assert.throws(() => bindDetailInstances(detail, full, cfg), /over 32 groups/); checks++;
ok(full.groups.length === MAX_INSTANCE_GROUPS - 1);
assert.throws(() => bindDetailInstances(detail, registry(), cfg, MAX_INSTANCES_PER_FRAME - cfg.maxDraw + 1), /detail.maxDraw/); checks++;
ok(bindDetailInstances(detail, registry(), cfg, MAX_INSTANCES_PER_FRAME - cfg.maxDraw).groups.length === 2);
assert.throws(() => bindDetailInstances(detail, registry(), { ...cfg, maxDraw: MAX_INSTANCES_PER_FRAME + 1 }), /detail.maxDraw/); checks++;
const units = instances.group('tuft', 1);
removeDetailInstances(binding, instances);
ok(instances.groups.length === 1 && instances.groups[0] === units);
removeDetailInstances(binding, instances); removeDetailInstances(null, instances);
ok(instances.groups.length === 1);

// Species identity (layer/collider) survives render-key sharing.
const sharedDetail = { ...detail, species: Uint16Array.from(detail.species, (s, i) => s === 0 && i % 4 === 0 ? 3 : s),
  speciesDefs: [...detail.speciesDefs, { model: 'tuft', layer: 2, shadow: false, lodCells: 4, collider: { prism: { r: 1, h: 1 } } }] };
const shared = bindDetailInstances(sharedDetail, registry(), cfg);
ok(shared.groups.length === 2 && shared.groupOf[0] === shared.groupOf[3] && shared.groupOf[2] === 255);
for (let p = 0; p < 20; p++) {
  const x = -20 + p * 2.125, y = -19 + ((p * 7) % 20) * 1.875;
  const selected = brute(x, y, cfg.maxDraw);
  feedDetail(shared, x, y, true);
  for (let g = 0; g < selected.length; g++) {
    assert.equal(shared.groups[g].count, selected[g].length);
    for (let j = 0; j < selected[g].length; j++) {
      const i = selected[g][j];
      assert.equal(shared.groupOf[sharedDetail.species[i]], g);
      assert.deepEqual(shared.groups[g].ib.u32.subarray(j * INSTANCE_STRIDE, (j + 1) * INSTANCE_STRIDE),
        shared.master.u32.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE));
    }
  }
  checks++;
}
const sharedAll = bindDetailInstances(sharedDetail, registry(), { ...cfg, maxDraw: detail.count });
ok(sharedAll.groups[0].ib.capacity === detail.count / 2);
const shadowSplit = { ...sharedDetail, speciesDefs: sharedDetail.speciesDefs.map((d, i) => i === 3 ? { ...d, shadow: true } : d) };
ok(bindDetailInstances(shadowSplit, registry(), cfg).groups.length === 3);
const lodSplit = { ...sharedDetail, speciesDefs: sharedDetail.speciesDefs.map((d, i) => i === 3 ? { ...d, lodCells: 5 } : d) };
ok(bindDetailInstances(lodSplit, registry(), cfg).groups.length === 3);

const { assets } = await loadTestAssets();
const canonical = World.load(assets.world('world_m1'), assets, { physics: 'mesh', detail: true });
const canonicalRegistry = new InstanceGroups();
canonicalRegistry.bindPool({ models: new Map(canonical.detail.speciesDefs.map(d => [d.model, {}])) });
// Existing trees and the compare harness's unit group count against the cap.
for (let i = 0; i < 7; i++) canonicalRegistry.group('tree-or-unit', 1);
const canonicalBinding = bindDetailInstances(canonical.detail, canonicalRegistry, canonical.terrain.recipe.recipe.detail, 485);
ok(canonicalBinding.groups.length === 7 && canonicalRegistry.groups.length === 14); // PLANT-VOXEL-OFF-01 + STONES-VOXEL-OFF-01: voxel plants + stones removed (was 19 / 26, then 10 / 17)
const active = new Set(canonical.detail.species);
ok(canonical.detail.speciesDefs.every((d, s) => active.has(s) ? canonicalBinding.groupOf[s] < 7 : canonicalBinding.groupOf[s] === 255));
feedDetail(canonicalBinding, 1474.5, 1025, true);
ok(canonicalBinding.fed > 0 && canonicalBinding.fed <= canonicalBinding.maxDraw);
console.log(`world_m1: ${canonical.detail.count} placements, ${canonicalBinding.groups.length} detail groups`);

// Walk contains cached frames and >4m moves. Buffers remain stable throughout.
const walk = bindDetailInstances(detail, registry(), { ...cfg, maxDraw: 768 });
function frames() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += feedDetail(walk, (i % 80) * 0.5 - 20, ((i / 80) | 0) - 10, false);
  return sum;
}
for (let i = 0; i < 20; i++) frames();
const buffers = walk.groups.map(g => g.ib.u32);
global.gc(); const before = process.memoryUsage().heapUsed;
const sum = frames();
global.gc(); const growth = process.memoryUsage().heapUsed - before;
ok(growth < 64 * 1024 && sum > 0);
ok(walk.groups.every((g, i) => g.ib.u32 === buffers[i]));
console.log(`scatterFeed: ${checks} checks PASS (1000 frames, retained heap delta ${growth} bytes)`);
