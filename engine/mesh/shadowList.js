// @ts-check
// engine/mesh/shadowList.js - ME-15a (docs/architecture.md 27.9a item 4). The
// sun shadow pass's caster list: the camera `DrawList` is frustum-culled to the
// view and misses casters behind the camera, so the shadow list is built a
// second time with the SAME item builders (structures, terrain chunks, voxel
// props) and culled with the shadow ortho planes (`shadowSunMatrix().planes`).
// Sprites / kind 0 are never in a DrawList. Zero allocation per frame.
//
// ME-15c: the voxel feed reads `src.voxelPool` (pass `VoxelPool.shadowView`, posed
// without the screen cull by `projectShadow()`, so props behind the camera
// cast) and RE-06 instanced groups (`src.instances`) are added with their FULL
// instance buffer `g.ib` (not the camera-compacted `drawIb`): units in the sun
// outside the view still shadow what is on screen; the sun-plane cull is per group.
import { DrawList, addStructures, addMeshStructures, pushClothItem, DRAW_TERRAIN, DRAW_FLAG_ONE_PART, MAX_DRAW_ITEMS } from './DrawList.js';
import { addVoxelInstances } from './voxelMesh.js';
import { fillShadowBands, groupRadius } from './instances.js';

/**
 * MESH-SHADOW-02 (37.19 option 1): placed kind-9 mesh props only (towers, terrain, cloth, voxel props, instanced groups are never
 * budgeted). Cut-off = `src.meshLod0M` from the eye; `cap` = max props kept (nearest first, ties by object id). `cap` is a
 * mutable tunable (probes/sweeps); both the GL pass and the JS twin read this one list, so parity is unaffected.
 */
export const MESH_SHADOW_CAP = 4;
export const meshShadowBudget = { cap: MESH_SHADOW_CAP, cutM: /** @type {number|null} */ (null) }; // cutM null = src.meshLod0M (probe override only)
const _budget = { eye: /** @type {any} */ (null), cutM: 25, cap: MESH_SHADOW_CAP };

/** Builder output capacity before the overflow trim (the trim keeps `MAX_DRAW_ITEMS`). */
export const SHADOW_BUILD_CAPACITY = 1024;

/** @param {number} [capacity] @returns {DrawList} a list sized for `buildShadowList`. */
export function createShadowList(capacity = SHADOW_BUILD_CAPACITY) {
  return new DrawList(capacity);
}

/**
 * @typedef {Object} ShadowSources
 * @property {{x:number,y:number,z:number}} centre - shadow box centre (LOD / ordering / overflow reference)
 * @property {import('./DrawList.js').LevelMeshCache} cache
 * @property {import('./terrainMesh.js').TerrainMeshSet|null} [terrainSet] - already `step()`ed by the camera pass
 * @property {{list: any[], partNamesFor: (k: string) => string[]}|null} [voxelPool]
 * @property {import('./voxelMesh.js').VoxelMeshCache} [voxelMeshCache]
 * @property {number} [fogFarM] - structure distance cull (default 2000, as the camera feed)
 * @property {import('./instances.js').InstanceGroups|null} [instances] - RE-06 groups (ME-15c): parts from the camera pass
 * @property {{x:number,y:number}} [eye] - ME-15f: camera eye xy; with it instanced groups are distance-banded (LOD0 <= meshLod0M, LOD1 <= instCastM, none beyond) into engine-owned `g.shadowIb`; without it the full `g.ib` at LOD0 (old behaviour)
 * @property {number} [meshLod0M] - ME-15f (default 25)
 * @property {number} [instCastM] - ME-15f (default 48)
 * @property {{count:number, cloths:any[], meshes:any[], mats:(string|null)[], castShadow?:ArrayLike<number>}|null} [cloths] - CLOTH-1b1 (33.5): the cloth system; every cloth with `castShadow` (drawn or not) is pushed, the sun-plane cull decides
 * @property {import('./DrawList.js').MeshDrawCache} [meshCache] - ME-14c2: draw copies of placed glTF meshes (casters need `meshIdFor` too)
 * @property {(key: string) => number} [meshIdFor] - strict resolver for imported mesh materials
 * @property {(key: string) => number} [matIdFor] - cloth mesh creation (material key -> id)
 */

/**
 * Fills `list` with every shadow caster intersecting the shadow frustum.
 * @param {DrawList} list - from `createShadowList`
 * @param {DrawList|null} cameraList - culled camera list; terrain items present there keep its LOD range
 * @param {import('../world/World.js').World} world
 * @param {Float64Array} planes - `shadowSunMatrix().planes`
 * @param {ShadowSources} src
 * @returns {number} list.count
 */
export function buildShadowList(list, cameraList, world, planes, src) {
  const c = src.centre;
  list.begin();
  addStructures(list, world, c, src.cache, src.fogFarM || 2000);
  if (src.meshCache && src.meshIdFor) {
    let b = null;
    if (src.eye) { b = _budget; b.eye = src.eye; b.cutM = meshShadowBudget.cutM || src.meshLod0M || 25; b.cap = meshShadowBudget.cap; } // MESH-SHADOW-02; no eye = old behaviour
    addMeshStructures(list, world, c, src.meshCache, src.meshIdFor, src.fogFarM || 2000, true, b); // ME-14c2 (37.1 item 6)
  }
  if (src.terrainSet) src.terrainSet.addToDrawList(list, c);
  const vp = src.voxelPool;
  if (vp && vp.list.length > 0 && src.voxelMeshCache) {
    addVoxelInstances(list, /** @type {any} */ (vp), src.voxelMeshCache, vp.partNamesFor);
  }
  const ig = src.instances;
  if (ig && ((ig.pool && src.voxelMeshCache) || (src.meshCache && src.meshIdFor))) {
    const groups = ig.groups;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (g.count <= 0 || g.castShadow === false) continue;
      if (g.mesh) { // TREES-LP-b: kind-9 mesh group; one band (<= instCastM), no LOD1
        if (!src.meshCache || !src.meshIdFor) continue;
        const draw = src.meshCache.get(g.mesh, src.meshIdFor);
        let it = null;
        if (!src.eye) it = list.addInstances(draw, g.parts, g.ib, g.count);
        else {
          if (!(g._R > 0)) g._R = groupRadius(draw, g.parts);
          const cast = src.instCastM || 48;
          fillShadowBands(g, src.eye.x, src.eye.y, cast, cast, planes, g._R); // lod0M == castM: band 1 stays empty
          if (g.shadowCount[0] > 0) it = list.addInstances(draw, g.parts, g.shadowIb[0], g.shadowCount[0], g._R);
        }
        if (it) it.flags |= DRAW_FLAG_ONE_PART;
        continue;
      }
      if (!ig.pool || !src.voxelMeshCache) continue;
      const pm = ig.pool.models.get(g.modelKey);
      if (!pm) continue;
      const names = ig.pool.partNamesFor(g.modelKey);
      const mesh0 = src.voxelMeshCache.get(pm, g.modelKey, names);
      const eye = src.eye;
      if (!eye) { list.addInstances(mesh0, g.parts, g.ib, g.count); continue; }
      // ME-15f (27.9a amendment 5): bands from the eye + shadow-plane cull; the camera's drawIb/drawCount stay untouched.
      const mesh1 = src.voxelMeshCache.get(pm, g.modelKey, names, 1) || mesh0;
      let R = groupRadius(mesh0, g.parts);
      if (mesh1 !== mesh0) { const R1 = groupRadius(mesh1, g.parts); if (R1 > R) R = R1; }
      fillShadowBands(g, eye.x, eye.y, src.meshLod0M || 25, src.instCastM || 48, planes, R);
      if (g.shadowCount[0] > 0) list.addInstances(mesh0, g.parts, g.shadowIb[0], g.shadowCount[0], R);
      if (g.shadowCount[1] > 0) list.addInstances(mesh1, g.parts, g.shadowIb[1], g.shadowCount[1], R);
    }
  }
  const cs = src.cloths;
  if (cs) {
    for (let i = 0; i < cs.count; i++) {
      if (cs.castShadow && !cs.castShadow[i]) continue;
      pushClothItem(list, cs, i, src.matIdFor);
    }
  }
  list.cull(planes);
  if (cameraList) syncTerrainLod(list, cameraList);
  trimShadowList(list, c.x, c.y);
  return list.count;
}

/** Terrain items that also exist in the camera list use its LOD range (caster == receiver geometry). */
function syncTerrainLod(list, cameraList) {
  for (let i = 0; i < list.count; i++) {
    const it = list.items[i];
    if (it.type !== DRAW_TERRAIN) continue;
    for (let k = 0; k < cameraList.count; k++) {
      const ci = cameraList.items[k];
      if (ci.mesh === it.mesh && ci.objectId === it.objectId) { it.rangeFirst = ci.rangeFirst; it.rangeCount = ci.rangeCount; break; }
    }
  }
}

/** Drops farthest-from-centre items (ties: the later one) until `count <= MAX_DRAW_ITEMS`; stable order otherwise. */
export function trimShadowList(list, cx, cy) {
  const items = list.items;
  while (list.count > MAX_DRAW_ITEMS) {
    let worst = 0, worstD = -1;
    for (let i = 0; i < list.count; i++) {
      const a = items[i].aabb;
      const dx = (a[0] + a[3]) * 0.5 - cx, dy = (a[1] + a[4]) * 0.5 - cy;
      const d = dx * dx + dy * dy;
      if (d >= worstD) { worstD = d; worst = i; }
    }
    const dead = items[worst];
    for (let i = worst; i < list.count - 1; i++) items[i] = items[i + 1];
    items[list.count - 1] = dead;
    list.count--;
  }
}

// ---- world z range (feeds `shadowSunMatrix`) -------------------------------
const _zCache = new WeakMap();

/**
 * World z extent of terrain + placed structures for the depth range. The
 * structure part is cached on `world.structVersion`; the terrain part is read
 * each call (a few numbers). Returns `out` (`{min, max}`).
 * @param {import('../world/World.js').World} world
 * @param {import('./DrawList.js').LevelMeshCache} cache
 * @param {{min:number,max:number}} out
 */
export function shadowWorldZ(world, cache, out) {
  let e = _zCache.get(world);
  if (!e || e.version !== world.structVersion) {
    let lo = Infinity, hi = -Infinity;
    const structs = world.structures || [];
    for (let i = 0; i < structs.length; i++) {
      const s = structs[i];
      if (s.kind === 'mesh') { lo = Math.min(lo, s.bbox.z0); hi = Math.max(hi, s.bbox.z1); continue; } // ME-14c1: world-space bbox
      const set = cache.get(s), b = set.base.bbox;
      const oz = s.origin.z; // z-only bbox lift (same as DrawList's item aabb)
      lo = Math.min(lo, oz + b[2]);
      hi = Math.max(hi, oz + b[5]);
    }
    e = { version: world.structVersion, lo, hi };
    _zCache.set(world, e);
  }
  let lo = e.lo, hi = e.hi;
  const t = world.terrain;
  if (t) {
    if (t.farMinH < lo) lo = t.farMinH;
    if (t.farMaxH > hi) hi = t.farMaxH;
    const nr = t.nearReady ? t.near : null;
    if (nr) { if (nr.minH < lo) lo = nr.minH; if (nr.maxH > hi) hi = nr.maxH; }
  }
  if (!(lo <= hi)) { lo = 0; hi = 0; }
  out.min = lo; out.max = hi;
  return out;
}
