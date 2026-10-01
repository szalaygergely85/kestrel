// @ts-check
// engine/mesh/instances.js - RE-06 (docs/architecture.md 28.6). Per-instance
// buffer layout + group registry for instanced voxel units: N copies of one
// model = one draw per part, both twins (GPU raster pass and rasterJS.js).
//
//   world(v) = I_i * P_p * v
//   I_i = instance rigid transform [Rz(yaw) | x y z]  (this buffer, 64 B)
//   P_p = part matrix at the identity instance (computeVoxelPose FORWARD)
// so no second pose implementation exists: `FORWARD(inst) = I * FORWARD(identity)`
// because Aw = Rz*cellM and bw = inst - Aw*anchor (voxelPose.js).
//
// engine/mesh convention: imports engine/voxel/voxelPose.js + VoxelModel.js
// only (never render/gpu). Zero allocation per frame after group creation.
import { computeVoxelPose, FORWARD, cosSinDeg } from '../voxel/voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { classifyAABB, CULL_OUT } from './culling.js';

/** Words / bytes per instance. */
export const INSTANCE_STRIDE = 16;
export const INSTANCE_BYTES = 64;
/** Word offsets inside one instance. Rows 0..2 = [A_r0 A_r1 A_r2 t_r] at 4r. */
export const INST_ROW0 = 0, INST_ROW1 = 4, INST_ROW2 = 8;
export const INST_OBJECT_ID = 12; // u32
export const INST_FLAGS = 13;     // u32: bit0 yawAligned, bits 8-15 team
export const INST_FLAG_ALIGNED = 1;
export const INST_TEAM_SHIFT = 8;
/** Unit objectIds are `UNIT_OBJECT_BASE | unitIndex` (bit 16 = unit space; 27.4 ranges <= 0x8FFF untouched). */
export const UNIT_OBJECT_BASE = 0x10000;

/** Groups the registry can hold / instances the GPU uploads per frame. */
export const MAX_INSTANCE_GROUPS = 32;
export const MAX_INSTANCES_PER_FRAME = 2048;

/**
 * @typedef {Object} InstanceBuffer
 * @property {Float32Array} f32
 * @property {Uint32Array} u32 - same memory as `f32`
 * @property {number} capacity - instances
 */

/** @param {number} capacity @returns {InstanceBuffer} */
export function createInstanceBuffer(capacity) {
  const buf = new ArrayBuffer(capacity * INSTANCE_BYTES);
  return { f32: new Float32Array(buf), u32: new Uint32Array(buf), capacity };
}

const _cs = new Float64Array(2);

/**
 * Writes a yaw-only unit instance (feet position x,y,z; yaw in degrees).
 * Exact matrices at multiples of 90 (cosSinDeg). Zero allocation.
 * @param {InstanceBuffer} ib
 * @param {number} i
 * @param {number} objectId - game-set; convention `UNIT_OBJECT_BASE | unitIndex`
 * @param {number} team - 0..7
 */
export function writeUnitInstance(ib, i, x, y, z, yawDeg, objectId, team) {
  cosSinDeg(yawDeg, _cs);
  const c = _cs[0], s = _cs[1];
  const f = ib.f32, o = i * INSTANCE_STRIDE;
  f[o] = c; f[o + 1] = -s; f[o + 2] = 0; f[o + 3] = x;
  f[o + 4] = s; f[o + 5] = c; f[o + 6] = 0; f[o + 7] = y;
  f[o + 8] = 0; f[o + 9] = 0; f[o + 10] = 1; f[o + 11] = z;
  const aligned = (((yawDeg % 90) + 90) % 90 === 0) ? INST_FLAG_ALIGNED : 0; // the exact voxelPose test
  ib.u32[o + 12] = objectId >>> 0;
  ib.u32[o + 13] = (aligned | ((team & 7) << INST_TEAM_SHIFT)) >>> 0;
  f[o + 14] = 0; f[o + 15] = 0;
}

/**
 * @typedef {Object} InstanceParts
 * @property {Float64Array} m - MAX_VOX_PARTS*12: P_p (A row-major 9, t 3)
 * @property {Uint8Array} flags - MAX_VOX_PARTS; bit0 = part pose axis-aligned (at yaw 0)
 * @property {number} count
 */

/** @returns {InstanceParts} */
export function createInstanceParts() {
  return { m: new Float64Array(MAX_VOX_PARTS * 12), flags: new Uint8Array(MAX_VOX_PARTS), count: 0 };
}

const _idInst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0 };
const _poseScratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);

/**
 * P_p for every part of `pm` at the identity instance (one pose per group).
 * @param {any} pm - PackedVoxelModel
 * @param {{clip: number, frame: number, tMs: number}} pose
 * @param {InstanceParts} out
 */
export function computeGroupParts(pm, pose, out) {
  _idInst.clip = pose.clip; _idInst.frame = pose.frame; _idInst.tMs = pose.tMs;
  computeVoxelPose(pm, _idInst, _poseScratch);
  const n = pm.partCount;
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 12; c++) out.m[p * 12 + c] = FORWARD[p * 12 + c];
    out.flags[p] = _poseScratch[p * PART_STRIDE + 12];
  }
  out.count = n;
}

/**
 * RE-15a (28.13 point 2): max |corner| of `mesh.bbox` under any of `parts`'
 * part matrices - the group's conservative bounding radius R, s.t. every
 * instance's world AABB is `t-R .. t+R` (t = the instance translation).
 * Factored out of `DrawList.addInstances` so both the whole-group AABB
 * (DrawList.js) and the new per-instance cull (below) share one computation,
 * done once per group per frame rather than per instance. Zero allocation.
 * @param {import('./MeshData.js').MeshData} mesh
 * @param {{m: Float64Array, count: number}} parts
 * @returns {number}
 */
export function groupRadius(mesh, parts) {
  const b = mesh.bbox;
  let r2 = 0;
  for (let p = 0; p < parts.count; p++) {
    const o = p * 12;
    for (let c = 0; c < 8; c++) {
      const x = (c & 1) ? b[3] : b[0], y = (c & 2) ? b[4] : b[1], z = (c & 4) ? b[5] : b[2];
      const wx = parts.m[o] * x + parts.m[o + 1] * y + parts.m[o + 2] * z + parts.m[o + 9];
      const wy = parts.m[o + 3] * x + parts.m[o + 4] * y + parts.m[o + 5] * z + parts.m[o + 10];
      const wz = parts.m[o + 6] * x + parts.m[o + 7] * y + parts.m[o + 8] * z + parts.m[o + 11];
      const d2 = wx * wx + wy * wy + wz * wz;
      if (d2 > r2) r2 = d2;
    }
  }
  return Math.sqrt(r2);
}

/**
 * RE-15a (28.13 point 3): compacts the survivors of `classifyAABB(planes,
 * t-R, t+R)` (t = instance translation, words 3/7/11) from `g.ib` (the
 * game-owned, never-written source) into `g.drawIb[0]` (engine-owned scratch),
 * stable, in game order. Copies all 16 words through the `u32` view so the
 * objectId/flags words (stored as uint32 bit patterns in the same buffer)
 * round-trip bit-exact - a `Float32Array` get/set round-trip is not
 * guaranteed bit-exact for arbitrary bit patterns (NaN payloads). Zero
 * allocation (plain `for` loop, never `subarray`/`set(subarray)`).
 * Conservative: a straddling box (CULL_STRADDLE) is kept, only CULL_OUT drops.
 * @param {InstanceGroup} g
 * @param {Float64Array|null} planes - `frustumPlanes` output, or null/undefined = no cull (keep all)
 * @param {number} R - `groupRadius(mesh, g.parts)`, this group this frame
 * @returns {number} survivor count
 */
function compactGroup(g, planes, R) {
  const srcF = g.ib.f32, srcU = g.ib.u32;
  const dstU = g.drawIb[0].u32;
  const n = g.count;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_STRIDE;
    if (planes) {
      const tx = srcF[o + 3], ty = srcF[o + 7], tz = srcF[o + 11];
      if (classifyAABB(planes, tx - R, ty - R, tz - R, tx + R, ty + R, tz + R) === CULL_OUT) continue;
    }
    const wo = w * INSTANCE_STRIDE;
    for (let c = 0; c < INSTANCE_STRIDE; c++) dstU[wo + c] = srcU[o + c];
    w++;
  }
  return w;
}

/**
 * @typedef {Object} InstanceGroup
 * @property {string} modelKey
 * @property {InstanceBuffer} ib - the game writes instances here, never written by the engine
 * @property {number} count - the game sets it each frame
 * @property {{clip: number, frame: number, tMs: number}} pose - one animation pose for the whole group
 * @property {InstanceParts} parts - engine-owned scratch
 * @property {[InstanceBuffer, InstanceBuffer]} drawIb - RE-15a: engine-owned compacted scratch, index 0 = LOD0 (used), 1 = LOD1 (RE-15c, allocated but unused here)
 * @property {[number, number]} drawCount - survivor counts into `drawIb[0]`/`drawIb[1]`
 * @property {number|null} _memoFrameNo - RE-15a: the `frameNo` this group's `drawIb`/`drawCount` were last computed for
 * @property {boolean} used
 */

/**
 * Registry of instance groups (`engine.instances`). The game creates a group
 * per (model, animation phase) and refills `ib`/`count`/`pose` every frame;
 * the engine turns each non-empty group into one `DRAW_INSTANCED` item.
 */
export class InstanceGroups {
  constructor() {
    /** @type {InstanceGroup[]} */
    this.groups = [];
    this.pool = /** @type {any} */ (null);
    // RE-15a (28.13 point 8): F3 stats, reset once per memoized frame (not
    // per group/call) so a second same-frameNo `addToDrawList` call never
    // double-counts. `instancesLod1` stays 0 until RE-15c.
    this.stats = { instances: 0, instancesCulled: 0, instancesLod1: 0 };
    /** @type {number|null} the last `frameNo` seen by `addToDrawList` */
    this._lastFrameNo = null;
  }

  /** @param {any} pool - the bound VoxelPool (models registry + partNamesFor) */
  bindPool(pool) { this.pool = pool; }

  /**
   * @param {string} modelKey
   * @param {number} capacity - instances
   * @returns {InstanceGroup}
   */
  group(modelKey, capacity) {
    if (this.groups.length >= MAX_INSTANCE_GROUPS) throw new Error(`InstanceGroups: over ${MAX_INSTANCE_GROUPS} groups`);
    const g = {
      modelKey, ib: createInstanceBuffer(capacity), count: 0,
      pose: { clip: -1, frame: 0, tMs: 0 }, parts: createInstanceParts(), used: true,
      // RE-15a (28.13 point 3): both LOD buckets allocated now (index 1 is
      // RE-15c's future LOD1 bucket - unused, always drawCount[1] === 0 here).
      drawIb: [createInstanceBuffer(capacity), createInstanceBuffer(capacity)],
      drawCount: [0, 0],
      _memoFrameNo: null,
    };
    this.groups.push(g);
    return g;
  }

  /** @param {InstanceGroup} g */
  remove(g) {
    const i = this.groups.indexOf(g);
    if (i >= 0) this.groups.splice(i, 1);
  }

  /**
   * Pushes one DRAW_INSTANCED item per non-empty, non-fully-culled group
   * (after `addVoxelInstances`, before `list.cull`; both twins call this).
   * RE-15a (28.13): per-instance frustum cull + compaction into `g.drawIb[0]`,
   * memoized on `frameNo` - a group already computed for this `frameNo` is
   * re-pushed from its cached `drawIb[0]`/`drawCount[0]` without recomputing
   * (matters when `?gpucompare=1` runs the GPU pass and the JS twin for the
   * same logical frame; also keeps RE-15c's future LOD hysteresis state from
   * advancing twice). `stats` (F3) is reset once per NEW `frameNo`, not per
   * call, so a memoized repeat never double-counts.
   * @param {import('./DrawList.js').DrawList} list
   * @param {import('./voxelMesh.js').VoxelMeshCache} cache
   * @param {Float64Array|null} [planes] - `frustumPlanes` output; omitted/null = no cull (back-compat, keeps all)
   * @param {number} [frameNo] - the rendered-frame counter; omitted (not a number) = always
   *   recompute, no memo - every call resets stats and recomputes every group, even back to back
   *   in the same tick (RE-15a fixes, PC-B Q7 item 1: `frameNo !== this._lastFrameNo` alone let two
   *   `undefined`-frameNo calls in a row see "unchanged" and wrongly reuse a stale memo).
   */
  addToDrawList(list, cache, planes, frameNo) {
    const pool = this.pool;
    if (!pool) return;
    const groups = this.groups;
    const memo = typeof frameNo === 'number';
    if (!memo || frameNo !== this._lastFrameNo) {
      this._lastFrameNo = frameNo;
      this.stats.instances = 0;
      this.stats.instancesCulled = 0;
      this.stats.instancesLod1 = 0;
    }
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (g.count <= 0) continue;
      const pm = pool.models.get(g.modelKey);
      if (!pm) continue;
      const mesh = cache.get(pm, g.modelKey, pool.partNamesFor(g.modelKey));
      if (!memo || g._memoFrameNo !== frameNo) {
        computeGroupParts(pm, g.pose, g.parts);
        const R = groupRadius(mesh, g.parts);
        g.drawCount[0] = compactGroup(g, planes, R);
        g.drawCount[1] = 0; // RE-15c fills the LOD1 bucket
        g._memoFrameNo = frameNo;
        this.stats.instances += g.drawCount[0];
        this.stats.instancesCulled += g.count - g.drawCount[0];
      }
      if (g.drawCount[0] <= 0) continue;
      list.addInstances(mesh, g.parts, g.drawIb[0], g.drawCount[0]);
    }
  }
}
