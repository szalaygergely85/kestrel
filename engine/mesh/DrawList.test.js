// engine/mesh/DrawList.test.js (ME-03, docs/architecture.md 27.15.4 step 5).
// Zero-allocation gate is hard (27.15.0): when `global.gc` is missing this
// file re-runs itself with `--expose-gc`.
// Run: node engine/mesh/DrawList.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DrawList, DRAW_STATIC, DRAW_INSTANCED, addStructures, LevelMeshCache,
} from './DrawList.js';
import { createInstanceBuffer, writeUnitInstance, createInstanceParts } from './instances.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { frustumPlanes, classifyAABB, CULL_OUT } from './culling.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { KIND_FLOOR, FACE_U } from '../render/GBuffer.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny 1-quad mesh (kind FLOOR), just enough to be a valid draw item. */
function makeQuadMesh(id) {
  const b = new StaticMeshBuilder(id);
  const mat = b.matIndex('floor');
  b.addQuad(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    0, 0, 1,
    0, packFlat1(KIND_FLOOR, FACE_U, mat),
    [0, AO_NONE, 0, 0, 0, 0, 0, 0],
  );
  return b.build();
}

// ---------------------------------------------------------------------------
// 1. begin/push: identity reset, capacity throw.
// ---------------------------------------------------------------------------
{
  const list = new DrawList(4);
  list.begin();
  ok('fresh list count 0', list.count === 0);
  const mesh = makeQuadMesh('m');
  const item = list.push(mesh, DRAW_STATIC);
  ok('push returns an item with identity matrix', item.matrix[0] === 1 && item.matrix[4] === 1 && item.matrix[8] === 1
    && item.matrix[9] === 0 && item.matrix[10] === 0 && item.matrix[11] === 0);
  ok('push sets mesh/type', item.mesh === mesh && item.type === DRAW_STATIC);
  ok('count incremented', list.count === 1);
  for (let i = 0; i < 3; i++) list.push(mesh, DRAW_STATIC);
  ok('count at capacity', list.count === 4);
  let threw = false;
  try { list.push(mesh, DRAW_STATIC); } catch (e) { threw = true; }
  ok('push past capacity throws', threw);
}

// ---------------------------------------------------------------------------
// 2. cull: drops an item behind the eye, stable order for kept items.
// ---------------------------------------------------------------------------
{
  const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 }; // forward = -y
  const grid = { cols: 240, rows: 90 };
  const terms = {};
  const M = new Float64Array(16);
  const planes = new Float64Array(24);
  projTerms(cam, grid, terms);
  shearProjection(terms, M);
  frustumPlanes(M, planes);

  const list = new DrawList(8);
  list.begin();
  const meshA = makeQuadMesh('a'), meshB = makeQuadMesh('b'), meshC = makeQuadMesh('c');
  const a = list.push(meshA, DRAW_STATIC); a.aabb.set([-1, -20, 0, 1, -18, 2]); // ahead: kept
  const b = list.push(meshB, DRAW_STATIC); b.aabb.set([-1, 5, 0, 1, 10, 2]); // behind: culled
  const c = list.push(meshC, DRAW_STATIC); c.aabb.set([-1, -40, 0, 1, -38, 2]); // ahead: kept
  const n = list.cull(planes);
  ok('cull drops the behind-camera item', n === 2, `n=${n}`);
  ok('cull keeps a and c, in relative order', list.items[0].mesh === meshA && list.items[1].mesh === meshC,
    `items[0]=${list.items[0].mesh && list.items[0].mesh.id} items[1]=${list.items[1].mesh && list.items[1].mesh.id}`);
  // Sanity: classifyAABB itself agrees the dropped box was CULL_OUT.
  ok('dropped box really is CULL_OUT', classifyAABB(planes, -1, 5, 0, 1, 10, 2) === CULL_OUT);
}

// ---------------------------------------------------------------------------
// 3. addStructures: structSeq/order on a 3-structure fake world.
// ---------------------------------------------------------------------------
{
  function fakeLevel(name) {
    const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
    return {
      name, width: 1, height: 1, legend,
      sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; },
    };
  }
  const structs = [
    { id: 's0', level: fakeLevel('l0'), origin: { x: 0, y: 0, z: 0 }, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, structSeq: 0, packed: { version: 1 } },
    { id: 's1', level: fakeLevel('l1'), origin: { x: 10, y: 0, z: 0 }, bbox: { x0: 10, y0: 0, x1: 11, y1: 1 }, structSeq: 1, packed: { version: 1 } },
    { id: 's2', level: fakeLevel('l2'), origin: { x: 5, y: 0, z: 0 }, bbox: { x0: 5, y0: 0, x1: 6, y1: 1 }, structSeq: 2, packed: { version: 1 } },
  ];
  const world = { structures: structs };
  const cache = new LevelMeshCache();
  const list = new DrawList(16);
  list.begin();
  addStructures(list, world, { x: 0, y: 0, z: 1.6 }, cache, 2000);
  ok('addStructures pushed one item per structure (1 quad each)', list.count === 3, `count=${list.count}`);
  ok('near -> far order (s0, s2, s1)', list.items[0].objectId === 0 && list.items[1].objectId === 2 && list.items[2].objectId === 1,
    `order=${[0, 1, 2].map((i) => list.items[i].objectId)}`);
  ok('planeIdOr uses structSeq (not sort order)', list.items[1].planeIdOr === (2 & 7) << 28);
  ok('cache reuses the built mesh on a second call', cache.get(structs[0]) === cache.get(structs[0]));
  // ED-MESH-1a: same id + equal packed.version but a NEW Level object (editor rebuild) -> a new mesh set.
  const edited = { ...structs[0], level: fakeLevel('l0-edited'), packed: { version: 1 } };
  const first = cache.get(structs[0]);
  ok('cache rebuilds on a new Level object with equal version', cache.get(edited) !== first);
  ok('...and then reuses it for that Level', cache.get(edited) === cache.get(edited));
}

// ---------------------------------------------------------------------------
// 4. Timing: 200 synthetic items begin/push/cull <= 0.3 ms median (warn-only
// unless PERF_STRICT=1 - 27.15.0).
// ---------------------------------------------------------------------------
{
  const list = new DrawList(256);
  const meshes = [];
  for (let i = 0; i < 200; i++) meshes.push(makeQuadMesh(`perf${i}`));
  const rnd = mulberry32(7);
  const grid = { cols: 240, rows: 90 };
  const terms = {};
  const M = new Float64Array(16);
  const planes = new Float64Array(24);
  const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 };
  projTerms(cam, grid, terms);
  shearProjection(terms, M);
  frustumPlanes(M, planes);

  function runOnce() {
    const t0 = process.hrtime.bigint();
    list.begin();
    for (let i = 0; i < 200; i++) {
      const it = list.push(meshes[i], DRAW_STATIC);
      const d = -5 - rnd() * 100;
      it.aabb.set([-1, d - 1, 0, 1, d + 1, 2]);
    }
    list.cull(planes);
    const t1 = process.hrtime.bigint();
    return Number(t1 - t0) / 1e6;
  }
  runOnce(); runOnce(); // warm up
  const runs = [runOnce(), runOnce(), runOnce()].sort((a, b) => a - b);
  const median = runs[1];
  console.log(`  DrawList begin/push/cull (200 items): median=${median.toFixed(4)} ms`);
  if (process.env.PERF_STRICT === '1') ok('200 items begin/push/cull <= 0.3 ms (median of 3)', median <= 0.3, `median=${median.toFixed(4)}ms`);
  else if (!(median <= 0.3)) console.log('PERF WARN: begin/push/cull > 0.3ms on this machine (set PERF_STRICT=1 to gate)');
}

// ---------------------------------------------------------------------------
// 5. Zero allocation: 1000 begin/push/cull frames (200 items each).
// ---------------------------------------------------------------------------
{
  const list = new DrawList(256);
  const meshes = [];
  for (let i = 0; i < 200; i++) meshes.push(makeQuadMesh(`zalloc${i}`));
  const grid = { cols: 240, rows: 90 };
  const terms = {};
  const M = new Float64Array(16);
  const planes = new Float64Array(24);
  const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 };
  projTerms(cam, grid, terms);
  shearProjection(terms, M);
  frustumPlanes(M, planes);
  let sink = 0;

  function frame() {
    list.begin();
    for (let i = 0; i < 200; i++) {
      const it = list.push(meshes[i], DRAW_STATIC);
      it.aabb.set([-1, -5 - i, 0, 1, -3 - i, 2]);
    }
    sink += list.cull(planes);
  }
  for (let i = 0; i < 50; i++) frame(); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('DrawList begin/push/cull: no significant heap growth over 1000 frames (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}


// ---------------------------------------------------------------------------
// 5. RE-06 addInstances: item fields, aabb union, whole-group cull, zero alloc.
// ---------------------------------------------------------------------------
{
  const mesh = makeQuadMesh('inst'); // bbox 0..1 x 0..1 x 0
  const ib = createInstanceBuffer(4);
  writeUnitInstance(ib, 0, 0, -20, 0, 0, 0x10000, 0);
  writeUnitInstance(ib, 1, 10, -30, 2, 37.5, 0x10001, 1);
  const parts = createInstanceParts();
  parts.count = 2;
  for (let p = 0; p < 2; p++) { const o = p * 12; parts.m[o] = 1; parts.m[o + 4] = 1; parts.m[o + 8] = 1; parts.m[o + 9] = p; parts.flags[p] = p === 0 ? 1 : 0; }
  const list = new DrawList(8);
  list.begin();
  ok('addInstances(count 0) adds nothing', list.addInstances(mesh, parts, ib, 0) === null && list.count === 0);
  let threw = false;
  try { list.addInstances(mesh, parts, ib, 5); } catch (e) { threw = true; }
  ok('addInstances over the buffer capacity throws', threw);
  const it = list.addInstances(mesh, parts, ib, 2);
  ok('item type/instBuf/instCount/objectId', it.type === DRAW_INSTANCED && it.instBuf === ib && it.instCount === 2 && it.objectId === 0 && it.mesh === mesh);
  ok('partMatrices/partFlags copied', it.partMatrices[9] === 0 && it.partMatrices[12 + 9] === 1 && it.partFlags[0] === 1 && it.partFlags[1] === 0);
  // R = max |corner| of bbox (0..1,0..1,0) under part 1 (t=(1,0,0)) = |(2,1,0)| = sqrt(5)
  const R = Math.sqrt(5);
  const a = it.aabb;
  ok('aabb = union of instance translations +- R', Math.abs(a[0] - (0 - R)) < 1e-9 && Math.abs(a[3] - (10 + R)) < 1e-9
    && Math.abs(a[1] - (-30 - R)) < 1e-9 && Math.abs(a[4] - (-20 + R)) < 1e-9 && Math.abs(a[2] - (0 - R)) < 1e-9 && Math.abs(a[5] - (2 + R)) < 1e-9, Array.from(a).join(','));
  ok('push after an instanced item resets instBuf/instCount', (() => { list.begin(); const q = list.push(mesh, DRAW_STATIC); return q.instBuf === null && q.instCount === 0; })());

  // cull: on-screen group kept, off-screen group dropped whole.
  const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 };
  const grid = { cols: 240, rows: 90 };
  const terms = {}; const M = new Float64Array(16); const planes = new Float64Array(24);
  projTerms(cam, grid, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  const ibBehind = createInstanceBuffer(2);
  writeUnitInstance(ibBehind, 0, 0, 30, 0, 0, 0x10000, 0);
  writeUnitInstance(ibBehind, 1, 2, 40, 0, 0, 0x10001, 0);
  list.begin();
  list.addInstances(mesh, parts, ib, 2);
  const gBehind = list.addInstances(mesh, parts, ibBehind, 2);
  const n = list.cull(planes);
  ok('cull keeps the ahead group and drops the behind group whole', n === 1 && list.items[0].instBuf === ib && gBehind !== null);

  // zero allocation
  const frame = () => { list.begin(); list.addInstances(mesh, parts, ib, 2); list.addInstances(mesh, parts, ibBehind, 2); list.cull(planes); };
  for (let i = 0; i < 50; i++) frame();
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('addInstances + cull: no significant heap growth over 1000 frames', grew < 64 * 1024, `grew=${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
