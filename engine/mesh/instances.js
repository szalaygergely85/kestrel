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
import { lodBandFrac, lodDitherBits } from './lodDither.js';
import { requestMeshForGroup } from './lazyMesh.js';
import { DRAW_FLAG_ONE_PART } from './DrawList.js'; // runtime use only (DrawList imports groupRadius from here)

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
export const MAX_INSTANCES_PER_FRAME = 4096;

/**
 * @typedef {Object} InstanceBuffer
 * @property {Float32Array} f32
 * @property {Uint32Array} u32 - same memory as `f32`
 * @property {number} capacity - instances
 * @property {number} version - WG-4b(c): write counter (int32 wrap). `writeUnitInstance` bumps it when a row's words actually change, `touchInstances`
 *   is the explicit bump for raw `f32`/`u32` writers. The WebGPU shadow dirty-skip keys GPU-owned groups on (group.id, ib.version, count) instead of hashing rows.
 */

/** @param {number} capacity @returns {InstanceBuffer} */
export function createInstanceBuffer(capacity) {
  const buf = new ArrayBuffer(capacity * INSTANCE_BYTES);
  return { f32: new Float32Array(buf), u32: new Uint32Array(buf), capacity, version: 0 };
}

/** Raw writers (anything that writes `ib.f32`/`ib.u32` without `writeUnitInstance`) call this once per batch of writes. @param {InstanceBuffer} ib */
export function touchInstances(ib) { ib.version = (ib.version + 1) | 0; }

const _cs = new Float64Array(2);
const _old = new Uint32Array(INSTANCE_STRIDE);

/**
 * Writes a yaw-only unit instance (feet position x,y,z; yaw in degrees).
 * Exact matrices at multiples of 90 (cosSinDeg). Zero allocation.
 * @param {InstanceBuffer} ib
 * @param {number} i
 * @param {number} objectId - game-set; convention `UNIT_OBJECT_BASE | unitIndex`
 *   Bits 20-26 are reserved for the AUD-47 vegetation tint (marker bit 26); units/game ids must not use them.
 * @param {number} team - 0..7
 */
export function writeUnitInstance(ib, i, x, y, z, yawDeg, objectId, team) {
  cosSinDeg(yawDeg, _cs);
  const c = _cs[0], s = _cs[1];
  const f = ib.f32, o = i * INSTANCE_STRIDE, u = ib.u32;
  for (let w = 0; w < INSTANCE_STRIDE; w++) _old[w] = u[o + w];
  f[o] = c; f[o + 1] = -s; f[o + 2] = 0; f[o + 3] = x;
  f[o + 4] = s; f[o + 5] = c; f[o + 6] = 0; f[o + 7] = y;
  f[o + 8] = 0; f[o + 9] = 0; f[o + 10] = 1; f[o + 11] = z;
  const aligned = (((yawDeg % 90) + 90) % 90 === 0) ? INST_FLAG_ALIGNED : 0; // the exact voxelPose test
  ib.u32[o + 12] = objectId >>> 0;
  ib.u32[o + 13] = (aligned | ((team & 7) << INST_TEAM_SHIFT)) >>> 0;
  f[o + 14] = 0; f[o + 15] = 0;
  for (let w = 0; w < INSTANCE_STRIDE; w++) if (u[o + w] !== _old[w]) { ib.version = (ib.version + 1) | 0; break; } // unchanged rewrite (static units every frame) keeps the version
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

const _idInst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, addPart: -1 };
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
 * RE-15a/c (28.13 points 2, 3, 6): compacts the survivors of `classifyAABB(planes,
 * t-R, t+R)` (t = instance translation, words 3/7/11) from `g.ib` (game-owned,
 * never written) into the engine-owned `g.drawIb[0]` (LOD0) / `g.drawIb[1]`
 * (LOD1), stable, in game order. Copies all 16 words through the `u32` view so
 * objectId/flags round-trip bit-exact. Zero allocation (plain loops, never
 * `subarray`). Conservative: only CULL_OUT drops.
 * LOD (RE-15c): when `g.lodCells > 0` and `vp` (column-major viewProj) is given,
 * `cells = R * ySc * rows / w` (ySc = |y_clip row xyz|, w = clip w of t);
 * LOD1 when cells < lodCells*0.9, LOD0 when > lodCells*1.1, else the previous
 * choice (`g.lodPrev`, by game slot). w <= 0 (behind/at the eye) -> LOD0.
 * @param {InstanceGroup} g
 * @param {Float64Array|null} planes - null = no cull (keep all)
 * @param {number} R - conservative radius over both LOD meshes
 * @param {Float64Array|null} vp
 * @param {number} rows
 * @param {number} [swayPad] - S8-B2-06: extra metres on the cull sphere (SWAY_MAX while wind sway is on); the LOD cell estimate keeps plain `R`
 */
export function compactGroup(g, planes, R, vp, rows, swayPad = 0) {
  const srcF = g.ib.f32, srcU = g.ib.u32;
  const dst0 = g.drawIb[0].u32, dst1 = g.drawIb[1].u32;
  const n = g.count;
  const lodOn = g.lodCells > 0 && !!vp;
  const lo = g.lodCells * 0.9, hi = g.lodCells * 1.1;
  let k = 0;
  if (lodOn) k = R * Math.sqrt(vp[1] * vp[1] + vp[5] * vp[5] + vp[9] * vp[9]) * rows;
  const lodPrev = g.lodPrev;
  const Rc = R + swayPad;
  // QUAT-LOD-01 part 2: near-LOD0 cap, only meaningful with LOD on (there must be an LOD1 bucket to push the excess into).
  // Natural LOD0 survivors are buffered (index + projected `cells`) instead of written straight to dst0, so the top
  // `g.lod0Cap` by `cells` (= nearest by the engine's own LOD metric) can be picked after the loop. `lodPrev` is left as the
  // NATURAL hysteresis state (cap never perturbs it): the cap is a pure per-frame draw-bucket decision on top.
  const capOn = lodOn && g.lod0Cap > 0;
  const lod0Idx = g._lod0Idx, lod0Cells = g._lod0Cells;
  let nat0 = 0;
  let w0 = 0, w1 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_STRIDE;
    const tx = srcF[o + 3], ty = srcF[o + 7], tz = srcF[o + 11];
    if (planes && classifyAABB(planes, tx - Rc, ty - Rc, tz - Rc, tx + Rc, ty + Rc, tz + Rc) === CULL_OUT) continue;
    let lod = 0;
    let cellsForCap = Infinity; // w <= 1e-6 (behind/at the eye): no projected size, treat as nearest (top cap priority)
    if (lodOn) {
      const cw = vp[3] * tx + vp[7] * ty + vp[11] * tz + vp[15];
      if (cw > 1e-6) {
        const cells = k / cw;
        cellsForCap = cells;
        lod = cells < lo ? 1 : cells > hi ? 0 : lodPrev[i];
        if (g.lodDither && cells >= lo && cells <= hi) { // S8-B2-07: screen-door crossfade, both copies with complementary coverage bits
          const f = lodBandFrac(cells, lo, hi);
          for (let c = 0; c < INSTANCE_STRIDE; c++) { dst0[w0 * INSTANCE_STRIDE + c] = srcU[o + c]; dst1[w1 * INSTANCE_STRIDE + c] = srcU[o + c]; }
          dst0[w0 * INSTANCE_STRIDE + 13] = (srcU[o + 13] | lodDitherBits(f, 0)) >>> 0;
          dst1[w1 * INSTANCE_STRIDE + 13] = (srcU[o + 13] | lodDitherBits(f, 1)) >>> 0;
          w0++; w1++;
          lodPrev[i] = f >= 0.5 ? 0 : 1;
          continue;
        }
      }
      lodPrev[i] = lod;
    }
    if (lod) {
      const wo = w1 * INSTANCE_STRIDE;
      for (let c = 0; c < INSTANCE_STRIDE; c++) dst1[wo + c] = srcU[o + c];
      w1++;
    } else if (capOn) {
      lod0Idx[nat0] = i; lod0Cells[nat0] = cellsForCap; nat0++;
    } else {
      const wo = w0 * INSTANCE_STRIDE;
      for (let c = 0; c < INSTANCE_STRIDE; c++) dst0[wo + c] = srcU[o + c];
      w0++;
    }
  }
  if (capOn) {
    const cap = g.lod0Cap;
    if (nat0 <= cap) {
      for (let j = 0; j < nat0; j++) { const o = lod0Idx[j] * INSTANCE_STRIDE, wo = w0 * INSTANCE_STRIDE; for (let c = 0; c < INSTANCE_STRIDE; c++) dst0[wo + c] = srcU[o + c]; w0++; }
    } else {
      // Partial selection: the `cap` largest-`cells` entries end up in [0,cap) (order scrambled), the rest in [cap,nat0).
      for (let s = 0; s < cap; s++) {
        let best = s, bestC = lod0Cells[s];
        for (let j = s + 1; j < nat0; j++) if (lod0Cells[j] > bestC) { bestC = lod0Cells[j]; best = j; }
        if (best !== s) {
          const ti = lod0Idx[s]; lod0Idx[s] = lod0Idx[best]; lod0Idx[best] = ti;
          const tc = lod0Cells[s]; lod0Cells[s] = lod0Cells[best]; lod0Cells[best] = tc;
        }
      }
      _insertionSortByIdx(lod0Idx, 0, cap); // stable game order within each written bucket
      _insertionSortByIdx(lod0Idx, cap, nat0);
      for (let j = 0; j < cap; j++) { const o = lod0Idx[j] * INSTANCE_STRIDE, wo = w0 * INSTANCE_STRIDE; for (let c = 0; c < INSTANCE_STRIDE; c++) dst0[wo + c] = srcU[o + c]; w0++; }
      for (let j = cap; j < nat0; j++) { const o = lod0Idx[j] * INSTANCE_STRIDE, wo = w1 * INSTANCE_STRIDE; for (let c = 0; c < INSTANCE_STRIDE; c++) dst1[wo + c] = srcU[o + c]; w1++; }
    }
  }
  g.drawCount[0] = w0; g.drawCount[1] = w1;
  touchInstances(g.drawIb[0]); touchInstances(g.drawIb[1]); // AUD-02: raw compaction writes -> version bump (the GPU upload skips an unchanged version)
  return w0 + w1;
}

/** Plain insertion sort of `idx[lo..hi)` ascending, in place. Zero allocation; `hi-lo` is `lod0Cap`-sized (small). */
function _insertionSortByIdx(idx, lo, hi) {
  for (let i = lo + 1; i < hi; i++) {
    const v = idx[i];
    let j = i - 1;
    while (j >= lo && idx[j] > v) { idx[j + 1] = idx[j]; j--; }
    idx[j + 1] = v;
  }
}

/** ME-15f (27.9a amendment 5): hysteresis half-width (m) of the shadow distance bands. */
export const SHADOW_BAND_HYST_M = 2;

/**
 * ME-15f: buckets the instances of `g` for the sun shadow pass by horizontal distance from the eye:
 * band 0 (d <= lod0M) -> `g.shadowIb[0]` (LOD0 mesh), band 1 (d <= castM) -> `g.shadowIb[1]` (LOD1 mesh),
 * band 2 -> no shadow. +-SHADOW_BAND_HYST_M hysteresis via `g.shadowBand` (per game slot, like `lodPrev`).
 * Instances whose sphere (t +- R) is fully outside the shadow `planes` are dropped (planes null = keep).
 * Reads `g.ib` (never written), writes only the engine-owned `g.shadowIb`/`g.shadowCount`.
 * Compacted rows are copied through the u32 view (bit-exact). Zero allocation.
 * @param {InstanceGroup} g
 * @param {number} ex @param {number} ey - eye xy
 * @param {number} lod0M @param {number} castM
 * @param {Float64Array|null} planes
 * @param {number} R - conservative radius over both LOD meshes
 * @param {number} [swayPad] - S8-B2-06: extra metres on the plane-cull sphere (SWAY_MAX while wind sway is on)
 * @returns {number} kept instances (both bands)
 */
export function fillShadowBands(g, ex, ey, lod0M, castM, planes, R, swayPad = 0) {
  const srcF = g.ib.f32, srcU = g.ib.u32;
  const dst0 = g.shadowIb[0].u32, dst1 = g.shadowIb[1].u32;
  const band = g.shadowBand;
  const h = SHADOW_BAND_HYST_M;
  const n = g.count;
  const Rc = R + swayPad;
  let w0 = 0, w1 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_STRIDE;
    const tx = srcF[o + 3], ty = srcF[o + 7];
    const dx = tx - ex, dy = ty - ey;
    const d = Math.sqrt(dx * dx + dy * dy);
    let b = band[i];
    if (b === 2 && d < castM - h) b = 1;
    if (b === 1 && d < lod0M - h) b = 0;
    if (b === 0 && d > lod0M + h) b = 1;
    if (b === 1 && d > castM + h) b = 2;
    band[i] = b;
    if (b === 2) continue;
    const tz = srcF[o + 11];
    if (planes && classifyAABB(planes, tx - Rc, ty - Rc, tz - Rc, tx + Rc, ty + Rc, tz + Rc) === CULL_OUT) continue;
    const dst = b ? dst1 : dst0;
    const wo = (b ? w1 : w0) * INSTANCE_STRIDE;
    for (let c = 0; c < INSTANCE_STRIDE; c++) dst[wo + c] = srcU[o + c];
    if (b) w1++; else w0++;
  }
  g.shadowCount[0] = w0; g.shadowCount[1] = w1;
  touchInstances(g.shadowIb[0]); touchInstances(g.shadowIb[1]); // AUD-02 (see compactGroup)
  return w0 + w1;
}

/**
 * @typedef {Object} InstanceGroup
 * @property {number} id - unique per group (WG-4b(c) shadow dirty-skip key)
 * @property {string} modelKey
 * @property {any} [mesh] - TREES-LP-b: registry MeshData (kind 9, unresolved) for a `meshGroup`; undefined for voxel groups
 * @property {InstanceBuffer} ib - the game writes instances here, never written by the engine
 * @property {number} count - the game sets it each frame
 * @property {{clip: number, frame: number, tMs: number}} pose - one animation pose for the whole group
 * @property {InstanceParts} parts - engine-owned scratch
 * @property {[InstanceBuffer, InstanceBuffer]} drawIb - RE-15a/c: engine-owned compacted scratch, 0 = LOD0, 1 = LOD1
 * @property {number} _R - cached group radius (both LODs) for the memoized frame
 * @property {boolean} [lodDither] - S8-B2-07: crossfade the LOD hysteresis band by screen-door dither (lodDither.js); undefined/false = off
 * @property {number} lodCells - RE-15c: projected-size LOD threshold in cells; 0 (default) = LOD off
 * @property {number} lod0Cap - QUAT-LOD-01 part 2: max LOD0 instances drawn per frame (0 default = no cap); the nearest
 *   (largest projected `cells`) `lod0Cap` naturally-LOD0 instances stay LOD0, the rest draw at LOD1 (needs a ready LOD1 mesh).
 * @property {any} [_mesh1] - QUAT-LOD-01 part 2: `g.mesh`'s resolved LOD1 registry mesh (via `resolveGroupLod1`), cached once;
 *   `undefined` = not yet attempted, `null` = none (no `lods`, no resolver, or lookup miss - permanent).
 * @property {Uint32Array} _lod0Idx - QUAT-LOD-01 part 2: cap scratch, game-slot indices of this frame's natural-LOD0 survivors
 * @property {Float32Array} _lod0Cells - QUAT-LOD-01 part 2: cap scratch, projected `cells` paired with `_lod0Idx`
 * @property {boolean} castShadow - ENV-01a2: false excludes the group from the sun caster list; default true
 * @property {Uint8Array} lodPrev - RE-15c: previous LOD per game slot (hysteresis)
 * @property {[number, number]} drawCount - survivor counts into `drawIb[0]`/`drawIb[1]`
 * @property {number|null} _memoFrameNo - RE-15a: the `frameNo` this group's `drawIb`/`drawCount` were last computed for
 * @property {[InstanceBuffer, InstanceBuffer]} shadowIb - ME-15f: engine-owned sun-shadow buckets, 0 = LOD0 band, 1 = LOD1 band
 * @property {[number, number]} shadowCount - ME-15f: counts in `shadowIb[0]`/`[1]` (filled by `fillShadowBands`)
 * @property {Uint8Array} shadowBand - ME-15f: previous distance band per game slot (0 LOD0, 1 LOD1, 2 none), hysteresis state
 * @property {boolean} used
 */

/**
 * One engine-owned `InstanceGroup` (buffers + scratch). `InstanceGroups.group` registers it; MESH-INST-01's `MeshGroupSet`
 * (meshGroups.js) owns its own, outside the 32-group voxel registry.
 * @param {string} modelKey @param {number} capacity - instances
 * @returns {InstanceGroup}
 */
let _groupSeq = 0;
/** ALPHA-01f-fix: true when a mesh has any masked range (registry MeshData: `ranges[].mask`; draw copy: `maskRanges`). `maskRanges` exists only on draw copies. */
export function meshIsMasked(m) {
  if (m.maskRanges) return true;
  const rs = m.ranges;
  if (rs) for (let i = 0; i < rs.length; i++) if (rs[i].mask) return true;
  return false;
}

export function makeInstanceGroup(modelKey, capacity) {
  const g = {
    id: ++_groupSeq, // WG-4b(c): stable identity for the shadow dirty-skip key
    modelKey, ib: createInstanceBuffer(capacity), count: 0,
    pose: { clip: -1, frame: 0, tMs: 0 }, parts: createInstanceParts(), used: true,
    // RE-15a (28.13 point 3): both LOD buckets allocated now (index 1 is
    // RE-15c's future LOD1 bucket - unused, always drawCount[1] === 0 here).
    drawIb: /** @type {[InstanceBuffer, InstanceBuffer]} */ ([createInstanceBuffer(capacity), createInstanceBuffer(capacity)]),
    drawCount: /** @type {[number, number]} */ ([0, 0]),
    shadowIb: /** @type {[InstanceBuffer, InstanceBuffer]} */ ([createInstanceBuffer(capacity), createInstanceBuffer(capacity)]),
    shadowCount: /** @type {[number, number]} */ ([0, 0]), shadowBand: new Uint8Array(capacity),
    lodCells: 0, castShadow: true, lodPrev: new Uint8Array(capacity), _R: 0,
    _memoFrameNo: /** @type {number|null} */ (null),
    // QUAT-LOD-01 part 2: near-LOD0 cap (0 = off) + its scratch, and the lazily-resolved LOD1 registry mesh for `g.mesh` groups.
    lod0Cap: 0, _mesh1: undefined, _lod0Idx: new Uint32Array(capacity), _lod0Cells: new Float32Array(capacity),
  };
  return g;
}

/**
 * QUAT-LOD-01 part 2: resolves a `meshGroup`'s LOD1 registry mesh from its LOD0 `mesh.lods[0].mesh` id, once (cached on
 * `g._mesh1`; `undefined` = not yet attempted this group's lifetime). `lookup` resolves a registry mesh id to its MeshData
 * (host-bound via `InstanceGroups.bindMeshResolver`, e.g. `assets.mesh`); no `lods`, no `lookup`, or a lookup miss caches
 * `null` forever (a mesh's `lods` never changes after load). Ready-ness (`!mesh.lazy`, MESH-LOAD-01) is re-checked every
 * call - cheap property read, no re-resolution - so an unloaded/evicted LOD1 shell correctly reports "not ready" (caller
 * falls back to LOD0, no pop to nothing) until its payload arrives.
 * @param {InstanceGroup} g @param {((id: string) => any)|null|undefined} lookup @returns {any|null} ready LOD1 mesh, or null
 */
export function resolveGroupLod1(g, lookup) {
  if (g._mesh1 === undefined) {
    const spec = g.mesh && g.mesh.lods && g.mesh.lods[0];
    g._mesh1 = (spec && spec.mesh && lookup) ? (lookup(spec.mesh) || null) : null;
  }
  return (g._mesh1 && !g._mesh1.lazy) ? g._mesh1 : null;
}

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
    /** S8-B2-06: metres added to every group's cull / shadow-cull sphere; the host sets SWAY_MAX while wind sway is on (windSwayOn), else 0. */
    this.swayPad = 0;
    /** @type {number|null} the last `frameNo` seen by `addToDrawList` */
    this._lastFrameNo = null;
    /** @type {((id: string) => any)|null} QUAT-LOD-01 part 2: resolves a registry mesh id to its MeshData, for `g.mesh.lods[0].mesh`; unbound (null) = mesh groups never get LOD1 (`resolveGroupLod1` always returns null). */
    this._meshLookup = null;
  }

  /** @param {any} pool - the bound VoxelPool (models registry + partNamesFor) */
  bindPool(pool) { this.pool = pool; }

  /** QUAT-LOD-01 part 2: binds the registry mesh-id resolver (e.g. `(id) => assets.mesh(id)`) `meshGroup` LOD1 lookups use. @param {(id: string) => any} fn */
  bindMeshResolver(fn) { this._meshLookup = fn; }

  /**
   * @param {string} modelKey
   * @param {number} capacity - instances
   * @returns {InstanceGroup}
   */
  group(modelKey, capacity) {
    if (this.groups.length >= MAX_INSTANCE_GROUPS) throw new Error(`InstanceGroups: over ${MAX_INSTANCE_GROUPS} groups`);
    const g = makeInstanceGroup(modelKey, capacity);
    this.groups.push(g);
    return g;
  }

  /**
   * TREES-LP-b (37.15 item 3): a group of N unscaled copies of one imported kind-9 mesh (`mesh` = registry MeshData,
   * material keys unresolved). Same words as a voxel group (`writeUnitInstance`), one identity part, LOD off. Drawn only
   * when `addToDrawList`/`buildShadowList` get a `meshDraw`/`meshCache` (otherwise skipped). Not back-face-safe for
   * one-sided meshes (the instanced path culls back faces): use closed/solid meshes (trees). No masked ranges.
   * @param {any} mesh @param {number} capacity - instances
   * @returns {InstanceGroup}
   */
  meshGroup(mesh, capacity) {
    if (!mesh || mesh.layout !== 'static' || !mesh.ranges || mesh.ranges.length < 1) throw new Error('InstanceGroups.meshGroup: needs a static kind-9 mesh');
    // ALPHA-01f (b) host: masked ranges are now supported (MeshBuffers.getVoxel's uvMaskBuffer + passRaster.js's instanced-masked draw path).
    if (this.groups.length >= MAX_INSTANCE_GROUPS) throw new Error(`InstanceGroups: over ${MAX_INSTANCE_GROUPS} groups`);
    const g = makeInstanceGroup(mesh.id || 'mesh', capacity);
    g.mesh = mesh;
    // ALPHA-01f-fix: a masked mesh is drawn per range WITHOUT DRAW_FLAG_ONE_PART, so the CPU loops read partMatrices[range*12]
    // for every range: identity into parts 0..R-1 (unmasked groups: one identity part, read via DRAW_FLAG_ONE_PART).
    const R = meshIsMasked(mesh) ? mesh.ranges.length : 1;
    if (R > MAX_VOX_PARTS) throw new Error(`InstanceGroups.meshGroup: masked mesh has ${R} ranges (> ${MAX_VOX_PARTS})`);
    for (let p = 0; p < R; p++) { const o = p * 12; g.parts.m[o] = 1; g.parts.m[o + 4] = 1; g.parts.m[o + 8] = 1; g.parts.flags[p] = 1; }
    g.parts.count = R;
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
   * @param {Float64Array|null} [viewProj] - RE-15c: column-major viewProj (same as `planes`'); with `rows` enables LOD where `g.lodCells > 0`
   * @param {number} [rows] - RE-15c: grid rows
   * @param {{cache: import('./DrawList.js').MeshDrawCache, idFor: ((key: string) => number)|null, maskAtlas?: any, gpu?: {accept: (g: any, mesh0: any, mesh1: any) => boolean}|null}|null} [meshDraw] - TREES-LP-b: resolves mesh groups' draw copies; null/omitted = mesh groups skipped
   */
  addToDrawList(list, cache, planes, frameNo, viewProj, rows, meshDraw) {
    const pool = this.pool;
    const groups = this.groups;
    const memo = typeof frameNo === 'number';
    if (!memo || frameNo !== this._lastFrameNo) {
      this._lastFrameNo = frameNo;
      this.stats.instances = 0;
      this.stats.instancesCulled = 0;
      this.stats.instancesLod1 = 0;
    }
    const gpu = (meshDraw && meshDraw.gpu) || null; // WG-4a: `gpu.accept(g, mesh0, mesh1)` true = the GPU cull kernel owns this group (no CPU compaction, no list item)
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (g.count <= 0) continue;
      if (g.mesh) { // TREES-LP-b: kind-9 mesh group, one identity part; QUAT-LOD-01 part 2: optional LOD1 via `g.mesh.lods`
        if (!meshDraw || !meshDraw.idFor) continue;
        if (g.mesh.lazy) { requestMeshForGroup(g.mesh, g); continue; }
        if (g.mesh.lazyOrigin) requestMeshForGroup(g.mesh, g); // S8-B2-03: throttled LRU keep-alive (touch) for a ready lazy mesh // MESH-LOAD-01: payload not loaded = group draws nothing yet
        const draw = meshDraw.cache.get(g.mesh, meshDraw.idFor, meshDraw.maskAtlas || undefined);
        if (gpu && gpu.accept(g, draw, null)) continue;
        // LOD1: resolved once (cached on g._mesh1); null when not loaded yet (MESH-LOAD-01) -> LOD0 only, no pop to nothing.
        const lod1Mesh = (g.lodCells > 0 && viewProj) ? resolveGroupLod1(g, this._meshLookup) : null;
        const draw1 = lod1Mesh ? meshDraw.cache.get(lod1Mesh, meshDraw.idFor, meshDraw.maskAtlas || undefined) : null;
        if (!memo || g._memoFrameNo !== frameNo) {
          let R = groupRadius(draw, g.parts);
          if (draw1) { const R1 = groupRadius(draw1, g.parts); if (R1 > R) R = R1; }
          g._R = R;
          const kept = compactGroup(g, planes, R, draw1 ? viewProj : null, draw1 ? (rows || 0) : 0, this.swayPad);
          g._memoFrameNo = frameNo;
          this.stats.instances += kept;
          this.stats.instancesCulled += g.count - kept;
          this.stats.instancesLod1 += g.drawCount[1];
        }
        // ALPHA-01f (b): ONE_PART collapses instancedRanges() to one synthetic whole-mesh range (rasterJS.js rasterInstanced's
        // `onePart` guard then drops per-range masking) - only opaque-only groups get it; a masked group keeps its real
        // mesh.ranges so passRaster.js's instanced-masked draw sees each range's mask rect (JS-twin parity, ALPHA-01f a).
        if (g.drawCount[0] > 0) { const it = list.addInstances(draw, g.parts, g.drawIb[0], g.drawCount[0], g._R); if (it && !meshIsMasked(g.mesh)) it.flags |= DRAW_FLAG_ONE_PART; }
        if (draw1 && g.drawCount[1] > 0) { const it1 = list.addInstances(draw1, g.parts, g.drawIb[1], g.drawCount[1], g._R); if (it1 && !meshIsMasked(lod1Mesh)) it1.flags |= DRAW_FLAG_ONE_PART; }
        continue;
      }
      if (!pool) continue;
      const pm = pool.models.get(g.modelKey);
      if (!pm) continue;
      const names = pool.partNamesFor(g.modelKey);
      const mesh = cache.get(pm, g.modelKey, names);
      const lodOn = g.lodCells > 0 && !!viewProj;
      const mesh1 = (lodOn || g.drawCount[1] > 0) ? cache.get(pm, g.modelKey, names, 1) : null;
      if (gpu && gpu.accept(g, mesh, mesh1)) { // same per-frame parts + radius as below; the kernel does cull + LOD
        computeGroupParts(pm, g.pose, g.parts);
        let R = groupRadius(mesh, g.parts);
        if (mesh1) { const R1 = groupRadius(mesh1, g.parts); if (R1 > R) R = R1; }
        g._R = R;
        continue;
      }
      if (!memo || g._memoFrameNo !== frameNo) {
        computeGroupParts(pm, g.pose, g.parts);
        let R = groupRadius(mesh, g.parts);
        if (mesh1) { const R1 = groupRadius(mesh1, g.parts); if (R1 > R) R = R1; }
        g._R = R;
        const kept = compactGroup(g, planes, R, viewProj || null, rows || 0, this.swayPad);
        g._memoFrameNo = frameNo;
        this.stats.instances += kept;
        this.stats.instancesCulled += g.count - kept;
        this.stats.instancesLod1 += g.drawCount[1];
      }
      if (g.drawCount[0] > 0) list.addInstances(mesh, g.parts, g.drawIb[0], g.drawCount[0], g._R);
      if (mesh1 && g.drawCount[1] > 0) list.addInstances(mesh1, g.parts, g.drawIb[1], g.drawCount[1], g._R);
    }
  }
}
