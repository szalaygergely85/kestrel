// engine/mesh/instances.test.js (RE-06, docs/architecture.md 28.6 "Node tests" 1).
// The instance/part split (I * P_p) must equal FORWARD(inst) of the one pose
// implementation (voxelPose.js) within 1e-9; buffer layout constants; the
// yawAligned bit; group registry -> DrawList; zero allocation.
// Run: node engine/mesh/instances.test.js  (re-spawns itself with --expose-gc)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VoxelPool } from '../render/voxelPool.js';
import { computeVoxelPose, FORWARD, cosSinDeg } from '../voxel/voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { DrawList, DRAW_INSTANCED } from './DrawList.js';
import { VoxelMeshCache } from './voxelMesh.js';
import {
  INSTANCE_STRIDE, INSTANCE_BYTES, INST_OBJECT_ID, INST_FLAGS, UNIT_OBJECT_BASE, MAX_INSTANCE_GROUPS,
  createInstanceBuffer, createInstanceParts, writeUnitInstance, computeGroupParts, InstanceGroups, groupRadius,
} from './instances.js';
import { frustumPlanes } from './culling.js';
import { makeOk } from '../test/assert.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/voxel_props.js';
import '../../design/models/voxel_tower.js';

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

const VM = globalThis.ASSETS.voxelModels;
const KEYS = ['lever', 'burner'];
const registry = { keys: (k) => (k === 'model' ? KEYS : []), model: (k) => ({ voxel: VM[k].voxel }) };
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
pool.bind(registry, table);

// ---- layout constants -----------------------------------------------------
ok('INSTANCE_STRIDE = 16 words = 64 B', INSTANCE_STRIDE === 16 && INSTANCE_BYTES === 64);
ok('objectId at word 12, flags at word 13', INST_OBJECT_ID === 12 && INST_FLAGS === 13);
{
  const ib = createInstanceBuffer(4);
  ok('instance buffer = 4 x 64 B, f32/u32 share memory', ib.f32.buffer === ib.u32.buffer && ib.f32.byteLength === 256 && ib.capacity === 4);
  writeUnitInstance(ib, 2, 1.5, -2.25, 3, 90, UNIT_OBJECT_BASE | 7, 5);
  const o = 2 * INSTANCE_STRIDE;
  ok('row0/row1/row2 at 90 deg are exact', ib.f32[o] === 0 && ib.f32[o + 1] === -1 && ib.f32[o + 3] === 1.5 && ib.f32[o + 4] === 1 && ib.f32[o + 5] === 0 && ib.f32[o + 7] === -2.25 && ib.f32[o + 10] === 1 && ib.f32[o + 11] === 3);
  ok('objectId word + team bits + aligned bit at 90 deg', ib.u32[o + 12] === (UNIT_OBJECT_BASE | 7) && ib.u32[o + 13] === (1 | (5 << 8)));
  writeUnitInstance(ib, 1, 0, 0, 0, 0, UNIT_OBJECT_BASE, 13); // architect RE-06 review: team masked to MAX_TEAMS (8)
  ok('team bits masked to 0..7', ((ib.u32[INSTANCE_STRIDE + 13] >>> 8) & 0xff) === (13 & 7));
  writeUnitInstance(ib, 0, 0, 0, 0, 37.5, 1, 0);
  ok('yawAligned bit clear at 37.5 deg', (ib.u32[13] & 1) === 0);
  for (const yaw of [0, 180, -90, 450, 270]) {
    writeUnitInstance(ib, 0, 0, 0, 0, yaw, 1, 0);
    ok(`aligned bit set at yaw ${yaw}`, (ib.u32[13] & 1) === 1);
  }
}

// ---- I * P_p == FORWARD(inst) within 1e-9 (200 random poses, every part of 2 models) ----
{
  const rnd = mulberry32(1234);
  const scratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
  const fwd = new Float64Array(MAX_VOX_PARTS * 12);
  const parts = createInstanceParts();
  let worst = 0, partsChecked = 0, alignedMismatch = 0;
  const cs = new Float64Array(2);
  for (let n = 0; n < 200; n++) {
    const key = KEYS[n & 1];
    const pm = pool.models.get(key);
    const yaw = n % 5 === 0 ? 90 * ((n / 5) % 8) : rnd() * 720 - 360;
    const x = rnd() * 400 - 200, y = rnd() * 400 - 200, z = rnd() * 10;
    const clip = pm.clips && pm.clips.length ? (n % pm.clips.length) : -1;
    const frame = 0, tMs = rnd() * 50;
    // Reference: the one pose implementation at the real instance.
    computeVoxelPose(pm, { x, y, z, yawDeg: yaw, clip, frame, tMs }, scratch);
    for (let i = 0; i < pm.partCount * 12; i++) fwd[i] = FORWARD[i];
    const refAligned = [];
    for (let p = 0; p < pm.partCount; p++) refAligned.push(scratch[p * PART_STRIDE + 12]);
    // Split: P_p at the identity instance.
    computeGroupParts(pm, { clip, frame, tMs }, parts);
    cosSinDeg(yaw, cs);
    const c = cs[0], s = cs[1];
    const instAligned = ((yaw % 90) + 90) % 90 === 0 ? 1 : 0;
    for (let p = 0; p < pm.partCount; p++) {
      const P = parts.m, o = p * 12;
      // I = [[c,-s,0,x],[s,c,0,y],[0,0,1,z]]
      const M = [
        c * P[o] - s * P[o + 3], c * P[o + 1] - s * P[o + 4], c * P[o + 2] - s * P[o + 5],
        s * P[o] + c * P[o + 3], s * P[o + 1] + c * P[o + 4], s * P[o + 2] + c * P[o + 5],
        P[o + 6], P[o + 7], P[o + 8],
        c * P[o + 9] - s * P[o + 10] + x, s * P[o + 9] + c * P[o + 10] + y, P[o + 11] + z,
      ];
      for (let k = 0; k < 12; k++) worst = Math.max(worst, Math.abs(M[k] - fwd[o + k]));
      if (((parts.flags[p] & 1) & instAligned) !== refAligned[p]) alignedMismatch++;
      partsChecked++;
    }
  }
  ok(`I * P_p == FORWARD(inst): max |diff| ${worst.toExponential(2)} over ${partsChecked} parts < 1e-9`, worst < 1e-9, String(worst));
  ok('aligned = part flag AND instance flag == voxelPose axisAligned', alignedMismatch === 0, String(alignedMismatch));
  ok('the lever has >= 2 parts', pool.models.get('lever').partCount >= 2);
}

// ---- writeUnitInstance rotation is orthonormal ------------------------------
{
  const ib = createInstanceBuffer(1);
  const rnd = mulberry32(99);
  let worst = 0;
  for (let n = 0; n < 100; n++) {
    writeUnitInstance(ib, 0, 0, 0, 0, rnd() * 360, 1, 0);
    const f = ib.f32;
    const a = [f[0], f[1], f[2], f[4], f[5], f[6], f[8], f[9], f[10]];
    for (let r = 0; r < 3; r++) {
      for (let q = 0; q < 3; q++) {
        let d = 0;
        for (let k = 0; k < 3; k++) d += a[r * 3 + k] * a[q * 3 + k];
        worst = Math.max(worst, Math.abs(d - (r === q ? 1 : 0)));
      }
    }
  }
  ok(`instance rotation orthonormal |A A^T - 1| < 1e-6 (${worst.toExponential(2)})`, worst < 1e-6);
}

// ---- registry -> DrawList ---------------------------------------------------
{
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('lever', 8);
  ok('group starts empty', g.count === 0 && g.modelKey === 'lever' && g.ib.capacity === 8);
  ok('drawIb[0]/[1] both allocated at group capacity (RE-15a point 3)', g.drawIb[0].capacity === 8 && g.drawIb[1].capacity === 8);
  const list = new DrawList(8);
  list.begin();
  groups.addToDrawList(list, cache, null, 1);
  ok('empty group adds no item', list.count === 0);
  for (let i = 0; i < 5; i++) writeUnitInstance(g.ib, i, i * 2, 10, 0, i * 30, UNIT_OBJECT_BASE | i, i % 3);
  g.count = 5;
  list.begin();
  groups.addToDrawList(list, cache, null, 2);
  const it = list.items[0];
  // RE-15a: with no planes (no cull) every instance survives into the compacted g.drawIb[0], not g.ib itself.
  ok('non-empty group adds one DRAW_INSTANCED item, drawn from the compacted scratch buffer', list.count === 1 && it.type === DRAW_INSTANCED && it.instBuf === g.drawIb[0] && it.instCount === 5);
  let bitEq = true;
  for (let w = 0; w < 5 * INSTANCE_STRIDE; w++) if (g.drawIb[0].u32[w] !== g.ib.u32[w]) bitEq = false;
  ok('compacted words are bit-equal to the uncompacted source (no cull)', bitEq);
  const mesh0 = it.mesh;
  list.begin();
  groups.addToDrawList(list, cache, null, 3);
  ok('item mesh = the cached voxel mesh (same object on a second frame)', list.items[0].mesh === mesh0);
  let threw = false;
  try { for (let i = 0; i < MAX_INSTANCE_GROUPS + 1; i++) groups.group('lever', 1); } catch (e) { threw = true; }
  ok(`more than ${MAX_INSTANCE_GROUPS} groups throws`, threw);
  groups.remove(g);
  ok('remove() drops the group', !groups.groups.includes(g));
}

// ---- RE-15a: per-instance cull + compaction + memo + stats -------------------
{
  // A simple box frustum [-5,5] x [-5,5] x [-1000,1000] (world space is "flat"
  // enough here - z barely matters), (a,b,c,d) s.t. a*x+b*y+c*z+d >= 0 = inside.
  const PL = new Float64Array([
    1, 0, 0, 5, /* left:   x >= -5 */
    -1, 0, 0, 5, /* right:  x <= 5 */
    0, 1, 0, 5, /* bottom: y >= -5 */
    0, -1, 0, 5, /* top:    y <= 5 */
    0, 0, 1, 1000, /* near */
    0, 0, -1, 1000, /* far */
  ]);

  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('lever', 8);
  const pm = pool.models.get('lever');
  const mesh = cache.get(pm, 'lever', pool.partNamesFor('lever'));
  computeGroupParts(pm, g.pose, g.parts);
  const R = groupRadius(mesh, g.parts);
  ok('groupRadius > 0 for the lever model', R > 0);

  // off-screen-only group -> 0 items, 0 drawn, all culled.
  {
    const list = new DrawList(4);
    for (let i = 0; i < 4; i++) writeUnitInstance(g.ib, i, 500 + i, 500, 0, 0, UNIT_OBJECT_BASE | i, 0);
    g.count = 4;
    list.begin();
    groups.addToDrawList(list, cache, PL, 10);
    ok('off-screen-only group: 0 draw items', list.count === 0);
    ok('off-screen-only group: stats.instances 0, instancesCulled 4', groups.stats.instances === 0 && groups.stats.instancesCulled === 4);
  }

  // mixed group: 2 inside, 1 far outside, 1 straddling the right plane (x=5) - survivors in game order, bit-equal.
  {
    const list = new DrawList(4);
    writeUnitInstance(g.ib, 0, -2, 0, 0, 0, UNIT_OBJECT_BASE | 0, 0); // inside
    writeUnitInstance(g.ib, 1, 900, 0, 0, 0, UNIT_OBJECT_BASE | 1, 0); // far outside
    writeUnitInstance(g.ib, 2, 1, 1, 0, 0, UNIT_OBJECT_BASE | 2, 0); // inside
    // Placed so its AABB [x-R, x+R] straddles x=5 (kept, never falsely culled - "conservative").
    writeUnitInstance(g.ib, 3, 5 - R * 0.5, 0, 0, 0, UNIT_OBJECT_BASE | 3, 0);
    g.count = 4;
    list.begin();
    groups.addToDrawList(list, cache, PL, 11);
    const it = list.items[0];
    ok('mixed group: 3 survivors (0, 2, 3), in game order', it.instCount === 3);
    let order = true, bitExact = true;
    const survivors = [0, 2, 3];
    for (let s = 0; s < 3; s++) {
      const srcO = survivors[s] * INSTANCE_STRIDE, dstO = s * INSTANCE_STRIDE;
      if (g.ib.f32[srcO + 3] !== it.instBuf.f32[dstO + 3]) order = false;
      for (let w = 0; w < INSTANCE_STRIDE; w++) if (g.ib.u32[srcO + w] !== it.instBuf.u32[dstO + w]) bitExact = false;
    }
    ok('mixed group: survivors in stable game order', order);
    ok('mixed group: survivor words bit-equal to the source (u32 copy)', bitExact);
    ok('mixed group: stats.instances 3, instancesCulled 1', groups.stats.instances === 3 && groups.stats.instancesCulled === 1);

    // Second call, SAME frameNo (gpucompare's GPU + JS-twin double call): corrupt g.ib first -
    // if addToDrawList recomputed, the corruption would show up in the result.
    const savedX = g.ib.f32[2 * INSTANCE_STRIDE + 3];
    g.ib.f32[2 * INSTANCE_STRIDE + 3] = 12345; // would move instance 2 outside the box if re-scanned
    const list2 = new DrawList(4);
    list2.begin();
    groups.addToDrawList(list2, cache, PL, 11); // same frameNo (11)
    ok('same-frameNo repeat: still 3 survivors (did not recompute against the corrupted source)', list2.items[0].instCount === 3);
    ok('same-frameNo repeat: stats unchanged (no double count)', groups.stats.instances === 3 && groups.stats.instancesCulled === 1);
    g.ib.f32[2 * INSTANCE_STRIDE + 3] = savedX;

    // A new frameNo recomputes (and now really drops the corrupted-then-restored instance 2's old position check - just verifying recompute happens).
    const list3 = new DrawList(4);
    list3.begin();
    groups.addToDrawList(list3, cache, PL, 12);
    ok('new frameNo: recomputes (3 survivors again, position restored)', list3.items[0].instCount === 3);
    ok('instancesLod1 stays 0 (RE-15c not implemented yet)', groups.stats.instancesLod1 === 0);
  }
}

// ---- RE-15a fixes (PC-B Q7 item 1b): omitted frameNo never memoizes ----------
// Two calls with NO frameNo argument, after moving an instance between them,
// must both reflect the moved position - `frameNo !== this._lastFrameNo` alone
// is false on two `undefined` calls in a row, so the fix needs an explicit
// `typeof frameNo === 'number'` memo gate.
{
  const PL = new Float64Array([
    1, 0, 0, 5, -1, 0, 0, 5, 0, 1, 0, 5, 0, -1, 0, 5, 0, 0, 1, 1000, 0, 0, -1, 1000,
  ]);
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('lever', 4);
  writeUnitInstance(g.ib, 0, -2, 0, 0, 0, UNIT_OBJECT_BASE | 0, 0); // inside
  g.count = 1;

  const list1 = new DrawList(4);
  list1.begin();
  groups.addToDrawList(list1, cache, PL, undefined); // no frameNo -> no memo
  ok('no-frameNo call 1: instance inside -> 1 survivor', list1.items[0].instCount === 1);
  const x1 = list1.items[0].instBuf.f32[3];
  ok('no-frameNo call 1: survivor at the original position', x1 === -2);

  // Move the instance far outside the frustum, then call again with no frameNo.
  writeUnitInstance(g.ib, 0, 900, 0, 0, 0, UNIT_OBJECT_BASE | 0, 0);
  const list2 = new DrawList(4);
  list2.begin();
  groups.addToDrawList(list2, cache, PL, undefined); // no frameNo again
  ok('no-frameNo call 2: did not reuse call 1\'s memo - instance now culled', list2.count === 0);

  // And moving it back inside is picked up on a third no-frameNo call.
  writeUnitInstance(g.ib, 0, 3, 0, 0, 0, UNIT_OBJECT_BASE | 0, 0);
  const list3 = new DrawList(4);
  list3.begin();
  groups.addToDrawList(list3, cache, PL, undefined);
  ok('no-frameNo call 3: reflects the instance moved back inside', list3.items[0].instCount === 1 && list3.items[0].instBuf.f32[3] === 3);
}

// ---- zero allocation: 1000 x (writeUnitInstance x 200 + group frame) ---------
// RE-15a: a real (encompassing) frustum + an incrementing frameNo, so every
// call actually runs the per-instance classifyAABB + u32-copy compaction
// (not a memoized no-op) - this is the hot path AC2's 0.1 ms/zero-alloc budget covers.
{
  const PL_ALL = new Float64Array([
    1, 0, 0, 1e6, -1, 0, 0, 1e6, 0, 1, 0, 1e6, 0, -1, 0, 1e6, 0, 0, 1, 1e6, 0, 0, -1, 1e6,
  ]);
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('burner', 200);
  const list = new DrawList(8);
  let frameNo = 0;
  const frame = () => {
    for (let i = 0; i < 200; i++) writeUnitInstance(g.ib, i, i, i * 0.5, 0, i * 7, UNIT_OBJECT_BASE | i, i & 3);
    g.count = 200;
    list.begin();
    groups.addToDrawList(list, cache, PL_ALL, ++frameNo);
  };
  for (let i = 0; i < 20; i++) frame();
  ok('zero-alloc warmup: all 200 survive the encompassing frustum', groups.stats.instances === 200 && groups.stats.instancesCulled === 0);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('zero-alloc: 1000 frames of 200 writeUnitInstance + cull/compact grow the heap < 64 KB', grew < 65536, `grew=${grew}`);

  // AC2 (28.13 budget): cull + compaction for 500 instances <= 0.1 ms JS (soft/informational -
  // CI machine speed varies; gated loosely at 5 ms/frame to catch gross regressions, not micro-noise).
  const g2 = groups.group('burner', 500);
  for (let i = 0; i < 500; i++) writeUnitInstance(g2.ib, i, i, i * 0.5, 0, i * 7, UNIT_OBJECT_BASE | i, i & 3);
  g2.count = 500;
  const list2 = new DrawList(2);
  for (let i = 0; i < 50; i++) { list2.begin(); groups.addToDrawList(list2, cache, PL_ALL, ++frameNo); } // warmup/JIT
  const t0 = performance.now();
  const N = 500;
  for (let i = 0; i < N; i++) { list2.begin(); groups.addToDrawList(list2, cache, PL_ALL, ++frameNo); }
  const perFrameMs = (performance.now() - t0) / N;
  console.log(`[RE-15a] cull+compact (burner x500, encompassing frustum): ${perFrameMs.toFixed(4)} ms/frame (target <= 0.1 ms)`);
  ok(`cull+compact 500 instances well under budget (<= 5 ms/frame soft gate, measured ${perFrameMs.toFixed(4)})`, perFrameMs <= 5);
}

// ---- RE-15c: LOD selection + hysteresis + 2 draw items per group --------------
{
  const M = new Float64Array(16); // looks along +y, up = +z, f = 1 (45-deg half fov)
  M[0] = 1; M[9] = 1; M[6] = 1.002; M[14] = -0.2; M[7] = 1; // x_clip=x, y_clip=z, z_clip=1.002y-0.2, w=y
  const PLV = frustumPlanes(M, new Float64Array(24));
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('lever', 8);
  const pm = pool.models.get('lever');
  const names = pool.partNamesFor('lever');
  computeGroupParts(pm, g.pose, g.parts);
  const R = Math.max(groupRadius(cache.get(pm, 'lever', names), g.parts), groupRadius(cache.get(pm, 'lever', names, 1), g.parts));
  const rows = 100;
  const dAt = (cells) => R * rows / cells; // distance at which projected size = `cells`
  const put = (i, y) => writeUnitInstance(g.ib, i, 0, y, 0, 0, UNIT_OBJECT_BASE | i, 0);
  const run = (fn) => { const l = new DrawList(8); l.begin(); groups.addToDrawList(l, cache, PLV, ++fnoLod, M, rows); return l; };
  let fnoLod = 0;
  // LOD off (default): everything LOD0, one item
  put(0, dAt(2)); put(1, dAt(30)); g.count = 2;
  let l = run();
  ok('lodCells 0: 1 item, 0 lod1', l.count === 1 && groups.stats.instancesLod1 === 0 && g.drawCount[0] === 2);
  g.lodCells = 8;
  l = run();
  ok('lodCells 8: far -> LOD1, near -> LOD0 = 2 items', l.count === 2 && g.drawCount[0] === 1 && g.drawCount[1] === 1 && groups.stats.instancesLod1 === 1);
  ok('items: LOD0 mesh then LOD1 mesh, different meshes, LOD1 fewer quads',
    l.items[0].mesh !== l.items[1].mesh && l.items[1].mesh.id.endsWith('@1') && l.items[1].mesh.triCount <= l.items[0].mesh.triCount);
  ok('each item holds its own bucket', l.items[0].instBuf === g.drawIb[0] && l.items[1].instBuf === g.drawIb[1] && l.items[0].instCount === 1);
  ok('g.ib never written (instance 0 still near, id intact)', g.ib.u32[12] === (UNIT_OBJECT_BASE | 0));
  // hysteresis: inside [7.2, 8.8] keeps previous
  put(0, dAt(8.4)); put(1, dAt(8.4)); g.count = 2; // inst0 was LOD1, inst1 was LOD0
  l = run();
  ok('hysteresis band keeps previous LOD per slot', g.lodPrev[0] === 1 && g.lodPrev[1] === 0 && g.drawCount[0] === 1 && g.drawCount[1] === 1);
  put(0, dAt(9)); put(1, dAt(7)); // cross both thresholds
  l = run();
  ok('crossing 0.9/1.1 flips LOD', g.lodPrev[0] === 0 && g.lodPrev[1] === 1);
  // same frameNo: no advance
  put(0, dAt(8.4)); put(1, dAt(8.4));
  const l2 = new DrawList(8); l2.begin();
  groups.addToDrawList(l2, cache, PLV, fnoLod, M, rows); // same frameNo as last run -> memo
  ok('second same-frameNo call keeps lodPrev and re-pushes cached items', g.lodPrev[0] === 0 && g.lodPrev[1] === 1 && l2.count === 2);
  // culled + lod bookkeeping: drawn + culled = count
  put(2, dAt(30)); put(3, -50); g.count = 4; // 3 is behind the eye
  l = run();
  ok('drawn + culled = count', groups.stats.instances + groups.stats.instancesCulled === 4 && groups.stats.instancesCulled >= 1);
  // survivors bit-equal words
  ok('LOD bucket words bit-equal to source', (() => {
    for (let b = 0; b < 2; b++) for (let j = 0; j < g.drawCount[b]; j++) {
      const oid = g.drawIb[b].u32[j * INSTANCE_STRIDE + 12];
      const si = oid & 0xffff;
      for (let c = 0; c < INSTANCE_STRIDE; c++) if (g.drawIb[b].u32[j * INSTANCE_STRIDE + c] !== g.ib.u32[si * INSTANCE_STRIDE + c]) return false;
    }
    return true;
  })());
  // zero alloc
  g.count = 4; l = new DrawList(8);
  for (let i = 0; i < 50; i++) { l.begin(); groups.addToDrawList(l, cache, PLV, ++fnoLod, M, rows); }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) { l.begin(); groups.addToDrawList(l, cache, PLV, ++fnoLod, M, rows); }
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('LOD zero-alloc: 1000 frames grow heap < 64 KB', grew < 65536, `grew=${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
