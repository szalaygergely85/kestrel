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
import { makeFrame } from '../core/transform.js';
import { placementMatrix12 } from '../mesh/DrawList.js';
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
    // Imported meshes have no grid sectors or dynamic legend tags.
    if (s.mesh) continue; // merged below by buildStaticMeshCollider
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
  const merged = buildStaticMeshCollider(world);
  if (merged) colliders.push(merged);
  return colliders;
}

/**
 * ED-MESH-01e: the merged `meshes:static` collider of all placed mesh structures (structure order = parts
 * order, so a rebuild after an edit is bit-identical to a fresh load). `null` when nothing collides.
 * @param {import('./World.js').World} world
 * @returns {MeshCollider|null}
 */
export function buildStaticMeshCollider(world) {
  const meshParts = [];
  for (const s of world.structures) {
    if (!s.mesh) continue;
    const mesh = typeof s.mesh === 'string' ? world.assets.mesh(s.mesh) : s.mesh;
    const frame = s.frame || makeFrame(s.origin.x, s.origin.y, s.origin.z, 0, s.yawDeg || 0);
    const matrix12 = placementMatrix12({ frame, scale: s.scale }, new Float64Array(12));
    const src = proxySource(mesh, s);
    if (src) meshParts.push({ id: s.id, src, matrix12 });
  }
  return buildMergedMeshCollider(meshParts);
}

/** Mesh ids already warned about for colliding with > PROXY_WARN_TRIS render triangles (once per mesh). */
const _warnedNoProxy = new Set();
const PROXY_WARN_TRIS = 64;

/**
 * MESH-PHYS-01: what a placed mesh collides with - `null` (walk-over: `collide: false` on the mesh or the
 * placement), its `collider` proxy (9 floats/tri), or, as a fallback, its render triangles.
 * @returns {{pos: ArrayLike<number>, triCount: number}|null}
 */
function proxySource(mesh, placement) {
  if (!mesh || mesh.collide === false || placement.collide === false) return null;
  if (mesh.collider && mesh.collider.length >= 9) return { pos: mesh.collider, triCount: mesh.collider.length / 9 };
  if (!mesh.triCount) return null;
  if (mesh.triCount > PROXY_WARN_TRIS && !_warnedNoProxy.has(mesh.id)) {
    _warnedNoProxy.add(mesh.id);
    console.warn(`engine/world/colliders.js: mesh "${mesh.id}" collides with its ${mesh.triCount} render triangles - run tools/gen-mesh-colliders.mjs to add a proxy.`);
  }
  return { pos: mesh.pos, triCount: mesh.triCount };
}

/**
 * MESH-PHYS-01 broad phase: ALL static placed-mesh proxies baked (world space) into ONE BVH built once at
 * load, so a query costs one collider AABB test + a log-depth traversal that reaches only the few proxies
 * near the player, instead of one AABB test (and one BVH) per placed mesh. `parts` records each source
 * (id + triangle range in BVH source order) for debugging. Same MeshCollider shape as every other collider.
 * @param {Array<{id:string, src:{pos:ArrayLike<number>, triCount:number}, matrix12:ArrayLike<number>}>} parts
 * @returns {MeshCollider|null}
 */
function buildMergedMeshCollider(parts) {
  let tris = 0;
  for (const p of parts) tris += p.src.triCount;
  if (!tris) return null;
  const pos = new Float64Array(tris * 9);
  const ranges = [];
  let o = 0, tri = 0;
  for (const { id, src, matrix12: m } of parts) {
    for (let v = 0; v < src.triCount * 3; v++, o += 3) {
      const x = src.pos[v * 3], y = src.pos[v * 3 + 1], z = src.pos[v * 3 + 2];
      pos[o] = m[0] * x + m[1] * y + m[2] * z + m[9];
      pos[o + 1] = m[3] * x + m[4] * y + m[5] * z + m[10];
      pos[o + 2] = m[6] * x + m[7] * y + m[8] * z + m[11];
    }
    ranges.push({ id, start: tri, count: src.triCount });
    tri += src.triCount;
  }
  const bvh = buildBvh(pos, null, null);
  return {
    id: 'meshes:static', kind: /** @type {'trimesh'} */ ('trimesh'), bvh,
    min: Float64Array.from(bvh.nodeMin.subarray(0, 3)),
    max: Float64Array.from(bvh.nodeMax.subarray(0, 3)),
    enabled: true,
    parts: ranges,
  };
}

/**
 * ME-06c2 (37.2): one load-time BVH of open eight-sided trunk prisms.
 * @param {{count:number,x:Float64Array,y:Float64Array,z:Float64Array,yawDeg:Int16Array,species:Uint8Array}} scatter
 * @param {{species:Array<{trunkR:number,trunkH:number}>}} cfg
 * @returns {MeshCollider|null}
 */
export function buildTrunkCollider(scatter, cfg) {
  if (!scatter || scatter.count === 0) return null;
  const pos = new Float64Array(scatter.count * 8 * 2 * 9);
  let o = 0;
  for (let i = 0; i < scatter.count; i++) {
    const s = cfg.species[scatter.species[i]];
    const r = s.trunkR / Math.cos(Math.PI / 8);
    const yaw = scatter.yawDeg[i] * Math.PI / 180;
    const zb = scatter.z[i] - 0.5, zt = scatter.z[i] + s.trunkH;
    for (let side = 0; side < 8; side++) {
      const a = yaw + side * Math.PI / 4, b = yaw + (side + 1) * Math.PI / 4;
      const ax = scatter.x[i] + r * Math.cos(a), ay = scatter.y[i] + r * Math.sin(a);
      const bx = scatter.x[i] + r * Math.cos(b), by = scatter.y[i] + r * Math.sin(b);
      // CCW ring, outward winding; no top/bottom faces to invent support.
      pos[o++] = ax; pos[o++] = ay; pos[o++] = zb;
      pos[o++] = bx; pos[o++] = by; pos[o++] = zb;
      pos[o++] = bx; pos[o++] = by; pos[o++] = zt;
      pos[o++] = ax; pos[o++] = ay; pos[o++] = zb;
      pos[o++] = bx; pos[o++] = by; pos[o++] = zt;
      pos[o++] = ax; pos[o++] = ay; pos[o++] = zt;
    }
  }
  const bvh = buildBvh(pos, null, null);
  return {
    id: 'scatter:trunks', kind: 'trimesh', bvh,
    min: Float64Array.from(bvh.nodeMin.subarray(0, 3)),
    max: Float64Array.from(bvh.nodeMax.subarray(0, 3)),
    enabled: true,
  };
}

function colliderRing(cx, cy, yaw, prism, radius, hx, hy) {
  const sides = prism ? 8 : 4, ring = new Float64Array(sides * 2);
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (let side = 0; side < sides; side++) {
    let x, y;
    if (prism) {
      const r = radius / Math.cos(Math.PI / 8);
      const angle = yaw + side * Math.PI / 4;
      x = r * Math.cos(angle); y = r * Math.sin(angle);
    } else {
      const lx = side === 0 || side === 3 ? -hx : hx;
      const ly = side < 2 ? -hy : hy;
      x = lx * cos - ly * sin; y = lx * sin + ly * cos;
    }
    ring[side * 2] = cx + x;
    ring[side * 2 + 1] = cy + y;
  }
  return ring;
}

function emitColliderFaces(pos, o, ring, cx, cy, zb, zt, prism, bottom) {
  const sides = ring.length / 2;
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    const ax = ring[side * 2], ay = ring[side * 2 + 1];
    const bx = ring[next * 2], by = ring[next * 2 + 1];
    pos[o++] = ax; pos[o++] = ay; pos[o++] = zb;
    pos[o++] = bx; pos[o++] = by; pos[o++] = zb;
    pos[o++] = bx; pos[o++] = by; pos[o++] = zt;
    pos[o++] = ax; pos[o++] = ay; pos[o++] = zb;
    pos[o++] = bx; pos[o++] = by; pos[o++] = zt;
    pos[o++] = ax; pos[o++] = ay; pos[o++] = zt;
    if (prism) {
      pos[o++] = cx; pos[o++] = cy; pos[o++] = zt;
      pos[o++] = ax; pos[o++] = ay; pos[o++] = zt;
      pos[o++] = bx; pos[o++] = by; pos[o++] = zt;
      if (bottom) {
        pos[o++] = cx; pos[o++] = cy; pos[o++] = zb;
        pos[o++] = bx; pos[o++] = by; pos[o++] = zb;
        pos[o++] = ax; pos[o++] = ay; pos[o++] = zb;
      }
    }
  }
  if (!prism) {
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      pos[o++] = ring[corner * 2]; pos[o++] = ring[corner * 2 + 1]; pos[o++] = zt;
    }
    if (bottom) {
      for (const corner of [0, 2, 1, 0, 3, 2]) {
        pos[o++] = ring[corner * 2]; pos[o++] = ring[corner * 2 + 1]; pos[o++] = zb;
      }
    }
  }
  return o;
}

/**
 * ENV-01a1 (37.4): optional rock/stump prisms and yawed log boxes, with
 * upward-facing tops for support. Geometry is built only at world load.
 * @param {import('./scatter.js').DetailSet} detail
 * @returns {MeshCollider|null}
 */
export function buildDetailCollider(detail) {
  if (!detail || detail.count === 0) return null;
  let triCount = 0;
  for (let i = 0; i < detail.count; i++) {
    const c = detail.speciesDefs[detail.species[i]].collider;
    if (c) triCount += c.prism ? 24 : 10;
  }
  if (!triCount) return null;
  const pos = new Float64Array(triCount * 9);
  let o = 0;
  for (let i = 0; i < detail.count; i++) {
    const c = detail.speciesDefs[detail.species[i]].collider;
    if (!c) continue;
    const shape = c.prism || c.box;
    const yaw = detail.yawDeg[i] * Math.PI / 180;
    const zb = detail.z[i] - 0.5, zt = detail.z[i] + shape.h;
    const ring = colliderRing(detail.x[i], detail.y[i], yaw, !!c.prism,
      c.prism ? c.prism.r : 0, c.box ? c.box.hx : 0, c.box ? c.box.hy : 0);
    o = emitColliderFaces(pos, o, ring, detail.x[i], detail.y[i], zb, zt, !!c.prism, false);
  }
  const bvh = buildBvh(pos, null, null);
  return {
    id: 'scatter:detail', kind: 'trimesh', bvh,
    min: Float64Array.from(bvh.nodeMin.subarray(0, 3)),
    max: Float64Array.from(bvh.nodeMax.subarray(0, 3)),
    enabled: true,
  };
}

/**
 * PROP-COLLIDE-01 (37.10): one closed, static prop BVH in world metres.
 * @param {Array<{kind:number,x:number,y:number,zc:number,hx:number,hy:number,hz:number,r:number,h:number,yawRad:number}>} shapes
 * @param {number} count
 * @returns {MeshCollider|null}
 */
export function buildPropCollider(shapes, count) {
  if (!count) return null;
  let triCount = 0;
  for (let i = 0; i < count; i++) triCount += shapes[i].kind === 1 ? 32 : 12;
  const pos = new Float64Array(triCount * 9);
  let o = 0;
  for (let i = 0; i < count; i++) {
    const s = shapes[i], prism = s.kind === 1;
    const halfH = prism ? s.h / 2 : s.hz;
    const ring = colliderRing(s.x, s.y, s.yawRad, prism, s.r, s.hx, s.hy);
    o = emitColliderFaces(pos, o, ring, s.x, s.y, s.zc - halfH, s.zc + halfH, prism, true);
  }
  const bvh = buildBvh(pos, null, null);
  return { id: 'props:static', kind: 'trimesh', bvh,
    min: Float64Array.from(bvh.nodeMin.subarray(0, 3)),
    max: Float64Array.from(bvh.nodeMax.subarray(0, 3)), enabled: true };
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
