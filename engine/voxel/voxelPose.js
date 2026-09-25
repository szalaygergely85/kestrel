// engine/voxel/voxelPose.js - US-039 pose sampling + rigid-part transforms
// (architecture.md 15.1 "Transforms" + "Pose sampling"). Hot path: called
// once per instance per frame by castModels. No `new`, array/object
// literals, closures, `for..of` or destructuring in the functions below
// (backlog US-039 tech notes item 5) - every buffer is module-level scratch,
// reused call to call.

import { MAX_VOX_PARTS, PART_STRIDE } from './VoxelModel.js';

/**
 * Writes [cos(deg), sin(deg)] into `out` (length >= 2). Exact {0,+-1} for
 * multiples of 90 degrees (so axis-aligned poses have exact matrices, per
 * 15.1), else Math.cos/sin. GLSL mirrors this with the same %90 branch.
 */
export function cosSinDeg(deg, out) {
  const m = ((deg % 90) + 90) % 90;
  if (m === 0) {
    let q = Math.round(deg / 90) % 4;
    if (q < 0) q += 4;
    if (q === 0) { out[0] = 1; out[1] = 0; }
    else if (q === 1) { out[0] = 0; out[1] = 1; }
    else if (q === 2) { out[0] = -1; out[1] = 0; }
    else { out[0] = 0; out[1] = -1; }
  } else {
    const r = (deg * Math.PI) / 180;
    out[0] = Math.cos(r);
    out[1] = Math.sin(r);
  }
}

// ---- scratch (module-level, zero per-call allocation) ----------------------
const _cs = new Float64Array(2);
const _Rz = new Float64Array(9);
const _Ry = new Float64Array(9);
const _Rx = new Float64Array(9);
const _RyRx = new Float64Array(9);
const _Rrot = new Float64Array(9);
const _RzYaw = new Float64Array(9);
const _RzYawInv = new Float64Array(9);
const _Aw = new Float64Array(9);
const _bw = new Float64Array(3);
const _Ak = new Float64Array(MAX_VOX_PARTS * 9);
const _bk = new Float64Array(MAX_VOX_PARTS * 3);
const _axisAligned = new Uint8Array(MAX_VOX_PARTS);
const _AkT = new Float64Array(9);
const _tmp9 = new Float64Array(9);

/**
 * Forward per-part world transforms (Aw_k 3x3 row-major + bw_k, stride 12),
 * filled as a side effect of the LAST `computeVoxelPose` call - a shared
 * scratch (same pattern as `moveOut` in engine/physics/physics.test.js),
 * valid until the next call. castModels reads it right after calling
 * computeVoxelPose, before doing anything else for that instance, to build
 * the world AABB (15.1 does not name this array; it is an internal detail
 * of the CPU oracle, not part of the documented pose/march API).
 */
export const FORWARD = new Float64Array(MAX_VOX_PARTS * 12);

function setRz(deg, out) {
  cosSinDeg(deg, _cs);
  const c = _cs[0], s = _cs[1];
  out[0] = c; out[1] = -s; out[2] = 0;
  out[3] = s; out[4] = c; out[5] = 0;
  out[6] = 0; out[7] = 0; out[8] = 1;
}

function setRy(deg, out) {
  cosSinDeg(deg, _cs);
  const c = _cs[0], s = _cs[1];
  out[0] = c; out[1] = 0; out[2] = s;
  out[3] = 0; out[4] = 1; out[5] = 0;
  out[6] = -s; out[7] = 0; out[8] = c;
}

function setRx(deg, out) {
  cosSinDeg(deg, _cs);
  const c = _cs[0], s = _cs[1];
  out[0] = 1; out[1] = 0; out[2] = 0;
  out[3] = 0; out[4] = c; out[5] = -s;
  out[6] = 0; out[7] = s; out[8] = c;
}

// out = a * b (3x3 row-major). Safe even if out aliases a or b (reads into
// locals first).
function matMul3(a, b, out) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[3], a11 = a[4], a12 = a[5];
  const a20 = a[6], a21 = a[7], a22 = a[8];
  const b00 = b[0], b01 = b[1], b02 = b[2];
  const b10 = b[3], b11 = b[4], b12 = b[5];
  const b20 = b[6], b21 = b[7], b22 = b[8];
  out[0] = a00 * b00 + a01 * b10 + a02 * b20;
  out[1] = a00 * b01 + a01 * b11 + a02 * b21;
  out[2] = a00 * b02 + a01 * b12 + a02 * b22;
  out[3] = a10 * b00 + a11 * b10 + a12 * b20;
  out[4] = a10 * b01 + a11 * b11 + a12 * b21;
  out[5] = a10 * b02 + a11 * b12 + a12 * b22;
  out[6] = a20 * b00 + a21 * b10 + a22 * b20;
  out[7] = a20 * b01 + a21 * b11 + a22 * b21;
  out[8] = a20 * b02 + a21 * b12 + a22 * b22;
}

function transpose3(a, out) {
  const a01 = a[1], a02 = a[2], a10 = a[3], a12 = a[5], a20 = a[6], a21 = a[7];
  out[0] = a[0]; out[4] = a[4]; out[8] = a[8];
  out[1] = a10; out[2] = a20; out[3] = a01; out[5] = a21; out[6] = a02; out[7] = a12;
}

// Builds R(rot) = Rz(rz) * Ry(ry) * Rx(rx) into `out`.
function setRot(rx, ry, rz, out) {
  setRz(rz, _Rz);
  setRy(ry, _Ry);
  setRx(rx, _Rx);
  matMul3(_Ry, _Rx, _RyRx);
  matMul3(_Rz, _RyRx, out);
}

/**
 * Samples clip pose for every part at `inst.clip`/`inst.frame`/`inst.tMs`
 * (15.1 "Pose sampling") into the module scratch `_rotOut`/`_posOut`
 * (partCount*3 each). `clip = -1` (or no clips) is the rest pose (all 0).
 */
const _rotOut = new Float64Array(MAX_VOX_PARTS * 3);
const _posOut = new Float64Array(MAX_VOX_PARTS * 3);
function samplePose(pm, inst) {
  const partCount = pm.partCount;
  const clipIdx = inst.clip;
  if (clipIdx === undefined || clipIdx < 0 || !pm.clips || clipIdx >= pm.clips.length) {
    for (let i = 0; i < partCount * 3; i++) { _rotOut[i] = 0; _posOut[i] = 0; }
    return;
  }
  const clip = pm.clips[clipIdx];
  const n = clip.n;
  let frame = inst.frame | 0;
  if (frame < 0) frame = 0;
  if (frame >= n) frame = n - 1;
  const alpha = clip.step ? 0 : Math.max(0, Math.min(1, inst.tMs / clip.durMs[frame]));
  const next = (frame + 1 < n) ? (frame + 1) : (clip.loop ? 0 : frame);
  const stride = partCount * 6;
  for (let p = 0; p < partCount; p++) {
    const base = frame * stride + p * 6;
    const baseN = next * stride + p * 6;
    for (let c = 0; c < 6; c++) {
      const v0 = clip.keys[base + c];
      const v1 = clip.keys[baseN + c];
      const v = v0 + (v1 - v0) * alpha;
      if (c < 3) _rotOut[p * 3 + c] = v; else _posOut[p * 3 + (c - 3)] = v;
    }
  }
}

/**
 * Computes, per part, the world-to-part-local affine `L_k` (12 float64:
 * A 3x3 row-major, then b 3) and the `axisAligned` flag (15.1), writing
 * them into `out` (Float64Array, length >= partCount*PART_STRIDE): per
 * part [A(9), b(3), axisAligned(1), pad(2)]. Also fills the module-level
 * `FORWARD` scratch with the forward per-part world transform (see above).
 */
export function computeVoxelPose(pm, inst, out) {
  const partCount = pm.partCount;
  const cellM = pm.cellM;
  const invCellM = 1 / cellM;
  const yawDeg = inst.yawDeg;

  setRz(yawDeg, _RzYaw);
  transpose3(_RzYaw, _RzYawInv);
  for (let i = 0; i < 9; i++) _Aw[i] = _RzYaw[i] * cellM;
  _bw[0] = inst.x - (_Aw[0] * pm.anchor[0] + _Aw[1] * pm.anchor[1] + _Aw[2] * pm.anchor[2]);
  _bw[1] = inst.y - (_Aw[3] * pm.anchor[0] + _Aw[4] * pm.anchor[1] + _Aw[5] * pm.anchor[2]);
  _bw[2] = inst.z - (_Aw[6] * pm.anchor[0] + _Aw[7] * pm.anchor[1] + _Aw[8] * pm.anchor[2]);

  samplePose(pm, inst);

  const yawMod90 = ((yawDeg % 90) + 90) % 90 === 0;

  for (let p = 0; p < partCount; p++) {
    const pbase = p * PART_STRIDE;
    const parentIdx = pm.parts[pbase + 9];
    const pivotX = pm.parts[pbase + 6], pivotY = pm.parts[pbase + 7], pivotZ = pm.parts[pbase + 8];
    const rx = _rotOut[p * 3], ry = _rotOut[p * 3 + 1], rz = _rotOut[p * 3 + 2];
    const posX = _posOut[p * 3], posY = _posOut[p * 3 + 1], posZ = _posOut[p * 3 + 2];

    setRot(rx, ry, rz, _Rrot);
    const rotZero = rx === 0 && ry === 0 && rz === 0;

    const abase = p * 9, bbase = p * 3;
    if (parentIdx < 0) {
      _Ak[abase] = _Rrot[0]; _Ak[abase + 1] = _Rrot[1]; _Ak[abase + 2] = _Rrot[2];
      _Ak[abase + 3] = _Rrot[3]; _Ak[abase + 4] = _Rrot[4]; _Ak[abase + 5] = _Rrot[5];
      _Ak[abase + 6] = _Rrot[6]; _Ak[abase + 7] = _Rrot[7]; _Ak[abase + 8] = _Rrot[8];
      const rvx = _Rrot[0] * pivotX + _Rrot[1] * pivotY + _Rrot[2] * pivotZ;
      const rvy = _Rrot[3] * pivotX + _Rrot[4] * pivotY + _Rrot[5] * pivotZ;
      const rvz = _Rrot[6] * pivotX + _Rrot[7] * pivotY + _Rrot[8] * pivotZ;
      _bk[bbase] = pivotX + posX - rvx;
      _bk[bbase + 1] = pivotY + posY - rvy;
      _bk[bbase + 2] = pivotZ + posZ - rvz;
      _axisAligned[p] = (yawMod90 && rotZero) ? 1 : 0;
    } else {
      const pAbase = parentIdx * 9, pBbase = parentIdx * 3;
      _tmp9[0] = _Ak[pAbase]; _tmp9[1] = _Ak[pAbase + 1]; _tmp9[2] = _Ak[pAbase + 2];
      _tmp9[3] = _Ak[pAbase + 3]; _tmp9[4] = _Ak[pAbase + 4]; _tmp9[5] = _Ak[pAbase + 5];
      _tmp9[6] = _Ak[pAbase + 6]; _tmp9[7] = _Ak[pAbase + 7]; _tmp9[8] = _Ak[pAbase + 8];
      matMul3(_tmp9, _Rrot, _AkT); // reuse _AkT as scratch for the product before storing
      _Ak[abase] = _AkT[0]; _Ak[abase + 1] = _AkT[1]; _Ak[abase + 2] = _AkT[2];
      _Ak[abase + 3] = _AkT[3]; _Ak[abase + 4] = _AkT[4]; _Ak[abase + 5] = _AkT[5];
      _Ak[abase + 6] = _AkT[6]; _Ak[abase + 7] = _AkT[7]; _Ak[abase + 8] = _AkT[8];

      const rvx = _Rrot[0] * pivotX + _Rrot[1] * pivotY + _Rrot[2] * pivotZ;
      const rvy = _Rrot[3] * pivotX + _Rrot[4] * pivotY + _Rrot[5] * pivotZ;
      const rvz = _Rrot[6] * pivotX + _Rrot[7] * pivotY + _Rrot[8] * pivotZ;
      const lx = pivotX + posX - rvx, ly = pivotY + posY - rvy, lz = pivotZ + posZ - rvz;
      _bk[bbase] = _tmp9[0] * lx + _tmp9[1] * ly + _tmp9[2] * lz + _bk[pBbase];
      _bk[bbase + 1] = _tmp9[3] * lx + _tmp9[4] * ly + _tmp9[5] * lz + _bk[pBbase + 1];
      _bk[bbase + 2] = _tmp9[6] * lx + _tmp9[7] * ly + _tmp9[8] * lz + _bk[pBbase + 2];
      _axisAligned[p] = (yawMod90 && rotZero && _axisAligned[parentIdx]) ? 1 : 0;
    }

    // Forward Aw_k = Aw * Ak, bw_k = Aw*bk + bw (for the world AABB only).
    _tmp9[0] = _Ak[abase]; _tmp9[1] = _Ak[abase + 1]; _tmp9[2] = _Ak[abase + 2];
    _tmp9[3] = _Ak[abase + 3]; _tmp9[4] = _Ak[abase + 4]; _tmp9[5] = _Ak[abase + 5];
    _tmp9[6] = _Ak[abase + 6]; _tmp9[7] = _Ak[abase + 7]; _tmp9[8] = _Ak[abase + 8];
    matMul3(_Aw, _tmp9, _AkT); // _AkT reused as Aw_k scratch
    const fbase = p * 12;
    FORWARD[fbase] = _AkT[0]; FORWARD[fbase + 1] = _AkT[1]; FORWARD[fbase + 2] = _AkT[2];
    FORWARD[fbase + 3] = _AkT[3]; FORWARD[fbase + 4] = _AkT[4]; FORWARD[fbase + 5] = _AkT[5];
    FORWARD[fbase + 6] = _AkT[6]; FORWARD[fbase + 7] = _AkT[7]; FORWARD[fbase + 8] = _AkT[8];
    FORWARD[fbase + 9] = _Aw[0] * _bk[bbase] + _Aw[1] * _bk[bbase + 1] + _Aw[2] * _bk[bbase + 2] + _bw[0];
    FORWARD[fbase + 10] = _Aw[3] * _bk[bbase] + _Aw[4] * _bk[bbase + 1] + _Aw[5] * _bk[bbase + 2] + _bw[1];
    FORWARD[fbase + 11] = _Aw[6] * _bk[bbase] + _Aw[7] * _bk[bbase + 1] + _Aw[8] * _bk[bbase + 2] + _bw[2];

    // Amat = (1/cellM) * Ak^T * RzYawInv; b = -Amat * bw_k.
    transpose3(_tmp9, _AkT); // _AkT = Ak^T (transpose of the Ak we just copied into _tmp9)
    matMul3(_AkT, _RzYawInv, _tmp9); // reuse _tmp9 for the product Ak^T*RzYawInv
    const obase = p * PART_STRIDE;
    out[obase] = _tmp9[0] * invCellM; out[obase + 1] = _tmp9[1] * invCellM; out[obase + 2] = _tmp9[2] * invCellM;
    out[obase + 3] = _tmp9[3] * invCellM; out[obase + 4] = _tmp9[4] * invCellM; out[obase + 5] = _tmp9[5] * invCellM;
    out[obase + 6] = _tmp9[6] * invCellM; out[obase + 7] = _tmp9[7] * invCellM; out[obase + 8] = _tmp9[8] * invCellM;

    const fb2 = p * 12;
    const bwx = FORWARD[fb2 + 9], bwy = FORWARD[fb2 + 10], bwz = FORWARD[fb2 + 11];
    out[obase + 9] = -(out[obase] * bwx + out[obase + 1] * bwy + out[obase + 2] * bwz);
    out[obase + 10] = -(out[obase + 3] * bwx + out[obase + 4] * bwy + out[obase + 5] * bwz);
    out[obase + 11] = -(out[obase + 6] * bwx + out[obase + 7] * bwy + out[obase + 8] * bwz);
    out[obase + 12] = _axisAligned[p];
    out[obase + 13] = 0; out[obase + 14] = 0; out[obase + 15] = 0;
  }
}

/**
 * US-041a (15.3 item 5): world position of `pm`'s mount `name` (validated at
 * load - VoxelModel.js's `validateVoxelModel` - so an unknown `part` can
 * never reach here), a light anchor / E-prompt point that follows its part's
 * CURRENT animated pose. Helper-only in M1 (no billboard attach - consumers
 * are US-042/US-022). Must be called right after `computeVoxelPose` for the
 * SAME instance (reads the shared `FORWARD` scratch that call just filled -
 * same "read it before doing anything else for this instance" convention
 * `castModels` itself follows, not per-instance state). Writes into `out`
 * (length >= 3); returns `out`, or null if `pm` has no mount named `name`.
 */
export function voxelMountWorld(pm, name, out) {
  const mount = pm.mounts && pm.mounts[name];
  if (!mount) return null;
  const at = mount.at;
  const fbase = mount.partIdx * 12;
  out[0] = FORWARD[fbase] * at[0] + FORWARD[fbase + 1] * at[1] + FORWARD[fbase + 2] * at[2] + FORWARD[fbase + 9];
  out[1] = FORWARD[fbase + 3] * at[0] + FORWARD[fbase + 4] * at[1] + FORWARD[fbase + 5] * at[2] + FORWARD[fbase + 10];
  out[2] = FORWARD[fbase + 6] * at[0] + FORWARD[fbase + 7] * at[1] + FORWARD[fbase + 8] * at[2] + FORWARD[fbase + 11];
  return out;
}
