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
import { DrawList, addStructures, DRAW_TERRAIN, MAX_DRAW_ITEMS } from './DrawList.js';
import { addVoxelInstances } from './voxelMesh.js';

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
 * @property {import('./instances.js').InstanceGroups|null} [instances] - RE-06 groups (ME-15c): full buffer, parts from the camera pass
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
  if (src.terrainSet) src.terrainSet.addToDrawList(list, c);
  const vp = src.voxelPool;
  if (vp && vp.list.length > 0 && src.voxelMeshCache) {
    addVoxelInstances(list, /** @type {any} */ (vp), src.voxelMeshCache, vp.partNamesFor);
  }
  const ig = src.instances;
  if (ig && ig.pool && src.voxelMeshCache) {
    const groups = ig.groups;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (g.count <= 0) continue;
      const pm = ig.pool.models.get(g.modelKey);
      if (!pm) continue;
      list.addInstances(src.voxelMeshCache.get(pm, g.modelKey, ig.pool.partNamesFor(g.modelKey)), g.parts, g.ib, g.count);
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
      const s = structs[i], set = cache.get(s), b = set.base.bbox;
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
