// @ts-check
// engine/world/colliders.js - ME-11a (docs/backlog.md, docs/architecture.md
// 27.18). Builds the `MeshCollider[]` (27.17 shape) a `World` in
// `physicsMode: 'mesh'` collides against: one base collider per placed
// structure (`buildLevelMesh(level).base`) plus one collider per dynamic
// legend tag (`buildLevelMesh(level).dyn`, e.g. the tower's grate).
//
// Grate / dynamic tags (27.18 "Grate / dynamic tags"): rebuilding a dyn
// mesh + BVH every sim step is too slow (~1.5 ms measured on the tower,
// over the 1 ms/step budget) for a mesh whose only change is one sector's
// `ceilH`. Instead each dyn collider is built ONCE, at load, with that
// tag's `sector.ceilH` temporarily forced to a sentinel value
// (`floorH + 1000.5`) before the mesh is built; every vertex whose z lands
// exactly on that sentinel is recorded in `trackCeil` (a dynamic sector's
// faces are the ONLY faces whose z can equal the sentinel, since ordinary
// level geometry never reads a value 1000 m above any real floor).
// `refitDynCollider` then only ever rewrites those tracked vertices' z to
// the CURRENT `ceilH` and calls `bvh.js`'s `refit` (same topology, zero
// allocation) - no mesh rebuild, no allocation, on the hot path.
//
// A one-time sanity check (per structure+tag, warns at most once) confirms
// the sentinel trick is safe for this content: the sentinel build's BASE
// mesh must be byte-identical to a normal (non-sentinel) build's base -
// i.e. no base face is allowed to depend on this tag's `ceilH` (the
// `levelMesh.js` "upper/lintel" boundary rule reads a NEIGHBOUR cell's
// `ceilH`, so a future dynamic tag adjacent to a non-dynamic sector could,
// in principle, break this). If it ever doesn't hold, that one tag falls
// back to a full mesh rebuild per refit (allocates, logged once) rather
// than silently returning wrong geometry.
//
// engine/world may import engine/mesh/levelMesh.js and
// engine/physics/bvh.js at runtime (27.18: no rule against it - engine/mesh
// never imports engine/world, so there is no cycle).
import { buildLevelMesh } from '../mesh/levelMesh.js';
import { buildBvh, buildBvhFromMesh, refit } from '../physics/bvh.js';

/** @typedef {import('../physics/meshCollide.js').MeshCollider} MeshCollider */

/** Structures already warned about (one console.warn per structure:tag, ever). */
const _warnedSentinelMismatch = new Set();

/** Row-major 3x3 identity + translation (bvh.js's matrix12 layout). yawSteps is always 0 in M1 (`World.placeStructure` throws otherwise). */
function translationMatrix(origin) {
  return Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, origin.x, origin.y, origin.z]);
}

/** Strict element-wise equality of two typed arrays (length first). */
function typedArrayEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** "Byte-identical" MeshData comparison (pos/uv/nrm/flat/aux + triCount) - the sentinel-safety check. */
function meshesEqual(a, b) {
  return a.triCount === b.triCount
    && typedArrayEqual(a.pos, b.pos)
    && typedArrayEqual(a.uv, b.uv)
    && typedArrayEqual(a.nrm, b.nrm)
    && typedArrayEqual(a.flat, b.flat)
    && typedArrayEqual(a.aux, b.aux);
}


/** Structures:tags already warned about for a bad `topH` (one warn per key). */
const _warnedBarrierTopH = new Set();

/**
 * 27.18b: vertical barrier quads on every edge of the dynamic sector `ch`'s
 * cells that faces the open sky (grid edge, or a non-solid neighbour with
 * `ceilH: 'sky'`), spanning z0..topH. `levelMesh` emits no face there (rule 3
 * needs a numeric neighbour ceilH), so the closed grate would be walk-through.
 * Same corner order/winding as `levelMesh.emitWall` for the face pointing out
 * of the dyn cell. Positions are float32-rounded like the mesh's. Build time
 * only (allocates). Appends 18 numbers per edge (2 tris, non-indexed) to `out`.
 * @param {import('./Level.js').Level} level
 * @param {string} ch legend char of the dynamic sector
 * @param {number} z0 bottom edge (the sector's current ceilH, or a sentinel)
 * @param {number[]} [out]
 * @returns {number[]}
 */
export function dynBarrierQuads(level, ch, z0, out = []) {
  const sec = level.legend[ch];
  const topH = sec && sec.topH;
  if (typeof topH !== 'number' || !(topH > sec.dynamic.ceilOpen)) {
    const key = `${level.name}:${sec && sec.tag}`;
    if (!_warnedBarrierTopH.has(key)) {
      _warnedBarrierTopH.add(key);
      console.warn(`engine/world/colliders.js: "${key}": dynamic sector needs a numeric topH > dynamic.ceilOpen for its barrier quads; none emitted (content error).`);
    }
    return out;
  }
  const zb = Math.fround(z0), zt = Math.fround(topH);
  const corners = [0, 1, 2, 0, 2, 3];
  const push = (p12) => { for (const c of corners) out.push(p12[c * 3], p12[c * 3 + 1], p12[c * 3 + 2]); };
  const open = (c, r) => {
    if (!level.inBounds(c, r)) return true;
    const n = level.legend[level.rows[r][c]];
    if (!n) return true;
    if (n.solid || (n.dynamic && n.tag === sec.tag)) return false;
    return n.ceilH === 'sky';
  };
  for (let r = 0; r < level.height; r++) {
    for (let c = 0; c < level.width; c++) {
      if (level.rows[r][c] !== ch) continue;
      // neighbour west (face W), east (E), north (N), south (S) - emitWall's layouts
      if (open(c - 1, r)) push([c, r, zb, c, r, zt, c, r + 1, zt, c, r + 1, zb]);
      if (open(c + 1, r)) push([c + 1, r + 1, zb, c + 1, r + 1, zt, c + 1, r, zt, c + 1, r, zb]);
      if (open(c, r - 1)) push([c + 1, r, zb, c + 1, r, zt, c, r, zt, c, r, zb]);
      if (open(c, r + 1)) push([c, r + 1, zb, c, r + 1, zt, c + 1, r + 1, zt, c + 1, r + 1, zb]);
    }
  }
  return out;
}

/** Static-layout pos with the tag's barrier quads appended (z0 = `z0`). */
function posWithBarriers(mesh, level, ch, z0) {
  const extra = dynBarrierQuads(level, ch, z0);
  const pos = new Float64Array(mesh.pos.length + extra.length);
  pos.set(mesh.pos, 0);
  pos.set(extra, mesh.pos.length);
  return pos;
}

/** One MeshCollider from a MeshData (static layout, idx === null), or null if it has no triangles. */
function colliderFromMesh(id, mesh, matrix12) {
  if (!mesh || mesh.triCount === 0) return null;
  const bvh = buildBvhFromMesh(mesh, matrix12);
  return {
    id,
    kind: /** @type {'trimesh'} */ ('trimesh'),
    bvh,
    min: Float64Array.from([bvh.nodeMin[0], bvh.nodeMin[1], bvh.nodeMin[2]]),
    max: Float64Array.from([bvh.nodeMax[0], bvh.nodeMax[1], bvh.nodeMax[2]]),
    enabled: true,
  };
}

/** Refreshes a collider's world AABB from its (already refit/rebuilt) bvh's root node bounds. */
function refreshAabb(collider) {
  const bvh = collider.bvh;
  collider.min[0] = bvh.nodeMin[0]; collider.min[1] = bvh.nodeMin[1]; collider.min[2] = bvh.nodeMin[2];
  collider.max[0] = bvh.nodeMax[0]; collider.max[1] = bvh.nodeMax[1]; collider.max[2] = bvh.nodeMax[2];
}

/**
 * Zero-allocation refit: rewrites only the tracked vertices' z to `ceilH`,
 * re-derives the bvh's world triangle data + node bounds (`bvh.js` `refit`,
 * same topology) and refreshes the collider's AABB.
 */
function refitColliderInPlace(collider, ceilH) {
  // Math.fround: the mesh this collider's topology came from stores vertex
  // positions in a Float32Array (levelMesh.js/MeshData.js) - a fresh build
  // at this same ceilH would round it to float32 too, so rounding here is
  // what keeps a refit bit-comparable to a fresh `buildLevelMesh` build
  // (colliders.test.js's grate-refit-vs-fresh-build check).
  const z = Math.fround(ceilH);
  const pos = collider._pos, track = collider._trackCeil;
  for (let i = 0; i < track.length; i++) {
    if (track[i]) pos[i * 3 + 2] = z;
  }
  refit(collider.bvh, pos, collider._idx, collider._matrix12);
  refreshAabb(collider);
}

/**
 * Full rebuild fallback (only reached if the sentinel sanity check ever
 * fails for this tag - not expected for the tower's grate, per 27.18).
 * Allocates every call; that's accepted here in exchange for correctness.
 */
function rebuildDynColliderFallback(collider, structure, tag) {
  const set = buildLevelMesh(structure.level);
  const dynEntry = set.dyn.find((d) => d.tag === tag);
  if (!dynEntry) { collider.enabled = false; return; }
  const ch = structure.tagMap.get(tag);
  const pos = posWithBarriers(dynEntry.mesh, structure.level, ch, structure.level.legend[ch].ceilH);
  collider.bvh = buildBvh(pos, null, collider._matrix12);
  refreshAabb(collider);
  collider.enabled = true;
}

/**
 * Builds one dynamic-tag collider for `structure` (the sentinel trick, see
 * the file header). `normalBaseMesh` is the structure's already-built
 * (non-sentinel) base MeshData, used for the one-time sanity check.
 * @returns {MeshCollider|null}
 */
function buildDynCollider(structure, tag, normalBaseMesh, matrix12) {
  const level = structure.level;
  const ch = structure.tagMap.get(tag);
  const sector = level.legend[ch];
  const currentCeilH = sector.ceilH; // already the restored value: World.load runs _restoreDynamics before this
  const sentinel = Math.fround(sector.floorH + 1000.5);

  sector.ceilH = sentinel;
  let sentinelSet;
  try {
    sentinelSet = buildLevelMesh(level);
  } finally {
    sector.ceilH = currentCeilH;
  }

  const key = `${structure.id}:${tag}`;
  if (!meshesEqual(sentinelSet.base, normalBaseMesh)) {
    if (!_warnedSentinelMismatch.has(key)) {
      _warnedSentinelMismatch.add(key);
      console.warn(`engine/world/colliders.js: "${key}": the sentinel build's base mesh differs from the normal base - a base face depends on this tag's ceilH. Falling back to a full mesh rebuild on every refit for this tag (allocates).`);
    }
    const normalSet = buildLevelMesh(level); // level is back at currentCeilH here
    const normalDyn = normalSet.dyn.find((d) => d.tag === tag);
    if (!normalDyn) return null;
    const fbPos = posWithBarriers(normalDyn.mesh, level, ch, currentCeilH);
    const collider = colliderFromMesh(key, { triCount: fbPos.length / 9, pos: fbPos, idx: null }, matrix12);
    if (!collider) return null;
    collider._matrix12 = matrix12;
    collider._fallback = true;
    return collider;
  }

  const dynEntry = sentinelSet.dyn.find((d) => d.tag === tag);
  if (!dynEntry) return null;
  const mesh = dynEntry.mesh;
  // 27.18b: barrier quads built with z0 = sentinel so trackCeil marks them too.
  const allPos = posWithBarriers(mesh, level, ch, sentinel);
  const vertexCount = allPos.length / 3;
  const trackCeil = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    if (allPos[i * 3 + 2] === sentinel) trackCeil[i] = 1;
  }

  const bvh = buildBvh(allPos, null, matrix12);
  const collider = {
    id: key,
    kind: /** @type {'trimesh'} */ ('trimesh'),
    bvh,
    min: Float64Array.from([bvh.nodeMin[0], bvh.nodeMin[1], bvh.nodeMin[2]]),
    max: Float64Array.from([bvh.nodeMax[0], bvh.nodeMax[1], bvh.nodeMax[2]]),
    enabled: true,
    // ME-11a refit bookkeeping - not part of the 27.17 MeshCollider typedef,
    // read only by refitDynCollider/refitColliderInPlace in this module.
    _pos: allPos,
    _idx: null,
    _matrix12: matrix12,
    _trackCeil: trackCeil,
    _fallback: false,
  };
  // The sentinel above is a build-time trick only - refit once immediately
  // to the structure's real (already-restored) ceilH before this collider
  // is ever used.
  refitColliderInPlace(collider, currentCeilH);
  return collider;
}

/**
 * Builds every collider for `world`'s currently placed structures: one base
 * collider (id = `structure.id`) + one per dynamic tag (id =
 * `${structure.id}:${tag}`, tags sorted), deterministic order (structures in
 * `world.structures` order, tags sorted within a structure). Meshes with 0
 * triangles are skipped (no collider needed). Also records, on each
 * structure, a `tag -> collider` map (`structure._dynColliders`) so
 * `refitDynCollider` can look a collider up with no allocation.
 * @param {import('./World.js').World} world
 * @returns {MeshCollider[]}
 */
export function buildWorldColliders(world) {
  const colliders = [];
  for (const s of world.structures) {
    s._dynColliders = new Map();
    const matrix12 = translationMatrix(s.origin);
    const set = buildLevelMesh(s.level);

    const base = colliderFromMesh(s.id, set.base, matrix12);
    if (base) colliders.push(base);

    const tags = s.tagMap ? Array.from(s.tagMap.keys()).sort() : [];
    for (const tag of tags) {
      const c = buildDynCollider(s, tag, set.base, matrix12);
      if (c) {
        colliders.push(c);
        s._dynColliders.set(tag, c);
      }
    }
  }
  return colliders;
}

/**
 * Refits (or, on the rare sentinel-mismatch fallback path, fully rebuilds)
 * `${structure.id}:${tag}`'s collider to the tag's CURRENT `ceilH`. No-op if
 * that tag never got a collider (e.g. it had 0 triangles at load). Zero
 * allocation on the normal (non-fallback) path.
 * @param {import('./World.js').World} world
 * @param {Object} structure - a `world.structures[i]` entry
 * @param {string} tag
 */
export function refitDynCollider(world, structure, tag) {
  const collider = structure._dynColliders && structure._dynColliders.get(tag);
  if (!collider) return;
  const ch = structure.tagMap.get(tag);
  const ceilH = structure.level.legend[ch].ceilH;
  if (collider._fallback) {
    rebuildDynColliderFallback(collider, structure, tag);
    return;
  }
  refitColliderInPlace(collider, ceilH);
}
