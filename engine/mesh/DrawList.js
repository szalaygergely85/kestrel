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
import { resolveMats } from './MeshData.js';
import { cutoffByte } from '../render/MaskAtlas.js';
import { localDirToWorld } from '../core/transform.js';
import { classifyAABB, CULL_OUT } from './culling.js';
import { groupRadius } from './instances.js';
import { setLazyView, pumpLazyMeshes, requestMesh, touchMesh, lazyHoldRadius, LOAD_MARGIN_M } from './lazyMesh.js';
import { createClothMesh, updateClothMesh } from './clothMesh.js';

/** `DrawItem.type` values. */
export const DRAW_STATIC = 0;
export const DRAW_VOXEL = 1;
export const DRAW_TERRAIN = 2;
/** RE-06 (28.6): N instances of one voxel model, one draw per part (`instBuf`/`instCount`, engine/mesh/instances.js). */
export const DRAW_INSTANCED = 3;
/** CLOTH-1b1 (33.5): one deformable cloth mesh (layout 'cloth'), indexed, smooth per-pixel normal, two-sided. */
export const DRAW_CLOTH = 4;
/** US-055a2a (35.3): one water slot of the clipmap layer (`item.water` = the frame's WaterSelection, `item.objectId` = slot); water has its own list + target. */
export const DRAW_WATER = 5;

/** `DrawItem.flags` bits. Terrain only; off until ME-06 decides (27.5). */
export const DRAW_FLAG_DEPTH_BIAS = 1;
/** MESH-INST-01: DRAW_INSTANCED item whose mesh is ONE identity part: both twins draw `mesh.triCount` triangles as one range (one GL draw per group, the single-draw triangle order) instead of one per `mesh.ranges` entry. */
export const DRAW_FLAG_ONE_PART = 2;

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
 * @property {number} objectId - levels structSeq; terrain 0x7000|chunkIndex; voxels 0x8000|slot (slot < 48; units >= 0x10000, view models near 0xFFFF)
 * @property {number} mirror - 0|1: part matrices have det < 0 (HANDS-01a, view-model hand mirror); front faces wind CW on screen, both twins flip the cull sign
 * @property {number} zBase - G-buffer z = worldZ - zBase - aux.zRef
 * @property {number} flags - DRAW_FLAG_*
 * @property {Float64Array} aabb - 6, world, for culling
 * @property {import('./instances.js').InstanceBuffer|null} instBuf - DRAW_INSTANCED: per-instance buffer (64 B each)
 * @property {number} instCount - DRAW_INSTANCED: instances used
 * @property {any} water - DRAW_WATER: the frame's WaterSelection (engine/render/water.js)
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
    mirror: 0,
    zBase: 0,
    flags: 0,
    aabb: new Float64Array(6),
    instBuf: null,
    instCount: 0,
    water: null,
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
  item.mirror = 0;
  item.zBase = 0;
  item.flags = 0;
  item.aabb.fill(0);
  item.instBuf = null;
  item.instCount = 0;
  item.water = null;
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
   * @param {number} [Rin] - RE-15c: precomputed radius (max over both LOD meshes); default = groupRadius(mesh, parts)
   * @returns {DrawItem|null} null when count <= 0
   */
  addInstances(mesh, parts, ib, count, Rin) {
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
    const R = Rin !== undefined ? Rin : groupRadius(mesh, parts);
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
    if (structs[i].kind === 'mesh') continue; // ME-14c1: imported meshes go through addMeshStructures
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

// ---- imported glTF mesh placements (ME-14c1, 37.1 items 3-5) ----------------------------------
export const MAX_MESH_DRAWS = 64;

const _xAx = [0, 0], _yAx = [0, 0];
/**
 * Row-major 3x3 (yaw about +Z) + translation, bvh.js's matrix12 layout, for a placed mesh `frame`.
 * The ONE formula shared by the ME-14b collider (colliders.js) and the draw item.
 * @param {import('../core/transform.js').Frame} frame
 * @param {ArrayLike<number> & {[i:number]:number}} out length >= 12
 */
export function frameMatrix12(frame, out) {
  localDirToWorld(frame, 1, 0, _xAx);
  localDirToWorld(frame, 0, 1, _yAx);
  out[0] = _xAx[0]; out[1] = _yAx[0]; out[2] = 0;
  out[3] = _xAx[1]; out[4] = _yAx[1]; out[5] = 0;
  out[6] = 0; out[7] = 0; out[8] = 1;
  out[9] = frame.x; out[10] = frame.y; out[11] = frame.z;
  return out;
}

/**
 * MESH-SCALE-01: model matrix of a placed mesh = `frameMatrix12` with the placement's uniform `scale` (> 0, absent/1 = none)
 * folded into the 3x3 (rows scaled; translation unchanged). One source for the single draw, the instance matrix and the
 * collider bake. Normals stay correct because every consumer renormalises (rasterJS transformVertex, WGSL vs_main).
 * @param {{frame:any, scale?:number}} placed @param {Float64Array} out @returns {Float64Array}
 */
export function placementMatrix12(placed, out) {
  frameMatrix12(placed.frame, out);
  const k = placed.scale;
  if (k !== undefined && k !== 1) for (let i = 0; i < 9; i++) out[i] *= k;
  return out;
}

/**
 * Resolved-materials draw copies of registry `MeshData` (which stays unresolved, shared with colliders). Per mesh in a
 * WeakMap, rebuilt when `idFor` changes. Allocates only on first use.
 */
export class MeshDrawCache {
  constructor() { this._map = new WeakMap(); }
  /**
   * @param {import('./MeshData.js').MeshData} mesh registry mesh (`mats`: material name -> palette key)
   * @param {(key: string) => number} idFor palette key -> material id
   * @param {import('../render/MaskAtlas.js').MaskAtlas|null} [atlas] ALPHA-01b: needed when a range carries `mask`
   *   (-> `copy.maskRanges`, Int32Array(ranges*5) = [x0, y0, w, h, cutoffByte] per range, w = -1 opaque; absent when no
   *   range is masked)
   */
  get(mesh, idFor, atlas) {
    if (mesh.lazy) throw new Error(`MeshDrawCache.get: mesh "${mesh.id}" payload is not loaded (MESH-LOAD-01: feeds must skip shells)`);
    const hit = this._map.get(mesh);
    const lo = /** @type {any} */ (mesh).lazyOrigin; if (lo) lo.caches.add(this); // S8-B2-03: an eviction drops this copy
    if (hit && hit.copy.pos === mesh.pos && hit.idFor === idFor && (!hit.atlas || (hit.atlas === atlas && hit.atlasVersion === atlas.version)) && !(hit.noAtlas && atlas)) return hit.copy;
    const mats = mesh.mats || {};
    const copy = { ...mesh, flat: mesh.flat.slice(), matsResolved: false };
    resolveMats(copy, (name) => {
      const key = mats[name];
      if (key === undefined) throw new Error(`mesh "${mesh.id}": material "${name}" has no mats entry`);
      return idFor(key);
    });
    let usedAtlas = null, noAtlas = false;
    if (mesh.ranges.some((r) => r.mask)) {
      if (!atlas) { // no atlas (world.maskAtlas null, masks not wired yet): masked ranges draw opaque, warn once per mesh
        noAtlas = true;
        console.warn(`mesh "${mesh.id}": masked ranges but no MaskAtlas - drawn opaque`);
      } else {
      const mr = new Int32Array(mesh.ranges.length * 5);
      for (let i = 0; i < mesh.ranges.length; i++) {
        const m = mesh.ranges[i].mask, o = i * 5;
        if (!m) { mr[o + 2] = -1; continue; }
        const rc = atlas.rect(m.tex);
        if (!rc) throw new Error(`mesh "${mesh.id}": mask "${m.tex}" not in the atlas`);
        mr[o] = rc.x0; mr[o + 1] = rc.y0; mr[o + 2] = rc.w; mr[o + 3] = rc.h; mr[o + 4] = cutoffByte(m.cutoff);
      }
      copy.maskRanges = mr;
      usedAtlas = atlas;
      }
    }
    this._map.set(mesh, { idFor, copy, noAtlas, atlas: usedAtlas, atlasVersion: usedAtlas ? usedAtlas.version : -1 });
    return copy;
  }
}

const _mOrder = new Int32Array(MAX_MESH_DRAWS);
const _mDist = new Float64Array(MAX_MESH_DRAWS);
const _mKey = new Float64Array(MAX_MESH_DRAWS);
const MIN_RANK_RADIUS_M = 0.25;
/** BUG-MESH-MISSING-01: selection key (smaller = kept first) = distance / bbox radius, i.e. inverse projected size: a 6 m dead tree at 30 m (key 10) beats a 0.2 m pebble at 12 m (key 48). Size-first, so a 2 m eye step barely reorders big props. @param {any} b bbox @param {number} d */
function rankKey(b, d) {
  const r = 0.5 * Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  return (d + 0.5) / (r > MIN_RANK_RADIUS_M ? r : MIN_RANK_RADIUS_M);
}

/**
 * One `DRAW_STATIC` item per placed `kind:'mesh'` structure, best `MAX_MESH_DRAWS` (smallest distance / bbox radius) within `fogFarM`, drawn near -> far; grouped placements are uncapped.
 * planeIdOr = (slot & 0xFF) << 20 (draw order, neighbours outline), objectId = 0xA000 | structureIndex.
 * @param {DrawList} list
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z?:number}} cam
 * @param {MeshDrawCache} cache
 * @param {(key: string) => number} idFor
 * @param {number} fogFarM
 * @param {boolean} [shadowOnly] - MESH-SHADOW-01: skip placements with `castShadow === false` (the sun shadow feed)
 * @param {any} [budget] - MESH-SHADOW-02 shadow budget {eye, cutM, cap}
 * @param {{has: (si: number) => boolean, chosen: Uint8Array}|null} [groups] - MESH-INST-01 (meshGroups.js): grouped placements take part in the same nearest-MAX_MESH_DRAWS selection but are only marked in `groups.chosen`, not pushed
 */
export function addMeshStructures(list, world, cam, cache, idFor, fogFarM, shadowOnly = false, budget = null, groups = null) {
  const structs = world.structures;
  // MESH-SHADOW-02 (37.19 opt 1): shadow-only budget {eye, cutM, cap}: distance measured from the EYE (not the shadow box
  // centre), props beyond cutM dropped, at most `cap` nearest kept (ties: lower structure index = lower object id).
  const bEye = shadowOnly && budget ? budget.eye : null, bCut = bEye ? budget.cutM : 0;
  const maxKeep = bEye ? Math.min(MAX_MESH_DRAWS, budget.cap) : MAX_MESH_DRAWS;
  if (groups) groups.chosen.fill(0);
  if (!shadowOnly) { setLazyView(cam.x, cam.y, fogFarM); pumpLazyMeshes(); } // MESH-LOAD-01: decode queued payloads (<= 2 / 4 ms), remember the eye for scatter groups
  let count = 0;
  for (let i = 0; i < structs.length; i++) {
    if (structs[i].kind !== 'mesh') continue;
    if (shadowOnly && structs[i].castShadow === false) continue; // MESH-SHADOW-01
    const d = bEye ? bboxDist(bEye, structs[i].bbox) : bboxDist(cam, structs[i].bbox);
    if (!shadowOnly && structs[i].mesh.lazyOrigin && !structs[i].mesh.lazy && d <= lazyHoldRadius()) touchMesh(structs[i].mesh); // S8-B2-03: LRU keep-alive inside loadM + 60 m
    if (structs[i].mesh.lazy) { // MESH-LOAD-01: payload not loaded = draws nothing; ask for it when within draw distance + margin
      if (!shadowOnly && d <= fogFarM + LOAD_MARGIN_M) requestMesh(structs[i].mesh);
      continue;
    }
    if (d > fogFarM || (bEye && d > bCut)) continue;
    if (groups && groups.has(i)) { groups.chosen[i] = 1; continue; } // BUG-MESH-MISSING-01: instanced groups are not capped (cheap); only the frustum cull in push() thins them
    const key = rankKey(structs[i].bbox, d);
    if (count < maxKeep) {
      _mOrder[count] = i; _mDist[count] = d; _mKey[count] = key; count++;
    } else if (maxKeep > 0) {
      let worst = 0, worstK = _mKey[0];
      for (let k = 1; k < maxKeep; k++) if (_mKey[k] > worstK || (_mKey[k] === worstK && _mOrder[k] > _mOrder[worst])) { worstK = _mKey[k]; worst = k; } // ties: evict the highest object id (MESH-SHADOW-02)
      if (key < worstK) { _mOrder[worst] = i; _mDist[worst] = d; _mKey[worst] = key; }
    }
  }
  for (let i = 1; i < count; i++) {
    const oi = _mOrder[i], di = _mDist[i];
    let j = i - 1;
    while (j >= 0 && _mDist[j] > di) { _mOrder[j + 1] = _mOrder[j]; _mDist[j + 1] = _mDist[j]; j--; }
    _mOrder[j + 1] = oi; _mDist[j + 1] = di;
  }
  for (let k = 0; k < count; k++) {
    const si = _mOrder[k];
    const s = structs[si];
    const mesh = cache.get(s.mesh, idFor, world.maskAtlas);
    const item = list.push(mesh, DRAW_STATIC);
    placementMatrix12(s, item.matrix);
    item.zBase = s.origin.z;
    item.planeIdOr = (k & 0xFF) << 20;
    item.objectId = 0xA000 | si;
    item.rangeFirst = 0;
    item.rangeCount = mesh.triCount;
    const b = s.bbox, a = item.aabb;
    a[0] = b.x0; a[1] = b.y0; a[2] = b.z0; a[3] = b.x1; a[4] = b.y1; a[5] = b.z1;
  }
}

// ---- cloth (CLOTH-1b1, 33.5) ----------------------------------------------------------------
/**
 * Pushes one `DRAW_CLOTH` item for cloth slot `slot` of the cloth system (`world.cloths`). Creates the slot's mesh on first
 * use (`matIdFor(system.mats[slot])`, origin = bbox centre rounded to metres; attached with `system.setMesh`) and refreshes
 * its arrays (`updateClothMesh`, version-gated, does not bump `meshVersion`: the system owns that). Item: matrix = identity
 * + t = mesh origin, planeIdOr `(0xD<<28) | (slot<<20)`, objectId `0x9000 | slot` (free ranges, 33.5), zBase = origin z,
 * aabb = mesh bbox + origin. Used by `addCloths` (camera) and `buildShadowList` (sun).
 * @param {DrawList} list
 * @param {{cloths: any[], meshes: any[], mats: (string|null)[]}} system
 * @param {number} slot
 * @param {(key: string) => number} [matIdFor]
 * @returns {DrawItem|null}
 */
export function pushClothItem(list, system, slot, matIdFor) {
  const cloth = system.cloths[slot];
  let mesh = system.meshes[slot];
  if (!mesh) {
    const bb = cloth.bbox;
    const key = system.mats[slot];
    const matId = key && matIdFor ? matIdFor(key) : 0;
    const us = /** @type {any} */ (system).uvStep;
    mesh = createClothMesh(cloth, String(slot), matId, [Math.round((bb[0] + bb[3]) * 0.5), Math.round((bb[1] + bb[4]) * 0.5), Math.round((bb[2] + bb[5]) * 0.5)],
      us ? us[2 * slot] : undefined, us ? us[2 * slot + 1] : undefined);
    mesh.matFor = matIdFor || null;
    system.meshes[slot] = mesh;
    if (typeof (/** @type {any} */ (system)).setMesh === 'function') /** @type {any} */ (system).setMesh(slot, mesh);
  } else {
    updateClothMesh(mesh, cloth);
    // a mesh first pushed without matIdFor (or with another resolver) re-resolves its material once
    if (matIdFor && mesh.matFor !== matIdFor) {
      const key = system.mats[slot];
      mesh.matId = key ? matIdFor(key) : 0;
      mesh.matFor = matIdFor;
    }
  }
  if (mesh.triCount <= 0) return null;
  const item = list.push(mesh, DRAW_CLOTH);
  const o = mesh.origin, m = item.matrix;
  m[9] = o[0]; m[10] = o[1]; m[11] = o[2];
  item.zBase = o[2];
  item.planeIdOr = (0xD << 28) | ((slot & 0xFF) << 20);
  item.objectId = 0x9000 | (slot & 0xFF);
  item.rangeFirst = 0;
  item.rangeCount = mesh.triCount;
  const b = mesh.bbox, a = item.aabb;
  a[0] = b[0] + o[0]; a[1] = b[1] + o[1]; a[2] = b[2] + o[2];
  a[3] = b[3] + o[0]; a[4] = b[4] + o[1]; a[5] = b[5] + o[2];
  return item;
}

/**
 * Camera feed: every cloth whose bbox meets the view frustum becomes a `DRAW_CLOTH` item (call after the voxel feed, before
 * terrain, 33.5). Drawn cloths are stamped with `system.markDrawn(slot)` (the system wakes/sleeps on it).
 * @param {DrawList} list
 * @param {{count: number, cloths: any[], meshes: any[], mats: (string|null)[], markDrawn?: (slot: number) => void}|null|undefined} system
 * @param {Float64Array|null} planes - `frustumPlanes` output; null = no culling
 * @param {(key: string) => number} [matIdFor]
 */
export function addCloths(list, system, planes, matIdFor) {
  if (!system) return;
  for (let i = 0; i < system.count; i++) {
    const item = pushClothItem(list, system, i, matIdFor);
    if (!item) continue;
    if (planes) {
      const a = item.aabb;
      if (classifyAABB(planes, a[0], a[1], a[2], a[3], a[4], a[5]) === CULL_OUT) { list.count--; continue; }
    }
    if (system.markDrawn) system.markDrawn(i);
  }
}
