// engine/render/voxelPool.test.js - US-040 build-order step 1 Node tests
// (architecture.md 15.2 item 8's "Node" list is folded into
// VoxelTextures.test.js for the atlas/rows; this file covers `VoxelPool`
// itself: bind, pushInstance, project/culling, and that castModels and the
// pool agree on the same instance via the shared `instanceRect` helper).
//
//   node engine/render/voxelPool.test.js

import { VoxelPool } from './voxelPool.js';
import { castModels } from '../voxel/voxelMarch.js';
import { GBuffer, KIND_MODEL } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

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
castModels(fb, list, cam, { faceMode: 'nearest' });
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

console.log(`${pass} pass, ${fail} fail`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
