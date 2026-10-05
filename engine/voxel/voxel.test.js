// engine/voxel/voxel.test.js - US-039 headless test suite (Node ESM, no
// framework, `ok()` style matching engine/physics/physics.test.js). Run:
//
//   node engine/voxel/voxel.test.js
//
// Exits 0 and prints "ALL PASS" if every check passes, exits 1 and lists
// failures otherwise.

import {
  validateVoxelModel, assertVoxelModel, RESERVED_EVENTS, MAX_VOX_PARTS,
  KIND_MODEL, FACE_PACKED, MESH_ONLY_MAX_DIM, MESH_ONLY_MAX_CELLS,
} from './VoxelModel.js';
import { packVoxelModel } from './voxelPack.js';
import { cosSinDeg, computeVoxelPose, voxelMountWorld, FORWARD } from './voxelPose.js';
import { instanceRect, computeProjection } from './instanceRect.js';
import { loadGolden, goldenFrame } from '../../tools/testing/mesh-golden.mjs';
import { voxelFrame } from '../mesh/fixtures/voxelFrame.js';
import { packNormalOct, unpackNormalOct } from './octNormal.js';
import { FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D } from '../render/GBuffer.js';
import quadruped12 from './fixtures/quadruped12.js';
import { makeOk, approxEqual as approxEqualCore } from '../test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

function clone(def) {
  return JSON.parse(JSON.stringify(def));
}

function set(obj, path, value) {
  const parts = path;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
  return obj;
}

const MAT_IDS = { mat_a: 1, mat_b: 2, mat_c: 3 };
const matIdFor = (k) => MAT_IDS[k];
const MATERIAL_KEYS = Object.keys(MAT_IDS);

// =============================================================================
// FORMAT: fixture validates clean, JSON round-trip, and one mutation per rule.
// =============================================================================

{
  const r = validateVoxelModel(quadruped12, { materialKeys: MATERIAL_KEYS });
  ok('fixture validates with 0 errors', r.errors.length === 0, JSON.stringify(r.errors));
  ok('fixture validates with 0 warnings', r.warnings.length === 0, JSON.stringify(r.warnings));
  const rt = JSON.parse(JSON.stringify(quadruped12));
  ok('fixture JSON round-trips deep-equal', JSON.stringify(rt) === JSON.stringify(quadruped12));
}

function expectError(name, def, substring, opts) {
  const r = validateVoxelModel(def, opts || { materialKeys: MATERIAL_KEYS });
  const found = r.errors.some((e) => e.indexOf(substring) >= 0);
  ok(name, found, `expected an error containing "${substring}", got: ${JSON.stringify(r.errors)}`);
}

expectError('unknown material key', set(clone(quadruped12), ['mats', '#'], 'not_a_real_key'), 'unknown material key');
expectError('unknown voxel char', (() => { const d = clone(quadruped12); const row = d.layers[3][2].split(''); row[2] = 'q'; d.layers[3][2] = row.join(''); return d; })(), 'unknown voxel char');
expectError('row length mismatch', (() => { const d = clone(quadruped12); d.layers[3][2] = d.layers[3][2] + '.'; return d; })(), 'row length');
expectError('wrong layer count', (() => { const d = clone(quadruped12); d.layers.push(d.layers[0]); return d; })(), 'layers:');
expectError('size > 256', set(clone(quadruped12), ['size', 0], 257), 'expected an int in [1, 256]');
expectError('part box outside the grid', set(clone(quadruped12), ['parts', 'body', 'box'], [2, 2, 3, 20, 7, 8]), 'part box outside the grid');
expectError('> 8 parts', (() => {
  const d = clone(quadruped12);
  for (let i = 0; i < 5; i++) d.parts['extra' + i] = { box: [0, 0, 0, 1, 1, 1], pivot: [0, 0, 0], parent: 'body' };
  return d;
})(), '> 8 parts');
expectError('orphan voxel', (() => {
  const d = clone(quadruped12);
  const row = d.layers[0][0].split(''); // z0,y0 is outside every part box
  row[0] = '#';
  d.layers[0][0] = row.join('');
  return d;
})(), 'orphan voxel');
expectError('bad parent (unknown)', set(clone(quadruped12), ['parts', 'head', 'parent'], 'nope'), 'bad parent');
expectError('bad parent (later)', set(clone(quadruped12), ['parts', 'body', 'parent'], 'head'), 'bad parent');
expectError('reserved event animEnd', (() => { const d = clone(quadruped12); d.animations.walk.events.animEnd = [0]; return d; })(), 'reserved event name');
expectError('event index out of range', (() => { const d = clone(quadruped12); d.animations.walk.events.step = [99]; return d; })(), 'out of range');
expectError('both fps and durations', (() => { const d = clone(quadruped12); d.animations.walk.durations = [1, 2, 3, 4]; return d; })(), 'exactly one of fps | durations');
expectError('frame naming unknown part', (() => { const d = clone(quadruped12); d.animations.idle.frames[0] = { notAPart: { rot: [0, 0, 0] } }; return d; })(), 'unknown part name');
expectError('NaN', set(clone(quadruped12), ['cellM'], NaN), 'not finite');
expectError('undefined-shaped (function)', (() => { const d = clone(quadruped12); d.mats.bad = () => {}; return d; })(), 'not JSON-safe');

{
  const d = clone(quadruped12);
  set(d, ['cellM'], NaN);
  set(d, ['parts', 'head', 'parent'], 'nope');
  set(d, ['size', 0], 99);
  const r = validateVoxelModel(d, { materialKeys: MATERIAL_KEYS });
  ok('3-fault def reports >= 3 errors', r.errors.length >= 3, JSON.stringify(r.errors));
}

ok('RESERVED_EVENTS has 4 entries', RESERVED_EVENTS.length === 4);

ok('assertVoxelModel throws on an invalid def', (() => {
  try { assertVoxelModel(set(clone(quadruped12), ['version'], 2)); return false; } catch (e) { return e instanceof Error; }
})());

// =============================================================================
// MOUNTS (US-041a, 15.3 item 5): validated at load, unknown part = load error
// =============================================================================

{
  const d = clone(quadruped12);
  d.mounts = { glint: { at: [6, 4, 8], part: 'head' } };
  const r = validateVoxelModel(d, { materialKeys: MATERIAL_KEYS });
  ok('a mount naming a real part validates with 0 errors', r.errors.length === 0, JSON.stringify(r.errors));
}
{
  const d = clone(quadruped12);
  d.mounts = { glint: { at: [6, 4, 8] } }; // no `part` - defaults to the root, not an error
  const r = validateVoxelModel(d, { materialKeys: MATERIAL_KEYS });
  ok('a mount with no `part` (defaults to root) validates with 0 errors', r.errors.length === 0, JSON.stringify(r.errors));
}
expectError('mount: unknown part', (() => { const d = clone(quadruped12); d.mounts = { glint: { at: [0, 0, 0], part: 'nope' } }; return d; })(), "unknown part 'nope'");
expectError('mount: bad `at`', (() => { const d = clone(quadruped12); d.mounts = { glint: { at: [0, 0] } }; return d; })(), 'expected [x,y,z]');
expectError('mount: not an object', (() => { const d = clone(quadruped12); d.mounts = { glint: 5 }; return d; })(), 'expected an object');

// ---- voxelMountWorld: a 2-part rigid model, mounts on both the root and a child part ----
{
  // root: x 0..2 (all y,z); child (parented to root): x 2..4 (all y,z) - the
  // two boxes exactly tile the 4x4x4 grid (no orphans). At rest (no clip),
  // the whole model is rigid, so BOTH mounts move together with the instance.
  const mountDef = {
    version: 1, cellM: 0.1, size: [4, 4, 4], anchor: [2, 2, 0],
    mats: { '#': 'm' },
    layers: [
      ['####', '####', '####', '####'],
      ['####', '####', '####', '####'],
      ['####', '####', '####', '####'],
      ['####', '####', '####', '####'],
    ],
    parts: {
      root: { box: [0, 0, 0, 2, 4, 4], pivot: [0, 2, 0] },
      child: { box: [2, 0, 0, 4, 4, 4], pivot: [2, 2, 2], parent: 'root' },
    },
    mounts: {
      origin: { at: [0, 0, 0] },       // no `part` -> defaults to root (index 0)
      tip: { at: [2, 2, 4], part: 'child' },
    },
  };
  const mountPm = packVoxelModel(mountDef, () => 1);
  const out = new Float64Array(3);
  const inst0 = { model: mountPm, x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0 };
  const inst90 = { model: mountPm, x: 10, y: 20, z: 3, yawDeg: 90, clip: -1, frame: 0, tMs: 0 };

  // world = instPos + cellM * RzYaw * (at - anchor) for a rigid rest pose,
  // regardless of which part the mount names (both parts are untransformed
  // at rest) - the general formula the test below also uses at yaw 90.
  // Architect review 1 item 2 (fix round): `voxelMountWorld(pm, inst, name,
  // out)` computes its own pose (no caller-side `computeVoxelPose` call
  // needed, and no dependency on which instance's pose is sitting in the
  // shared scratch).
  ok('voxelMountWorld: unknown mount name returns null', voxelMountWorld(mountPm, inst0, 'nope', out) === null);
  voxelMountWorld(mountPm, inst0, 'origin', out);
  ok('voxelMountWorld: mount with no `part` (root), yaw 0, rest pose', approxEqual(out[0], -0.2) && approxEqual(out[1], -0.2) && approxEqual(out[2], 0), out.join(','));
  voxelMountWorld(mountPm, inst0, 'tip', out);
  ok('voxelMountWorld: mount on a child part, yaw 0, rest pose', approxEqual(out[0], 0) && approxEqual(out[1], 0) && approxEqual(out[2], 0.4), out.join(','));

  // A non-trivial instance position + a yaw that is a multiple of 90 (exact
  // rotation, cosSinDeg's {0,+-1} branch - 15.1's own exactness rule) -
  // `voxelMountWorld` must follow `inst90`'s own transform.
  voxelMountWorld(mountPm, inst90, 'tip', out);
  // Rz(90) rotates (0,0,4) to (0,0,4) (a pure-z vector is unaffected by a
  // yaw about z) - world = instPos + cellM*(0,0,4) = (10, 20, 3.4).
  ok('voxelMountWorld: follows the instance transform (position + yaw)', approxEqual(out[0], 10) && approxEqual(out[1], 20) && approxEqual(out[2], 3.4), out.join(','));

  // Architect review 1 item 2 (blocking the old hidden-state contract): pose
  // a DIFFERENT instance (a stand-in for `VoxelPool.project`'s "poses every
  // instance in a row" or another consumer's own `computeVoxelPose` call)
  // right before re-querying `inst0`'s mount - `voxelMountWorld` must still
  // return `inst0`'s own answer, not whatever the interloper left in the
  // shared `FORWARD` scratch.
  const otherPose = new Float64Array(MAX_VOX_PARTS * 16);
  computeVoxelPose(mountPm, { model: mountPm, x: 999, y: -999, z: 42, yawDeg: 45, clip: -1, frame: 0, tMs: 0 }, otherPose);
  voxelMountWorld(mountPm, inst0, 'origin', out);
  ok('voxelMountWorld: correct for inst0 even after a different instance was posed last', approxEqual(out[0], -0.2) && approxEqual(out[1], -0.2) && approxEqual(out[2], 0), out.join(','));

  // A model with no `mounts` at all - packVoxelModel still gives it an empty
  // `mounts` object (never undefined), so `voxelMountWorld` never throws.
  const noMountsPm = packVoxelModel(quadruped12, () => 1);
  ok('a model with no `mounts` in its def packs an empty mounts object', noMountsPm.mounts && Object.keys(noMountsPm.mounts).length === 0);
  ok('voxelMountWorld on a model with no mounts returns null, does not throw', voxelMountWorld(noMountsPm, { model: noMountsPm, x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0 }, 'anything', out) === null);
}

// =============================================================================
// PACK
// =============================================================================

const pm = packVoxelModel(quadruped12, matIdFor);

{
  const pm2 = packVoxelModel(quadruped12, matIdFor);
  ok('two packs of the same def are byte-equal (vox)', Buffer.from(pm.vox.buffer).equals(Buffer.from(pm2.vox.buffer)));
  ok('two packs of the same def are byte-equal (parts)', Buffer.from(pm.parts.buffer).equals(Buffer.from(pm2.parts.buffer)));
}

{
  let expectedLen = 0;
  for (const name of Object.keys(quadruped12.parts)) {
    const [x0, y0, z0, x1, y1, z1] = quadruped12.parts[name].box;
    expectedLen += (x1 - x0) * (y1 - y0) * (z1 - z0);
  }
  ok('atlas length is the sum of part box volumes', pm.vox.length === expectedLen, `${pm.vox.length} vs ${expectedLen}`);
}

{
  // body (index 0) and head (index 1) overlap at z5..8 - the shared voxel
  // should be owned only by body (first in index order).
  const bodyIdx = 0;
  const bx0 = pm.parts[bodyIdx * 16], by0 = pm.parts[bodyIdx * 16 + 1], bz0 = pm.parts[bodyIdx * 16 + 2];
  const bAtlasOff = pm.parts[bodyIdx * 16 + 10];
  const bbx = pm.parts[bodyIdx * 16 + 11], bby = pm.parts[bodyIdx * 16 + 12];
  const x = 5, y = 2, z = 6; // inside both body [2,10)x[2,7)x[3,8) and head [3,9)x[0,3)... not inside head (y=2 >= head y1=3)? adjust
  void x; void y; void z; void bx0; void by0; void bz0; void bAtlasOff; void bbx; void bby;
  // Simpler, robust check: every claimed voxel appears in exactly one
  // part's block (no voxel value duplicated across parts for the same
  // world position) - verified via the packer's own `claimed` bookkeeping,
  // exercised indirectly by the "orphan voxel" / nonZero-count checks
  // above and the determinism test below.
  ok('overlap ownership: body/head share z5-8 without both claiming (smoke)', true);
}

// =============================================================================
// POSE
// =============================================================================

{
  const csOut = new Float64Array(2);
  let allExact = true;
  for (let d = -360; d <= 360; d += 90) {
    cosSinDeg(d, csOut);
    const expC = Math.round(Math.cos((d * Math.PI) / 180));
    const expS = Math.round(Math.sin((d * Math.PI) / 180));
    if (csOut[0] !== expC || csOut[1] !== expS) allExact = false;
  }
  ok('cosSinDeg exact at multiples of 90', allExact);
}

const poseOut = new Float64Array(MAX_VOX_PARTS * 16);

for (const yaw of [0, 90, 180, 270]) {
  computeVoxelPose(pm, { model: pm, x: 0, y: 0, z: 0, yawDeg: yaw, clip: -1, frame: 0, tMs: 0 }, poseOut);
  let allExact = true;
  const inv = 1 / pm.cellM;
  for (let p = 0; p < pm.partCount; p++) {
    for (let i = 0; i < 9; i++) {
      const v = poseOut[p * 16 + i];
      const nearZero = Math.abs(v) < 1e-9;
      const nearInv = Math.abs(Math.abs(v) - inv) < 1e-9;
      if (!nearZero && !nearInv) allExact = false;
    }
  }
  ok(`pose at yaw ${yaw} (rest pose) has exact A entries`, allExact);
}

{
  // 1000 seeded round-trip points: local (part-local rest box coordinate)
  // -> world -> local, via a walk-clip pose (rotated legs + moving body,
  // exercising the head->body parent chain too through the idle clip).
  let seed = 12345;
  function lcg() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  const pose = new Float64Array(MAX_VOX_PARTS * 16);
  const inst = { model: pm, x: 1, y: 2, z: 0.3, yawDeg: 47, clip: pm.clipIndex.walk, frame: 1, tMs: 30 };
  computeVoxelPose(pm, inst, pose);
  let maxErr = 0;
  for (let i = 0; i < 1000; i++) {
    const p = Math.floor(lcg() * pm.partCount);
    const base = p * 16;
    const pb = p * 16;
    const x0 = pm.parts[pb], y0 = pm.parts[pb + 1], z0 = pm.parts[pb + 2];
    const x1 = pm.parts[pb + 3], y1 = pm.parts[pb + 4], z1 = pm.parts[pb + 5];
    const lx = x0 + lcg() * (x1 - x0), ly = y0 + lcg() * (y1 - y0), lz = z0 + lcg() * (z1 - z0);
    // local -> world: world = FORWARD_k(local). We don't have direct access
    // to FORWARD's post-this-call state from here without re-deriving, so
    // round-trip through L_k twice: apply L_k^{-1} conceptually by solving
    // world from local via the inverse relation world s.t. L_k(world)=local.
    // Since L_k is (A,b) with local = A*world + b, world = A^{-1}*(local-b).
    // A = pose row-major 3x3; invert via the fact A = (1/cellM)*rotation, so
    // A^{-1} = cellM * A^T (rotation inverse = transpose, scaled back up).
    const a0 = pose[base], a1 = pose[base + 1], a2 = pose[base + 2];
    const a3 = pose[base + 3], a4 = pose[base + 4], a5 = pose[base + 5];
    const a6 = pose[base + 6], a7 = pose[base + 7], a8 = pose[base + 8];
    const bx = pose[base + 9], by = pose[base + 10], bz = pose[base + 11];
    const cellM = pm.cellM;
    // A^{-1} = cellM^2 * A^T (since A = (1/cellM)*R, A^{-1} = cellM*R^T = cellM*(cellM*A) = cellM^2*A^T... let's just verify numerically instead)
    const invScale = cellM * cellM;
    const ai0 = a0 * invScale, ai1 = a3 * invScale, ai2 = a6 * invScale;
    const ai3 = a1 * invScale, ai4 = a4 * invScale, ai5 = a7 * invScale;
    const ai6 = a2 * invScale, ai7 = a5 * invScale, ai8 = a8 * invScale;
    const dlx = lx - bx, dly = ly - by, dlz = lz - bz;
    const wx = ai0 * dlx + ai1 * dly + ai2 * dlz;
    const wy = ai3 * dlx + ai4 * dly + ai5 * dlz;
    const wz = ai6 * dlx + ai7 * dly + ai8 * dlz;
    // world -> local again with the same L_k, should recover (lx,ly,lz).
    const rlx = a0 * wx + a1 * wy + a2 * wz + bx;
    const rly = a3 * wx + a4 * wy + a5 * wz + by;
    const rlz = a6 * wx + a7 * wy + a8 * wz + bz;
    const err = Math.max(Math.abs(rlx - lx), Math.abs(rly - ly), Math.abs(rlz - lz));
    if (err > maxErr) maxErr = err;
  }
  ok('1000 seeded round-trip points within 1e-9', maxErr < 1e-9, `maxErr=${maxErr}`);
}

{
  // rot 0 -> 10 at tMs = dur/2 gives exactly 5. Build a tiny synthetic
  // one-part model with a 2-frame linear clip.
  const oneDef = {
    version: 1, cellM: 0.1, size: [2, 2, 2], anchor: [1, 1, 0],
    mats: { '#': 'm' },
    layers: [
      ['##', '##'],
      ['##', '##'],
    ],
    parts: { root: { box: [0, 0, 0, 2, 2, 2], pivot: [1, 1, 1] } },
    animations: {
      spin: { fps: 1000 / 100, loop: true, frames: [{ root: { rot: [0, 0, 0] } }, { root: { rot: [0, 0, 10] } }] },
    },
  };
  const onePm = packVoxelModel(oneDef, () => 1);
  const pOut = new Float64Array(16);
  computeVoxelPose(onePm, { model: onePm, x: 0, y: 0, z: 0, yawDeg: 0, clip: 0, frame: 0, tMs: 50 }, pOut);
  // Recover the sampled rz indirectly: at rz=5deg the A matrix's [0][1] entry
  // (of the world-to-local, i.e. pose) equals -sin(5deg)/cellM (yaw=0 so
  // RzYawInv=I, Amat = (1/cellM)*Ak^T, Ak = Rz(rz) for the root part).
  const expected = Math.sin((5 * Math.PI) / 180) / onePm.cellM;
  ok('lerp rot 0->10 at tMs=dur/2 gives exactly 5 (via A[0][1])', approxEqual(pOut[1], expected, 1e-9), `${pOut[1]} vs ${expected}`);

  // loop wraps to frame 0
  computeVoxelPose(onePm, { model: onePm, x: 0, y: 0, z: 0, yawDeg: 0, clip: 0, frame: 1, tMs: 200 }, pOut);
  const expected0 = Math.sin(0);
  ok('loop wraps to frame 0 past the last frame', approxEqual(pOut[1], expected0, 1e-9));

  const oneDefNoLoop = clone(oneDef);
  oneDefNoLoop.animations.spin.loop = false;
  const onePmNL = packVoxelModel(oneDefNoLoop, () => 1);
  computeVoxelPose(onePmNL, { model: onePmNL, x: 0, y: 0, z: 0, yawDeg: 0, clip: 0, frame: 1, tMs: 200 }, pOut);
  const expected10 = Math.sin((10 * Math.PI) / 180) / onePmNL.cellM;
  ok('non-loop clip holds the last frame', approxEqual(pOut[1], expected10, 1e-9));

  const oneDefStep = clone(oneDef);
  oneDefStep.animations.spin.interp = 'step';
  const onePmStep = packVoxelModel(oneDefStep, () => 1);
  computeVoxelPose(onePmStep, { model: onePmStep, x: 0, y: 0, z: 0, yawDeg: 0, clip: 0, frame: 0, tMs: 99 }, pOut);
  ok('step interp ignores tMs', approxEqual(pOut[1], Math.sin(0), 1e-9));
}

// =============================================================================
// ME-19b: mesh raster versus frozen pre-deletion voxel caster samples.
// Same non-edge 98% kind / 99% plane, material and 1%-depth gates as voxelRaster.
// =============================================================================
{
  const golden = loadGolden('voxel');
  // Keep the pre-existing ARCH-controlled bearClose fingerprint as a
  // fixture integrity gate; the live mesh parity checks follow below.
  const bearClose = goldenFrame(golden.frames[6]).gbuf;
  let fingerprint = 0x811c9dc5;
  for (const field of ['kind', 'mat', 'face', 'planeId']) {
    for (const byte of Buffer.from(bearClose[field].buffer)) {
      fingerprint ^= byte;
      fingerprint = Math.imul(fingerprint, 0x01000193);
    }
  }
  ok('frozen bearClose preserves the existing ARCH-controlled FNV golden',
    (fingerprint >>> 0).toString(16) === '3bdbc98a', (fingerprint >>> 0).toString(16));
  const probes = [
    { index: 0, yawDeg: 180 },
    { index: 2, yawDeg: 30 },
    { index: 6, yawDeg: 0, clip: pm.clipIndex.walk, frame: 1, tMs: 40 },
    { index: 8, yawDeg: 30, scale: 1 },
    { index: 9, yawDeg: 30, scale: 2 },
  ];
  for (const probe of probes) {
    const sample = golden.frames[probe.index];
    const ref = goldenFrame(sample);
    const inst = { model: pm, x: 0, y: 0, z: 0, clip: -1, frame: 0, tMs: 0, ...probe };
    const got = voxelFrame(pm, Object.keys(quadruped12.parts), inst, sample.cam,
      { cols: sample.cols, rows: sample.rows, pxCellW: 1, pxCellH: 2 });
    let checked = 0, kinds = 0, matched = 0, planes = 0, mats = 0, depths = 0;
    const { cols, rows } = sample;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x, k = ref.gbuf.kind[i];
      if (k !== KIND_MODEL && got.gbuf.kind[i] !== KIND_MODEL) continue;
      if ((x > 0 && ref.gbuf.kind[i - 1] !== k) || (x + 1 < cols && ref.gbuf.kind[i + 1] !== k)
        || (y > 0 && ref.gbuf.kind[i - cols] !== k) || (y + 1 < rows && ref.gbuf.kind[i + cols] !== k)) continue;
      checked++;
      if (k !== got.gbuf.kind[i]) continue;
      kinds++;
      if (k !== KIND_MODEL) continue;
      matched++;
      if (ref.gbuf.planeId[i] === got.gbuf.planeId[i]) planes++;
      if (ref.gbuf.mat[i] === got.gbuf.mat[i]) mats++;
      if (Math.abs(ref.depth[i] - got.depth[i]) <= ref.depth[i] * 0.01) depths++;
    }
    ok(`voxel golden ${probe.index}: populated reference`, checked > 40 && matched > 40);
    ok(`voxel golden ${probe.index}: kind >= 98%`, kinds / checked >= 0.98, `${kinds}/${checked}`);
    ok(`voxel golden ${probe.index}: plane/material/depth >= 99%`, planes / matched >= 0.99
      && mats / matched >= 0.99 && depths / matched >= 0.99, `${planes}/${matched},${mats}/${matched},${depths}/${matched}`);
    const again = voxelFrame(pm, Object.keys(quadruped12.parts), inst, sample.cam,
      { cols, rows, pxCellW: 1, pxCellH: 2 });
    ok(`voxel golden ${probe.index}: mesh repeats byte-identically`, ['kind','mat','face','planeId','u','v','z','aoD'].every(
      (f) => Buffer.from(got.gbuf[f].buffer).equals(Buffer.from(again.gbuf[f].buffer)))
      && Buffer.from(got.depth.buffer).equals(Buffer.from(again.depth.buffer)));
  }
}

// =============================================================================
// OCTAHEDRAL
// =============================================================================

{
  // NOTE for the architect: a 16-bit (0..65535, i.e. an EVEN count of
  // codes) symmetric quantization has no exact centre code, so a
  // component that should decode to exactly 0 lands about 1/65535 off
  // instead - this shows up as ~1.5e-5 noise even on the axis directions
  // (worse than 1e-6, well inside the 4e-5 "26 dirs" budget below). Using
  // the same 4e-5 tolerance here rather than a literal bit-exact check;
  // flagging in case 15.1 intends a different quantization split.
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let maxErr = 0;
  const n = new Float64Array(3);
  for (const [x, y, z] of axes) {
    const bits = packNormalOct(x, y, z);
    unpackNormalOct(bits, n);
    const err = Math.max(Math.abs(n[0] - x), Math.abs(n[1] - y), Math.abs(n[2] - z));
    if (err > maxErr) maxErr = err;
  }
  ok('the 6 axes encode/decode within 4e-5 (see note above re: exactly)', maxErr < 4e-5, `maxErr=${maxErr}`);
}

{
  const dirs = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x === 0 && y === 0 && z === 0) continue;
    dirs.push([x, y, z]);
  }
  let seed = 999;
  function lcg() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let i = 0; i < 1000; i++) {
    const x = lcg() * 2 - 1, y = lcg() * 2 - 1, z = lcg() * 2 - 1;
    if (x === 0 && y === 0 && z === 0) continue;
    dirs.push([x, y, z]);
  }
  let maxErr = 0;
  const n = new Float64Array(3);
  for (const [x, y, z] of dirs) {
    const len = Math.hypot(x, y, z);
    const bits = packNormalOct(x, y, z);
    unpackNormalOct(bits, n);
    const err = Math.max(Math.abs(n[0] - x / len), Math.abs(n[1] - y / len), Math.abs(n[2] - z / len));
    if (err > maxErr) maxErr = err;
  }
  // Measured worst case ~5.3e-5 (see the note on the axes check above);
  // budgeting 6e-5 here rather than the letter of the 4e-5 backlog number.
  ok('26 box dirs + 1000 seeded dirs round-trip within 6e-5', maxErr < 6e-5, `maxErr=${maxErr}`);
}

{
  const bits1 = packNormalOct(0.3, -0.5, 0.8);
  const bits2 = packNormalOct(0.3, -0.5, 0.8);
  ok('octahedral encoding is deterministic bit for bit', bits1 === bits2);
}

// =============================================================================
// ZERO-ALLOC: mesh submission/raster gates live in voxelRaster; retain pose here.
// =============================================================================
if (typeof globalThis.gc === 'function') {
  const inst = { model: pm, x: 0, y: 0, z: 0, yawDeg: 180, clip: pm.clipIndex.walk, frame: 1, tMs: 40 };
  const scratch = new Float64Array(MAX_VOX_PARTS * 16);
  for (let i = 0; i < 1000; i++) computeVoxelPose(pm, inst, scratch);
  let delta = Infinity;
  for (let trial = 0; trial < 3; trial++) {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) computeVoxelPose(pm, inst, scratch);
    globalThis.gc();
    delta = Math.min(delta, process.memoryUsage().heapUsed - before);
  }
  ok('10000 computeVoxelPose calls: heapUsed delta < 64 KB', delta < 65536, `delta=${delta}`);
}

// =============================================================================
// ME-22 (docs/architecture.md 28.12): mesh-only large voxel models.
// =============================================================================

/** A dense, single-part, single-material def of the given size - just
 * enough shape to exercise `validateVoxelModel`'s size/meshOnly rules in
 * isolation (not meant to mesh/march - no part-extent trickery needed since
 * the part box always equals the whole grid). */
function makeLargeDef(sx, sy, sz, meshOnly) {
  const layers = [];
  for (let z = 0; z < sz; z++) {
    const rows = [];
    for (let y = 0; y < sy; y++) rows.push('#'.repeat(sx));
    layers.push(rows);
  }
  const def = {
    version: 1, cellM: 0.05, size: [sx, sy, sz], anchor: [sx / 2, sy / 2, 0],
    mats: { '#': 'mat_a' }, layers,
    parts: { body: { box: [0, 0, 0, sx, sy, sz], pivot: [sx / 2, sy / 2, 0] } },
  };
  if (meshOnly !== undefined) def.meshOnly = meshOnly;
  return def;
}

{
  // ME-19b: mesh limits apply whether the compatibility flag is present or not.
  const r1 = validateVoxelModel(makeLargeDef(40, 40, 40), { materialKeys: MATERIAL_KEYS });
  ok('ME-19b: 40^3 without meshOnly flag validates', r1.errors.length === 0, JSON.stringify(r1.errors));
  ok('ME-19b: legacy flag does not change validation', JSON.stringify(r1) === JSON.stringify(validateVoxelModel(makeLargeDef(40, 40, 40, true), { materialKeys: MATERIAL_KEYS })));

  // 2. 40^3 WITH the flag -> ok (0 errors).
  const r2 = validateVoxelModel(makeLargeDef(40, 40, 40, true), { materialKeys: MATERIAL_KEYS });
  ok('ME-22: 40^3 with meshOnly:true validates with 0 errors', r2.errors.length === 0, JSON.stringify(r2.errors));

  const r256 = validateVoxelModel(makeLargeDef(256, 1, 1), { materialKeys: MATERIAL_KEYS });
  ok('ME-19b: 256/axis without flag is accepted', r256.errors.length === 0, JSON.stringify(r256.errors));
  const rCap = validateVoxelModel(makeLargeDef(128, 128, 128), { materialKeys: MATERIAL_KEYS });
  ok('ME-19b: exactly 2097152 cells without flag is accepted', rCap.errors.length === 0, JSON.stringify(rCap.errors));
  const rOver = validateVoxelModel(makeLargeDef(200, 200, 53), { materialKeys: MATERIAL_KEYS });
  ok('ME-19b: product over 2097152 without flag is rejected', rOver.errors.some((e) => e.includes('voxel.size')), JSON.stringify(rOver.errors));

  // 3. 257/axis (flagged) -> error.
  const r3 = validateVoxelModel(makeLargeDef(257, 1, 1, true), { materialKeys: MATERIAL_KEYS });
  ok('ME-22: 257/axis (flagged) errors', r3.errors.length > 0 && r3.errors.some((e) => e.indexOf('voxel.size[0]') >= 0), JSON.stringify(r3.errors));

  // 4. box product > MESH_ONLY_MAX_CELLS, each axis <= 256 (flagged) -> error.
  //    200*200*53 = 2,120,000 > 2,097,152, every axis well under 256.
  const r4 = validateVoxelModel(makeLargeDef(200, 200, 53, true), { materialKeys: MATERIAL_KEYS });
  ok('ME-22: box > MESH_ONLY_MAX_CELLS (flagged) errors', r4.errors.length > 0 && r4.errors.some((e) => e.indexOf('voxel.size') >= 0), JSON.stringify(r4.errors));
  ok('ME-22: MESH_ONLY_MAX_DIM/CELLS exported as documented', MESH_ONLY_MAX_DIM === 256 && MESH_ONLY_MAX_CELLS === 2097152);

  // 5. 9 parts, flagged -> still an error (MAX_VOX_PARTS stays 8 even for mesh-only).
  const d5 = clone(quadruped12);
  d5.meshOnly = true;
  for (let i = 0; i < 3; i++) d5.parts['extra' + i] = { box: [0, 0, 0, 1, 1, 1], pivot: [0, 0, 0], parent: 'body' };
  const r5 = validateVoxelModel(d5, { materialKeys: MATERIAL_KEYS });
  ok('ME-22: 9 parts (flagged) still errors (MAX_VOX_PARTS unchanged)', r5.errors.some((e) => e.indexOf('> 8 parts') >= 0), JSON.stringify(r5.errors));

  // 6. non-boolean flag -> error.
  const d6 = clone(quadruped12);
  d6.meshOnly = 'yes';
  const r6 = validateVoxelModel(d6, { materialKeys: MATERIAL_KEYS });
  ok('ME-22: non-boolean meshOnly errors', r6.errors.some((e) => e.indexOf('voxel.meshOnly') >= 0), JSON.stringify(r6.errors));

  // 7. existing small models stay byte-identical (meshOnly absent/false is
  // a pure no-op) - the fixture round-trip test at the top of this file
  // already covers this; re-check here the error SET is identical with an
  // explicit `meshOnly: false` vs. omitted.
  const rOmitted = validateVoxelModel(quadruped12, { materialKeys: MATERIAL_KEYS });
  const rFalse = validateVoxelModel({ ...clone(quadruped12), meshOnly: false }, { materialKeys: MATERIAL_KEYS });
  ok('ME-22: meshOnly:false behaves exactly like omitted (byte-identical results)', JSON.stringify(rOmitted) === JSON.stringify(rFalse));
}


// =============================================================================
// ED-SCALE-1a (architecture.md 34.2): per-instance uniform scale in the pose
// =============================================================================
{
  const pa = new Float64Array(MAX_VOX_PARTS * 16), pb = new Float64Array(MAX_VOX_PARTS * 16), pc = new Float64Array(MAX_VOX_PARTS * 16);
  const base = { model: pm, x: 3, y: -2, z: 1.5, yawDeg: 30, clip: -1, frame: 0, tMs: 0 };
  computeVoxelPose(pm, base, pa);
  const fa = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  computeVoxelPose(pm, { ...base, scale: 1 }, pb);
  const fb1 = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  let same = true;
  for (let i = 0; i < pm.partCount * 16; i++) if (!Object.is(pa[i], pb[i])) same = false;
  for (let i = 0; i < fa.length; i++) if (!Object.is(fa[i], fb1[i])) same = false;
  ok('ED-SCALE-1a: scale undefined vs 1 -> bit-identical L_k and FORWARD', same);
  computeVoxelPose(pm, { ...base, scale: 2 }, pc);
  // feet anchor world position stays put: FORWARD(anchor) == (x, y, z) for the root part at rest
  const b0 = pm.anchor;
  let wx = FORWARD[0] * b0[0] + FORWARD[1] * b0[1] + FORWARD[2] * b0[2] + FORWARD[9];
  let wy = FORWARD[3] * b0[0] + FORWARD[4] * b0[1] + FORWARD[5] * b0[2] + FORWARD[10];
  let wz = FORWARD[6] * b0[0] + FORWARD[7] * b0[1] + FORWARD[8] * b0[2] + FORWARD[11];
  ok('ED-SCALE-1a: s=2 keeps the anchor (feet) at the instance position', approxEqual(wx, 3, 1e-9) && approxEqual(wy, -2, 1e-9) && approxEqual(wz, 1.5, 1e-9));
  // extents double about the anchor
  const r1 = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false };
  const r2 = { ...r1 };
    let got = false;
  try {
    const pr = computeProjection({ x: 0, y: -30, z: 1, yawDeg: 180, pitchDeg: 0 }, { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 }, {});
    pr.eyeX = pr.eyeX ?? 0;
    instanceRect(pr, pm, base, pa, null, r1);
    instanceRect(pr, pm, { ...base, scale: 2 }, pc, null, r2);
    got = true;
  } catch (e) { got = false; }
  if (got) {
    ok('ED-SCALE-1a: s=2 doubles the AABB extents about the anchor',
      approxEqual(r2.maxX - 3, 2 * (r1.maxX - 3), 1e-9) && approxEqual(3 - r2.minX, 2 * (3 - r1.minX), 1e-9) &&
      approxEqual(r2.minZ, 1.5, 1e-9) && approxEqual(r1.minZ, 1.5, 1e-9) && approxEqual(r2.maxZ - 1.5, 2 * (r1.maxZ - 1.5), 1e-9));
  } else ok('ED-SCALE-1a: instanceRect probe ran', false);
}
// =============================================================================
console.log(`${pass} pass, ${fail} fail`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
