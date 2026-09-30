// engine/physics/contacts.test.js (ME-11b, docs/architecture.md 27.18 "Test
// matrix": "contacts.test.js - 1000 seeded spheres + 200 capsules vs brute
// force over all triangles (same count, depth within 1e-9, same order),
// terrain contact, zero allocation"). Headless Node ESM, no framework, same
// conventions as meshCollide.test.js (self-relaunch under --expose-gc,
// mulberry32, makeOk). Run: node engine/physics/contacts.test.js
//
// engine/physics/** may not import engine/mesh/** at runtime (check-deps
// rule 11); this test only imports engine/physics/bvh.js to build synthetic
// colliders, same convention as meshCollide.test.js/bvh.test.js.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBvh } from './bvh.js';
import { contacts, createContactList, CONTACT_MAX } from './contacts.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Synthetic collider set (a few quads - a floor, two walls, a ramp), same
// `buildCollider` convention as meshCollide.test.js.
// ---------------------------------------------------------------------------
function writeQuad(pos, t, a, b, c, d) {
  const o = t * 18;
  pos[o] = a[0]; pos[o + 1] = a[1]; pos[o + 2] = a[2];
  pos[o + 3] = b[0]; pos[o + 4] = b[1]; pos[o + 5] = b[2];
  pos[o + 6] = c[0]; pos[o + 7] = c[1]; pos[o + 8] = c[2];
  pos[o + 9] = a[0]; pos[o + 10] = a[1]; pos[o + 11] = a[2];
  pos[o + 12] = c[0]; pos[o + 13] = c[1]; pos[o + 14] = c[2];
  pos[o + 15] = d[0]; pos[o + 16] = d[1]; pos[o + 17] = d[2];
}
function wallQuad(x0, y0, x1, y1, z0, z1) {
  return [[x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]];
}
function buildCollider(id, quads, enabled = true) {
  const pos = new Float64Array(quads.length * 18);
  for (let i = 0; i < quads.length; i++) {
    const [a, b, c, d] = quads[i];
    writeQuad(pos, i, a, b, c, d);
  }
  const bvh = buildBvh(pos, null, null);
  const min = Float64Array.from([bvh.nodeMin[0], bvh.nodeMin[1], bvh.nodeMin[2]]);
  const max = Float64Array.from([bvh.nodeMax[0], bvh.nodeMax[1], bvh.nodeMax[2]]);
  return { id, kind: 'trimesh', bvh, min, max, enabled };
}

const floor = buildCollider('floor', [[[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]]]);
const wallA = buildCollider('wallA', [wallQuad(3, -10, 3, 10, 0, 4)]);
const wallB = buildCollider('wallB', [wallQuad(-10, 3, 10, 3, 0, 4)]);
const ramp = buildCollider('ramp', [[[-8, -8, 0], [-4, -8, 2], [-4, -4, 2], [-8, -4, 0]]]);
const colliders = [floor, wallA, wallB, ramp];
const world = { colliders, terrain: null };

// ---------------------------------------------------------------------------
// Brute-force reference: the SAME closest-point math as contacts.js (Ericson
// 5.1.5 / 5.1.9), applied to EVERY triangle of every collider (no BVH/
// queryAABB culling) - this is what "brute force" means per 27.18: skip the
// acceleration structure, not the geometry test.
// ---------------------------------------------------------------------------
function closestPtPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out.x = ax; out.y = ay; out.z = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out.x = bx; out.y = by; out.z = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.x = ax + v * abx; out.y = ay + v * aby; out.z = az + v * abz; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out.x = cx; out.y = cy; out.z = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.x = ax + w * acx; out.y = ay + w * acy; out.z = az + w * acz; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.x = bx + w * (cx - bx); out.y = by + w * (cy - by); out.z = bz + w * (cz - bz); return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out.x = ax + abx * v + acx * w; out.y = ay + aby * v + acy * w; out.z = az + abz * v + acz * w;
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function closestPtSegmentSegment(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, out) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-15;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; } else if (a <= EPS) { s = 0; t = clamp01(f / e); } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = clamp01(-c / a); } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1x = p1x + d1x * s, c1y = p1y + d1y * s, c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t, c2y = p2y + d2y * t, c2z = p2z + d2z * t;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  out.distSq = dx * dx + dy * dy + dz * dz;
}
const _tp = { x: 0, y: 0, z: 0 };
const _ss = { distSq: 0 };

/** Brute-force contacts: every triangle of every collider, no BVH culling. Returns [{depth, collider, tri}] sorted the same way contacts.js sorts. */
function bruteForce(shape) {
  const isCapsule = shape.type === 'capsule';
  const list = [];
  for (let ci = 0; ci < colliders.length; ci++) {
    const bvh = colliders[ci].bvh;
    for (let ti = 0; ti < bvh.triCount; ti++) {
      const o = ti * 9;
      const ax = bvh.tri[o], ay = bvh.tri[o + 1], az = bvh.tri[o + 2];
      const bx = bvh.tri[o + 3], by = bvh.tri[o + 4], bz = bvh.tri[o + 5];
      const cx = bvh.tri[o + 6], cy = bvh.tri[o + 7], cz = bvh.tri[o + 8];
      let dist;
      if (!isCapsule) {
        closestPtPointTriangle(shape.x, shape.y, shape.z, ax, ay, az, bx, by, bz, cx, cy, cz, _tp);
        dist = Math.hypot(shape.x - _tp.x, shape.y - _tp.y, shape.z - _tp.z);
      } else {
        const qz = shape.z + shape.h;
        closestPtPointTriangle(shape.x, shape.y, shape.z, ax, ay, az, bx, by, bz, cx, cy, cz, _tp);
        let best = (shape.x - _tp.x) ** 2 + (shape.y - _tp.y) ** 2 + (shape.z - _tp.z) ** 2;
        closestPtPointTriangle(shape.x, shape.y, qz, ax, ay, az, bx, by, bz, cx, cy, cz, _tp);
        best = Math.min(best, (shape.x - _tp.x) ** 2 + (shape.y - _tp.y) ** 2 + (qz - _tp.z) ** 2);
        const edges = [[ax, ay, az, bx, by, bz], [bx, by, bz, cx, cy, cz], [cx, cy, cz, ax, ay, az]];
        for (const [ex0, ey0, ez0, ex1, ey1, ez1] of edges) {
          closestPtSegmentSegment(shape.x, shape.y, shape.z, shape.x, shape.y, qz, ex0, ey0, ez0, ex1, ey1, ez1, _ss);
          best = Math.min(best, _ss.distSq);
        }
        dist = Math.sqrt(best);
      }
      if (dist < shape.r) list.push({ depth: shape.r - dist, collider: ci, tri: ti });
    }
  }
  list.sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth;
    if (a.collider !== b.collider) return a.collider - b.collider;
    return a.tri - b.tri;
  });
  return list;
}

// ---------------------------------------------------------------------------
// 1. 1000 seeded spheres vs brute force
// ---------------------------------------------------------------------------
{
  const rnd = mulberry32(777);
  const out = createContactList();
  let countMismatches = 0, depthErr = 0, orderMismatches = 0, anyContacts = 0;
  for (let i = 0; i < 1000; i++) {
    const shape = {
      type: 'sphere',
      x: (rnd() - 0.5) * 24, y: (rnd() - 0.5) * 24, z: (rnd() - 0.5) * 6,
      r: 0.2 + rnd() * 0.8,
    };
    contacts(world, shape, out);
    const brute = bruteForce(shape).slice(0, CONTACT_MAX);
    if (brute.length > 0) anyContacts++;
    if (out.count !== brute.length) { countMismatches++; continue; }
    for (let k = 0; k < out.count; k++) {
      depthErr = Math.max(depthErr, Math.abs(out.depth[k] - brute[k].depth));
      if (out.collider[k] !== brute[k].collider || out.tri[k] !== brute[k].tri) orderMismatches++;
    }
  }
  ok('spheres: at least some seeds produced contacts (test is non-trivial)', anyContacts > 50, `anyContacts=${anyContacts}`);
  ok('spheres: contact COUNT matches brute force for all 1000 seeds', countMismatches === 0, `mismatches=${countMismatches}`);
  ok('spheres: depth matches brute force within 1e-9', depthErr <= 1e-9, `maxErr=${depthErr}`);
  ok('spheres: sorted order (collider, tri) matches brute force', orderMismatches === 0, `orderMismatches=${orderMismatches}`);
}

// ---------------------------------------------------------------------------
// 2. 200 seeded capsules vs brute force
// ---------------------------------------------------------------------------
{
  const rnd = mulberry32(4242);
  const out = createContactList();
  let countMismatches = 0, depthErr = 0, orderMismatches = 0, anyContacts = 0;
  for (let i = 0; i < 200; i++) {
    const shape = {
      type: 'capsule',
      x: (rnd() - 0.5) * 24, y: (rnd() - 0.5) * 24, z: (rnd() - 0.5) * 6,
      r: 0.2 + rnd() * 0.6, h: 0.5 + rnd() * 2.0,
    };
    contacts(world, shape, out);
    const brute = bruteForce(shape).slice(0, CONTACT_MAX);
    if (brute.length > 0) anyContacts++;
    if (out.count !== brute.length) { countMismatches++; continue; }
    for (let k = 0; k < out.count; k++) {
      depthErr = Math.max(depthErr, Math.abs(out.depth[k] - brute[k].depth));
      if (out.collider[k] !== brute[k].collider || out.tri[k] !== brute[k].tri) orderMismatches++;
    }
  }
  ok('capsules: at least some seeds produced contacts (test is non-trivial)', anyContacts > 20, `anyContacts=${anyContacts}`);
  ok('capsules: contact COUNT matches brute force for all 200 seeds', countMismatches === 0, `mismatches=${countMismatches}`);
  ok('capsules: depth matches brute force within 1e-9', depthErr <= 1e-9, `maxErr=${depthErr}`);
  ok('capsules: sorted order (collider, tri) matches brute force', orderMismatches === 0, `orderMismatches=${orderMismatches}`);
}

// ---------------------------------------------------------------------------
// 3. Terrain contact: synthetic flat terrain, sphere resting near it.
// `shape.z` is the Rapier shape-position convention (sphere CENTRE), not
// feet - see contacts.js's file header. groundZ = 5, r = 0.25 (exact in
// binary float, so `groundZ + r - groundZ === r` bit-for-bit and the
// "exactly resting" case lands on depth === 0, not a rounding-noise
// epsilon): the centre rests exactly on the ground at z = groundZ + r
// (queue item 8b).
// ---------------------------------------------------------------------------
{
  const groundZ = 5, r = 0.25;
  const flatTerrain = {
    groundAt() { return groundZ; },
    groundNormalAt(x, y, out) { out.x = 0; out.y = 0; out.z = 1; return out; },
  };
  const w = { colliders: [], terrain: flatTerrain };
  const out = createContactList();

  // Resting exactly on the ground: centre at z = groundZ + r -> no contact
  // (tangent, depth 0, which this module treats as "no contact").
  contacts(w, { type: 'sphere', x: 0, y: 0, z: groundZ + r, r }, out);
  ok('terrain: sphere resting exactly on flat ground gets no contact', out.count === 0, `count=${out.count}`);

  // Well above the ground: no contact.
  contacts(w, { type: 'sphere', x: 0, y: 0, z: 20, r }, out);
  ok('terrain: sphere far above the ground gets no contact', out.count === 0, `count=${out.count}`);

  // Centre 0.1 m below the resting height -> depth 0.1.
  contacts(w, { type: 'sphere', x: 0, y: 0, z: groundZ + r - 0.1, r }, out);
  ok('terrain: sphere resting 0.1m into flat ground gets exactly one contact', out.count === 1, `count=${out.count}`);
  ok('terrain: depth = 0.1 when the centre sits 0.1m below the resting height', Math.abs(out.depth[0] - 0.1) < 1e-9, `depth=${out.depth[0]}`);
  ok('terrain: normal points straight up', out.nx[0] === 0 && out.ny[0] === 0 && out.nz[0] === 1);
  ok('terrain: contact point is at ground height', Math.abs(out.pz[0] - groundZ) < 1e-9, `pz=${out.pz[0]}`);

  // Same two cases against a flat trimesh floor at z=0 must agree (queue
  // item 8b: "the same two cases vs a flat trimesh floor - must agree").
  // xy offset to (3, -3), well inside one half of the floor quad's two
  // triangles (away from the a-c diagonal seam at y=x) so the sphere's
  // footprint doesn't straddle both triangles and double-count a contact.
  const flatFloor = buildCollider('flatFloor', [[[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]]]);
  const wMesh = { colliders: [flatFloor], terrain: null };

  contacts(wMesh, { type: 'sphere', x: 3, y: -3, z: 0 + r, r }, out);
  ok('terrain/trimesh agreement: resting exactly on a flat trimesh floor gets no contact', out.count === 0, `count=${out.count}`);

  contacts(wMesh, { type: 'sphere', x: 3, y: -3, z: 0 + r - 0.1, r }, out);
  ok('terrain/trimesh agreement: count matches the terrain case', out.count === 1, `count=${out.count}`);
  ok('terrain/trimesh agreement: depth matches the terrain case (0.1)', Math.abs(out.depth[0] - 0.1) < 1e-9, `depth=${out.depth[0]}`);
}

// ---------------------------------------------------------------------------
// 3b. Truncation policy (queue item 8c): once `out` is full, a new contact
// replaces the current shallowest entry only if it is strictly deeper -
// i.e. `contacts()` keeps the CONTACT_MAX DEEPEST contacts found, not just
// the first CONTACT_MAX. Built from 20 overlapping triangles (as parallel,
// separately-penetrating quads at increasing depth) under one sphere.
// ---------------------------------------------------------------------------
{
  const n = 20;
  const quads = [];
  // Quad i is a small flat square at z = -i*0.01, all centred under the
  // sphere so every one of the 20 produces a contact candidate. Sphere
  // centre z=0.05, r=0.5 -> depth(i) = r - (centreZ - quadZ) = 0.45 - 0.01*i,
  // strictly decreasing (i=0 deepest at 0.45, i=19 shallowest at 0.26) and
  // all positive, so all 20 are real contacts before truncation.
  for (let i = 0; i < n; i++) {
    const z = -i * 0.01;
    quads.push([[-1, -1, z], [1, -1, z], [1, 1, z], [-1, 1, z]]);
  }
  const overlapping = buildCollider('overlapping20', quads);
  const w = { colliders: [overlapping], terrain: null };
  const out = createContactList();

  // xy offset to (0.5, -0.5), off the quads' a-c diagonal seam (y=x), so
  // each quad contributes exactly one contact instead of one per triangle.
  // Expected surviving depths are the CONTACT_MAX=16 deepest: i=0..15,
  // depths 0.45 down to 0.30; i=16..19 (depths 0.29..0.26) must be dropped.
  contacts(w, { type: 'sphere', x: 0.5, y: -0.5, z: 0.05, r: 0.5 }, out);
  ok('truncation: keeps exactly CONTACT_MAX contacts out of 20 candidates', out.count === CONTACT_MAX, `count=${out.count}`);
  let minDepth = Infinity, maxDepth = -Infinity;
  for (let i = 0; i < out.count; i++) {
    if (out.depth[i] < minDepth) minDepth = out.depth[i];
    if (out.depth[i] > maxDepth) maxDepth = out.depth[i];
  }
  ok('truncation: shallowest surviving depth is the 16th-deepest (0.30), not one of the 4 shallow ones dropped', Math.abs(minDepth - 0.30) < 1e-9, `minDepth=${minDepth}`);
  ok('truncation: deepest surviving depth is 0.45', Math.abs(maxDepth - 0.45) < 1e-9, `maxDepth=${maxDepth}`);
}

// ---------------------------------------------------------------------------
// 4. Zero allocation (--expose-gc, project convention: warm up, gc, run,
// gc, gate heapUsed growth < 64 KB).
// ---------------------------------------------------------------------------
{
  const rnd = mulberry32(99);
  const out = createContactList();
  const shapes = [];
  for (let i = 0; i < 64; i++) {
    shapes.push(rnd() < 0.5
      ? { type: 'sphere', x: (rnd() - 0.5) * 24, y: (rnd() - 0.5) * 24, z: (rnd() - 0.5) * 6, r: 0.2 + rnd() * 0.8 }
      : { type: 'capsule', x: (rnd() - 0.5) * 24, y: (rnd() - 0.5) * 24, z: (rnd() - 0.5) * 6, r: 0.2 + rnd() * 0.6, h: 0.5 + rnd() * 2.0 });
  }
  // Warm up (JIT + any one-time allocation paths need more than a couple
  // thousand calls to fully settle with this many distinct shapes/colliders).
  for (let i = 0; i < 40000; i++) contacts(world, shapes[i % shapes.length], out);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) contacts(world, shapes[i % shapes.length], out);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const growth = after - before;
  ok('contacts(): zero allocation over 20000 calls (heap growth < 64 KB)', growth < 64 * 1024, `growth=${growth}`);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
