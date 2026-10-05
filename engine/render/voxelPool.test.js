// engine/render/voxelPool.test.js - US-040 build-order step 1 Node tests
// (architecture.md 15.2 item 8's "Node" list is folded into
// VoxelTextures.test.js for the atlas/rows; this file covers `VoxelPool`
// itself: bind, pushInstance, project/culling, and that castModels and the
// pool agree on the same instance via the shared `instanceRect` helper).
//
//   node engine/render/voxelPool.test.js

import { MAX_VOX_INSTANCES_MESH } from '../index.js';
import { GpuCellPipeline } from './gpu/GpuCellPipeline.js';
import { VoxelPool } from './voxelPool.js';
import { loadGolden, goldenFrame } from '../../tools/testing/mesh-golden.mjs';
const golden = loadGolden('voxelPool');
import { GBuffer, KIND_MODEL } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fake registry + material table (mirrors MaterialTable.bindShading's idFor shape) ----
const registry = {
  keys(kind) { return kind === 'model' ? ['bear', 'notVoxel'] : []; },
  model(key) { return key === 'bear' ? { voxel: quadruped12 } : { billboard: true }; },
};
let nextId = 1;
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, nextId++); return idMap.get(key); } };

// ---- bind() ----------------------------------------------------------------
const pool = new VoxelPool();
ok('default renderer is mesh with 48 slots', pool.renderer === 'mesh' && pool.cap === MAX_VOX_INSTANCES_MESH);
pool.renderer = 'dda'; // Existing 16-slot caster oracle fixture, until ME-19b.
pool.bind(registry, table);
ok('bind: packs voxel models only', pool.models.has('bear') && !pool.models.has('notVoxel'));
ok('bind: matIds resolved via table.idFor', pool.models.get('bear').matIds[1] > 0);

// ---- pushInstance / beginFrame ---------------------------------------------
pool.beginFrame();
ok('pushInstance: unknown model is a no-op, not a throw', (() => {
  try { pool.pushInstance('nope', 0, 0, 0, 0); return true; } catch { return false; }
})());
ok('pushInstance: unknown model queues nothing', pool._rawCount === 0);
pool.pushInstance('bear', 3, 0, 2, 0);
ok('pushInstance: queues one instance', pool._rawCount === 1);

for (let i = 0; i < 20; i++) pool.pushInstance('bear', 3, i, 2, 0);
ok('pushInstance: caps at MAX_VOX_INSTANCES (16)', pool._rawCount === 16);

// ---- project(): culling matches castModels' own AABB/rect logic ----------
const cam = { x: 0, y: 5, z: 1, yawDeg: 0, pitchDeg: 0 };
const rt = { cols: 40, rows: 20, pxCellW: 1, pxCellH: 2 };
pool.beginFrame();
pool.pushInstance('bear', 3, 0, 2, 0); // roughly ahead of the camera -> visible
pool.pushInstance('bear', 3, -500, 2, 0); // far behind the camera's forward plane at t<=0.05 gets full-screen, not culled; use a definitely-offscreen point instead
pool.project(cam, rt);
ok('project: visible instance survives culling', pool.list.length >= 1);
ok('project: stats.count matches list length', pool.stats.count === pool.list.length);
ok('project: each surviving instance has a compact slot', pool.list.every((inst, i) => inst.slot === i));

// A model instance placed at a point where castModels finds a real kind-8
// hit must survive the pool's own cull (same instanceRect call).
const fb = { rt, depth: new DepthBuffer(rt.cols, rt.rows).depth, gbuf: new GBuffer(rt.cols, rt.rows) };
fb.gbuf.beginFrame();
const list = [{ model: pool.models.get('bear'), x: 3, y: 0, z: 2, yawDeg: 0, clip: -1, frame: 0, tMs: 0 }];
const oracle = goldenFrame(golden.frames[0]);
fb.gbuf = oracle.gbuf;
let sawModel = false;
for (let i = 0; i < fb.gbuf.kind.length; i++) if (fb.gbuf.kind[i] === KIND_MODEL) { sawModel = true; break; }
ok('castModels actually draws the same instance the pool keeps (sanity check for the shared cull)', sawModel);

pool.beginFrame();
pool.pushInstance('bear', 3, 0, 2, 0);
pool.project(cam, rt);
ok('pool keeps the instance castModels draws (no cull disagreement)', pool.list.length === 1);

// ---- zero allocation on repeated pushInstance/project once warm -----------
pool.beginFrame();
for (let i = 0; i < 5; i++) pool.pushInstance('bear', 3, i, 2, 0);
pool.project(cam, rt); // warm up (grows raw[]/list[] slot objects)
if (global.gc) {
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < 200; f++) {
    pool.beginFrame();
    for (let i = 0; i < 5; i++) pool.pushInstance('bear', 3, i, 2, 0);
    pool.project(cam, rt);
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  ok('zero-alloc: 200 frames of push+project does not grow the heap materially', after - before < 200000, `${before} -> ${after}`);
} else {
  console.log('SKIP zero-alloc check (run with --expose-gc)');
}

// ---- US-041a (15.3 item 1): collect(world, cam) - entities, nearest-16 -----
{
  // Minimal fake World: only what `collect` reads (`renderVersion`,
  // `forEachEntity`) - a real `World` is exercised end to end in
  // engine/world/world.test.js's own voxel-component section.
  function fakeWorld(entities) {
    return {
      renderVersion: 1,
      forEachEntity(fn) { for (const [id, e] of entities) fn(e, id); },
    };
  }

  const poolC = new VoxelPool(); poolC.renderer = 'dda'; // Existing nearest-16 oracle fixture.
  poolC.bind(registry, table);
  const camC = { x: 0, y: 0, z: 0 };

  // 20 entities on the +y axis at y = 0..19 - the "nearest 16" must be
  // exactly y = 0..15 (indices 0-15), never the far ones.
  const ents = new Map();
  for (let i = 0; i < 20; i++) {
    ents.set(`e${i}`, { components: { voxel: { model: 'bear', anim: undefined, frame: 0, t: 0, playing: true } }, transform: { x: 0, y: i, z: 0, yawDeg: 0 } });
  }
  poolC.collect(fakeWorld(ents), camC);
  ok('collect: caps at MAX_VOX_INSTANCES (16) when more voxel entities exist', poolC._rawCount === 16, String(poolC._rawCount));
  const ys = [];
  for (let i = 0; i < poolC._rawCount; i++) ys.push(poolC.raw[i].y);
  ys.sort((a, b) => a - b);
  ok('collect: nearest 16 (to cam) win, farther ones dropped', JSON.stringify(ys) === JSON.stringify([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]), ys.join(','));

  // <= MAX_VOX_INSTANCES entities: all of them are queued (no culling needed).
  const fewEnts = new Map();
  for (let i = 0; i < 5; i++) fewEnts.set(`f${i}`, { components: { voxel: { model: 'bear', frame: 0, t: 0, playing: true } }, transform: { x: 0, y: 0, z: 0, yawDeg: 0 } });
  const poolFew = new VoxelPool();
  poolFew.bind(registry, table);
  poolFew.collect(fakeWorld(fewEnts), camC);
  ok('collect: <= 16 entities queues every one of them', poolFew._rawCount === 5);

  // A non-voxel entity (or a model with no `.voxel`) is skipped, not thrown.
  const mixedEnts = new Map([
    ['sprite1', { components: { sprite: { model: 'bear' } }, transform: { x: 0, y: 0, z: 0 } }],
    ['vox1', { components: { voxel: { model: 'bear', frame: 0, t: 0, playing: true } }, transform: { x: 1, y: 1, z: 1, yawDeg: 45 } }],
  ]);
  const poolMixed = new VoxelPool();
  poolMixed.bind(registry, table);
  poolMixed.collect(fakeWorld(mixedEnts), camC);
  ok('collect: only components.voxel entities are queued (sprite-only skipped)', poolMixed._rawCount === 1 && poolMixed.raw[0].x === 1);

  // Entity list is cached by renderVersion (same pattern as SpritePool.collect).
  const world2 = fakeWorld(fewEnts);
  poolFew.collect(world2, camC);
  const entsRef1 = poolFew._ents;
  poolFew.collect(world2, camC);
  ok('collect: entity ref list is reused while renderVersion is unchanged', poolFew._ents === entsRef1);

  // ---- zero allocation once warm (<=16 branch and nearest-16 branch both) ----
  // A STABLE world object (same renderVersion) across every call - the real
  // per-frame case (a fresh `fakeWorld(...)` every call would allocate in
  // the TEST HARNESS itself, not in VoxelPool, and measure the wrong thing).
  if (global.gc) {
    const worldStable = fakeWorld(ents);
    poolC.collect(worldStable, camC); // warm up (grows raw[]/_ents[] - all fixed size after this; _nearIdx/_nearDist are always fixed size)
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 300; f++) poolC.collect(worldStable, camC);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    ok('zero-alloc: 300 frames of collect() (nearest-16 path) does not grow the heap materially', after - before < 200000, `${before} -> ${after}`);
  } else {
    console.log('SKIP zero-alloc collect() check (run with --expose-gc)');
  }
}

// ---- ME-22 (28.12 item 4): meshOnly router - dda never receives a mesh-
// only model: no pool entry, no throw, exactly one console.warn per modelKey.
{
  const meshOnlyDef = { ...quadruped12, meshOnly: true };
  const registryMO = {
    keys(kind) { return kind === 'model' ? ['bear', 'bigbear'] : []; },
    model(key) { return key === 'bear' ? { voxel: quadruped12 } : { voxel: meshOnlyDef }; },
  };
  const poolMO = new VoxelPool();
  poolMO.bind(registryMO, table);
  ok('ME-22 bind: meshOnly model is still packed (mesh renderer needs it)', poolMO.models.has('bigbear'));
  ok('ME-22 bind: meshOnly model excluded from the DDA atlas index map', poolMO._modelIndexByKey.bigbear === undefined && poolMO._modelIndexByKey.bear === 0);

  const origWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  let threw = false;
  try {
    poolMO.beginFrame();
    poolMO.pushInstance('bigbear', 3, 0, 2, 0);
    poolMO.pushInstance('bear', 4, 0, 2, 0);
    poolMO.project(cam, rt, 'dda');
    poolMO.project(cam, rt, 'dda'); // second frame - still exactly one warn total (warnOnce)
  } catch (e) { threw = true; } finally { console.warn = origWarn; }
  ok('ME-22 router: dda renderer never throws for a meshOnly model', !threw);
  ok('ME-22 router: meshOnly instance never enters pool.list', poolMO.list.every((inst) => inst.modelKey !== 'bigbear'));
  ok('ME-22 router: the non-meshOnly instance still renders', poolMO.list.some((inst) => inst.modelKey === 'bear'));
  const meshOnlyWarnings = warnings.filter((w) => w.indexOf('bigbear') >= 0);
  ok('ME-22 router: exactly one console.warn for the meshOnly modelKey (warnOnce across frames)', meshOnlyWarnings.length === 1, JSON.stringify(warnings));

  // A mesh-renderer project() call DOES include the meshOnly instance.
  poolMO.beginFrame();
  poolMO.pushInstance('bigbear', 3, 0, 2, 0);
  poolMO.project(cam, rt, 'mesh');
  ok('ME-22 router: renderer "mesh" keeps the meshOnly instance', poolMO.list.some((inst) => inst.modelKey === 'bigbear'));
}

// ---- ME-15d: projectShadow slot records survive a shrinking prop count (zero alloc when it grows back) ----
{
  const sp = new VoxelPool();
  sp.bind(registry, table);
  sp.beginFrame();
  for (let i = 0; i < 6; i++) sp.pushInstance('bear', i, 0, 2, 0);
  sp.projectShadow();
  const recs = sp.shadowList.slice();
  ok('ME-15d projectShadow: 6 posed records', sp.shadowList.length === 6 && recs.every(Boolean));
  sp.beginFrame();
  for (let i = 0; i < 2; i++) sp.pushInstance('bear', i, 0, 2, 0);
  sp.projectShadow();
  ok('ME-15d projectShadow: view shrinks to 2', sp.shadowList.length === 2);
  sp.beginFrame();
  for (let i = 0; i < 6; i++) sp.pushInstance('bear', i, 0, 2, 0);
  sp.projectShadow();
  ok('ME-15d projectShadow: growing back reuses the same 6 records (no alloc)', sp.shadowList.length === 6 && recs.every((r, i) => sp.shadowList[i] === r));
}

// VOX-CAP-01: mesh selection, cap switches and constructor-owned storage.
{
  const p = new VoxelPool(); p.renderer = 'mesh'; p.bind(registry, table);
  const entities = Array.from({ length: 60 }, (_, i) => ({
    components: { voxel: { model: 'bear' } },
    transform: { x: 0, y: -(60 - i), z: 0, yawDeg: 0 },
  }));
  const w = { renderVersion: 1, forEachEntity(fn) { for (const e of entities) fn(e); } };
  const c = { x: 0, y: 1, z: 1, yawDeg: 0, pitchDeg: 0 };
  const refs = { raw: p.raw.slice(), slots: p._slots.slice(), shadows: p._shadowSlots.slice(), idx: p._nearIdx, dist: p._nearDist };
  ok('mesh cap is public and scratch is preallocated for 48', MAX_VOX_INSTANCES_MESH === 48 && p.cap === 48 && p.raw.length === 48 && p._slots.length === 48 && p._shadowSlots.length === 48);
  entities.length = 30;
  p.collect(w, c);
  ok('mesh queues all 30 in unchanged entity order below cap', p._rawCount === 30 && p.raw.slice(0, 30).every((r, i) => r.y === entities[i].transform.y));
  p.project(c, rt);
  ok('mesh projects all 30 visible props', p.list.length === 30 && p.stats.count === 30);
  ok('mesh shadows include all 30', p.projectShadow() === 30);
  for (let i = 30; i < 60; i++) entities.push({ components: { voxel: { model: 'bear' } }, transform: { x: 0, y: -(60 - i), z: 0 } });
  w.renderVersion++;
  const warnings = [], saveWarn = console.warn;
  console.warn = msg => warnings.push(msg);
  try { p.collect(w, c); p.collect(w, c); } finally { console.warn = saveWarn; }
  ok('60 entities choose nearest 48 in increasing distance order', p._rawCount === 48 && p.raw.every((r, i) => r.y === -(i + 1)));
  ok('overflow warning fires once and names 48', warnings.length === 1 && warnings[0].includes('(48)'));
  p.project(c, rt);
  ok('mesh projects and shadows the full 48 cap', p.list.length === 48 && p.projectShadow() === 48);
  // Switching back is covered by the existing frozen-path suites; here verify
  // renderer assignment updates only the cap, retaining every scratch record.
  p.renderer = 'dda';
  ok('renderer switch updates cap immediately', p.cap === 16);
  p.renderer = 'mesh';
  entities.length = 48; w.renderVersion++;
  p.collect(w, c); p.project(c, rt); p.projectShadow();
  let growth = 0;
  if (global.gc) {
    for (let trial = 0; trial < 3; trial++) {
      global.gc(); const before = process.memoryUsage().heapUsed;
      for (let f = 0; f < 1000; f++) {
        p.renderer = f & 1 ? 'dda' : 'mesh'; p.renderer = 'mesh';
        p.collect(w, c); p.project(c, rt); p.projectShadow();
      }
      global.gc(); const delta = process.memoryUsage().heapUsed - before;
      growth = trial === 0 ? delta : Math.min(growth, delta);
    }
    ok('1000 frames at 48 including renderer switches grow heap <64KB', growth < 65536, String(growth));
    console.log(`[VOX-CAP-01] heap growth ${growth} bytes`);
  }
  p.beginFrame(); p.pushInstance('bear', 0, -1, 0, 0); p.project(c, rt); p.projectShadow();
  p.collect(w, c); p.project(c, rt); p.projectShadow();
  ok('shrink/regrow and switches reuse all raw/project/shadow records', p.raw.every((r, i) => r === refs.raw[i]) && p.list.every((r, i) => r === refs.slots[i]) && p.shadowList.every((r, i) => r === refs.shadows[i]) && p._nearIdx === refs.idx && p._nearDist === refs.dist);
  p.beginFrame(); for (let i = 0; i < 48; i++) p.pushInstance('bear', 0, -i - 1, 0, 0);
  ok('mesh pushInstance accepts all 48', p._rawCount === 48);
  p.project(c, rt);
  let guarded = false;
  try { GpuCellPipeline.prototype._uploadVoxelInstances.call({}, p); } catch (e) { guarded = e.message.includes('exceeds DDA cap (16): 48'); }
  ok('GPU upload rejects mesh-sized list before writing texture scratch', guarded);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
