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
  ib.u32[o + 13] = (aligned | ((team & 0xff) << INST_TEAM_SHIFT)) >>> 0;
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
 * @typedef {Object} InstanceGroup
 * @property {string} modelKey
 * @property {InstanceBuffer} ib - the game writes instances here
 * @property {number} count - the game sets it each frame
 * @property {{clip: number, frame: number, tMs: number}} pose - one animation pose for the whole group
 * @property {InstanceParts} parts - engine-owned scratch
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
   * Pushes one DRAW_INSTANCED item per non-empty group (after
   * `addVoxelInstances`, before `list.cull`; both twins call this).
   * @param {import('./DrawList.js').DrawList} list
   * @param {import('./voxelMesh.js').VoxelMeshCache} cache
   */
  addToDrawList(list, cache) {
    const pool = this.pool;
    if (!pool) return;
    const groups = this.groups;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (g.count <= 0) continue;
      const pm = pool.models.get(g.modelKey);
      if (!pm) continue;
      const mesh = cache.get(pm, g.modelKey, pool.partNamesFor(g.modelKey));
      computeGroupParts(pm, g.pose, g.parts);
      list.addInstances(mesh, g.parts, g.ib, g.count);
    }
  }
}
