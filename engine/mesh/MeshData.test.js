// engine/mesh/MeshData.test.js (ME-01, docs/architecture.md 27.15.2 step 1).
// Run: node engine/mesh/MeshData.test.js
import {
  MESH_VERSION, AO_FAR, AO_NONE,
  packFlat1, flatKind, flatFace, flatMat,
  wallPlaneIdBase, planePlaneIdBase,
  StaticMeshBuilder, validateMesh, assertMesh, resolveMats, meshToJSON, meshFromJSON,
} from './MeshData.js';
import { packPlaneId } from '../render/GBuffer.js';
import { makeOk, approxEqual } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Deterministic PRNG (27.15.0: "seeded inputs, never Math.random").
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1234);

// ---- packFlat1 round trip at extremes -------------------------------------
{
  const cases = [[0, 0, 0], [9, 7, 0xffff], [1, 4, 12345], [255 & 0xff, 15, 0]];
  for (const [k, f, m] of cases) {
    const packed = packFlat1(k, f, m);
    ok(`packFlat1 round trip (${k},${f},${m})`, flatKind(packed) === (k & 0xff) && flatFace(packed) === (f & 0xf) && flatMat(packed) === (m & 0xffff));
  }
}

// ---- planeId helpers == packPlaneId on 100 seeded inputs -------------------
{
  let allWall = true, allPlane = true;
  for (let i = 0; i < 100; i++) {
    const face = 1 + Math.floor(rnd() * 6);
    const boundary = Math.floor(rnd() * 2000) - 1000;
    if (wallPlaneIdBase(face, boundary) !== packPlaneId(0, face, boundary)) allWall = false;
    const kind = 4 + Math.floor(rnd() * 3); // 4,5,6
    const h = (rnd() - 0.5) * 20;
    if (planePlaneIdBase(kind, h) !== packPlaneId(0, kind, Math.round(h * 1000) + 0x800000)) allPlane = false;
  }
  ok('wallPlaneIdBase matches packPlaneId(0, face, boundary) x100', allWall);
  ok('planePlaneIdBase matches packPlaneId(0, kind, round(h*1000)+0x800000) x100', allPlane);
}

// ---- StaticMeshBuilder: every triangle's cross product is parallel to its normal ----
{
  const b = new StaticMeshBuilder('test:quad');
  // An arbitrary, non-axis-aligned quad.
  const p12 = [0, 0, 0, 3, 0, 1, 3, 2, 1, 0, 2, 0];
  const uv8 = [0, 0, 1, 0, 1, 1, 0, 1];
  // Correct outward normal for this planar quad (computed from the same corners).
  function sub(a, b2) { return [a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]]; }
  function cross(a, b2) { return [a[1] * b2[2] - a[2] * b2[1], a[2] * b2[0] - a[0] * b2[2], a[0] * b2[1] - a[1] * b2[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
  const p0 = [p12[0], p12[1], p12[2]], p1 = [p12[3], p12[4], p12[5]], p2 = [p12[6], p12[7], p12[8]];
  const n = norm(cross(sub(p1, p0), sub(p2, p0)));
  b.addQuad(p12, uv8, n[0], n[1], n[2], 0, packFlat1(4, 5, 0), [0, 0, 0, 0, 0, 0, 0, 0]);
  const mesh = b.build();
  ok('builder produced 2 triangles', mesh.triCount === 2);
  let allParallel = true;
  for (let t = 0; t < mesh.triCount; t++) {
    const v0 = t * 3;
    const a = [mesh.pos[v0 * 3], mesh.pos[v0 * 3 + 1], mesh.pos[v0 * 3 + 2]];
    const c1 = [mesh.pos[(v0 + 1) * 3], mesh.pos[(v0 + 1) * 3 + 1], mesh.pos[(v0 + 1) * 3 + 2]];
    const c2 = [mesh.pos[(v0 + 2) * 3], mesh.pos[(v0 + 2) * 3 + 1], mesh.pos[(v0 + 2) * 3 + 2]];
    const cp = norm(cross(sub(c1, a), sub(c2, a)));
    const dot = cp[0] * n[0] + cp[1] * n[1] + cp[2] * n[2];
    if (!approxEqual(dot, 1, 1e-9)) allParallel = false;
  }
  ok('every builder triangle cross(p1-p0,p2-p0) is parallel to its stored normal (1e-9)', allParallel);
}

// ---- validator: accepts a clean mesh, rejects 3 broken fixtures -----------
function makeCleanMesh() {
  const b = new StaticMeshBuilder('test:clean');
  const matIdx = b.matIndex('stone');
  b.addQuad(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1],
    0, 0, 1, planePlaneIdBase(4, 0), packFlat1(4, 5, matIdx), [0, AO_NONE, 0, 0, 0, 0, 0, 0],
  );
  return b.build();
}
{
  const clean = makeCleanMesh();
  ok('validator accepts a clean mesh', validateMesh(clean).errors.length === 0);

  const badLen = makeCleanMesh();
  badLen.uv = badLen.uv.slice(0, badLen.uv.length - 1);
  ok('validator rejects bad-length uv', validateMesh(badLen).errors.length > 0);

  const badBbox = makeCleanMesh();
  badBbox.bbox = Float64Array.from([0, 0, 0, 0.5, 0.5, 0.5]); // too small, doesn't contain (1,1,0)
  ok('validator rejects a bbox that misses a vertex', validateMesh(badBbox).errors.length > 0);

  const badRange = makeCleanMesh();
  badRange.ranges = [{ start: 0, count: badRange.triCount + 5 }];
  ok('validator rejects an out-of-bounds range', validateMesh(badRange).errors.length > 0);

  ok('assertMesh throws on a broken mesh', (() => { try { assertMesh(badLen); return false; } catch (e) { return true; } })());
}

// ---- JSON round trip byte-equal --------------------------------------------
{
  const mesh = makeCleanMesh();
  const json1 = JSON.stringify(meshToJSON(mesh));
  const back = meshFromJSON(JSON.parse(json1));
  const json2 = JSON.stringify(meshToJSON(back));
  ok('meshToJSON -> meshFromJSON -> meshToJSON is byte-equal (JSON string)', json1 === json2);
  ok('round trip preserves triCount', back.triCount === mesh.triCount);
  ok('round trip preserves pos values', Array.from(back.pos).every((v, i) => v === mesh.pos[i]));
}

// ---- resolveMats: applies ids, throws on a second call --------------------
{
  const mesh = makeCleanMesh(); // matKeys = ['stone'] via packFlat1(...,0)... actually clean mesh has no matIndex call
  const b = new StaticMeshBuilder('test:mats');
  const idx = b.matIndex('stone');
  b.addQuad(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1],
    0, 0, 1, planePlaneIdBase(4, 0), packFlat1(4, 5, idx), [0, AO_NONE, 0, 0, 0, 0, 0, 0],
  );
  const m2 = b.build();
  ok('unresolved mesh matsResolved is false', m2.matsResolved === false);
  resolveMats(m2, (key) => (key === 'stone' ? 42 : -1));
  ok('resolveMats writes the resolved id', flatMat(m2.flat[1]) === 42);
  ok('resolveMats sets matsResolved', m2.matsResolved === true);
  let threw = false;
  try { resolveMats(m2, () => 0); } catch (e) { threw = true; }
  ok('resolveMats throws on a second call', threw);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
