// Tests for tools/bb-import.mjs (OWN-REQ-010). Plain Node script, no
// framework (matches tools/vox-import.test.mjs / engine/physics/physics.test.js) -
// run directly: node tools/bb-import.test.mjs
//
// The `.bbmodel` fixture below is a tiny hand-written object (2 bones, 1
// looping clip, 1 one-shot clip) - not a captured real Blockbench export
// (see bb-import.mjs's own header for the documented format assumptions).
// The pose numbers this file checks against `computeVoxelPose` are derived
// BY HAND from the engine's own published formulas (voxelPose.js `setRx`/
// `setRy`/`setRz`/`computeVoxelPose`) - see the comments beside each
// expected value.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertPivot, convertPos, convertRot, collectBones, buildClip, mergeBBModel, runCli } from './bb-import.mjs';
// tools/ may import only engine/index.js (check-deps rule 1); `computeVoxelPose`
// itself is engine-internal (not re-exported there - only castModels/VoxelPool
// are the public voxel-render API), so the "plays identically in
// computeVoxelPose" part of this story's AC is verified below by a LOCAL
// reimplementation of its published formula (architecture.md 15.1 / this
// project's engine/voxel/voxelPose.js `setRx`/`setRy`/`setRz`/
// `computeVoxelPose` - read in full while building this tool, duplicated
// here only because it cannot be imported), applied to the real packed
// clip data that `validateVoxelModel`/`packVoxelModel` (both public) build
// from bb-import's own output. See `handComputeForward` below.
import { validateVoxelModel, packVoxelModel } from '../engine/index.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e.stack || e.message);
    process.exitCode = 1;
  }
}

function closeTo(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !~ ${b} (eps ${eps})`);
}
function vecClose(a, b, eps, msg) {
  for (let i = 0; i < b.length; i++) closeTo(a[i], b[i], eps, `${msg}[${i}]`);
}

// ---- fixtures --------------------------------------------------------------

const CELL_M = 0.1; // 1 voxel = 0.1 m, so 1 "Blockbench block" (16 px) = 1.6 voxel units

// Target VoxelModelDef: 2 parts, `base` (root, z0..2) and `arm` (child, z2..4),
// covering the whole 4x4x4 grid so validateVoxelModel's orphan-voxel rule
// (VoxelModel.js rule 5) is satisfied.
function makeTargetDef() {
  const row = 'aaaa';
  const layer = [row, row, row, row];
  return {
    version: 1,
    cellM: CELL_M,
    size: [4, 4, 4],
    anchor: [2, 2, 0],
    mats: { a: 'stone' },
    layers: [layer, layer, layer, layer],
    parts: {
      base: { box: [0, 0, 0, 4, 4, 2], pivot: [2, 2, 0] },
      arm: { box: [0, 0, 2, 4, 4, 4], pivot: [2, 2, 2], parent: 'base' },
    },
  };
}

// Blockbench origins chosen so px/16/cellM comes out exact: 16*cellM = 1.6.
// base pivot [2,2,0] (voxel units) -> bb origin [x=2*1.6, y(up)=0*1.6, z(south)=2*1.6] = [3.2, 0, 3.2]
// arm  pivot [2,2,2] (voxel units) -> bb origin [2*1.6, 2*1.6, 2*1.6] = [3.2, 3.2, 3.2]
function makeBBModel() {
  return {
    meta: { format_version: '4.5' },
    name: 'fixture',
    outliner: [
      {
        name: 'base',
        origin: [3.2, 0, 3.2],
        rotation: [0, 0, 0],
        children: [
          'elem-uuid-1', // a cube element - not a bone, must be skipped
          {
            name: 'arm',
            origin: [3.2, 3.2, 3.2],
            rotation: [0, 0, 0],
            children: ['elem-uuid-2'],
          },
        ],
      },
    ],
    animations: [
      {
        name: 'swing',
        loop: 'loop',
        length: 1.0,
        animators: {
          'anim-arm': {
            name: 'arm',
            keyframes: [
              { channel: 'rotation', time: 0, interpolation: 'linear', data_points: [{ x: 0, y: 0, z: 0 }] },
              { channel: 'rotation', time: 0.5, interpolation: 'linear', data_points: [{ x: 0, y: 90, z: 0 }] },
            ],
          },
          'anim-fx': {
            name: 'effects',
            type: 'effect',
            keyframes: [
              { channel: 'timeline', time: 0.5, data_points: [{ script: 'clunk' }] },
            ],
          },
        },
      },
      {
        name: 'wave',
        loop: 'once',
        length: 0.3,
        animators: {
          'anim-base': {
            name: 'base',
            keyframes: [
              { channel: 'rotation', time: 0, data_points: [{ x: 0, y: 0, z: 0 }] },
              { channel: 'rotation', time: 0.3, data_points: [{ x: 45, y: 0, z: 0 }] },
            ],
          },
        },
      },
    ],
  };
}

// ---- unit conversion --------------------------------------------------------

test('convertPivot: axis swap (bbY<->ourZ, bbZ<->ourY), px/16/cellM scale', () => {
  vecClose(convertPivot([3.2, 0, 3.2], CELL_M, [0, 0, 0]), [2, 2, 0], 1e-9, 'base pivot');
  vecClose(convertPivot([3.2, 3.2, 3.2], CELL_M, [0, 0, 0]), [2, 2, 2], 1e-9, 'arm pivot');
});

test('convertPivot: --origin offset is added in Blockbench px before scaling', () => {
  vecClose(convertPivot([0, 0, 0], CELL_M, [1.6, 1.6, 1.6]), [1, 1, 1], 1e-9, 'offset pivot');
});

test('convertPos: same axis swap, no offset', () => {
  vecClose(convertPos([1.6, 3.2, 4.8], CELL_M), [1, 3, 2], 1e-9, 'pos');
});

test('convertRot: every component negates (Y/Z swap is orientation-reversing)', () => {
  vecClose(convertRot([10, 20, 30]), [-10, -30, -20], 1e-9, 'rot');
  vecClose(convertRot([0, 90, 0]), [0, 0, -90], 1e-9, 'yaw-only');
  vecClose(convertRot([45, 0, 0]), [-45, 0, 0], 1e-9, 'roll-only');
});

test('convertRot: wraps into (-180, 180]', () => {
  // ourRotZ = -bbRotY = -(-190) = 190 -> wraps to -170
  vecClose(convertRot([0, -190, 0]), [0, 0, -170], 1e-9, 'wrap');
});

// ---- outliner walk ----------------------------------------------------------

test('collectBones: walks nested groups, skips element-uuid leaves', () => {
  const bb = makeBBModel();
  const bones = collectBones(bb.outliner);
  assert.strictEqual(bones.length, 2);
  assert.strictEqual(bones[0].name, 'base');
  assert.strictEqual(bones[0].parent, undefined);
  assert.strictEqual(bones[1].name, 'arm');
  assert.strictEqual(bones[1].parent, 'base');
});

// ---- clip building ----------------------------------------------------------

test('buildClip: looping clip samples at keyframe-time union, converts rot, builds the event', () => {
  const bb = makeBBModel();
  const clip = buildClip(bb.animations[0], ['base', 'arm'], CELL_M);
  assert.strictEqual(clip.loop, true);
  assert.strictEqual(clip.interp, 'linear');
  assert.deepStrictEqual(clip.durations, [500, 500]); // t=[0,500]ms, length 1000ms -> tail = 1000-500
  assert.deepStrictEqual(clip.frames[0], {}); // all-zero pose omitted
  assert.ok(!clip.frames[1].base);
  vecClose(clip.frames[1].arm.rot, [0, 0, -90], 1e-9, 'swing frame1 arm.rot');
  assert.ok(!clip.frames[1].arm.pos);
  assert.deepStrictEqual(clip.events, { clunk: [1] });
});

test('buildClip: one-shot clip holds a positive tail duration', () => {
  const bb = makeBBModel();
  const clip = buildClip(bb.animations[1], ['base', 'arm'], CELL_M);
  assert.strictEqual(clip.loop, false);
  assert.deepStrictEqual(clip.durations, [300, 1]); // length 300ms == last keyframe time -> tail clamped to 1ms, not 0
  vecClose(clip.frames[1].base.rot, [-45, 0, 0], 1e-9, 'wave frame1 base.rot');
  assert.strictEqual(clip.events, undefined);
});

// ---- merge + unknown-bone / rest-rotation errors ----------------------------

test('mergeBBModel: unknown bone name throws a clear, non-crashing error', () => {
  const target = makeTargetDef();
  const bb = makeBBModel();
  bb.outliner[0].children.push({ name: 'tail', origin: [0, 0, 0], rotation: [0, 0, 0], children: [] });
  assert.throws(() => mergeBBModel(bb, target, {}), /tail.*Known parts: base, arm|do not match any part/s);
});

test('mergeBBModel: a non-zero bone rest rotation throws (ambiguous bind pose)', () => {
  const target = makeTargetDef();
  const bb = makeBBModel();
  bb.outliner[0].rotation = [0, 45, 0];
  assert.throws(() => mergeBBModel(bb, target, {}), /rest rotation/);
});

test('mergeBBModel: parts pivot/parent updated, clips added, box/mats/layers untouched, validates clean', () => {
  const target = makeTargetDef();
  const bb = makeBBModel();
  const merged = mergeBBModel(bb, target, {});
  vecClose(merged.parts.base.pivot, [2, 2, 0], 1e-9, 'merged base pivot');
  assert.strictEqual(merged.parts.base.parent, undefined);
  vecClose(merged.parts.arm.pivot, [2, 2, 2], 1e-9, 'merged arm pivot');
  assert.strictEqual(merged.parts.arm.parent, 'base');
  assert.deepStrictEqual(merged.parts.base.box, [0, 0, 0, 4, 4, 2]);
  assert.deepStrictEqual(merged.parts.arm.box, [0, 0, 2, 4, 4, 4]);
  assert.deepStrictEqual(merged.mats, { a: 'stone' });
  assert.deepStrictEqual(merged.layers, target.layers);
  assert.ok(merged.animations.swing);
  assert.ok(merged.animations.wave);
  const { errors } = validateVoxelModel(merged);
  assert.deepStrictEqual(errors, []);
});

// ---- end-to-end: computeVoxelPose sample-time playback, hand-computed -----
//
// `handComputeForward` below is a line-for-line port of the DOCUMENTED,
// normative pose formula (architecture.md 15.1's "Transforms"; this
// project's own engine/voxel/voxelPose.js `setRx`/`setRy`/`setRz`/
// `computeVoxelPose`) - duplicated here (not imported: tools/ may import
// only engine/index.js per check-deps, and computeVoxelPose is not part of
// that public surface) so this test can play the REAL packed clip data
// bb-import produced through it, per this story's AC ("plays identically in
// computeVoxelPose (sample times)"). PART_STRIDE=16 (pivot at offset 6..8,
// parentIdx at offset 9) is VoxelModel.js's own published, stable constant.
//
//   Rx(t)=[[1,0,0],[0,c,-s],[0,s,c]]  Ry(t)=[[c,0,s],[0,1,0],[-s,0,c]]  Rz(t)=[[c,-s,0],[s,c,0],[0,0,1]]
//   Rrot = Rz(rz)*Ry(ry)*Rx(rx)
//   root part:  Ak=Rrot;              bk = pivot+pos-Rrot*pivot
//   child part: Ak=Ak_parent*Rrot;    bk = Ak_parent*(pivot+pos-Rrot*pivot) + bk_parent
//   Aw = cellM*Rz(yawDeg); bw = inst.xyz - Aw*anchor
//   forward (world = Aw_k*local + bw_k): Aw_k = Aw*Ak; bw_k = Aw*bk + bw
const PART_STRIDE = 16;
function mat3(a00, a01, a02, a10, a11, a12, a20, a21, a22) { return [a00, a01, a02, a10, a11, a12, a20, a21, a22]; }
function setRx(t) { const c = Math.cos((t * Math.PI) / 180), s = Math.sin((t * Math.PI) / 180); return mat3(1, 0, 0, 0, c, -s, 0, s, c); }
function setRy(t) { const c = Math.cos((t * Math.PI) / 180), s = Math.sin((t * Math.PI) / 180); return mat3(c, 0, s, 0, 1, 0, -s, 0, c); }
function setRz(t) { const c = Math.cos((t * Math.PI) / 180), s = Math.sin((t * Math.PI) / 180); return mat3(c, -s, 0, s, c, 0, 0, 0, 1); }
function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}
function mulVec3(a, v) { return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]]; }
function addVec3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subVec3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scaleMat3(a, k) { return a.map((v) => v * k); }

/** Returns { A: number[9], b: number[3] } (world = A*local + b) for every
 * part of `pm`, at `clipName`/`frame` (frame boundary, tMs=0), `yawDeg`,
 * `instXYZ`. `pm` is the real object `packVoxelModel` (engine/index.js)
 * returns for a merged model. */
function handComputeForward(pm, clipName, frame, yawDeg, instXYZ) {
  const clip = pm.clips[pm.clipIndex[clipName]];
  const Aw = scaleMat3(setRz(yawDeg), pm.cellM);
  const bw = subVec3(instXYZ, mulVec3(Aw, Array.from(pm.anchor)));
  const out = [];
  for (let p = 0; p < pm.partCount; p++) {
    const base = p * PART_STRIDE;
    const pivot = [pm.parts[base + 6], pm.parts[base + 7], pm.parts[base + 8]];
    const parentIdx = pm.parts[base + 9];
    const kbase = frame * pm.partCount * 6 + p * 6;
    const rot = [clip.keys[kbase], clip.keys[kbase + 1], clip.keys[kbase + 2]];
    const pos = [clip.keys[kbase + 3], clip.keys[kbase + 4], clip.keys[kbase + 5]];
    const Rrot = mul3(setRz(rot[2]), mul3(setRy(rot[1]), setRx(rot[0])));
    const rv = mulVec3(Rrot, pivot);
    const l = subVec3(addVec3(pivot, pos), rv);
    let Ak, bk;
    if (parentIdx < 0) { Ak = Rrot; bk = l; }
    else { Ak = mul3(out[parentIdx].Ak, Rrot); bk = addVec3(mulVec3(out[parentIdx].Ak, l), out[parentIdx].bk); }
    out.push({ Ak, bk, A: mul3(Aw, Ak), b: addVec3(mulVec3(Aw, bk), bw) });
  }
  return out;
}

test('end-to-end: "swing" clip frame 1 (arm rotated -90 about Z) matches the hand-computed forward pose', () => {
  const target = makeTargetDef();
  const bb = makeBBModel();
  const merged = mergeBBModel(bb, target, {});
  const pm = packVoxelModel(merged, () => 1);
  const forward = handComputeForward(pm, 'swing', 1, 0, [0, 0, 0]);

  // base does not animate in 'swing' -> rest pose: Ak=I, bk=[0,0,0] (pivot
  // cancels exactly when rot=0), A=cellM*I, b=bw=-cellM*anchor=[-0.2,-0.2,0].
  vecClose(forward[0].A, [0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1], 1e-9, 'base A');
  vecClose(forward[0].b, [-0.2, -0.2, 0], 1e-9, 'base b');

  // arm: rot=[0,0,-90] -> Rrot=Rz(-90)=[[0,1,0],[-1,0,0],[0,0,1]]. pivot=[2,2,2].
  // rv=Rrot*pivot=[2,-2,2]; l=pivot-rv=[0,4,0]. Ak=Rrot (parent Ak=I).
  // A=cellM*Rrot=[[0,0.1,0],[-0.1,0,0],[0,0,0.1]]. bk=l=[0,4,0], b=cellM*bk+bw=[-0.2,0.2,0].
  vecClose(forward[1].A, [0, 0.1, 0, -0.1, 0, 0, 0, 0, 0.1], 1e-9, 'arm A');
  vecClose(forward[1].b, [-0.2, 0.2, 0], 1e-9, 'arm b');
});

test('end-to-end: "wave" clip frame 1 (base rotated -45 about X) matches the hand-computed forward pose, arm follows rigidly', () => {
  const target = makeTargetDef();
  const bb = makeBBModel();
  const merged = mergeBBModel(bb, target, {});
  const pm = packVoxelModel(merged, () => 1);
  const forward = handComputeForward(pm, 'wave', 1, 0, [0, 0, 0]);

  const c = Math.SQRT1_2; // cos(45deg) == sin(45deg)
  // base: rot=[-45,0,0] -> Rrot=Rx(-45)=[[1,0,0],[0,c,c],[0,-c,c]]. pivot=[2,2,0].
  // rv=[2, 2c, -2c]; l=pivot-rv=[0, 2-2c, 2c]. A=cellM*Rrot. b=cellM*l+bw.
  vecClose(forward[0].A, [0.1, 0, 0, 0, 0.1 * c, 0.1 * c, 0, -0.1 * c, 0.1 * c], 1e-9, 'base A');
  vecClose(forward[0].b, [-0.2, 0.1 * (2 - 2 * c) - 0.2, 0.1 * (2 * c)], 1e-9, 'base b');

  // arm does not animate in 'wave' -> its own l=[0,0,0] regardless of the
  // parent's rotation (pivot cancellation again), so arm's whole forward
  // transform equals base's exactly (it rigidly inherits base's frame).
  vecClose(forward[1].A, forward[0].A, 1e-9, 'arm A == base A');
  vecClose(forward[1].b, forward[0].b, 1e-9, 'arm b == base b');
});

// ---- CLI --------------------------------------------------------------------

test('runCli: reads files, writes merged JSON, validates clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-import-test-'));
  try {
    const bbPath = path.join(dir, 'fixture.bbmodel');
    const modelPath = path.join(dir, 'model.json');
    const outPath = path.join(dir, 'out.json');
    fs.writeFileSync(bbPath, JSON.stringify(makeBBModel()), 'utf8');
    fs.writeFileSync(modelPath, JSON.stringify(makeTargetDef()), 'utf8');
    const result = runCli([bbPath, '--model', modelPath, '--out', outPath]);
    assert.strictEqual(result.wrote, outPath);
    const merged = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.ok(merged.animations.swing);
    assert.ok(merged.animations.wave);
    vecClose(merged.parts.arm.pivot, [2, 2, 2], 1e-9, 'cli merged arm pivot');
    const { errors } = validateVoxelModel(merged);
    assert.deepStrictEqual(errors, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runCli: --help / no args prints help without touching any file', () => {
  const result = runCli([]);
  assert.strictEqual(result.help, true);
  assert.ok(result.text.includes('bb-import'));
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
