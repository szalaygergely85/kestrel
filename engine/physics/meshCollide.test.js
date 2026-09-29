// engine/physics/meshCollide.test.js (ME-10a, docs/architecture.md 27.17).
// moveCircleMesh (the trimesh twin of moveCapsule) against synthetic
// quad-built meshes: flat floor, wall push-out, convex corner, diagonal
// wall, risers (grounded/airborne), lintel, grate face, walkable/blocking
// ramps, candidate overflow, zero allocation, determinism.
//
// engine/physics/** may not import engine/mesh/** at runtime (check-deps
// rule 11); this TEST file only imports engine/physics/bvh.js to build
// synthetic meshes (same convention as bvh.test.js), never engine/mesh.
// Run: node engine/physics/meshCollide.test.js [--verbose]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBvh } from './bvh.js';
import { moveCircleMesh, MESH_CAND_MAX } from './meshCollide.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Quad -> triangle -> collider helpers (synthetic meshes, no engine/mesh)
// ---------------------------------------------------------------------------

/** Writes 2 triangles (a,b,c) and (a,c,d) - a "grid style" quad - into pos at triangle offset t. */
function writeQuad(pos, t, a, b, c, d) {
  const o = t * 18;
  pos[o] = a[0]; pos[o + 1] = a[1]; pos[o + 2] = a[2];
  pos[o + 3] = b[0]; pos[o + 4] = b[1]; pos[o + 5] = b[2];
  pos[o + 6] = c[0]; pos[o + 7] = c[1]; pos[o + 8] = c[2];
  pos[o + 9] = a[0]; pos[o + 10] = a[1]; pos[o + 11] = a[2];
  pos[o + 12] = c[0]; pos[o + 13] = c[1]; pos[o + 14] = c[2];
  pos[o + 15] = d[0]; pos[o + 16] = d[1]; pos[o + 17] = d[2];
}

/** Vertical wall quad along the segment (x0,y0)-(x1,y1), z in [z0, z1]. */
function wallQuad(x0, y0, x1, y1, z0, z1) {
  return [[x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]];
}

/** Flat/inclined floor quad: (x0,y0,z0) rising to (x0+runLen, y0, z0+H) along x,
 * level along y (width). nz of the resulting triangles = cos(angleDeg) exactly. */
function rampQuad(x0, y0, runLen, width, angleDeg, z0 = 0) {
  const H = runLen * Math.tan(angleDeg * Math.PI / 180);
  return [
    [x0, y0, z0], [x0 + runLen, y0, z0 + H],
    [x0 + runLen, y0 + width, z0 + H], [x0, y0 + width, z0],
  ];
}

/** Builds a MeshCollider (27.17 shape) from a list of quads (each [p00,p10,p11,p01]). */
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

function freshOut() { return { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false }; }

const WALK_COS = Math.cos(50 * Math.PI / 180); // maxSlopeDeg = 50, per the 30/49/51 test trio
const OPTS = { height: 2, stepUpMax: 0.3, walkCos: WALK_COS };

// ---------------------------------------------------------------------------
// 1. Flat floor: no push
// ---------------------------------------------------------------------------
{
  const floor = buildCollider('floor', [[[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]]]);
  const out = freshOut();
  moveCircleMesh([floor], 1, 0, 0, 1, 0.2, 0.3, 0, true, OPTS, out);
  ok('flat floor: no push on x', Math.abs(out.x - 1) < 1e-9, `got ${out.x}`);
  ok('flat floor: no push on y', Math.abs(out.y - 0.2) < 1e-9, `got ${out.y}`);
  ok('flat floor: not blocked', !out.blockedX && !out.blockedY);
  ok('flat floor: no overflow', !out.overflow);
}

// ---------------------------------------------------------------------------
// 2. Wall push-out exact within 1e-6 + blockedX
// ---------------------------------------------------------------------------
{
  const wall = buildCollider('wall', [wallQuad(5, -5, 5, 5, -1, 3)]);
  const out = freshOut();
  // Start at x=4.9, move +0.05 -> target 4.95 overlaps the plane; near-side
  // approach only (never crosses to the far side), radius 0.3.
  moveCircleMesh([wall], 1, 4.9, 0, 0.05, 0, 0.3, 0, true, OPTS, out);
  ok('wall push-out exact within 1e-6', Math.abs(out.x - 4.7) < 1e-6, `got ${out.x}`);
  ok('wall push-out: blockedX', out.blockedX);
  ok('wall push-out: y unaffected', Math.abs(out.y - 0) < 1e-9);
}

// ---------------------------------------------------------------------------
// 3. Convex corner slide (nx/ny set, no stick)
// ---------------------------------------------------------------------------
{
  // A wall segment that ENDS at (5,5) - the circle approaches beyond the
  // segment's extent, so the nearest feature is the segment's endpoint
  // (a corner), not a perpendicular face.
  const wall = buildCollider('corner-wall', [wallQuad(5, 0, 5, 5, -1, 3)]);
  const out = freshOut();
  moveCircleMesh([wall], 1, 4.9, 5.15, 0.2, 0, 0.3, 0, true, OPTS, out);
  ok('convex corner: nx set', Math.abs(out.nx) > 1e-6, `nx=${out.nx}`);
  ok('convex corner: ny set', Math.abs(out.ny) > 1e-6, `ny=${out.ny}`);
  ok('convex corner: not a face contact', !out.blockedX && !out.blockedY);
  ok('convex corner: circle actually moved (no stick)', out.x !== 4.9 || out.y !== 5.15);
  const dist = Math.hypot(out.x - 5, out.y - 5);
  ok('convex corner: pushed out to radius from the corner point', Math.abs(dist - 0.3) < 1e-6, `dist=${dist}`);
}

// ---------------------------------------------------------------------------
// 4. Diagonal wall (normal = wall normal)
// ---------------------------------------------------------------------------
{
  // Wall along the line y = x (through (0,0) and (10,10)); unit normal in xy
  // is (1,-1)/sqrt2 or (-1,1)/sqrt2. Circle sits 0.25 m off the line's
  // midpoint along +n, inside overlap radius 0.3 - no movement needed.
  const wall = buildCollider('diag-wall', [wallQuad(0, 0, 10, 10, -1, 3)]);
  const inv = Math.SQRT1_2;
  const cx = 5 + inv * 0.25, cy = 5 - inv * 0.25;
  const out = freshOut();
  moveCircleMesh([wall], 1, cx, cy, 0, 0, 0.3, 0, true, OPTS, out);
  ok('diagonal wall: normal matches wall normal (x)', Math.abs(Math.abs(out.nx) - inv) < 1e-6, `nx=${out.nx}`);
  ok('diagonal wall: normal matches wall normal (y)', Math.abs(Math.abs(out.ny) - inv) < 1e-6, `ny=${out.ny}`);
  ok('diagonal wall: normal points away from the line (same sign as offset)', out.nx > 0 && out.ny < 0, `n=(${out.nx},${out.ny})`);
}

// ---------------------------------------------------------------------------
// 5. 0.3 m riser: grounded passes / airborne blocks
// ---------------------------------------------------------------------------
{
  const riser = buildCollider('riser03', [wallQuad(3, -5, 3, 5, 0, 0.3)]);
  {
    const out = freshOut();
    moveCircleMesh([riser], 1, 2.9, 0, 0.2, 0, 0.3, 0, true, OPTS, out); // grounded, stepUpMax 0.3
    ok('0.3m riser grounded: passes (no push)', Math.abs(out.x - 3.1) < 1e-9 && !out.blockedX, `x=${out.x} blockedX=${out.blockedX}`);
  }
  {
    const out = freshOut();
    moveCircleMesh([riser], 1, 2.9, 0, 0.05, 0, 0.3, 0, false, OPTS, out); // airborne
    ok('0.3m riser airborne: blocks', out.blockedX && out.x < 3, `x=${out.x} blockedX=${out.blockedX}`);
  }
}

// ---------------------------------------------------------------------------
// 6. 0.6 m riser blocks (grounded too - exceeds stepUpMax)
// ---------------------------------------------------------------------------
{
  const riser = buildCollider('riser06', [wallQuad(3, -5, 3, 5, 0, 0.6)]);
  const out = freshOut();
  moveCircleMesh([riser], 1, 2.9, 0, 0.05, 0, 0.3, 0, true, OPTS, out);
  ok('0.6m riser blocks even grounded', out.blockedX && out.x < 3, `x=${out.x} blockedX=${out.blockedX}`);
}

// ---------------------------------------------------------------------------
// 7. Lintel: at floor level passes, feet at +0.5 blocks
// ---------------------------------------------------------------------------
{
  const lintel = buildCollider('lintel', [wallQuad(4, -5, 4, 5, 2, 3)]); // ceilH=2, topH=3
  {
    const out = freshOut();
    moveCircleMesh([lintel], 1, 3.9, 0, 0.2, 0, 0.3, 0, true, OPTS, out); // footZ=0, height=2 -> headTop=2
    ok('lintel at floor level: passes', !out.blockedX && Math.abs(out.x - 4.1) < 1e-9, `x=${out.x} blockedX=${out.blockedX}`);
  }
  {
    const out = freshOut();
    moveCircleMesh([lintel], 1, 3.9, 0, 0.05, 0, 0.3, 0.5, true, OPTS, out); // footZ=0.5 -> headTop=2.5 > ceilH
    ok('lintel with feet at +0.5: blocks', out.blockedX && out.x < 4, `x=${out.x} blockedX=${out.blockedX}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Closed grate face blocks; at ceilH = footZ + height passes
// ---------------------------------------------------------------------------
{
  {
    const grateClosed = buildCollider('grate-closed', [wallQuad(6, -5, 6, 5, 0, 10)]); // ceilH=0 (fully closed)
    const out = freshOut();
    moveCircleMesh([grateClosed], 1, 5.9, 0, 0.05, 0, 0.3, 0, true, OPTS, out);
    ok('closed grate face: blocks', out.blockedX && out.x < 6, `x=${out.x} blockedX=${out.blockedX}`);
  }
  {
    const grateOpen = buildCollider('grate-open', [wallQuad(6, -5, 6, 5, 2, 10)]); // ceilH = footZ+height = 2
    const out = freshOut();
    moveCircleMesh([grateOpen], 1, 5.9, 0, 0.2, 0, 0.3, 0, true, OPTS, out);
    ok('grate at ceilH = footZ+height: passes', !out.blockedX && Math.abs(out.x - 6.1) < 1e-9, `x=${out.x} blockedX=${out.blockedX}`);
  }
}

// ---------------------------------------------------------------------------
// 9. Walkable 30 deg / 49 deg ramps never block
// ---------------------------------------------------------------------------
{
  for (const angleDeg of [30, 49]) {
    const ramp = buildCollider(`ramp${angleDeg}`, [rampQuad(0, -5, 4, 10, angleDeg, 0)]);
    const out = freshOut();
    // Move along the incline's run direction, through its footprint.
    moveCircleMesh([ramp], 1, 1, 0, 1, 0, 0.3, 0.5, true, OPTS, out);
    ok(`${angleDeg}deg ramp: never blocks`, !out.blockedX && !out.blockedY, `blockedX=${out.blockedX} blockedY=${out.blockedY}`);
  }
}

// ---------------------------------------------------------------------------
// 10. 51 deg ramp above the step band blocks
// ---------------------------------------------------------------------------
{
  // Run long enough that the incline's height at the contact point is well
  // above stepUpMax (0.3 m), so it can't be dismissed as a walkable step.
  const ramp = buildCollider('ramp51', [rampQuad(0, -5, 4, 10, 51, 0)]);
  const out = freshOut();
  moveCircleMesh([ramp], 1, 2, 0, 0.5, 0, 0.3, 1.5, true, OPTS, out);
  ok('51deg ramp above the step band: blocks', out.blockedX, `x=${out.x} blockedX=${out.blockedX}`);
}

// ---------------------------------------------------------------------------
// 11. Overflow flag with a 300-triangle fan
// ---------------------------------------------------------------------------
{
  const quads = [];
  for (let i = 0; i < 300; i++) {
    const xw = 5 + i * 0.0001;
    quads.push(wallQuad(xw, -1, xw, 1, -1, 3));
  }
  const fan = buildCollider('fan300', quads);
  const out = freshOut();
  moveCircleMesh([fan], 1, 4.9, 0, 0.2, 0, 0.3, 0, true, OPTS, out);
  ok('300-triangle fan: overflow flag set', out.overflow === true);
}

// ---------------------------------------------------------------------------
// 12. Zero allocation (--expose-gc, 10k calls < 64 KB)
// ---------------------------------------------------------------------------
{
  const colliders = [
    buildCollider('perf-floor', [[[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0]]]),
    buildCollider('perf-wall-a', [wallQuad(5, -20, 5, 20, -1, 3)]),
    buildCollider('perf-wall-b', [wallQuad(-20, 8, 20, 8, -1, 3)]),
  ];
  const out = freshOut();
  let seed = 1;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function callOnce() {
    const x = (rng() * 2 - 1) * 6, y = (rng() * 2 - 1) * 6;
    const dx = (rng() * 2 - 1) * 0.15, dy = (rng() * 2 - 1) * 0.15;
    moveCircleMesh(colliders, colliders.length, x, y, dx, dy, 0.3, 0, rng() > 0.5, OPTS, out);
  }
  for (let i = 0; i < 1000; i++) callOnce(); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) callOnce();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('10k moveCircleMesh calls: no significant heap growth (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
}

// ---------------------------------------------------------------------------
// 13. Two runs bit-equal (determinism)
// ---------------------------------------------------------------------------
{
  const wall = buildCollider('det-wall', [wallQuad(5, -5, 5, 5, -1, 3)]);
  const out1 = freshOut(), out2 = freshOut();
  moveCircleMesh([wall], 1, 4.9, 0, 0.15, 0, 0.3, 0, true, OPTS, out1);
  moveCircleMesh([wall], 1, 4.9, 0, 0.15, 0, 0.3, 0, true, OPTS, out2);
  ok('two runs bit-equal', out1.x === out2.x && out1.y === out2.y
    && out1.nx === out2.nx && out1.ny === out2.ny
    && out1.blockedX === out2.blockedX && out1.blockedY === out2.blockedY
    && out1.overflow === out2.overflow);
}

if (VERBOSE) console.log(`MESH_CAND_MAX=${MESH_CAND_MAX}`);
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
