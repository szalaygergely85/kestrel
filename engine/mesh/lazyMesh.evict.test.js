// engine/mesh/lazyMesh.evict.test.js (S8-B2-03): LRU eviction of lazy mesh payloads with a fake fetch and a fake clock.
// Run: node engine/mesh/lazyMesh.evict.test.js   (node --expose-gc adds a heap check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { World } from '../world/World.js';
import { DrawList, MeshDrawCache } from './DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from './meshGroups.js';
import { MeshBuffers } from '../render/gpu/MeshBuffers.js';
import { LazyMeshStore, meshReady, HOLD_MARGIN_M, LOAD_MARGIN_M, EVICT_AFTER_MS, SWEEP_EVERY } from './lazyMesh.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/manifest.json'), 'utf8'));
const metaFile = (id) => manifest.files.find((f) => f.endsWith(id.replace('quaternius/', '') + '.mesh.json'));
const readMeta = (id) => JSON.parse(fs.readFileSync(path.join(root, 'content', metaFile(id)), 'utf8'));
const binUrl = (id) => pathToFileURL(path.join(root, 'content', metaFile(id).replace('.mesh.json', '.mesh.bin'))).href;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack || e.message}`); process.exitCode = 1; }
}
const tick = () => new Promise((r) => setImmediate(r));

const FOG = 50, LOAD_M = FOG + LOAD_MARGIN_M, HOLD_M = LOAD_M + HOLD_MARGIN_M;
const IDS = ['quaternius/Rock_Medium_1', 'quaternius/Pebble_Round_1', 'quaternius/Pebble_Round_2'];
const ID_FOR = () => 1;
const XS = [0, 400, 800];

/** Scene: 3 placements far apart on the x axis; fake clock (ms) advanced by the test; counting fake fetch + counting fake GPU device. */
function scene(evictAfterMs) {
  const clock = { t: 1000 };
  const fetched = [];
  const st = new LazyMeshStore({ fetchBytes: async (url) => { fetched.push(url); return fs.readFileSync(fileURLToPath(url)); }, log: null, now: () => clock.t, evictAfterMs });
  const meshes = {};
  for (const id of IDS) meshes[id] = st.makeShell(readMeta(id), binUrl(id));
  const w = { structures: [], renderVersion: 0, structVersion: 0, events: null, assets: null };
  IDS.forEach((id, i) => World.prototype.placeMesh.call(w, meshes[id], { x: XS[i], y: 0, z: 0 }, `p${i}`, 0, undefined, 1));
  let live = 0, created = 0;
  const device = { createBuffer() { live++; created++; return {}; }, dispose() { live--; } };
  const mb = new MeshBuffers(device);
  const cache = new MeshDrawCache(), groups = new MeshGroupSet();
  return {
    clock, st, meshes, w, fetched, mb, cache,
    gpuLive: () => live, gpuCreated: () => created,
    ready: () => IDS.filter((id) => meshReady(meshes[id])).length,
    async frame(camX, dtMs) {
      clock.t += dtMs;
      const l = new DrawList(); l.begin();
      addMeshStructuresBatched(l, w, { x: camX, y: 0, z: 1.7 }, cache, ID_FOR, FOG, groups, null);
      for (const s of w.structures) { // "upload": every placement within draw distance that has its payload
        if (s.mesh.lazy || Math.abs(camX - (s.bbox.x0 + s.bbox.x1) / 2) > FOG + 10) continue;
        mb.get(cache.get(s.mesh, ID_FOR, null));
      }
      await tick();
    },
  };
}

await test('constants: hysteresis band and timeout as in the story (loadM + 60 m, 20 s)', () => {
  assert.equal(HOLD_MARGIN_M, 60); assert.equal(EVICT_AFTER_MS, 20000); assert.ok(SWEEP_EVERY > 0);
});

await test('walk out and back: loads, is kept inside the band, released 20 s after leaving, reloads on return', async () => {
  const s = scene();
  for (let i = 0; i < 6; i++) await s.frame(0, 16);
  assert.equal(s.ready(), 1); assert.ok(meshReady(s.meshes[IDS[0]]));
  assert.equal(s.gpuLive(), 1, 'one GPU vertex buffer');
  assert.ok(s.meshes[IDS[0]].pos.length > 0);
  for (let i = 0; i < 400; i++) await s.frame(HOLD_M - 5, 100); // 40 s just inside the hold radius
  assert.ok(meshReady(s.meshes[IDS[0]]), 'inside loadM + 60 m: never released');
  assert.equal(s.st.stats.evicted, 0);
  const t0 = s.clock.t;
  while (s.clock.t - t0 < 15000) await s.frame(HOLD_M + 40, 100);
  assert.ok(meshReady(s.meshes[IDS[0]]), 'unused for 15 s: still loaded');
  while (s.clock.t - t0 < 25000 + SWEEP_EVERY * 100) await s.frame(HOLD_M + 40, 100);
  const m = s.meshes[IDS[0]];
  assert.ok(!meshReady(m) && m.pos.length === 0 && m.lazy, 'released: back to a shell, same object');
  assert.equal(s.st.stats.evicted, 1);
  assert.equal(s.gpuLive(), 0, 'GPU buffer released');
  assert.ok(m.collider && m.collider.length >= 9, 'collider stays');
  assert.ok(m.triCount > 0, 'meta stays');
  const before = s.fetched.length;
  for (let i = 0; i < 10; i++) await s.frame(0, 16);
  assert.ok(meshReady(m) && m.pos.length > 0);
  assert.equal(s.fetched.length, before + 1, 'exactly one re-fetch');
  assert.equal(s.gpuLive(), 1, 'GPU buffer re-uploaded once');
});

await test('no thrash inside the hysteresis band: oscillating across the load edge never releases or refetches', async () => {
  const s = scene();
  for (let i = 0; i < 6; i++) await s.frame(0, 16);
  const f0 = s.fetched.length, c0 = s.gpuCreated();
  for (let i = 0; i < 1000; i++) await s.frame(LOAD_M + (i % 2 ? 25 : -25), 100); // crosses loadM every frame, stays inside loadM + 60
  assert.equal(s.st.stats.evicted, 0);
  assert.equal(s.fetched.length, f0, 'no refetch');
  assert.equal(s.gpuCreated(), c0, 'no GPU re-upload');
});

await test('1000-frame loop route: loaded count and GPU buffers stay bounded, heap does not grow', async () => {
  const s = scene();
  const route = (i) => { const u = (i % 500) / 500; return (u < 0.5 ? u * 2 : (1 - u) * 2) * 900; }; // 0 -> 900 -> 0, twice
  let maxReady = 0, maxLive = 0;
  const heap = [];
  for (let i = 0; i < 1000; i++) {
    await s.frame(route(i), 200);
    maxReady = Math.max(maxReady, s.ready()); maxLive = Math.max(maxLive, s.gpuLive());
    if (i === 499 || i === 999) { if (global.gc) global.gc(); heap.push(process.memoryUsage().heapUsed); }
  }
  assert.ok(maxReady <= 2, `at most 2 of 3 meshes loaded at once (max ${maxReady})`);
  assert.ok(maxLive <= maxReady, `GPU buffers <= loaded meshes (max ${maxLive})`);
  assert.ok(s.st.stats.evicted >= 4, `meshes were released (evicted ${s.st.stats.evicted})`);
  assert.equal(s.gpuLive(), s.ready());
  assert.equal(s.fetched.length, s.st.stats.fetched);
  if (global.gc) assert.ok(heap[1] < heap[0] * 1.5 + 4e6, `heap flat (${heap.map((h) => Math.round(h / 1e6))} MB)`);
  console.log(`   loop: max loaded ${maxReady}/3, max GPU buffers ${maxLive}, evicted ${s.st.stats.evicted}, fetches ${s.fetched.length}${global.gc ? `, heap MB ${heap.map((h) => Math.round(h / 1e6))}` : ''}`);
});

await test('meshGroup (getVoxel, instanced path) buffers are freed on eviction too (arch 2026-10-08 verdicts 13)', async () => {
  const s = scene();
  for (let i = 0; i < 6; i++) await s.frame(0, 16);
  const m = s.meshes[IDS[0]];
  assert.ok(meshReady(m));
  s.mb.getVoxel(s.cache.get(m, ID_FOR, null)); // what InstanceGroups.meshGroup draws use
  assert.ok(s.mb.voxelCache.has(m.id));
  const liveLoaded = s.gpuLive();
  assert.ok(liveLoaded >= 3, `static + voxel buffers live (${liveLoaded})`);
  const t0 = s.clock.t;
  while (s.clock.t - t0 < 25000 + SWEEP_EVERY * 100) await s.frame(HOLD_M + 40, 100);
  assert.ok(!meshReady(m), 'evicted');
  assert.ok(!s.mb.voxelCache.has(m.id), 'voxelCache entry released');
  assert.equal(s.gpuLive(), 0, 'every GPU buffer of the mesh freed (static + voxel)');
});

await test('editor path ensure() pins a mesh; evictAfterMs 0 disables eviction', async () => {
  const s = scene();
  await s.st.ensure(s.meshes[IDS[0]]);
  for (let i = 0; i < 300; i++) await s.frame(HOLD_M + 500, 200);
  assert.ok(meshReady(s.meshes[IDS[0]]), 'pinned');
  const n = scene(0);
  for (let i = 0; i < 6; i++) await n.frame(0, 16);
  for (let i = 0; i < 300; i++) await n.frame(HOLD_M + 500, 200);
  assert.ok(meshReady(n.meshes[IDS[0]]), 'eviction disabled');
  assert.equal(n.st.stats.evicted, 0);
});

console.log(`lazyMesh.evict: ${passed} passed`);
