// engine/mesh/lazyMesh.test.js (MESH-LOAD-01): lazy mesh payloads with a fake fetch over the real content/meshes.
// Run: node engine/mesh/lazyMesh.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContentPack } from '../content/loadPack.js';
import { World } from '../world/World.js';
import { buildWorldColliders } from '../world/colliders.js';
import { DrawList, MeshDrawCache, addMeshStructures } from './DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from './meshGroups.js';
import { LazyMeshStore, lazyEligible, meshReady, ensureMesh, requestMesh, pumpLazyMeshes, lazyMeshVersion, LOAD_MARGIN_M } from './lazyMesh.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestUrl = pathToFileURL(path.join(root, 'content/manifest.json')).href;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack || e.message}`); process.exitCode = 1; }
}

/** Fake fetch over the disk with counters; `delay` lets the tests control when bytes arrive. */
function fakeFetch() {
  const f = { texts: 0, bins: [], binBytes: 0 };
  f.fetchText = async (url) => { f.texts++; return fs.readFileSync(fileURLToPath(url), 'utf8'); };
  f.fetchBytes = async (url) => { const b = fs.readFileSync(fileURLToPath(url)); f.bins.push(path.basename(fileURLToPath(url))); f.binBytes += b.length; return b; };
  return f;
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/manifest.json'), 'utf8'));
const meshFiles = manifest.files.filter((f) => f.endsWith('.mesh.json'));
const metas = meshFiles.map((f) => JSON.parse(fs.readFileSync(path.join(root, 'content', f), 'utf8')));
const nLazy = metas.filter(lazyEligible).length;
const nEager = metas.length - nLazy;

function byteEq(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'lazy') continue;
    const x = a[k], y = b[k];
    if (ArrayBuffer.isView(x) || ArrayBuffer.isView(y)) {
      assert.ok(ArrayBuffer.isView(x) && ArrayBuffer.isView(y) && x.constructor === y.constructor, `${k} type`);
      assert.equal(Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)), 0, `${k} bytes`);
    } else assert.equal(JSON.stringify(x), JSON.stringify(y), k);
  }
}

const eagerF = fakeFetch();
const eager = await loadContentPack(manifestUrl, { ...eagerF, lazyMeshes: false });

await test('eager mode (default) = today: every bin fetched at load, no shells, no store', async () => {
  assert.equal(eager.lazyMeshes, null);
  assert.equal(eagerF.bins.length, metas.length);
  for (const m of Object.values(eager.meshes)) assert.ok(meshReady(m));
});

const lazyF = fakeFetch();
const lazyLog = [];
const lazy = await loadContentPack(manifestUrl, { ...lazyF, lazyMeshes: true, lazyLog: (m) => lazyLog.push(m) });
const store = lazy.lazyMeshes;

await test('boot fetches only the metas plus the bins of meshes that need render triangles for collision', async () => {
  assert.ok(store instanceof LazyMeshStore);
  assert.ok(nLazy > 30, `most meshes are lazy (${nLazy}/${metas.length})`);
  assert.equal(lazyF.bins.length, nEager, `bins fetched at boot: ${lazyF.bins.length} (eager ${nEager}, lazy ${nLazy})`);
  assert.equal(store.stats.registered, nLazy);
  assert.equal(store.stats.fetched, 0);
  console.log(`   boot: ${metas.length} metas, bins fetched ${lazyF.bins.length} (was ${eagerF.bins.length}), ${lazyF.binBytes} B (was ${eagerF.binBytes} B)`);
});

await test('shell: meta fields + collider present, streams empty, same object for the session', async () => {
  const id = 'quaternius/Rock_Medium_1';
  const s = lazy.meshes[id], e = eager.meshes[id];
  assert.ok(s.lazy && !meshReady(s));
  assert.equal(s.pos.length, 0);
  assert.equal(s.triCount, e.triCount);
  assert.ok(s.collider && s.collider.length >= 9, 'collision proxy before the payload');
  assert.equal(Buffer.compare(Buffer.from(s.collider.buffer, s.collider.byteOffset, s.collider.byteLength), Buffer.from(e.collider.buffer, e.collider.byteOffset, e.collider.byteLength)), 0);
  assert.equal(JSON.stringify(s.ranges), JSON.stringify(e.ranges));
  assert.deepEqual(Array.from(s.bbox), Array.from(e.bbox));
});

function mkWorld(meshes, ids) {
  const w = { structures: [], renderVersion: 0, structVersion: 0, events: null, assets: null };
  ids.forEach((id, i) => World.prototype.placeMesh.call(w, meshes[id], { x: i * 40, y: 0, z: 0 }, `p${i}`, i * 15, undefined, 1));
  return w;
}
const IDS = ['quaternius/Rock_Medium_1', 'quaternius/DeadTree_1', 'quaternius/Rock_Medium_2', 'quaternius/DeadTree_2', 'quaternius/Pebble_Round_1'];

await test('colliders are eager: the world collider list from shells == from loaded meshes', async () => {
  const a = buildWorldColliders(mkWorld(eager.meshes, IDS)), b = buildWorldColliders(mkWorld(lazy.meshes, IDS));
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(Array.from(a[i].min), Array.from(b[i].min));
    assert.deepEqual(Array.from(a[i].max), Array.from(b[i].max));
    assert.equal(a[i].bvh.nodeMin.length, b[i].bvh.nodeMin.length);
  }
  assert.ok(a.length > 0 && Array.from(b[0].max).every(Number.isFinite));
  assert.equal(store.stats.requested, 0, 'building colliders requested nothing');
});

await test('placeholder: a shell draws nothing; near shells are requested, far ones are not', async () => {
  const w = mkWorld(lazy.meshes, IDS); // x = 0,40,80,120,160
  const cam = { x: 0, y: 0, z: 1.7 }, cache = new MeshDrawCache();
  const list = new DrawList(); list.begin();
  addMeshStructures(list, w, cam, cache, () => 1, 50); // fogFar 50 + margin 20 = 70: placements at x 0,40 (bbox dist) are near, 80+ are not
  assert.equal(list.count, 0, 'unloaded meshes draw nothing');
  const near = store.stats.requested;
  assert.ok(near >= 2 && near <= 3, `requested ${near}`);
  assert.equal(lazy.meshes['quaternius/Pebble_Round_1'].lazy.promise, null, 'far mesh not requested');
  assert.equal(lazy.meshes['quaternius/DeadTree_2'].lazy.promise, null, 'far mesh not requested');
  assert.equal(LOAD_MARGIN_M, 20);
});

await test('de-dup: repeated requests share one Promise and one fetch', async () => {
  const m = lazy.meshes['quaternius/Rock_Medium_1'];
  const before = lazyF.bins.length;
  const p1 = requestMesh(m), p2 = requestMesh(m), p3 = store.request(m);
  assert.equal(p1, p2); assert.equal(p2, p3);
  const w = mkWorld(lazy.meshes, IDS); const list = new DrawList(); list.begin();
  for (let i = 0; i < 5; i++) addMeshStructures(list, w, { x: 0, y: 0, z: 1.7 }, new MeshDrawCache(), () => 1, 50);
  await settle();
  const fetchedNow = lazyF.bins.length - before;
  assert.ok(fetchedNow <= 3, `fetched ${fetchedNow} new bins for 3 distinct near meshes`);
  assert.equal(lazyF.bins.filter((b) => b === 'Rock_Medium_1.mesh.bin').length, 1, 'Rock_Medium_1 fetched exactly once in the lazy run');
});

await test('budget: pump() decodes at most 2 meshes per call; payload equals the eager mesh byte for byte', async () => {
  const st = new LazyMeshStore({ fetchBytes: lazyF.fetchBytes, log: null });
  const meta = (id) => metas.find((m) => m.id === id);
  const ids = ['quaternius/Pebble_Round_1', 'quaternius/Pebble_Round_2', 'quaternius/Pebble_Round_3', 'quaternius/Pebble_Round_4', 'quaternius/Pebble_Round_5'];
  const shells = ids.map((id) => st.makeShell(meta(id), pathToFileURL(path.join(root, 'content', manifest.files.find((f) => f.endsWith(id + '.mesh.json')).replace('.mesh.json', '.mesh.bin'))).href));
  shells.forEach((s) => st.request(s));
  await settle();
  assert.equal(st.stats.fetched, 5);
  assert.equal(st.stats.decoded, 0, 'nothing decoded outside pump()');
  st.pump(); assert.equal(st.stats.decoded, 2);
  st.pump(); assert.equal(st.stats.decoded, 4);
  st.pump(); assert.equal(st.stats.decoded, 5);
  assert.equal(st.stats.maxDecodesPerPump, 2);
  shells.forEach((s, i) => { assert.ok(meshReady(s)); byteEq(s, eager.meshes[ids[i]]); });
});

await test('budget: a slow decode stops the pump after the 4 ms budget', async () => {
  let t = 0;
  const st = new LazyMeshStore({ fetchBytes: lazyF.fetchBytes, log: null, now: () => (t += 5) }); // every clock read advances 5 ms
  const id = 'quaternius/Pebble_Square_1';
  const mk = (n) => st.makeShell({ ...metas.find((m) => m.id === id), id: `${id}#${n}` }, pathToFileURL(path.join(root, 'content/meshes/quaternius/Pebble_Square_1.mesh.bin')).href);
  const shells = [mk(1), mk(2), mk(3)];
  shells.forEach((s) => st.request(s));
  await settle();
  st.pump();
  assert.equal(st.stats.decoded, 1, 'first decode always runs, then the budget is spent');
});

await test('lazy meshes become real after pump: group set rebuilds and the shell draws', async () => {
  const w = mkWorld(lazy.meshes, ['quaternius/Rock_Medium_1', 'quaternius/Rock_Medium_1', 'quaternius/Rock_Medium_1']);
  const cam = { x: 0, y: 0, z: 1.7 }, cache = new MeshDrawCache(), groups = new MeshGroupSet();
  const v0 = lazyMeshVersion();
  const l0 = new DrawList(); l0.begin(); addMeshStructuresBatched(l0, w, cam, cache, () => 1, 300, groups, null);
  await settle();
  const l1 = new DrawList(); l1.begin(); addMeshStructuresBatched(l1, w, cam, cache, () => 1, 300, groups, null); // pumps the queue
  assert.ok(meshReady(lazy.meshes['quaternius/Rock_Medium_1']));
  assert.ok(lazyMeshVersion() > v0);
  const l2 = new DrawList(); l2.begin(); addMeshStructuresBatched(l2, w, cam, cache, () => 1, 300, groups, null);
  assert.equal(l2.count, 1, 'three placements of one mesh = one instanced group item');
  byteEq(lazy.meshes['quaternius/Rock_Medium_1'], eager.meshes['quaternius/Rock_Medium_1']);
});

await test('editor path: ensureMesh / assets-style load resolves without pump() and ignores the frame budget', async () => {
  const m = lazy.meshes['quaternius/Mushroom_Common'];
  assert.ok(!meshReady(m));
  const got = await ensureMesh(m);
  assert.equal(got, m);
  assert.ok(meshReady(m));
  byteEq(m, eager.meshes['quaternius/Mushroom_Common']);
  assert.equal(await ensureMesh(m), m, 'second call: already ready');
});

await test('failed fetch: warns, stays a placeholder, rejects ensure(), no unhandled rejection', async () => {
  const st = new LazyMeshStore({ fetchBytes: async () => { throw new Error('HTTP 404'); }, log: null });
  const s = st.makeShell(metas.find((m) => m.id === 'quaternius/Pebble_Round_1'), 'file:///nope.bin');
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    st.request(s); await settle();
    assert.equal(warned, 1); assert.ok(!meshReady(s)); assert.equal(st.stats.failed, 1);
    await assert.rejects(ensureMesh(s));
  } finally { console.warn = warn; }
});

await test('log: one summary line once the queue drains', async () => {
  await settle(); pumpLazyMeshes(); await settle();
  assert.ok(lazyLog.length >= 1 && /\[lazymesh\] \d+\/\d+ lazy meshes loaded/.test(lazyLog[lazyLog.length - 1]), lazyLog.join('|'));
});

console.log(`lazyMesh: ${passed} passed`);
