// engine/physics/meshCollide.test.js (ME-10a/b, docs/architecture.md 27.17).
// moveCircleMesh (the trimesh twin of moveCapsule) against synthetic
// quad-built meshes: flat floor, wall push-out, convex corner, diagonal
// wall, risers (grounded/airborne), lintel, grate face, walkable/blocking
// ramps, candidate overflow, zero allocation, determinism (ME-10a); plus
// probeSupport, meshSupportSector and moveSphereMesh (ME-10b): floor/ceiling
// probes, step-up snap window, drops, ramp normals, the 23.3 slope rule
// (TEST-ONLY harness, see section 4 below - integrate.js's ME-10c hooks
// don't exist yet), terrain merge, and the sphere/circle twin.
//
// engine/physics/** may not import engine/mesh/** at runtime (check-deps
// rule 11); this TEST file only imports engine/physics/bvh.js to build
// synthetic meshes (same convention as bvh.test.js), never engine/mesh.
// Run: node engine/physics/meshCollide.test.js [--verbose]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBvh } from './bvh.js';
import {
  moveCircleMesh, probeSupport, meshSupportSector, moveSphereMesh,
  MESH_CAND_MAX, FLOOR_NONE,
} from './meshCollide.js';
import { PHYSICS_DEFAULTS } from './config.js';
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
function freshSupport() { return { floorZ: 0, floorHit: false, fnx: 0, fny: 0, fnz: 0, floorCollider: -1, floorTri: -1, ceilZ: 0, ceilHit: false }; }
function freshSector() { return { floorH: 0, ceilH: 'sky', solid: false, terrain: false, slope: false, nx: 0, ny: 0, nz: 0 }; }

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
  // ME-10b note: warm-up raised 1000 -> 5000 (still < the 10k measured calls)
  // - with more source in this file (probeSupport/meshSupportSector/
  // moveSphereMesh + their own tests below), TurboFan's optimization of
  // this hot loop lands later; too little warm-up sometimes let that one-off
  // recompile fall inside the measured window and falsely read as a leak
  // (verified false-positive: isolated single-function repro with the same
  // 1000/10000 split measured ~100 KB "growth" that went negative at
  // 5000/100000 - not a real per-call allocation).
  for (let i = 0; i < 5000; i++) callOnce(); // warm up
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

// =============================================================================
// ME-10b: probeSupport + meshSupportSector + moveSphereMesh
// =============================================================================

// ---------------------------------------------------------------------------
// 14. probeSupport: floor under the centre
// ---------------------------------------------------------------------------
{
  const floor = buildCollider('probe-floor', [[[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]]]);
  const sup = freshSupport();
  probeSupport([floor], 1, 0, 0, 0.05, true, OPTS, sup);
  ok('probeSupport: floor under the centre', sup.floorHit && Math.abs(sup.floorZ - 0) < 1e-9, `floorZ=${sup.floorZ}`);
  ok('probeSupport: flat floor normal fnz=1', Math.abs(sup.fnz - 1) < 1e-9, `fnz=${sup.fnz}`);
  ok('probeSupport: floorCollider/floorTri set', sup.floorCollider === 0 && sup.floorTri >= 0);
}

// ---------------------------------------------------------------------------
// 15. Step-up snap window (0.3 up: grounded hit, airborne miss)
// ---------------------------------------------------------------------------
{
  const step = buildCollider('probe-step', [[[-5, -5, 0.3], [5, -5, 0.3], [5, 5, 0.3], [-5, 5, 0.3]]]);
  const supG = freshSupport();
  probeSupport([step], 1, 0, 0, 0, true, OPTS, supG); // grounded: stepUpMax 0.3 window reaches the step top
  ok('probeSupport: step-up window grounded hits the step top', supG.floorHit && Math.abs(supG.floorZ - 0.3) < 1e-9, `floorZ=${supG.floorZ}`);

  const supA = freshSupport();
  probeSupport([step], 1, 0, 0, 0, false, OPTS, supA); // airborne: never snaps up onto something above the feet
  ok('probeSupport: step-up window airborne misses the step top', !supA.floorHit && supA.floorZ === FLOOR_NONE, `floorHit=${supA.floorHit}`);
}

// ---------------------------------------------------------------------------
// 16. 5 m drop -> floor below
// ---------------------------------------------------------------------------
{
  const floor = buildCollider('probe-drop', [[[-5, -5, -5], [5, -5, -5], [5, 5, -5], [-5, 5, -5]]]);
  const sup = freshSupport();
  probeSupport([floor], 1, 0, 0, 0, true, OPTS, sup);
  ok('probeSupport: 5m drop finds the floor below', sup.floorHit && Math.abs(sup.floorZ - (-5)) < 1e-9, `floorZ=${sup.floorZ}`);
}

// ---------------------------------------------------------------------------
// 17. No floor -> FLOOR_NONE
// ---------------------------------------------------------------------------
{
  const sup = freshSupport();
  probeSupport([], 0, 0, 0, 0, true, OPTS, sup);
  ok('probeSupport: no colliders -> FLOOR_NONE', !sup.floorHit && sup.floorZ === FLOOR_NONE, `floorZ=${sup.floorZ}`);
}

// ---------------------------------------------------------------------------
// 18. Ceiling under a lintel / 'sky' in the open
// ---------------------------------------------------------------------------
{
  const floor = buildCollider('ceil-floor', [[[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]]]);
  const lintel = buildCollider('ceil-lintel', [[[-5, -5, 2], [5, -5, 2], [5, 5, 2], [-5, 5, 2]]]);

  const supUnder = freshSupport();
  probeSupport([floor, lintel], 2, 0, 0, 0, true, OPTS, supUnder);
  ok('probeSupport: ceiling under a lintel', supUnder.ceilHit && Math.abs(supUnder.ceilZ - 2) < 1e-9, `ceilZ=${supUnder.ceilZ}`);

  const supOpen = freshSupport();
  probeSupport([floor], 1, 0, 0, 0, true, OPTS, supOpen);
  ok('probeSupport: sky in the open (no ceiling)', !supOpen.ceilHit && supOpen.ceilZ === Infinity, `ceilZ=${supOpen.ceilZ}`);
  const sectorOpen = freshSector();
  meshSupportSector(supOpen, NaN, 0, 0, 0, sectorOpen);
  ok('meshSupportSector: open ceiling maps to sky', sectorOpen.ceilH === 'sky');
}

// ---------------------------------------------------------------------------
// 19. 30/49/51 deg ramp normals (51 -> would start a slide)
// ---------------------------------------------------------------------------
{
  for (const deg of [30, 49, 51]) {
    const ramp = buildCollider(`probe-ramp${deg}`, [rampQuad(0, -5, 4, 10, deg, 0)]);
    const midX = 2, y = 0;
    const footZ = midX * Math.tan(deg * Math.PI / 180); // exactly on the ramp surface
    const sup = freshSupport();
    probeSupport([ramp], 1, midX, y, footZ, true, OPTS, sup);
    ok(`probeSupport: ${deg}deg ramp fnz = cos(${deg}deg)`, Math.abs(sup.fnz - Math.cos(deg * Math.PI / 180)) < 1e-9, `fnz=${sup.fnz}`);
    ok(`probeSupport: ${deg}deg ramp fnx points downhill (negative)`, sup.fnx < 0, `fnx=${sup.fnx}`);

    const sector = freshSector();
    meshSupportSector(sup, NaN, 0, 0, 0, sector);
    ok(`meshSupportSector: ${deg}deg ramp slope=true (mesh floor, no terrain)`, sector.slope === true);
    if (deg === 51) {
      ok('51deg ramp: nz below slideStartCos (would start a slide)', sector.nz < PHYSICS_DEFAULTS.slideStartCos, `nz=${sector.nz}`);
    } else {
      // 30/49 deg are both < 50 deg maxSlopeDeg - 49 deg's nz (0.656) sits in
      // the 45-50 deg hysteresis band (above slideStartCos, below
      // slideStopCos) but a body starting NOT sliding never starts here
      // either (only the nz < slideStartCos check can flip it on).
      ok(`${deg}deg ramp: nz at/above slideStartCos (a non-sliding body never starts sliding here)`,
        sector.nz >= PHYSICS_DEFAULTS.slideStartCos, `nz=${sector.nz}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 20. 23.3 slide starts within a 60-step run of a TEST-ONLY harness that
// mimics integrate.js's step 4 (moveCircleMesh) / step 5 (probeSupport +
// meshSupportSector, then the same slope-accel math as integrate.js's
// terrain branch, gated on `sector.terrain || sector.slope` per 27.17's
// ME-10c hook description) directly against meshCollide.js - integrate.js
// itself is NOT touched here (its mesh hooks are ME-10c, the next step).
// ---------------------------------------------------------------------------
{
  const P = PHYSICS_DEFAULTS;
  const DT = P.fixedDt;
  const angleDeg = 51;
  const runLen = 60, width = 10;
  const ramp = buildCollider('slide-ramp', [rampQuad(0, -5, runLen, width, angleDeg, 0)]);
  const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(P.maxSlopeDeg * Math.PI / 180) };

  let x = runLen / 2, y = 0, z = Math.tan(angleDeg * Math.PI / 180) * x; // start exactly on the ramp, well clear of both ends
  let vx = 0, vy = 0;
  let grounded = true, sliding = false;
  const move = freshOut();
  const sup = freshSupport();
  const sector = freshSector();

  for (let i = 0; i < 60; i++) {
    // integrate step 4 twin.
    moveCircleMesh([ramp], 1, x, y, vx * DT, vy * DT, P.radius, z, grounded, opts, move);
    x = move.x; y = move.y;

    // integrate step 5 twin.
    probeSupport([ramp], 1, x, y, z, grounded, opts, sup);
    meshSupportSector(sup, NaN, 0, 0, 0, sector);
    const floorDiff = sector.floorH - z;
    if (grounded && Math.abs(floorDiff) <= P.stepUpMax) {
      z = sector.floorH;
      if (sector.terrain || sector.slope) {
        const nz = sector.nz;
        if (nz < P.slideStartCos) sliding = true;
        else if (nz > P.slideStopCos) sliding = false;
        if (sliding) {
          const dLen = Math.hypot(sector.nx, sector.ny);
          if (dLen > 1e-6) {
            const dhx = sector.nx / dLen, dhy = sector.ny / dLen;
            const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
            vx += dhx * P.slideAccel * horiz * DT;
            vy += dhy * P.slideAccel * horiz * DT;
            const speed = Math.hypot(vx, vy);
            if (speed > P.slideMaxSpeed) { const s = P.slideMaxSpeed / speed; vx *= s; vy *= s; }
          }
        }
      } else {
        sliding = false;
      }
    } else {
      grounded = false; // not expected on this smooth ramp within 60 steps; guards the harness only
    }
  }

  ok('23.3 slide: 51deg ramp starts sliding within 60 steps (TEST-ONLY integrate step4/5 stub)', sliding === true);
  ok('23.3 slide: velocity points downhill (-x)', vx < -0.1, `vx=${vx}`);
  ok('23.3 slide: never left the grounded band on this smooth ramp', grounded === true);
}

// ---------------------------------------------------------------------------
// 21. Terrain merge (terrain above mesh -> terrain:true; below -> mesh floor)
// ---------------------------------------------------------------------------
{
  // A flat mesh floor at z=0 (fnz=1), as if from a prior probeSupport call.
  const flatFloor = { floorZ: 0, floorHit: true, fnx: 0, fny: 0, fnz: 1, floorCollider: 0, floorTri: 0, ceilZ: Infinity, ceilHit: false };

  {
    const sector = freshSector();
    meshSupportSector(flatFloor, 5, 0, 0, 1, sector); // terrain above the mesh floor
    ok('meshSupportSector: terrain above mesh -> terrain:true', sector.terrain === true);
    ok('meshSupportSector: terrain above mesh -> floorH = terrainZ', sector.floorH === 5, `floorH=${sector.floorH}`);
    ok('meshSupportSector: terrain wins -> normal is the terrain normal', sector.nx === 0 && sector.ny === 0 && sector.nz === 1);
  }
  {
    // Terrain below the mesh floor -> mesh floor wins. Per 27.17's literal
    // formula `slope = !terrain && sup.floorHit`, slope comes out true here
    // too (any non-terrain mesh floor sets it, same as `sector.terrain`
    // gates the grid slide branch) - but this floor is FLAT (fnz=1), so the
    // caller's `nz < slideStartCos` check (integrate.js step 5) never fires:
    // it is never actually sliding. Checked here as nz===1, not slope===false
    // (see the ME-10 backlog note for why this reading was chosen over the
    // step list's terser "slope false on flat" wording).
    const sector = freshSector();
    meshSupportSector(flatFloor, -5, 0, 0, 1, sector);
    ok('meshSupportSector: terrain below mesh -> terrain:false (mesh wins)', sector.terrain === false);
    ok('meshSupportSector: terrain below mesh -> floorH = mesh floorZ', sector.floorH === 0, `floorH=${sector.floorH}`);
    ok('meshSupportSector: flat mesh floor -> nz=1 (never actually slides)', sector.nz === 1);
  }
  {
    // NaN terrain (no terrain under this point at all) must not poison floorH.
    const sector = freshSector();
    meshSupportSector(flatFloor, NaN, 0, 0, 1, sector);
    ok('meshSupportSector: NaN terrain -> terrain:false, floorH = mesh floorZ (no NaN poisoning)',
      sector.terrain === false && sector.floorH === 0, `terrain=${sector.terrain} floorH=${sector.floorH}`);
  }
}

// ---------------------------------------------------------------------------
// 22. sphere = circle with h 2r (matches moveCircleMesh directly)
// ---------------------------------------------------------------------------
{
  const wall = buildCollider('sphere-wall', [wallQuad(5, -5, 5, 5, -1, 3)]);
  // Deliberately wrong height/stepUpMax on entry - moveSphereMesh must
  // overwrite them in place (caller-owned scratch, sphere.js's convention).
  const opts = { height: 999, stepUpMax: 999, walkCos: WALK_COS };
  const outSphere = freshOut();
  moveSphereMesh([wall], 1, 4.9, 0, 0.05, 0, 0.3, 0, opts, outSphere);
  ok('moveSphereMesh: overwrites opts.height to 2r', opts.height === 0.6, `height=${opts.height}`);
  ok('moveSphereMesh: overwrites opts.stepUpMax to 0', opts.stepUpMax === 0, `stepUpMax=${opts.stepUpMax}`);

  const outCircle = freshOut();
  moveCircleMesh([wall], 1, 4.9, 0, 0.05, 0, 0.3, 0, true, { height: 0.6, stepUpMax: 0, walkCos: WALK_COS }, outCircle);
  ok('moveSphereMesh matches moveCircleMesh(height=2r, stepUpMax=0, grounded=true) on a grid twin',
    outSphere.x === outCircle.x && outSphere.y === outCircle.y && outSphere.blockedX === outCircle.blockedX,
    `sphere=${outSphere.x} circle=${outCircle.x}`);
}

// ---------------------------------------------------------------------------
// 23. Zero allocation: probeSupport + meshSupportSector + moveSphereMesh
// (--expose-gc, 10k calls < 64 KB)
// ---------------------------------------------------------------------------
{
  const colliders = [
    buildCollider('probe-perf-floor', [[[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0]]]),
    buildCollider('probe-perf-wall', [wallQuad(5, -20, 5, 20, -1, 3)]),
  ];
  const opts = { height: 0.6, stepUpMax: 0, walkCos: WALK_COS };
  const sup = freshSupport();
  const sector = freshSector();
  const out = freshOut();
  let seed = 7;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function callOnce() {
    const x = (rng() * 2 - 1) * 6, y = (rng() * 2 - 1) * 6;
    const dx = (rng() * 2 - 1) * 0.15, dy = (rng() * 2 - 1) * 0.15;
    probeSupport(colliders, colliders.length, x, y, 0, rng() > 0.5, opts, sup);
    meshSupportSector(sup, NaN, 0, 0, 1, sector);
    moveSphereMesh(colliders, colliders.length, x, y, dx, dy, 0.3, 0, opts, out);
  }
  for (let i = 0; i < 5000; i++) callOnce(); // warm up (see the ME-10b note on test 12's gate above)
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) callOnce();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('10k probeSupport+meshSupportSector+moveSphereMesh calls: no significant heap growth (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
}

if (VERBOSE) console.log(`MESH_CAND_MAX=${MESH_CAND_MAX}`);
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
