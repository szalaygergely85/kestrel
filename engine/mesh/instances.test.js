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
  createInstanceBuffer, createInstanceParts, writeUnitInstance, computeGroupParts, InstanceGroups,
} from './instances.js';
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
  const list = new DrawList(8);
  list.begin();
  groups.addToDrawList(list, cache);
  ok('empty group adds no item', list.count === 0);
  for (let i = 0; i < 5; i++) writeUnitInstance(g.ib, i, i * 2, 10, 0, i * 30, UNIT_OBJECT_BASE | i, i % 3);
  g.count = 5;
  list.begin();
  groups.addToDrawList(list, cache);
  const it = list.items[0];
  ok('non-empty group adds one DRAW_INSTANCED item', list.count === 1 && it.type === DRAW_INSTANCED && it.instBuf === g.ib && it.instCount === 5);
  const mesh0 = it.mesh;
  list.begin();
  groups.addToDrawList(list, cache);
  ok('item mesh = the cached voxel mesh (same object on a second frame)', list.items[0].mesh === mesh0);
  let threw = false;
  try { for (let i = 0; i < MAX_INSTANCE_GROUPS + 1; i++) groups.group('lever', 1); } catch (e) { threw = true; }
  ok(`more than ${MAX_INSTANCE_GROUPS} groups throws`, threw);
  groups.remove(g);
  ok('remove() drops the group', !groups.groups.includes(g));
}

// ---- zero allocation: 1000 x (writeUnitInstance x 200 + group frame) ---------
{
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const cache = new VoxelMeshCache();
  const g = groups.group('burner', 200);
  const list = new DrawList(8);
  const frame = () => {
    for (let i = 0; i < 200; i++) writeUnitInstance(g.ib, i, i, i * 0.5, 0, i * 7, UNIT_OBJECT_BASE | i, i & 3);
    g.count = 200;
    list.begin();
    groups.addToDrawList(list, cache);
  };
  for (let i = 0; i < 20; i++) frame();
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('zero-alloc: 1000 frames of 200 writeUnitInstance + group->DrawList grow the heap < 64 KB', grew < 65536, `grew=${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
