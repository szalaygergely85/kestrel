// @ts-check
// engine/mesh/DrawList.js - ME-03 (docs/backlog.md, docs/architecture.md
// 27.6, 27.7 items 2, 5; 27.15.4). The preallocated per-frame list of draw
// items `rasterJS.js` (and, from ME-04, the GPU raster pass) consumes, plus
// the level-structure feed (`LevelMeshCache`/`addStructures`) that turns
// `World.structures` into `DrawList` items using `levelMesh.js` (ME-01).
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (architecture.md 27.15.0) - never a caster, gpu/*, game/ or
// design/. This file imports levelMesh.js and culling.js (both engine/mesh)
// only.
//
// Zero allocation per frame (27.15.0 "hard gate"): `DrawList` preallocates
// every `DrawItem`'s typed arrays at construction; `begin`/`push`/`cull`
// never allocate. `addStructures`'s near-to-far sort scratch is module-level
// (literal copy of `compositor.js`'s `renderWorld` insertion sort).
import { buildLevelMesh, rebuildLevelMeshDyn } from './levelMesh.js';
import { classifyAABB, CULL_OUT } from './culling.js';
import { groupRadius } from './instances.js';

/** `DrawItem.type` values. */
export const DRAW_STATIC = 0;
export const DRAW_VOXEL = 1;
export const DRAW_TERRAIN = 2;
/** RE-06 (28.6): N instances of one voxel model, one draw per part (`instBuf`/`instCount`, engine/mesh/instances.js). */
export const DRAW_INSTANCED = 3;

/** `DrawItem.flags` bits. Terrain only; off until ME-06 decides (27.5). */
export const DRAW_FLAG_DEPTH_BIAS = 1;

/** Preallocated `DrawList` capacity (27.8: <= 60 draws expected in phase 1). */
export const MAX_DRAW_ITEMS = 256;

/** Structures cast per frame - same cap as `compositor.js`'s `MAX_STRUCTS` (structSeq is a 3-bit field, arch 7.2). */
const MAX_STRUCTS = 8;

/**
 * @typedef {Object} DrawItem
 * @property {import('./MeshData.js').MeshData|null} mesh
 * @property {number} type - DRAW_*
 * @property {Float64Array} matrix - 12: A (3x3 row-major) then t (3); mesh-local -> world
 * @property {Float64Array} partMatrices - 8*12, DRAW_VOXEL: part p -> world
 * @property {Uint8Array} partFlags - 8; bit 0 = part pose axis-aligned
 * @property {number} rangeFirst - triangles (static/terrain); voxel items use mesh.ranges per part
 * @property {number} rangeCount
 * @property {number} planeIdOr - levels (structSeq&7)<<28; voxels (slot&0xF)<<24; terrain 0
 * @property {number} objectId - levels structSeq; terrain 0x7000|chunkIndex; voxels 0x8000|slot
 * @property {number} zBase - G-buffer z = worldZ - zBase - aux.zRef
 * @property {number} flags - DRAW_FLAG_*
 * @property {Float64Array} aabb - 6, world, for culling
 * @property {import('./instances.js').InstanceBuffer|null} instBuf - DRAW_INSTANCED: per-instance buffer (64 B each)
 * @property {number} instCount - DRAW_INSTANCED: instances used
 */

/** @returns {DrawItem} a fresh, identity-initialised DrawItem. */
function makeDrawItem() {
  return {
    mesh: null,
    type: DRAW_STATIC,
    matrix: new Float64Array(12),
    partMatrices: new Float64Array(8 * 12),
    partFlags: new Uint8Array(8),
    rangeFirst: 0,
    rangeCount: 0,
    planeIdOr: 0,
    objectId: 0,
    zBase: 0,
    flags: 0,
    aabb: new Float64Array(6),
    instBuf: null,
    instCount: 0,
  };
}

/** Resets one `DrawItem` to identity/0 (reused by `DrawList.push`). */
function resetDrawItem(item) {
  item.mesh = null;
  item.type = DRAW_STATIC;
  const m = item.matrix;
  m[0] = 1; m[1] = 0; m[2] = 0;
  m[3] = 0; m[4] = 1; m[5] = 0;
  m[6] = 0; m[7] = 0; m[8] = 1;
  m[9] = 0; m[10] = 0; m[11] = 0;
  item.partMatrices.fill(0);
  item.partFlags.fill(0);
  item.rangeFirst = 0;
  item.rangeCount = 0;
  item.planeIdOr = 0;
  item.objectId = 0;
  item.zBase = 0;
  item.flags = 0;
  item.aabb.fill(0);
  item.instBuf = null;
  item.instCount = 0;
}

/**
 * Preallocated per-frame draw list. `begin()` resets the count only - the
 * `DrawItem`s themselves (and their typed arrays) are never reallocated.
 */
export class DrawList {
  /** @param {number} [capacity] */
  constructor(capacity = MAX_DRAW_ITEMS) {
    this.capacity = capacity;
    /** @type {DrawItem[]} */
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = makeDrawItem();
    this.count = 0;
  }

  begin() { this.count = 0; }

  /**
   * @param {import('./MeshData.js').MeshData|null} mesh
   * @param {number} type - DRAW_*
   * @returns {DrawItem} the next preallocated item, reset to identity/0
   */
  push(mesh, type) {
    if (this.count >= this.capacity) throw new Error(`DrawList.push: over capacity (${this.capacity})`);
    const item = this.items[this.count++];
    resetDrawItem(item);
    item.mesh = mesh;
    item.type = type;
    return item;
  }

  /**
   * RE-06 (28.6): one `DRAW_INSTANCED` item for `count` instances of `mesh`.
   * `parts` = P_p (part matrices at the identity instance) + identity flags;
   * `objectId` stays 0 (per instance, in `ib`). `aabb` = union of the instance
   * translations +- R, R = max |corner| of the mesh bbox under any P_p, so
   * `cull()` drops or keeps the whole group (no per-instance culling).
   * @param {import('./MeshData.js').MeshData} mesh
   * @param {{m: Float64Array, flags: Uint8Array, count: number}} parts
   * @param {import('./instances.js').InstanceBuffer} ib
   * @param {number} count
   * @returns {DrawItem|null} null when count <= 0
   */
  addInstances(mesh, parts, ib, count) {
    if (count <= 0) return null;
    if (count > ib.capacity) throw new Error(`DrawList.addInstances: count ${count} > buffer capacity ${ib.capacity}`);
    const item = this.push(mesh, DRAW_INSTANCED);
    item.instBuf = ib;
    item.instCount = count;
    item.partMatrices.set(parts.m);
    for (let p = 0; p < 8; p++) item.partFlags[p] = parts.flags[p];
    // RE-15a (28.13 point 2): factored into instances.js's `groupRadius` so
    // the per-instance cull (InstanceGroups.addToDrawList) shares this exact
    // computation instead of redoing it.
    const R = groupRadius(mesh, parts);
    const f = ib.f32;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      const tx = f[o + 3], ty = f[o + 7], tz = f[o + 11];
      if (tx < x0) x0 = tx; if (tx > x1) x1 = tx;
      if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
      if (tz < z0) z0 = tz; if (tz > z1) z1 = tz;
    }
    const a = item.aabb;
    a[0] = x0 - R; a[1] = y0 - R; a[2] = z0 - R; a[3] = x1 + R; a[4] = y1 + R; a[5] = z1 + R;
    return item;
  }

  /**
   * Drops every item whose `aabb` is fully outside `planes` (culling.js),
   * stable in-place compaction. Zero allocation.
   * @param {Float64Array} planes - as filled by `frustumPlanes` (24 floats)
   * @returns {number} the new `count`
   */
  cull(planes) {
    const items = this.items;
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      const a = items[r].aabb;
      const cls = classifyAABB(planes, a[0], a[1], a[2], a[3], a[4], a[5]);
      if (cls === CULL_OUT) continue;
      if (w !== r) { const tmp = items[w]; items[w] = items[r]; items[r] = tmp; }
      w++;
    }
    this.count = w;
    return this.count;
  }
}

/**
 * Per-world cache of `LevelMeshSet`s (ME-01), keyed by structure id: built on
 * first sight, `dyn` rebuilt (event-driven, not per frame) whenever
 * `structure.packed.version` has changed since the last `get()`.
 */
export class LevelMeshCache {
  /** @param {(key: string) => number} [matIdFor] */
  constructor(matIdFor) {
    this.matIdFor = matIdFor;
    /** @type {Map<string, {set: import('./levelMesh.js').LevelMeshSet, version: number, level: object}>} */
    this.cache = new Map();
  }

  /**
   * @param {{id: string, level: import('../world/Level.js').Level, packed: {version: number}}} structure
   * @returns {import('./levelMesh.js').LevelMeshSet}
   */
  get(structure) {
    let entry = this.cache.get(structure.id);
    const opts = this.matIdFor ? { matIdFor: this.matIdFor } : undefined;
    // ED-MESH-1a: a NEW Level object under the same id (editor rebuild = World.load + setWorld) must not reuse the old mesh,
    // even when `packed.version` is equal.
    if (!entry || entry.level !== structure.level) {
      entry = { set: buildLevelMesh(structure.level, opts), version: structure.packed.version, level: structure.level };
      this.cache.set(structure.id, entry);
    } else if (entry.version !== structure.packed.version) {
      for (let i = 0; i < entry.set.dyn.length; i++) {
        rebuildLevelMeshDyn(entry.set, structure.level, entry.set.dyn[i].tag, opts);
      }
      entry.version = structure.packed.version;
    }
    return entry.set;
  }
}

// ---- addStructures scratch (module-level, zero per-call allocation; a
// literal copy of compositor.js's renderWorld near-to-far insertion sort) --
const _order = new Int32Array(MAX_STRUCTS);
const _distScratch = new Float64Array(MAX_STRUCTS);

function bboxDist(cam, bbox) {
  const cx = Math.min(Math.max(cam.x, bbox.x0), bbox.x1);
  const cy = Math.min(Math.max(cam.y, bbox.y0), bbox.y1);
  const dx = cam.x - cx, dy = cam.y - cy;
  return Math.hypot(dx, dy);
}

/**
 * Pushes one `DRAW_STATIC` item per structure mesh (`set.base` + each
 * `set.dyn[k].mesh`) into `list`, matrix = translation by `structure.origin`
 * only (levels never rotate, 27.15.2), draw order near -> far.
 */
function pushMeshItem(list, mesh, structure) {
  const item = list.push(mesh, DRAW_STATIC);
  const o = structure.origin;
  const m = item.matrix;
  m[0] = 1; m[1] = 0; m[2] = 0;
  m[3] = 0; m[4] = 1; m[5] = 0;
  m[6] = 0; m[7] = 0; m[8] = 1;
  m[9] = o.x; m[10] = o.y; m[11] = o.z;
  item.zBase = o.z;
  item.planeIdOr = (structure.structSeq & 7) << 28;
  item.objectId = structure.structSeq;
  item.rangeFirst = 0;
  item.rangeCount = mesh.triCount;
  const b = mesh.bbox;
  const aabb = item.aabb;
  aabb[0] = b[0] + o.x; aabb[1] = b[1] + o.y; aabb[2] = b[2] + o.z;
  aabb[3] = b[3] + o.x; aabb[4] = b[4] + o.y; aabb[5] = b[5] + o.z;
  return item;
}

/**
 * Adds one `DRAW_STATIC` item per placed structure's base + dynamic meshes
 * to `list`, near -> far, fog-cull beyond `fogFarM` (literal copy of
 * `compositor.js`'s `renderWorld` structure sort/cull, capped at
 * `MAX_STRUCTS`). `structSeq` = `placed.structSeq` (27.15.0 amendment 14):
 * stable per structure, never the sort order.
 * @param {DrawList} list
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number}} cam
 * @param {LevelMeshCache} cache
 * @param {number} fogFarM
 */
export function addStructures(list, world, cam, cache, fogFarM) {
  const structs = world.structures;
  let count = 0;
  for (let i = 0; i < structs.length; i++) {
    const d = bboxDist(cam, structs[i].bbox);
    if (d > fogFarM) continue;
    if (count < MAX_STRUCTS) {
      _order[count] = i; _distScratch[count] = d; count++;
    } else {
      let worst = 0, worstD = _distScratch[0];
      for (let k = 1; k < MAX_STRUCTS; k++) if (_distScratch[k] > worstD) { worstD = _distScratch[k]; worst = k; }
      if (d < worstD) { _order[worst] = i; _distScratch[worst] = d; }
    }
  }
  for (let i = 1; i < count; i++) {
    const oi = _order[i], di = _distScratch[i];
    let j = i - 1;
    while (j >= 0 && _distScratch[j] > di) { _order[j + 1] = _order[j]; _distScratch[j + 1] = _distScratch[j]; j--; }
    _order[j + 1] = oi; _distScratch[j + 1] = di;
  }
  for (let k = 0; k < count; k++) {
    const s = structs[_order[k]];
    const set = cache.get(s);
    pushMeshItem(list, set.base, s);
    for (let d = 0; d < set.dyn.length; d++) pushMeshItem(list, set.dyn[d].mesh, s);
  }
}
