// engine/mesh/hullProxy.test.js - S8-B2-16 (docs/sprints/sprint-8-queue.md).
// buildHullProxy (18-DOP sample -> exact quickhull, capped <= HULL_MAX_FACES) and the --hull / colliderHull
// data flag end to end: the hull is emitted as plain triangles (same `collider` shape as the prism), so a
// capsule sweep against it uses the UNCHANGED engine/physics/meshCollide.js path (no new primitive).
// Run: node engine/mesh/hullProxy.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHullProxy, HULL_MAX_FACES, planMeshCollision, buildPrismProxy, PHYSICS } from '../index.js';
import { buildBvh } from '../physics/bvh.js';
import { moveCircleMesh } from '../physics/meshCollide.js';
import { readMeshJSON } from '../test/meshFile.test.js';
import { makeOk } from '../test/assert.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// --- generator: a real rock mesh -------------------------------------------------------------------------
const rock = readMeshJSON(new URL('../../content/meshes/quaternius/Rock_Medium_1.mesh.json', import.meta.url));
const hull = buildHullProxy(rock.pos);
ok(!!hull && hull.length % 9 === 0, 'hull is a flat 9-per-triangle array');
const hullTris = hull.length / 9;
ok(hullTris >= 4 && hullTris <= HULL_MAX_FACES, `rock hull <= ${HULL_MAX_FACES} tris (got ${hullTris})`);
const hull2 = buildHullProxy(rock.pos);
assert.deepEqual(hull2, hull); pass++;

// Every hull vertex must be a REAL mesh vertex (18-DOP support points are exact extreme points of the mesh,
// never interpolated) - round-trip within the importer's 1e-5 position rounding + the proxy's 1e-3 output rounding.
function closeToSomeMeshVertex(x, y, z) {
  for (let i = 0; i < rock.pos.length; i += 3) {
    if (Math.abs(rock.pos[i] - x) < 2e-3 && Math.abs(rock.pos[i + 1] - y) < 2e-3 && Math.abs(rock.pos[i + 2] - z) < 2e-3) return true;
  }
  return false;
}
let allReal = true;
for (let i = 0; i < hull.length; i += 3) if (!closeToSomeMeshVertex(hull[i], hull[i + 1], hull[i + 2])) allReal = false;
ok(allReal, 'every hull vertex is a real mesh vertex (no interior/averaged points)');

// Outward winding: every face normal points away from the hull's own centroid.
let cx = 0, cy = 0, cz = 0, nv = 0;
const seenV = new Set();
for (let i = 0; i < hull.length; i += 3) { const k = `${hull[i]},${hull[i + 1]},${hull[i + 2]}`; if (!seenV.has(k)) { seenV.add(k); cx += hull[i]; cy += hull[i + 1]; cz += hull[i + 2]; nv++; } }
cx /= nv; cy /= nv; cz /= nv;
let outward = true, volume6 = 0;
for (let t = 0; t < hullTris; t++) {
  const o = t * 9;
  const ax = hull[o], ay = hull[o + 1], az = hull[o + 2], bx = hull[o + 3], by = hull[o + 4], bz = hull[o + 5], cxp = hull[o + 6], cyp = hull[o + 7], czp = hull[o + 8];
  const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az, ex2 = cxp - ax, ey2 = cyp - ay, ez2 = czp - az;
  const nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
  const toC = [ax - cx, ay - cy, az - cz];
  if (nx * toC[0] + ny * toC[1] + nz * toC[2] > 1e-6) outward = false;
  volume6 += ax * (by * czp - bz * cyp) + bx * (cyp * az - czp * ay) + cxp * (ay * bz - az * by);
}
ok(outward, 'every hull face normal points away from the hull centroid (outward)');
ok(Math.abs(volume6) / 6 > 0.01, `hull encloses positive volume (${(Math.abs(volume6) / 6).toFixed(3)} m^3)`);

// A degenerate (near-planar) mesh falls back cleanly (null, caller uses the prism).
const flat = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.5, 0.5, 0, 0.2, 0.7, 0]);
ok(buildHullProxy(flat) === null, 'a flat/degenerate point set returns null (fallback to the prism)');

// planMeshCollision: hull opt-in only via opts.hull, same shape/soft/height rules as the prism otherwise.
const planHull = planMeshCollision('x/Rock', rock.pos, { hull: true });
assert.deepEqual(Array.from(planHull.collider), hull); pass++;
const planNoHull = planMeshCollision('x/Rock', rock.pos);
assert.deepEqual(Array.from(planNoHull.collider), Array.from(buildPrismProxy(rock.pos))); pass++;
ok(JSON.stringify(planHull.collider) !== JSON.stringify(planNoHull.collider), 'hull proxy differs from the prism proxy for the same mesh');

// --- capsule sweep: the hull IS the collider engine/physics/meshCollide.js sees -------------------------
// A triangular prism (6 vertices -> exactly 8 faces, well under the cap), so buildHullProxy reconstructs it
// EXACTLY (the 18-DOP directions recover all 6 corners) and its footprint is a known equilateral triangle.
const R = 2, H = 3;
const ring = [90, 210, 330].map((d) => [R * Math.cos(d * Math.PI / 180), R * Math.sin(d * Math.PI / 180)]);
function prismTris() {
  const [a, b, c] = ring;
  const top = ring.map(([x, y]) => [x, y, H]);
  const out = [];
  const tri = (p, q, r) => out.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
  tri([...a, 0], [...b, 0], [...c, 0]); // bottom (CCW seen from below -> outward = -z; order chosen for that)
  tri(top[0], top[2], top[1]); // top (outward = +z)
  for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; tri([...ring[i], 0], [...ring[j], 0], [...ring[j], H]); tri([...ring[i], 0], [...ring[j], H], [...ring[i], H]); }
  return out;
}
const prismPos = Float64Array.from(prismTris());
const prismHull = buildHullProxy(prismPos);
ok(!!prismHull && prismHull.length / 9 === 8, `exact prism hull has 8 faces (got ${prismHull ? prismHull.length / 9 : 'null'})`);
const bvh = buildBvh(Float64Array.from(prismHull), null, null);
const collider = { id: 'hull-prism', kind: 'trimesh', bvh, min: Float64Array.from(bvh.nodeMin.subarray(0, 3)), max: Float64Array.from(bvh.nodeMax.subarray(0, 3)), enabled: true };
const colliders = [collider];
const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax, walkCos: Math.cos(PHYSICS.maxSlopeDeg * Math.PI / 180) };
function insideRing(x, y, grow) {
  let worst = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = ring[i], b = ring[(i + 1) % 3];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    worst = Math.min(worst, (ex * (y - a[1]) - ey * (x - a[0])) / Math.hypot(ex, ey));
  }
  return worst >= -grow;
}
const capRadius = 0.3;
const out = { x: 0, y: 0, blockedX: 0, blockedY: 0, nx: 0, ny: 0, overflow: false };
for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) {
  const r = d * Math.PI / 180;
  const startX = 5 * Math.cos(r), startY = 5 * Math.sin(r);
  // Sweep a big step straight toward the centre: must stop outside the prism footprint, never inside.
  moveCircleMesh(colliders, 1, startX, startY, -startX, -startY, capRadius, 1.5, true, opts, out);
  ok(!insideRing(out.x, out.y, 0), `capsule centre never inside the hull face (dir ${d}: ${out.x.toFixed(2)},${out.y.toFixed(2)})`);
  const dist = Math.hypot(out.x, out.y);
  ok(dist > 0.3 && dist < 4.8, `capsule blocked near the hull face, not past the centre or untouched (dir ${d}, dist ${dist.toFixed(2)})`);
  // A target clearly outside the whole footprint (radius 2.5, beyond even the farthest vertex at 2): free, unblocked.
  const farX = 2.5 * Math.cos(r), farY = 2.5 * Math.sin(r);
  moveCircleMesh(colliders, 1, startX, startY, farX - startX, farY - startY, capRadius, 1.5, true, opts, out);
  ok(Math.abs(out.x - farX) < 1e-9 && Math.abs(out.y - farY) < 1e-9, `free just outside the footprint (dir ${d})`);
}

// --- data flag: colliderHull only takes effect with BOTH the mesh flag AND the tool's --hull --------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-hull-'));
try {
  const flagged = { id: 'tmp/HullRock', layout: 'static', pos: Array.from(rock.pos), colliderHull: true };
  const plain = { id: 'tmp/PlainRock', layout: 'static', pos: Array.from(rock.pos) };
  fs.writeFileSync(path.join(tmp, 'flagged.mesh.json'), JSON.stringify(flagged));
  fs.writeFileSync(path.join(tmp, 'plain.mesh.json'), JSON.stringify(plain));
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'tools/gen-mesh-colliders.mjs'), ...args, tmp], { cwd: ROOT, encoding: 'utf8' });

  // Default (no --hull): both meshes get the prism, regardless of the data flag.
  let r = run([]);
  ok(r.status === 0, `default run exits 0 (${r.stderr})`);
  let flaggedOut = JSON.parse(fs.readFileSync(path.join(tmp, 'flagged.mesh.json'), 'utf8'));
  let plainOut = JSON.parse(fs.readFileSync(path.join(tmp, 'plain.mesh.json'), 'utf8'));
  assert.deepEqual(flaggedOut.collider, plainOut.collider); pass++;
  ok(flaggedOut.collider.length / 9 <= 48, 'default: flagged mesh still gets the ordinary prism');
  ok(/proxy \d+ tris.*\(\d+\.\d+ms\)/.test(r.stdout), `per-mesh build time is logged: ${r.stdout.split('\n').find((l) => l.includes('flagged'))}`);

  // --hull: only the flagged mesh switches; re-running --check --hull is then 0 diffs (idempotent).
  r = run(['--hull']);
  ok(r.status === 0, `--hull run exits 0 (${r.stderr})`);
  flaggedOut = JSON.parse(fs.readFileSync(path.join(tmp, 'flagged.mesh.json'), 'utf8'));
  plainOut = JSON.parse(fs.readFileSync(path.join(tmp, 'plain.mesh.json'), 'utf8'));
  ok(flaggedOut.collider.length / 9 <= HULL_MAX_FACES, `--hull: flagged mesh capped at ${HULL_MAX_FACES} tris (got ${flaggedOut.collider.length / 9})`);
  ok(JSON.stringify(flaggedOut.collider) !== JSON.stringify(plainOut.collider), '--hull: the unflagged mesh is unaffected (still the prism)');
  ok(/hull \d+ tris/.test(r.stdout), 'log line names the hull proxy once --hull is on');
  r = run(['--hull', '--check']);
  ok(r.status === 0, `--hull --check is idempotent (0 diffs) on the 2nd run: ${r.stdout}`);

  // The default content root is untouched either way (S8-B2-16 AC).
  r = spawnSync(process.execPath, [path.join(ROOT, 'tools/gen-mesh-colliders.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0, `--check: 0 diffs for default meshes\n${r.stdout}\n${r.stderr}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fail} failed. ${fail ? 'FAIL: ' + failures.join(' | ') : 'ALL PASS'}`);
process.exitCode = fail ? 1 : 0;
