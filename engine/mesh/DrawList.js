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
import { MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { lodCentreX, lodCentreY } from '../core/camFocus.js';
import { buildLevelMesh, rebuildLevelMeshDyn } from './levelMesh.js';
import { resolveMats } from './MeshData.js';
import { cutoffByte } from '../render/MaskAtlas.js';
import { localDirToWorld } from '../core/transform.js';
import { classifyAABB, CULL_OUT } from './culling.js';
import { groupRadius } from './instances.js';
import { setLazyView, pumpLazyMeshes, requestMesh, touchMesh, lazyHoldRadius, warmLazyMeshes, LOAD_MARGIN_M } from './lazyMesh.js';
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
/** MESH-INST-02: DRAW_INSTANCED item of an "open" (thin / one-sided: grass cards, walls, bushes) mesh: both twins draw it WITHOUT back-face culling, like the single placed-mesh draw (the instanced path culls back faces otherwise). */
export const DRAW_FLAG_NO_CULL = 4;
/** OB-061: DRAW_INSTANCED item (always with NO_CULL) whose opaque cards must shade two-sided: the JS twin flips N on back faces like a masked range (the GPU flips on !front_facing for every item already). */
export const DRAW_FLAG_TWO_SIDED = 8;

/** MESH-INST-02: placed-mesh object ids live in [0xA000, 0xA000 + MESH_ID_SPAN) (0xFF00..0xFFFF stay free for viewmodel handles); the old `0xA000 | si` overflowed into 0xB000.. at 4096 structures. Identical to the old value for si < 4096. */
export const MESH_ID_BASE = 0xA000;
export const MESH_ID_SPAN = 0x5F00;
/** @param {number} si structure index @returns {number} object id of the placed-mesh draw (wraps, harmlessly, past MESH_ID_SPAN structures) */
export function meshObjectId(si) { return MESH_ID_BASE + (si < MESH_ID_SPAN ? si : si % MESH_ID_SPAN); }

const _onePartRange = [{ start: 0, count: 0 }]; // shared scratch: callers iterate synchronously (zero alloc)
/**
 * 38.9: the ranges a DRAW_INSTANCED item is drawn with in EVERY pass (camera, shadow, kernel).
 * ONE_PART items draw `[0, mesh.triCount)` as one range (part 0); otherwise `mesh.ranges`.
 * The returned array is a shared scratch for ONE_PART: do not keep it across calls.
 * @param {{mesh: {ranges: any[], triCount: number}, flags: number}} item
 */
export function instancedRanges(item) {
  if (item.flags & DRAW_FLAG_ONE_PART) { _onePartRange[0].count = item.mesh.triCount; return _onePartRange; }
  return item.mesh.ranges;
}

/** Preallocated camera `DrawList` capacity, counted BEFORE `cull()` (OB-043, 38.46: 256 -> 512; roadBend pre-cull peak 214). */
export const MAX_DRAW_ITEMS = 512;
/**
 * OB-043 (38.46): items the placed-mesh GROUP feed (meshGroups.push, the only feed that grows with content) leaves free for
 * the feeds pushed after it (terrain near+far+skirts, voxel pool <= 48, unit/tree/scatter instance groups, cloths <= 16).
 */
export const DRAW_TAIL_RESERVE = 192;
/**
 * OB-043: instances per list (`addInstances` drops a whole item past this, counted in `instDropped`) = instances.js
 * MAX_INSTANCES_PER_FRAME (4096: units + trees + scatter) + meshGroups MAX_GROUPED_KEPT (2048). A literal (instances.js imports
 * this module: no top-level use of its bindings here); DrawList.test.js pins the sum.
 */
export const MAX_LIST_INSTANCES = 6144;

/** Structures cast per frame - same cap as `compositor.js`'s `MAX_STRUCTS` (structSeq is a 3-bit field, arch 7.2). */
const MAX_STRUCTS = 8;

/**
 * @typedef {Object} DrawItem
 * @property {import('./MeshData.js').MeshData|null} mesh
 * @property {number} type - DRAW_*
 * @property {Float64Array} matrix - 12: A (3x3 row-major) then t (3); mesh-local -> world
 * @property {Float64Array} partMatrices - MAX_VOX_PARTS*12, DRAW_VOXEL: part p -> world
 * @property {Uint8Array} partFlags - MAX_VOX_PARTS; bit 0 = part pose axis-aligned
 * @property {number} rangeFirst - triangles (static/terrain); voxel items use mesh.ranges per part
 * @property {number} rangeCount
 * @property {number} planeIdOr - levels (structSeq&7)<<28; voxels (slot&0xF)<<24; terrain 0
 * @property {number} objectId - levels structSeq; terrain 0x7000|chunkIndex; voxels 0x8000|slot (slot < 48; units >= 0x10000, view models near 0xFFFF)
 * @property {number} mirror - 0|1: part matrices have det < 0 (HANDS-01a, view-model hand mirror); front faces wind CW on screen, both twins flip the cull sign
 * @property {number} zBase - G-buffer z = worldZ - zBase - aux.zRef
 * @property {number} flags - DRAW_FLAG_*
 * @property {number} depthTier - OB-053 (38.49): 0..3, the depth TEST is pulled forward by tier * DEPTH_TIER (both twins); written depth unchanged. 0 level/terrain/cloth, 1 placed meshes, 2 voxel props/models
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
    partMatrices: new Float64Array(MAX_VOX_PARTS * 12),
    partFlags: new Uint8Array(MAX_VOX_PARTS),
    rangeFirst: 0,
    rangeCount: 0,
    planeIdOr: 0,
    objectId: 0,
    mirror: 0,
    zBase: 0,
    flags: 0,
    depthTier: 0,
    aabb: new Float64Array(6),
    instBuf: null,
    instCount: 0,
    water: null,
  };
}

/** Resets one `DrawItem` to identity/0 (reused by `DrawList.push`). */
function resetDrawItem(item) {
  // MESH-FEED-GRID-01: only voxel / instanced items ever write part matrices (voxelMesh, viewModel, addGroupInstances); clearing the 2 big
  // typed arrays on every static/terrain/level push was the bulk of the reset cost. `item.type` still holds the previous use here.
  const parts = item.type === DRAW_VOXEL || item.type === DRAW_INSTANCED;
  item.mesh = null;
  item.type = DRAW_STATIC;
  const m = item.matrix;
  m[0] = 1; m[1] = 0; m[2] = 0;
  m[3] = 0; m[4] = 1; m[5] = 0;
  m[6] = 0; m[7] = 0; m[8] = 1;
  m[9] = 0; m[10] = 0; m[11] = 0;
  if (parts) { item.partMatrices.fill(0); item.partFlags.fill(0); }
  item.rangeFirst = 0;
  item.rangeCount = 0;
  item.planeIdOr = 0;
  item.objectId = 0;
  item.mirror = 0;
  item.zBase = 0;
  item.flags = 0;
  item.depthTier = 0;
  item.aabb.fill(0);
  item.instBuf = null;
  item.instCount = 0;
  item.water = null;
}

/**
 * Preallocated per-frame draw list. `begin()` resets the count only - the
 * `DrawItem`s themselves (and their typed arrays) are never reallocated.
 */
export const MAX_DRAW_CARDS = 64; // R6c: card-impostor species per frame

export class DrawList {
  /** @param {number} [capacity] */
  constructor(capacity = MAX_DRAW_ITEMS) {
    this.capacity = capacity;
    /** @type {DrawItem[]} */
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = makeDrawItem();
    this.count = 0;
    /** OB-043: pushes refused this frame (list full); they wrote into `_sink`, nothing draws them. */
    this.overflow = 0;
    /** OB-043: instances summed over this frame's DRAW_INSTANCED items, and instances refused past MAX_LIST_INSTANCES. */
    this.instTotal = 0;
    this.instDropped = 0;
    /** radius handed to `_addInstancesCore` (double field, see `addGroupInstances`) */
    this._instR = 0.5;
    /** OB-043: true = throw on overflow (tests / dev probes); false (default, the game path) = degrade: drop + count. */
    this.strict = false;
    /** @type {DrawItem} scratch target of refused pushes (never in `items`, never drawn) */
    this._sink = makeDrawItem();
    /** R6c (38.60): tree card impostor buckets of this frame (rasterCards / the GPU card pass); preallocated, 0 when no species opted in. */
    this.cardCount = 0;
    this.cards = new Array(MAX_DRAW_CARDS);
    for (let i = 0; i < MAX_DRAW_CARDS; i++) this.cards[i] = { ib: null, count: 0, imp: null, eye: null };
  }

  begin() { this.count = 0; this.overflow = 0; this.instTotal = 0; this.instDropped = 0; this.cardCount = 0; }

  /** R6c: queue one group's card bucket (compactGroup output); dropped past MAX_DRAW_CARDS (far trees pop out, like the list overflow). */
  addCards(ib, count, imp, eye) {
    if (this.cardCount >= MAX_DRAW_CARDS) return;
    const c = this.cards[this.cardCount++];
    c.ib = ib; c.count = count; c.imp = imp; c.eye = eye;
  }

  /**
   * @param {import('./MeshData.js').MeshData|null} mesh
   * @param {number} type - DRAW_*
   * @returns {DrawItem} the next preallocated item, reset to identity/0
   */
  push(mesh, type) {
    let item;
    if (this.count >= this.capacity) { // OB-043: never throw in the game path; later pushes (push order is the priority) are dropped
      if (this.strict) throw new Error(`DrawList.push: over capacity (${this.capacity})`);
      this.overflow++; item = this._sink;
    } else item = this.items[this.count++];
    resetDrawItem(item);
    item.mesh = mesh;
    item.type = type;
    item.depthTier = type === DRAW_VOXEL ? 2 : type === DRAW_INSTANCED ? 1 : 0; // OB-053 default per type; placed static meshes set 1 (MeshDrawCache), view models 0
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
   * @returns {DrawItem|null} null when count <= 0, the list is full or the item would pass MAX_LIST_INSTANCES (OB-043: counted, not drawn)
   */
  addInstances(mesh, parts, ib, count, Rin) {
    this._instR = Rin !== undefined ? Rin : (count > 0 ? groupRadius(mesh, parts) : 0);
    return this._addInstancesCore(mesh, parts, ib, count);
  }

  /**
   * `addInstances` for a group object `g` (`g.parts`, `g._R`): the radius travels through the list's `_instR` field, not as a
   * double argument (a non-inlined call boxes a double arg = 16 B per call; GATE-FLAKY-02a). Zero allocation.
   * @returns {DrawItem|null}
   */
  addGroupInstances(mesh, g, ib, count) {
    this._instR = g._R;
    return this._addInstancesCore(mesh, g.parts, ib, count);
  }

  _addInstancesCore(mesh, parts, ib, count) {
    if (count <= 0) return null;
    if (count > ib.capacity) throw new Error(`DrawList.addInstances: count ${count} > buffer capacity ${ib.capacity}`);
    if (this.instTotal + count > MAX_LIST_INSTANCES) { if (this.strict) throw new Error(`DrawList.addInstances: over ${MAX_LIST_INSTANCES} instances`); this.instDropped += count; return null; }
    if (this.count >= this.capacity) { this.push(mesh, DRAW_INSTANCED); return null; } // counts the overflow (or throws when strict)
    this.instTotal += count;
    const item = this.push(mesh, DRAW_INSTANCED);
    item.instBuf = ib;
    item.instCount = count;
    item.partMatrices.set(parts.m);
    for (let p = 0; p < MAX_VOX_PARTS; p++) item.partFlags[p] = parts.flags[p];
    // RE-15a (28.13 point 2): factored into instances.js's `groupRadius` so
    // the per-instance cull (InstanceGroups.addToDrawList) shares this exact
    // computation instead of redoing it.
    const R = this._instR;
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

function bboxDistXY(ex, ey, b) {
  const dx = ex < b.x0 ? b.x0 - ex : (ex > b.x1 ? ex - b.x1 : 0), dy = ey < b.y0 ? b.y0 - ey : (ey > b.y1 ? ey - b.y1 : 0);
  return Math.sqrt(dx * dx + dy * dy);
}

const _bd = new Float64Array(2); // [0] = distance, [1] = rank key: results leave the helpers through here (a returned double boxes when the call is not inlined: GATE-FLAKY-02a)
function bboxDistTo(cam, bbox) {
  const camX = lodCentreX(cam), camY = lodCentreY(cam);
  const cx = Math.min(Math.max(camX, bbox.x0), bbox.x1);
  const cy = Math.min(Math.max(camY, bbox.y0), bbox.y1);
  const dx = camX - cx, dy = camY - cy;
  _bd[0] = Math.sqrt(dx * dx + dy * dy);
}

function bboxDist(cam, bbox) {
  const camX = lodCentreX(cam), camY = lodCentreY(cam); // ortho: focus, not the far-back eye (US-068b3a)
  const cx = Math.min(Math.max(camX, bbox.x0), bbox.x1);
  const cy = Math.min(Math.max(camY, bbox.y0), bbox.y1);
  const dx = camX - cx, dy = camY - cy;
  return Math.sqrt(dx * dx + dy * dy); // not Math.hypot: its variadic call allocates per call (GATE-FLAKY-02a)
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

/**
 * OB-039: last camera-feed `addMeshStructures` call (both the GL/JS compositor and the WebGPU raster feed write it; shadow feeds
 * do not). requested = single (ungrouped, loaded) placements within fogFarM and inside the frustum (when planes were given);
 * kept = min(requested, MAX_MESH_DRAWS) chosen by smallest distance/radius (ties: lower structure index); dropped = requested - kept.
 * @type {{requested: number, kept: number, dropped: number, frustum: number}}
 */
export const meshFeedStats = { requested: 0, kept: 0, dropped: 0, frustum: 0, groupsDropped: 0, overflow: 0, instDropped: 0, drawItems: 0 };
/** OB-043: copies the camera list's overflow counters (pre-cull item count, refused pushes / instances) into `meshFeedStats` (F3). Call right before `list.cull`. @param {DrawList} list */
export function noteListOverflow(list) {
  meshFeedStats.drawItems = list.count; meshFeedStats.overflow = list.overflow; meshFeedStats.instDropped = list.instDropped;
}

const _mOrder = new Int32Array(MAX_MESH_DRAWS);
const _mDist = new Float64Array(MAX_MESH_DRAWS);
const _mKey = new Float64Array(MAX_MESH_DRAWS);
const MIN_RANK_RADIUS_M = 0.25;
/** BUG-MESH-MISSING-01: selection key (smaller = kept first) = distance / bbox radius, i.e. inverse projected size: a 6 m dead tree at 30 m (key 10) beats a 0.2 m pebble at 12 m (key 48). Size-first, so a 2 m eye step barely reorders big props. @param {any} b bbox @param {number} d */
function rankKeyTo(b) { // reads the distance from _bd[0], writes the key to _bd[1]
  const ex = b.x1 - b.x0, ey = b.y1 - b.y0, ez = b.z1 - b.z0, r = 0.5 * Math.sqrt(ex * ex + ey * ey + ez * ez);
  _bd[1] = (_bd[0] + 0.5) / (r > MIN_RANK_RADIUS_M ? r : MIN_RANK_RADIUS_M);
}

function rankKey(b, d) {
  const ex = b.x1 - b.x0, ey = b.y1 - b.y0, ez = b.z1 - b.z0, r = 0.5 * Math.sqrt(ex * ex + ey * ey + ez * ez); // sqrt, not hypot (alloc)
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
 * @param {Float64Array|null} [planes] - OB-039: camera frustum planes (`frustumPlanes`). Singles fully outside are skipped BEFORE
 *   the cap ranking (the later `list.cull` would drop them anyway, same `classifyAABB` on the same bbox), so the MAX_MESH_DRAWS
 *   slots go to on-screen props only. Camera feed only; ignored when `shadowOnly`. null = old frustum-blind pick.
 */
export function addMeshStructures(list, world, cam, cache, idFor, fogFarM, shadowOnly = false, budget = null, groups = null, planes = null) {
  const structs = world.structures;
  // MESH-SHADOW-02 (37.19 opt 1): shadow-only budget {eye, cutM, cap}: distance measured from the EYE (not the shadow box
  // centre), props beyond cutM dropped, at most `cap` nearest kept (ties: lower structure index = lower object id).
  const bEye = shadowOnly && budget ? budget.eye : null, bCut = bEye ? budget.cutM : 0;
  const maxKeep = bEye ? Math.min(MAX_MESH_DRAWS, budget.cap) : MAX_MESH_DRAWS;
  if (groups) { groups.chosen.fill(0); if (groups.hits) groups.hits.fill(0); }
  // STREAM-01b (38.51): residency grid. Re-fetched every frame (never cached: a structVersion change replaces the object); the camera
  // feed advances it, the shadow feed only reads the lists. Off (`world.streaming.enabled` false / no grid) = today's all-placements path.
  let grid = world.streaming && world.streaming.enabled && world.refreshPlacementGrid ? world.refreshPlacementGrid() : null;
  let gl = null, gr2 = null, gN = structs.length, warmM = 0, gx = 0, gy = 0, gw2 = null, gbx0 = null, gby0 = null, gbx1 = null, gby1 = null;
  if (grid) {
    gx = lodCentreX(cam); gy = lodCentreY(cam);
    if (!shadowOnly) grid.update(gx, gy);
    else if (grid.evaluated) { gx = grid.lastX; gy = grid.lastY; } // shadow feed: reach checks use the grid's own (camera) eye, never the shadow camera
    else grid = null; // fresh grid + shadow feed first: never classify from the shadow camera -> full list this frame
  }
  if (grid) {
    gl = grid.activeList; gr2 = grid.reach2; gN = grid.activeCount; warmM = grid.opts.warmM;
    gw2 = grid.warm2; gbx0 = grid.bx0; gby0 = grid.by0; gbx1 = grid.bx1; gby1 = grid.by1; // MESH-FEED-GRID-01 flat prefilter data
  }
  if (!shadowOnly) { setLazyView(lodCentreX(cam), lodCentreY(cam), fogFarM); pumpLazyMeshes(); } // MESH-LOAD-01: decode queued payloads (<= 2 / 4 ms), remember the eye for scatter groups
  const fr = shadowOnly ? null : planes;
  let count = 0, requested = 0;
  for (let q = 0; q < gN; q++) {
    const i = gl ? gl[q] : q; // grid: ascending active structure indices (same order as 0..N, so ranking ties are unchanged)
    // MESH-FEED-GRID-01: flat prefilter. Outside reach + warmM nothing can happen (no touch, no request, no draw): reject from the
    // grid's flat arrays without touching the structure / mesh objects. Slack 1e-6 keeps it a strict subset of the exact test below.
    let dg2 = 0;
    if (gl) {
      const dx = gx < gbx0[i] ? gbx0[i] - gx : (gx > gbx1[i] ? gx - gbx1[i] : 0), dy = gy < gby0[i] ? gby0[i] - gy : (gy > gby1[i] ? gy - gby1[i] : 0);
      dg2 = dx * dx + dy * dy;
      if (dg2 > gw2[i] * 1.000001) continue;
    } else if (structs[i].kind !== 'mesh') continue; // grid members are mesh placements by construction
    if (shadowOnly && structs[i].castShadow === false) continue; // MESH-SHADOW-01
    let d;
    if (gl && !bEye) { d = Math.sqrt(dg2); _bd[0] = d; } // camera feed: reach metric == bboxDistTo metric (both lodCentre xy -> AABB)
    else { if (bEye) bboxDistTo(bEye, structs[i].bbox); else bboxDistTo(cam, structs[i].bbox); d = _bd[0]; }
    // per-placement warm radius (reach + warmM) with the grid, else the global load / hold radius
    let rw2 = 0, dg = d; // dg: ONE metric for reach + warm = grid xy distance eye -> placement AABB (placementGrid.js)
    if (gl) { dg = bEye ? bboxDistXY(gx, gy, structs[i].bbox) : d; rw2 = gw2[i]; }
    if (!shadowOnly && structs[i].mesh.lazyOrigin && !structs[i].mesh.lazy && (gl ? dg * dg <= rw2 : d <= lazyHoldRadius())) touchMesh(structs[i].mesh); // S8-B2-03: LRU keep-alive inside loadM + 60 m
    if (structs[i].mesh.lazy) { // MESH-LOAD-01: payload not loaded = draws nothing; ask for it when within draw distance + margin
      if (!shadowOnly && (gl ? dg * dg <= rw2 : d <= fogFarM + LOAD_MARGIN_M)) requestMesh(structs[i].mesh);
      continue;
    }
    if (d > fogFarM || (bEye && d > bCut)) continue;
    if (gl && dg * dg > gr2[i]) continue; // per-placement reach: small props stop before big ones
    if (groups && groups.has(i)) { groups.chosen[i] = 1; if (groups.hits) groups.hits[groups.slotOf[i]]++; continue; } // BUG-MESH-MISSING-01: instanced groups are not capped (cheap); only the frustum cull in push() thins them
    const bb = structs[i].bbox;
    if (fr && classifyAABB(fr, bb.x0, bb.y0, bb.z0, bb.x1, bb.y1, bb.z1) === CULL_OUT) continue; // OB-039: off-screen singles never take a slot
    requested++;
    rankKeyTo(bb);
    const key = _bd[1];
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
  if (grid && !shadowOnly) warmLazyMeshes(structs, grid, lodCentreX(cam), lodCentreY(cam)); // warm ring: decode before it becomes active
  if (!shadowOnly) { // OB-039: F3 / tests - single placed-mesh draws wanted vs kept by the cap (camera feed only)
    meshFeedStats.requested = requested; meshFeedStats.kept = count; meshFeedStats.dropped = requested - count; meshFeedStats.frustum = fr ? 1 : 0;
  }
  for (let k = 0; k < count; k++) {
    const si = _mOrder[k];
    const s = structs[si];
    const mesh = cache.get(s.mesh, idFor, world.maskAtlas);
    const item = list.push(mesh, DRAW_STATIC);
    item.depthTier = 1; // OB-053: placed mesh sits above level/terrain at an exact tie
    placementMatrix12(s, item.matrix);
    item.zBase = s.origin.z;
    item.planeIdOr = (k & 0xFF) << 20;
    item.objectId = meshObjectId(si);
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
