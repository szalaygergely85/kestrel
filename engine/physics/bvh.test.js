// engine/physics/bvh.test.js (ME-09, docs/architecture.md 27.15.7).
// Build invariants on seeded triangle soups + the tower levelMesh base,
// queryAABB/raycast/segment vs independent brute force, refit == fresh
// build, and a zero-allocation gate on 10k mixed queries. Prints tower
// build ms and 10k raycasts ms (warn-only perf, per 27.15.7 step 5).
// Run: node engine/physics/bvh.test.js [--verbose]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BVH_LEAF_MAX, buildBvh, buildBvhFromMesh, refit, queryAABB, raycast, raycastAny, segment,
} from './bvh.js';
import { buildLevelMesh } from '../mesh/levelMesh.js';
import { loadLevel } from '../world/Level.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';

paletteMod; detailPassMod;

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

globalThis.window = globalThis.window || globalThis;
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Seeded RNG + soup generators
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random unrolled triangle soup, clustered per-triangle (non-degenerate almost always). */
function randomSoup(rng, triCount, scale = 40) {
  const pos = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const cx = (rng() * 2 - 1) * scale, cy = (rng() * 2 - 1) * scale, cz = (rng() * 2 - 1) * scale;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      pos[o] = cx + (rng() * 2 - 1) * 2;
      pos[o + 1] = cy + (rng() * 2 - 1) * 2;
      pos[o + 2] = cz + (rng() * 2 - 1) * 2;
    }
  }
  return pos;
}

function writeTri(pos, t, a, b, c) {
  const o = t * 9;
  pos[o] = a[0]; pos[o + 1] = a[1]; pos[o + 2] = a[2];
  pos[o + 3] = b[0]; pos[o + 4] = b[1]; pos[o + 5] = b[2];
  pos[o + 6] = c[0]; pos[o + 7] = c[1]; pos[o + 8] = c[2];
}

/** n x n quad grid, unrolled (2 triangles/quad), jittered heights - vertices
 * numerically identical where quads share an edge/corner (real shared
 * geometry, not coincidence), like a real level's floor mesh. */
function gridSoup(rng, n) {
  const h = new Float64Array((n + 1) * (n + 1));
  for (let i = 0; i < h.length; i++) h[i] = (rng() - 0.5) * 0.6;
  const height = (i, j) => h[j * (n + 1) + i];
  const triCount = n * n * 2;
  const pos = new Float32Array(triCount * 9);
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p00 = [i, j, height(i, j)], p10 = [i + 1, j, height(i + 1, j)];
      const p11 = [i + 1, j + 1, height(i + 1, j + 1)], p01 = [i, j + 1, height(i, j + 1)];
      writeTri(pos, t++, p00, p10, p11);
      writeTri(pos, t++, p00, p11, p01);
    }
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Independent (non-BVH) reference implementations
// ---------------------------------------------------------------------------

function refTransform(m, x, y, z, out, off) {
  if (!m) { out[off] = x; out[off + 1] = y; out[off + 2] = z; return; }
  out[off] = m[0] * x + m[1] * y + m[2] * z + m[9];
  out[off + 1] = m[3] * x + m[4] * y + m[5] * z + m[10];
  out[off + 2] = m[6] * x + m[7] * y + m[8] * z + m[11];
}

function refWorldTri(pos, idx, matrix12, t, out) {
  let i0, i1, i2;
  if (idx) { i0 = idx[t * 3]; i1 = idx[t * 3 + 1]; i2 = idx[t * 3 + 2]; }
  else { i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2; }
  refTransform(matrix12, pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2], out, 0);
  refTransform(matrix12, pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2], out, 3);
  refTransform(matrix12, pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2], out, 6);
}

function refTriCount(pos, idx) { return idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9); }

/** Brute-force nearest hit, independent double-sided Moeller-Trumbore. */
function bruteRaycast(pos, idx, matrix12, ox, oy, oz, dx, dy, dz, tMax) {
  const n = refTriCount(pos, idx);
  const w = new Float64Array(9);
  let bestT = tMax, bestTri = -1, bestU = 0, bestV = 0;
  for (let t = 0; t < n; t++) {
    refWorldTri(pos, idx, matrix12, t, w);
    const p0x = w[0], p0y = w[1], p0z = w[2];
    const p1x = w[3], p1y = w[4], p1z = w[5];
    const p2x = w[6], p2y = w[7], p2z = w[8];
    const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
    const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const invDet = 1 / det;
    const tvx = ox - p0x, tvy = oy - p0y, tvz = oz - p0z;
    const u = (tvx * px + tvy * py + tvz * pz) * invDet;
    if (u < 0 || u > 1) continue;
    const qx = tvy * e1z - tvz * e1y, qy = tvz * e1x - tvx * e1z, qz = tvx * e1y - tvy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (tt < 0 || tt >= bestT) continue;
    bestT = tt; bestTri = t; bestU = u; bestV = v;
  }
  return { hit: bestTri >= 0, t: bestT, tri: bestTri, u: bestU, v: bestV };
}

/** Brute-force inclusive AABB overlap set (source triangle ids). */
function bruteAABB(pos, idx, matrix12, x0, y0, z0, x1, y1, z1) {
  const n = refTriCount(pos, idx);
  const w = new Float64Array(9);
  const set = new Set();
  for (let t = 0; t < n; t++) {
    refWorldTri(pos, idx, matrix12, t, w);
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const vx = w[k * 3], vy = w[k * 3 + 1], vz = w[k * 3 + 2];
      if (vx < minx) minx = vx; if (vy < miny) miny = vy; if (vz < minz) minz = vz;
      if (vx > maxx) maxx = vx; if (vy > maxy) maxy = vy; if (vz > maxz) maxz = vz;
    }
    if (maxx < x0 || minx > x1 || maxy < y0 || miny > y1 || maxz < z0 || minz > z1) continue;
    set.add(t);
  }
  return set;
}

// ---------------------------------------------------------------------------
// 1. Build invariants
// ---------------------------------------------------------------------------

function checkBuildInvariants(label, pos, idx, matrix12) {
  const bvh = buildBvh(pos, idx, matrix12);
  const n = refTriCount(pos, idx);
  ok(`${label}: triCount matches source`, bvh.triCount === n);

  // Every source triangle appears in exactly one leaf.
  const seen = new Int32Array(n);
  let leafCount = 0, sumLeafTris = 0;
  for (let i = 0; i < bvh.nodeCount; i++) {
    const cnt = bvh.nodeTriCount[i];
    if (cnt > 0) {
      leafCount++;
      ok(`${label}: leaf ${i} within BVH_LEAF_MAX`, cnt <= BVH_LEAF_MAX);
      const start = bvh.nodeStart[i];
      for (let k = 0; k < cnt; k++) {
        const srcT = bvh.triId[start + k];
        seen[srcT]++;
        sumLeafTris++;
      }
    }
  }
  ok(`${label}: leaf triangle count == triCount`, sumLeafTris === n, `${sumLeafTris} vs ${n}`);
  let allOnce = true;
  for (let i = 0; i < n; i++) if (seen[i] !== 1) { allOnce = false; break; }
  ok(`${label}: every source triangle in exactly one leaf`, allOnce);

  // Node bounds contain children (inner) and their own triangles (leaf).
  let boundsOk = true;
  const eps = 1e-6;
  for (let i = 0; i < bvh.nodeCount; i++) {
    const b = i * 3;
    const cnt = bvh.nodeTriCount[i];
    if (cnt > 0) {
      const start = bvh.nodeStart[i];
      for (let k = 0; k < cnt; k++) {
        const o = (start + k) * 9;
        for (let v = 0; v < 3; v++) {
          const vx = bvh.tri[o + v * 3], vy = bvh.tri[o + v * 3 + 1], vz = bvh.tri[o + v * 3 + 2];
          if (vx < bvh.nodeMin[b] - eps || vx > bvh.nodeMax[b] + eps
            || vy < bvh.nodeMin[b + 1] - eps || vy > bvh.nodeMax[b + 1] + eps
            || vz < bvh.nodeMin[b + 2] - eps || vz > bvh.nodeMax[b + 2] + eps) boundsOk = false;
        }
      }
    } else {
      const left = bvh.nodeStart[i], right = left + 1;
      const lb = left * 3, rb = right * 3;
      if (bvh.nodeMin[lb] < bvh.nodeMin[b] - eps || bvh.nodeMax[lb] > bvh.nodeMax[b] + eps
        || bvh.nodeMin[rb] < bvh.nodeMin[b] - eps || bvh.nodeMax[rb] > bvh.nodeMax[b] + eps) boundsOk = false;
    }
  }
  ok(`${label}: node bounds contain children/triangles`, boundsOk);

  // Two builds from the same input are byte-identical.
  const bvh2 = buildBvh(pos, idx, matrix12);
  let identical = bvh.nodeCount === bvh2.nodeCount;
  if (identical) {
    const arrs = ['tri', 'triId', 'nodeMin', 'nodeMax', 'nodeStart', 'nodeTriCount'];
    for (const key of arrs) {
      const a = bvh[key], b2 = bvh2[key];
      if (a.length !== b2.length) { identical = false; break; }
      for (let i = 0; i < a.length; i++) if (a[i] !== b2[i]) { identical = false; break; }
      if (!identical) break;
    }
  }
  ok(`${label}: two builds are byte-identical`, identical);

  return bvh;
}

const rng10 = mulberry32(1);
checkBuildInvariants('soup(10)', randomSoup(rng10, 10), null, null);
const rng1000 = mulberry32(2);
const soup1000 = randomSoup(rng1000, 1000);
const bvh1000 = checkBuildInvariants('soup(1000)', soup1000, null, null);
const rng20000 = mulberry32(3);
const soup20000 = randomSoup(rng20000, 20000);
checkBuildInvariants('soup(20000)', soup20000, null, null);

const { assets } = await loadTestAssets();
const tower = loadLevel(assets.level('tower'));
const towerMesh = buildLevelMesh(tower).base;
// "matrix = tower origin" (27.15.7 step 1): a non-identity translation, so
// build/query/raycast are all exercised through the matrix path too.
const towerOrigin = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 12, 0, -7]);
const t0 = performance.now();
const towerBvh = checkBuildInvariants('tower levelMesh', towerMesh.pos, towerMesh.idx, towerOrigin);
const towerBuildMs = performance.now() - t0;
{
  const direct = buildBvhFromMesh(towerMesh, towerOrigin);
  ok('buildBvhFromMesh matches buildBvh(pos,idx,matrix)', direct.triCount === towerBvh.triCount && direct.nodeCount === towerBvh.nodeCount);
}

// ---------------------------------------------------------------------------
// 2. queryAABB vs brute force
// ---------------------------------------------------------------------------

{
  const rng = mulberry32(4);
  const out = new Int32Array(1000);
  let allMatch = true, checked = 0;
  for (let i = 0; i < 2000; i++) {
    const cx = (rng() * 2 - 1) * 40, cy = (rng() * 2 - 1) * 40, cz = (rng() * 2 - 1) * 40;
    const sx = rng() * 10 + 0.5, sy = rng() * 10 + 0.5, sz = rng() * 10 + 0.5;
    const x0 = cx - sx, x1 = cx + sx, y0 = cy - sy, y1 = cy + sy, z0 = cz - sz, z1 = cz + sz;
    const count = queryAABB(bvh1000, x0, y0, z0, x1, y1, z1, out, out.length);
    const gotSet = new Set();
    for (let k = 0; k < count; k++) gotSet.add(bvh1000.triId[out[k]]);
    const wantSet = bruteAABB(soup1000, null, null, x0, y0, z0, x1, y1, z1);
    checked++;
    if (gotSet.size !== wantSet.size) { allMatch = false; continue; }
    for (const id of wantSet) if (!gotSet.has(id)) { allMatch = false; break; }
  }
  ok(`queryAABB matches brute force on ${checked} seeded boxes`, allMatch);
}

// ---------------------------------------------------------------------------
// 3. raycast/segment vs brute force
// ---------------------------------------------------------------------------

function checkRaycast(label, pos, idx, matrix12, bvh, ox, oy, oz, dx, dy, dz, tMax) {
  const hitOut = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
  const got = raycast(bvh, ox, oy, oz, dx, dy, dz, tMax, hitOut);
  const want = bruteRaycast(pos, idx, matrix12, ox, oy, oz, dx, dy, dz, tMax);
  if (got !== want.hit) { failures.push(`${label}: hit mismatch got=${got} want=${want.hit}`); fail++; return; }
  pass++;
  if (!want.hit) return;
  const gotSrcTri = bvh.triId[hitOut.tri];
  const tClose = Math.abs(hitOut.t - want.t) <= 1e-9;
  ok(`${label}: t within 1e-9`, tClose, `got ${hitOut.t} want ${want.t}`);
  const sameTri = gotSrcTri === want.tri;
  const equalTTie = Math.abs(hitOut.t - want.t) <= 1e-12;
  ok(`${label}: same triangle (or an equal-t tie)`, sameTri || equalTTie, `got tri ${gotSrcTri} want ${want.tri}`);
}

{
  const rng = mulberry32(5);
  let rayIdx = 0;
  // Random rays through the 1000-tri soup's bbox region.
  for (let i = 0; i < 2500; i++, rayIdx++) {
    const ox = (rng() * 2 - 1) * 60, oy = (rng() * 2 - 1) * 60, oz = (rng() * 2 - 1) * 60;
    let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    checkRaycast(`ray ${rayIdx} (random)`, soup1000, null, null, bvh1000, ox, oy, oz, dx, dy, dz, 200);
  }
  // Axis-parallel rays.
  for (let i = 0; i < 1000; i++, rayIdx++) {
    const ox = (rng() * 2 - 1) * 60, oy = (rng() * 2 - 1) * 60, oz = (rng() * 2 - 1) * 60;
    const axis = i % 3;
    const dx = axis === 0 ? 1 : 0, dy = axis === 1 ? 1 : 0, dz = axis === 2 ? 1 : 0;
    checkRaycast(`ray ${rayIdx} (axis-parallel)`, soup1000, null, null, bvh1000, ox, oy, oz, dx, dy, dz, 200);
  }
  // Rays through shared edges/vertices: aim from a random point above/below
  // straight at a random grid soup vertex (guaranteed on a shared edge for
  // interior grid points).
  const gridN = 12;
  const rngGrid = mulberry32(6);
  const grid = gridSoup(rngGrid, gridN);
  const gridBvh = buildBvh(grid, null, null);
  for (let i = 0; i < 1500; i++, rayIdx++) {
    const gi = 1 + Math.floor(rng() * (gridN - 1));
    const gj = 1 + Math.floor(rng() * (gridN - 1));
    // Any vertex position used by the grid triangles - reconstruct from a
    // nearby triangle's own stored vertex 0 in source order for exactness.
    const t = 2 * (gj * gridN + gi);
    const vx = grid[t * 9], vy = grid[t * 9 + 1], vz = grid[t * 9 + 2];
    const ox = vx, oy = vy, oz = vz + 10 + rng() * 5;
    checkRaycast(`ray ${rayIdx} (through shared vertex)`, grid, null, null, gridBvh, ox, oy, oz, 0, 0, -1, 50);
  }
  // segment() sanity: matches raycast(a, b-a, tMax=1) on a handful of pairs.
  for (let i = 0; i < 20; i++) {
    const ax = (rng() * 2 - 1) * 60, ay = (rng() * 2 - 1) * 60, az = (rng() * 2 - 1) * 60;
    const bx = (rng() * 2 - 1) * 60, by = (rng() * 2 - 1) * 60, bz = (rng() * 2 - 1) * 60;
    const h1 = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    const h2 = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    const g1 = segment(bvh1000, ax, ay, az, bx, by, bz, h1);
    const g2 = raycast(bvh1000, ax, ay, az, bx - ax, by - ay, bz - az, 1, h2);
    ok('segment matches raycast(b-a, tMax=1)', g1 === g2 && (!g1 || (h1.t === h2.t && h1.tri === h2.tri)));
  }
  // raycastAny agrees with raycast's hit/miss.
  for (let i = 0; i < 200; i++) {
    const ox = (rng() * 2 - 1) * 60, oy = (rng() * 2 - 1) * 60, oz = (rng() * 2 - 1) * 60;
    let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    const h = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    const gotNear = raycast(bvh1000, ox, oy, oz, dx, dy, dz, 200, h);
    const gotAny = raycastAny(bvh1000, ox, oy, oz, dx, dy, dz, 200);
    ok('raycastAny agrees with raycast hit/miss', gotNear === gotAny);
  }
  if (VERBOSE) console.log(`checked ${rayIdx} rays vs brute force`);
}

// ---------------------------------------------------------------------------
// 4. refit == fresh build
// ---------------------------------------------------------------------------

{
  const rng = mulberry32(7);
  const moved = soup1000.slice();
  for (let i = 0; i < moved.length; i++) moved[i] += (rng() * 2 - 1) * 1.5;

  const refitBvh = buildBvh(soup1000, null, null); // fresh copy, refit in place
  refit(refitBvh, moved, null, null);
  const freshBvh = buildBvh(moved, null, null);

  // Same topology (refit never changes it): triId/nodeStart/nodeTriCount
  // stay identical to the pre-refit build. Compare query results instead of
  // raw arrays against `freshBvh` (a fresh build may pick a different, but
  // equally valid, split - only observable behaviour must match).
  let queriesMatch = true;
  const out1 = new Int32Array(200), out2 = new Int32Array(200);
  const rq = mulberry32(8);
  for (let i = 0; i < 300; i++) {
    const cx = (rq() * 2 - 1) * 40, cy = (rq() * 2 - 1) * 40, cz = (rq() * 2 - 1) * 40;
    const s = rq() * 8 + 1;
    const c1 = queryAABB(refitBvh, cx - s, cy - s, cz - s, cx + s, cy + s, cz + s, out1, out1.length);
    const set1 = new Set(); for (let k = 0; k < c1; k++) set1.add(refitBvh.triId[out1[k]]);
    const c2 = queryAABB(freshBvh, cx - s, cy - s, cz - s, cx + s, cy + s, cz + s, out2, out2.length);
    const set2 = new Set(); for (let k = 0; k < c2; k++) set2.add(freshBvh.triId[out2[k]]);
    if (set1.size !== set2.size) { queriesMatch = false; break; }
    for (const id of set1) if (!set2.has(id)) { queriesMatch = false; break; }
  }
  ok('refit queryAABB results == fresh build', queriesMatch);

  let raysMatch = true;
  const rr = mulberry32(9);
  for (let i = 0; i < 300; i++) {
    const ox = (rr() * 2 - 1) * 60, oy = (rr() * 2 - 1) * 60, oz = (rr() * 2 - 1) * 60;
    let dx = rr() * 2 - 1, dy = rr() * 2 - 1, dz = rr() * 2 - 1;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    const h1 = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    const h2 = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    const g1 = raycast(refitBvh, ox, oy, oz, dx, dy, dz, 200, h1);
    const g2 = raycast(freshBvh, ox, oy, oz, dx, dy, dz, 200, h2);
    if (g1 !== g2) { raysMatch = false; break; }
    if (g1 && (Math.abs(h1.t - h2.t) > 1e-9 || refitBvh.triId[h1.tri] !== freshBvh.triId[h2.tri])) {
      if (Math.abs(h1.t - h2.t) > 1e-12) { raysMatch = false; break; }
    }
  }
  ok('refit raycast results == fresh build', raysMatch);
}

// ---------------------------------------------------------------------------
// 5. Zero-allocation gate on 10k mixed queries + perf print (warn-only)
// ---------------------------------------------------------------------------

{
  const rng = mulberry32(10);
  const out = new Int32Array(200);
  const hit = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };

  function mixedQuery() {
    const kind = Math.random() < 0.5 ? 0 : 1; // not seeded on purpose - deterministic soup, non-deterministic mix order doesn't affect correctness
    if (kind === 0) {
      const cx = (rng() * 2 - 1) * 40, cy = (rng() * 2 - 1) * 40, cz = (rng() * 2 - 1) * 40;
      const s = rng() * 8 + 1;
      queryAABB(towerBvh, cx - s, cy - s, cz - s, cx + s, cy + s, cz + s, out, out.length);
    } else {
      const ox = (rng() * 2 - 1) * 60, oy = (rng() * 2 - 1) * 60, oz = (rng() * 2 - 1) * 60;
      let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
      raycast(towerBvh, ox, oy, oz, dx, dy, dz, 200, hit);
    }
  }
  for (let i = 0; i < 1000; i++) mixedQuery(); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) mixedQuery();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('10k mixed queries: no significant heap growth (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);

  const rTime0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    const ox = (rng() * 2 - 1) * 60, oy = (rng() * 2 - 1) * 60, oz = (rng() * 2 - 1) * 60;
    let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    raycast(towerBvh, ox, oy, oz, dx, dy, dz, 200, hit);
  }
  const raycast10kMs = performance.now() - rTime0;
  console.log(`[perf, warn-only] tower BVH build: ${towerBuildMs.toFixed(2)}ms (${towerBvh.triCount} tris, ${towerBvh.nodeCount} nodes); 10k raycasts: ${raycast10kMs.toFixed(2)}ms`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
