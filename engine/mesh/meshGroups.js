// @ts-check
// engine/mesh/meshGroups.js - MESH-INST-01 (docs/architecture.md 37.15 item 3; 37.19 option 2) + MESH-SCALE-01 (placement `scale`).
// CPU-side batching of placed kind-9 mesh props: placements that share one registry mesh (LOD 0 today: placements
// have no LOD) become ONE `DRAW_INSTANCED` item per mesh instead of one `DRAW_STATIC` item each.
// No shader change: the existing instanced raster path (`progMeshInst` / `rasterInstanced`) draws them.
//
// Feed shape (what WG-4a will consume): per group a `DRAW_INSTANCED` item { mesh = resolved draw copy (MeshDrawCache),
// flags = DRAW_FLAG_ONE_PART (draw the whole mesh as one range), partMatrices = identity for every range, instBuf = 16-word rows [A_r0 tx | A_r1 ty | A_r2 tz | objectId flags 0 0]
// (INSTANCE_STRIDE, row-major yaw rotation = frameMatrix12), instCount = frustum survivors, aabb = survivors +- R }.
// objectId = 0xA000 | structureIndex (the same id the single draw gets, so picks are unchanged); the instanced path
// derives planeId = flat.x | (objectId & 0xF) << 24 (static draws used a distance-order slot << 20).
//
// MESH-SCALE-01: a placement `scale` (uniform, 0.25..4) is folded into the instance matrix's 3x3 (`placementMatrix12`, the same
// matrix the single draw and the collider bake use); the twin and WGSL vertex stages renormalise normals, so no shader change.
// The group's cull radius R uses the largest member scale (conservative). A scale change on a member rebuilds the set.
//
// Not grouped (stay single `addMeshStructures` draws): meshes with a masked range, > MAX_VOX_PARTS ranges or thin one-sided geometry
// (grass cards; see `meshIsSolid`: the instanced path back-face culls), a mesh with only one
// placement, and anything past MAX_GROUPED_INSTANCES. The shadow feed never uses groups (MESH-SHADOW-02 budget).
//
// Invalidation: the set is rebuilt when world.structures / its length / structVersion / the material resolver changes,
// and when any member's frame or object identity differs from the snapshot taken at build time (checked per feed).
// Zero allocation per frame after a build.
import { MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { addMeshStructures, placementMatrix12, meshObjectId, meshFeedStats, DRAW_FLAG_ONE_PART, DRAW_FLAG_NO_CULL, DRAW_TAIL_RESERVE } from './DrawList.js';
import { INSTANCE_STRIDE, INST_OBJECT_ID, INST_FLAGS, makeInstanceGroup, createInstanceParts, groupRadius, touchInstances } from './instances.js';
import { classifyAABB, CULL_OUT } from './culling.js';
import { lazyMeshVersion } from './lazyMesh.js';

/** Total grouped instances per set (OB-043, 38.46: 2048 -> 4096; build-time only: 2 x 64 B CPU rows per member + one GPU vertex buffer per group). */
export const MAX_GROUPED_INSTANCES = 4096;
/** Survivors pushed per frame (OB-043: 1536 -> 2048; DrawList MAX_LIST_INSTANCES = 4096 engine instances + this); later members are dropped past this. */
export const MAX_GROUPED_KEPT = 2048;
/** Minimum placements per mesh for a group (a lone prop keeps the single-draw path). */
export const MIN_GROUP_SIZE = 2;

const _m12 = new Float64Array(12);

/** @param {any} s @returns {boolean} eligible for grouping on its own (mesh-level checks happen at build). */
function placementEligible(s) {
  return s.kind === 'mesh' && !!s.mesh && !s.mesh.lazy; // MESH-LOAD-01: an unloaded shell stays a (skipped) single until its payload arrives
}

/** Open-edge share (of all welded edges, boundary edges above the mesh base) up to which a mesh still counts as a solid prop. */
export const OPEN_EDGE_MAX_FRAC = 0.05;
const _solid = new WeakMap();

/**
 * The instanced raster path back-face culls (as voxel units do); single placed-mesh draws never did. For a solid prop the
 * culled faces are never visible, so the output is identical. Thin one-sided meshes (grass cards: ~20-45 % boundary edges)
 * would lose cells, so they keep the single-draw path. Heuristic, once per mesh: positions welded at 1e-4 m, a boundary edge
 * (used by one triangle) counts as open only when it lies above the base plane (bbox min z + 2 cm: cut-off bottoms are
 * never seen from above); solid = open edges <= OPEN_EDGE_MAX_FRAC of all edges (tree branch ends 2.5 %, grass 20+ %).
 * @param {any} mesh @returns {boolean}
 */
export function meshIsSolid(mesh) {
  let r = _solid.get(mesh);
  if (r !== undefined) return r;
  const ids = new Map(), zs = [], edges = new Map();
  const vid = (v) => {
    const x = Math.round(mesh.pos[v * 3] * 1e4), y = Math.round(mesh.pos[v * 3 + 1] * 1e4), z = Math.round(mesh.pos[v * 3 + 2] * 1e4);
    const k = x + ',' + y + ',' + z;
    let i = ids.get(k);
    if (i === undefined) { i = ids.size; ids.set(k, i); zs.push(z / 1e4); }
    return i;
  };
  for (let t = 0; t < mesh.triCount; t++) {
    const a = vid(t * 3), b = vid(t * 3 + 1), c = vid(t * 3 + 2);
    for (let e = 0; e < 3; e++) {
      const p = e === 0 ? a : e === 1 ? b : c, q = e === 0 ? b : e === 1 ? c : a;
      const k = p < q ? p * 4294967296 + q : q * 4294967296 + p;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  const base = mesh.bbox[2] + 0.02;
  let open = 0;
  for (const [k, n] of edges) {
    if (n !== 1) continue;
    const p = Math.floor(k / 4294967296), q = k - p * 4294967296;
    if (zs[p] > base || zs[q] > base) open++;
  }
  r = edges.size > 0 && open <= edges.size * OPEN_EDGE_MAX_FRAC;
  _solid.set(mesh, r);
  return r;
}

/** @param {any} mesh @returns {boolean} meshes the instanced path can draw as one identity part set (MESH-INST-02: masked and open meshes too). */
function meshGroupable(mesh) {
  return mesh.layout === 'static' && !!mesh.ranges && mesh.ranges.length <= MAX_VOX_PARTS && mesh.ranges.length >= 1;
}
/** @param {any} mesh @returns {boolean} some range carries an alpha mask (needs per-range draws, no ONE_PART) */
function meshHasMask(mesh) {
  for (let i = 0; i < mesh.ranges.length; i++) if (mesh.ranges[i].mask !== undefined) return true;
  return false;
}

export class MeshGroupSet {
  constructor() {
    /** @type {any[]} one entry per group (see `_build`) */
    this.groups = [];
    /** @type {Uint8Array} structure index -> 1 when drawn by a group (this build) */
    this.grouped = new Uint8Array(0);
    /** @type {Uint8Array} structure index -> 1 when the feed's nearest-MAX_MESH_DRAWS selection picked it this frame (set by `addMeshStructures`) */
    this.chosen = new Uint8Array(0);
    /** @type {any} */ this._structs = null;
    this._len = -1;
    this._ver = -1;
    this._lazyVer = -1; // MESH-LOAD-01: lazyMeshVersion() at the last build
    /** @type {any} */ this._idFor = null;
    /** @type {any} */ this._cache = null;
    /** F3 stats: placements grouped / instances kept by the last `push`. */
    this.stats = { groups: 0, members: 0, kept: 0, builds: 0, groupsDropped: 0, instancesDropped: 0 };
    /** OB-043 per-group scratch (sized at build): nearest survivor distance^2, sort order, take flag. */
    this._gd = new Float64Array(0); this._go = new Int32Array(0); this._gt = new Uint8Array(0);
    /** @type {Float64Array} per member x,y,z,yawDeg,scale snapshot (5 each), concatenated over groups */
    this._snap = new Float64Array(0);
  }

  /** @param {number} si structure index @returns {boolean} */
  has(si) { return si < this.grouped.length && this.grouped[si] === 1; }

  /**
   * Rebuilds the groups when anything relevant changed. Allocates only on a rebuild.
   * @param {import('../world/World.js').World} world
   * @param {import('./DrawList.js').MeshDrawCache} cache
   * @param {(key: string) => number} idFor
   */
  update(world, cache, idFor) {
    const structs = world.structures;
    const ver = /** @type {any} */ (world).structVersion | 0;
    let dirty = lazyMeshVersion() !== this._lazyVer || structs !== this._structs || structs.length !== this._len || ver !== this._ver || idFor !== this._idFor || cache !== this._cache;
    if (!dirty) dirty = !this._snapshotValid(structs);
    if (dirty) this._build(structs, ver, cache, idFor, world.maskAtlas || null);
  }

  /** @param {any[]} structs */
  _snapshotValid(structs) {
    const snap = this._snap;
    let w = 0;
    for (let k = 0; k < this.groups.length; k++) {
      const g = this.groups[k], mem = g.members;
      for (let j = 0; j < mem.length; j++) {
        const s = structs[mem[j]];
        if (s !== g.refs[j]) return false;
        const f = s.frame;
        if (f.x !== snap[w] || f.y !== snap[w + 1] || f.z !== snap[w + 2] || (f.yawDeg || 0) !== snap[w + 3] || f.yawSteps !== g.steps[j]) return false;
        if (s.mesh !== g.mesh || (s.scale === undefined ? 1 : s.scale) !== snap[w + 4]) return false;
        w += 5;
      }
    }
    return true;
  }

  /** @param {any[]} structs @param {number} ver */
  _build(structs, ver, cache, idFor, atlas) {
    this._lazyVer = lazyMeshVersion();
    this._structs = structs; this._len = structs.length; this._ver = ver; this._idFor = idFor; this._cache = cache;
    this.stats.builds++;
    this.groups.length = 0;
    if (this.grouped.length < structs.length) { this.grouped = new Uint8Array(structs.length + 64); this.chosen = new Uint8Array(structs.length + 64); }
    else this.grouped.fill(0);
    /** @type {Map<any, number[]>} */
    const byMesh = new Map();
    for (let i = 0; i < structs.length; i++) {
      const s = structs[i];
      if (!placementEligible(s)) continue;
      let l = byMesh.get(s.mesh);
      if (!l) { l = []; byMesh.set(s.mesh, l); }
      l.push(i);
    }
    let total = 0, snapN = 0;
    const picked = [];
    for (const [mesh, list] of byMesh) { // Map order = first placement order: deterministic
      if (list.length < MIN_GROUP_SIZE || !meshGroupable(mesh)) continue;
      if (total + list.length > MAX_GROUPED_INSTANCES) continue;
      total += list.length; snapN += list.length;
      picked.push([mesh, list]);
    }
    const snap = new Float64Array(snapN * 5);
    let w = 0;
    for (let p = 0; p < picked.length; p++) {
      const [mesh, list] = picked[p];
      const n = list.length;
      const g = /** @type {any} */ (makeInstanceGroup(mesh.id || 'mesh', n));
      const draw = cache.get(mesh, idFor, atlas);
      g.mesh = mesh; g.draw = draw; g.members = Int32Array.from(list);
      g.refs = new Array(n); g.steps = new Int32Array(n);
      g.count = n;
      g.masked = meshHasMask(mesh); // per-range draws (mask atlas per range); never ONE_PART
      g.open = !meshIsSolid(mesh);   // thin / one-sided: draw without back-face culling (what the single draw did)
      let maxScale = 1;
      // identity for every range index: both twins read `partMatrices[p]` per range (one voxel-style part per range)
      g.parts = createInstanceParts();
      for (let r = 0; r < mesh.ranges.length; r++) {
        const o = r * 12;
        g.parts.m[o] = 1; g.parts.m[o + 4] = 1; g.parts.m[o + 8] = 1;
        g.parts.flags[r] = 1;
      }
      g.parts.count = mesh.ranges.length;
      const u = g.ib.u32, f = g.ib.f32;
      for (let j = 0; j < n; j++) {
        const si = list[j], s = structs[si];
        this.grouped[si] = 1;
        g.refs[j] = s; g.steps[j] = s.frame.yawSteps;
        placementMatrix12(s, _m12);
        const sk = s.scale === undefined ? 1 : s.scale;
        if (sk > maxScale) maxScale = sk;
        const o = j * INSTANCE_STRIDE;
        f[o] = _m12[0]; f[o + 1] = _m12[1]; f[o + 2] = _m12[2]; f[o + 3] = _m12[9];
        f[o + 4] = _m12[3]; f[o + 5] = _m12[4]; f[o + 6] = _m12[5]; f[o + 7] = _m12[10];
        f[o + 8] = _m12[6]; f[o + 9] = _m12[7]; f[o + 10] = _m12[8]; f[o + 11] = _m12[11];
        u[o + INST_OBJECT_ID] = meshObjectId(si);
        u[o + INST_FLAGS] = 0; // not axis-aligned: the kind-9 face comes from the interpolated normal, as for single draws
        f[o + 14] = 0; f[o + 15] = 0;
        snap[w++] = s.frame.x; snap[w++] = s.frame.y; snap[w++] = s.frame.z; snap[w++] = s.frame.yawDeg || 0; snap[w++] = sk;
      }
      touchInstances(g.ib); // AUD-02: raw row writes above
      g._R = groupRadius(draw, g.parts) * maxScale;
      this.groups.push(g);
    }
    this._snap = snap;
    const G = this.groups.length;
    if (this._gd.length < G) { this._gd = new Float64Array(G); this._go = new Int32Array(G); this._gt = new Uint8Array(G); }
    this.stats.groups = this.groups.length;
    this.stats.members = total;
  }

  /**
   * One `DRAW_INSTANCED` item per group with >= 1 survivor. Survivors = members within draw distance
   * (`chosen`, uncapped) that are not outside the frustum; stable order,
   * 16 words copied through the u32 view (bit-exact). Zero allocation.
   * OB-043 (38.46): at most `list.capacity - list.count - DRAW_TAIL_RESERVE` group items are pushed; past that the groups
   * whose nearest survivor is farthest from `cam` (xy; ties: later group) are dropped whole and counted in `stats` and
   * `meshFeedStats.groupsDropped`. Push order stays the build order (both twins identical). Zero allocation.
   * @param {import('./DrawList.js').DrawList} list
   * @param {Float64Array|null} planes - `frustumPlanes` output; null = keep all
   * @param {{x:number,y:number}|null} [cam] - eye for the overflow ranking (null = origin)
   */
  push(list, planes, cam = null) {
    const chosen = this.chosen, G = this.groups.length, gd = this._gd;
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0;
    let kept = 0, live = 0;
    for (let k = 0; k < G; k++) {
      const g = this.groups[k], mem = g.members, R = g._R;
      const srcF = g.ib.f32, srcU = g.ib.u32, dst = g.drawIb[0].u32;
      let w = 0, dmin = Infinity;
      for (let j = 0; j < mem.length; j++) {
        if (chosen[mem[j]] !== 1) continue;
        if (kept + w >= MAX_GROUPED_KEPT) break;
        const o = j * INSTANCE_STRIDE;
        const tx = srcF[o + 3], ty = srcF[o + 7], tz = srcF[o + 11];
        if (planes && classifyAABB(planes, tx - R, ty - R, tz - R, tx + R, ty + R, tz + R) === CULL_OUT) continue;
        const wo = w * INSTANCE_STRIDE;
        for (let c = 0; c < INSTANCE_STRIDE; c++) dst[wo + c] = srcU[o + c];
        w++;
        const dx = tx - cx, dy = ty - cy, d2 = dx * dx + dy * dy;
        if (d2 < dmin) dmin = d2;
      }
      g.drawCount[0] = w; touchInstances(g.drawIb[0]); // AUD-02: raw compaction writes -> version bump
      kept += w;
      gd[k] = dmin;
      if (w > 0) live++;
    }
    // OB-043: group items over the budget -> keep the `budget` nearest (insertion sort of the live groups by (d2, k); overflow frames only)
    const budget = Math.max(0, list.capacity - list.count - DRAW_TAIL_RESERVE), take = this._gt;
    let groupsDropped = 0, instDropped = 0;
    if (live > budget) {
      const ord = this._go;
      let n = 0;
      for (let k = 0; k < G; k++) {
        take[k] = 0;
        if (this.groups[k].drawCount[0] <= 0) continue;
        const dk = gd[k];
        let j = n - 1;
        while (j >= 0 && gd[ord[j]] > dk) { ord[j + 1] = ord[j]; j--; }
        ord[j + 1] = k; n++;
      }
      for (let i = 0; i < budget; i++) take[ord[i]] = 1;
      for (let i = budget; i < n; i++) { groupsDropped++; instDropped += this.groups[ord[i]].drawCount[0]; }
    }
    for (let k = 0; k < G; k++) {
      const g = this.groups[k], w = g.drawCount[0];
      if (w <= 0 || (live > budget && !take[k])) continue;
      const it = list.addInstances(g.draw, g.parts, g.drawIb[0], w, g._R);
      if (it) it.flags |= (g.masked ? 0 : DRAW_FLAG_ONE_PART) | (g.open ? DRAW_FLAG_NO_CULL : 0);
    }
    this.stats.kept = kept - instDropped;
    this.stats.groupsDropped = groupsDropped; this.stats.instancesDropped = instDropped;
    meshFeedStats.groupsDropped = groupsDropped;
  }
}

/**
 * Camera feed for placed kind-9 meshes with batching: grouped placements become instanced items, everything else goes
 * through `addMeshStructures` exactly as before. BUG-MESH-MISSING-01: grouped placements are NOT subject to the `MAX_MESH_DRAWS` cap (every one within fogFarM is `chosen`, the frustum cull thins them); only singles are capped, ranked by projected size. `groups` null = old behaviour.
 * @param {import('./DrawList.js').DrawList} list
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number}} cam
 * @param {import('./DrawList.js').MeshDrawCache} cache
 * @param {(key: string) => number} idFor
 * @param {number} fogFarM
 * @param {MeshGroupSet|null} groups
 * @param {Float64Array|null} planes - camera frustum planes (the group compaction cull)
 */
export function addMeshStructuresBatched(list, world, cam, cache, idFor, fogFarM, groups, planes) {
  if (!groups) { addMeshStructures(list, world, cam, cache, idFor, fogFarM, false, null, null, planes); return; }
  groups.update(world, cache, idFor);
  addMeshStructures(list, world, cam, cache, idFor, fogFarM, false, null, groups, planes); // OB-039: frustum-aware single pick
  groups.push(list, planes, cam);
}

