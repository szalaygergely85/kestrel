// engine/voxel/partRot.test.js - TALK-E1 (architecture.md 38.28 item 7): optional extra part rotation ("jaw").
//   node engine/voxel/partRot.test.js
import { packVoxelModel } from './voxelPack.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from './VoxelModel.js';
import { VoxelPool } from '../render/voxelPool.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// root -> head -> jaw chain, plus an unrelated arm. One clip rotates the arm only.
const def = {
  version: 1, cellM: 0.1, size: [4, 1, 1], anchor: [0, 0, 0], mats: { s: 'stone' },
  layers: [['ssss']],
  parts: {
    root: { box: [0, 0, 0, 1, 1, 1], pivot: [0, 0, 0] },
    head: { box: [1, 0, 0, 2, 1, 1], pivot: [1, 0, 0], parent: 'root' },
    jaw: { box: [2, 0, 0, 3, 1, 1], pivot: [2, 0, 0.5], parent: 'head' },
    arm: { box: [3, 0, 0, 4, 1, 1], pivot: [3, 0, 0], parent: 'root' },
  },
  animations: { wave: { fps: 10, loop: true, frames: [{ arm: { rot: [0, 30, 0] } }, { arm: { rot: [0, 40, 0] } }] } },
};
const pm = packVoxelModel(def, () => 1);
ok('pm.partIndex maps names, frozen', pm.partIndex.jaw === 2 && pm.partIndex.arm === 3 && Object.isFrozen(pm.partIndex));

const out = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const fwd = (inst) => { computeVoxelPose(pm, inst, out); return [Float64Array.from(FORWARD.subarray(0, 48)), Float64Array.from(out.subarray(0, 4 * PART_STRIDE))]; };
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const base = (extra) => Object.assign({ x: 1, y: 2, z: 3, yawDeg: 20, clip: -1, frame: 0, tMs: 0, scale: 1 }, extra);

for (const clip of [-1, 0]) {
  const ref = fwd(base({ clip, frame: 1, tMs: 30 }));
  ok(`clip ${clip}: no add fields is the reference`, same(ref[0], fwd(base({ clip, frame: 1, tMs: 30 }))[0]));
  ok(`clip ${clip}: addPart -1 byte-identical`, same(ref[0], fwd(base({ clip, frame: 1, tMs: 30, addPart: -1, addRx: 9, addRy: 9, addRz: 9 }))[0]) && same(ref[1], fwd(base({ clip, frame: 1, tMs: 30, addPart: -1 }))[1]));
  ok(`clip ${clip}: addPart out of range ignored`, same(ref[0], fwd(base({ clip, frame: 1, tMs: 30, addPart: 4, addRx: 9, addRy: 0, addRz: 0 }))[0]));
  ok(`clip ${clip}: zero rotation byte-identical`, same(ref[0], fwd(base({ clip, frame: 1, tMs: 30, addPart: 2, addRx: 0, addRy: 0, addRz: 0 }))[0]));
}
{
  const ref = fwd(base());
  const rot = fwd(base({ addPart: 2, addRx: 0, addRy: 18, addRz: 0 }));
  const diff = (p) => { for (let c = 0; c < 12; c++) if (ref[0][p * 12 + c] !== rot[0][p * 12 + c]) return true; return false; };
  ok('rest + jaw 18 deg: only the jaw changes (root/head/arm untouched)', !diff(0) && !diff(1) && diff(2) && !diff(3));
  // a child of the rotated part follows: add a rotation to head, jaw (its child) moves too, arm does not
  const head = fwd(base({ addPart: 1, addRx: 0, addRy: 18, addRz: 0 }));
  const d2 = (p) => { for (let c = 0; c < 12; c++) if (ref[0][p * 12 + c] !== head[0][p * 12 + c]) return true; return false; };
  ok('head rotation carries its child jaw, not the arm', !d2(0) && d2(1) && d2(2) && !d2(3));
  // added on top of the clip rotation: arm clip 30 + 10 == clip with 40 at the same frame/alpha-0
  const a = fwd(base({ clip: 0, frame: 0, tMs: 0, addPart: 3, addRx: 0, addRy: 10, addRz: 0 }));
  const b = fwd(base({ clip: 0, frame: 1, tMs: 0 }));
  ok('adds on top of the clip rotation (30 + 10 == 40)', a[0].slice(36, 48).every((v, i) => Math.abs(v - b[0][36 + i]) < 1e-12));
}

// pool path: entity partRot reaches the posed slot, and omission leaves addPart -1
{
  const pool = new VoxelPool();
  pool.models.set('m', pm);
  const ent = (voxel) => ({ id: 1, transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } });
  const pr = { part: 'jaw', rx: 0, ry: 18, rz: 0 };
  pool._rawCount = 0; pool._queueEntity(ent({ model: 'm', partRot: pr }));
  ok('_queueEntity resolves partRot to part index + angles', pool.raw[0].addPart === 2 && pool.raw[0].addRy === 18);
  pool._rawCount = 0; pool._queueEntity(ent({ model: 'm' }));
  ok('_queueEntity without partRot -> addPart -1', pool.raw[0].addPart === -1);
  pool._rawCount = 0; pool._queueEntity(ent({ model: 'm', partRot: { part: 'nope', rx: 1 } }));
  ok('unknown part name -> addPart -1', pool.raw[0].addPart === -1);
  pool._rawCount = 0; pool._queueEntity(ent({ model: 'm', partRot: pr }));
  pool.projectShadow();
  ok('projectShadow copies the add fields', pool.shadowList[0].addPart === 2 && pool.shadowList[0].addRy === 18);
  // mutate in place: no replacement needed
  pr.ry = 5; pool._rawCount = 0; pool._queueEntity(ent({ model: 'm', partRot: pr }));
  ok('in-place mutation of partRot is picked up', pool.raw[0].addRy === 5);
}

// zero allocation: 10k poses with partRot
{
  const inst = base({ clip: 0, frame: 1, tMs: 10, addPart: 2, addRx: 0, addRy: 0, addRz: 0 });
  for (let i = 0; i < 2000; i++) { inst.addRy = i % 18; computeVoxelPose(pm, inst, out); }
  globalThis.gc && globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) { inst.addRy = i % 18; computeVoxelPose(pm, inst, out); }
  if (globalThis.gc) globalThis.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok(`10k poses with partRot: heap growth ${grew} B < 200 KB`, !globalThis.gc || grew < 200000);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
