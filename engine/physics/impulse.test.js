// engine/physics/impulse.test.js (US-136, architecture.md 32.4). Run: node --expose-gc engine/physics/impulse.test.js
// applyImpulse against synthetic mesh worlds through the real `integrate`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBvh } from './bvh.js';
import { moveCircleMesh, probeSupport, meshSupportSector } from './meshCollide.js';
import { integrate } from './integrate.js';
import { PHYSICS } from './config.js';
import { applyImpulse, IMPULSE_MAX_H, IMPULSE_MAX_V } from './impulse.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function collider(id, quads) {
  const pos = new Float64Array(quads.length * 18);
  quads.forEach(([a, b, c, d], i) => {
    const o = i * 18;
    for (const [k, p] of [[0, a], [3, b], [6, c], [9, a], [12, c], [15, d]]) { pos[o + k] = p[0]; pos[o + k + 1] = p[1]; pos[o + k + 2] = p[2]; }
  });
  const bvh = buildBvh(pos, null, null);
  return { id, kind: 'trimesh', bvh, min: Float64Array.from(bvh.nodeMin.slice(0, 3)), max: Float64Array.from(bvh.nodeMax.slice(0, 3)), enabled: true };
}
function meshWorld(cols) {
  const sup = { floorZ: 0, floorHit: false, fnx: 0, fny: 0, fnz: 0, floorCollider: -1, floorTri: -1, ceilZ: 0, ceilHit: false };
  const sec = { floorH: 0, ceilH: 'sky', solid: false, terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
  return {
    physicsMode: 'mesh',
    collideCircle: (x, y, dx, dy, r, z, g, o, out) => moveCircleMesh(cols, cols.length, x, y, dx, dy, r, z, g, o, out),
    supportAt: (x, y, z, g, o) => { probeSupport(cols, cols.length, x, y, z, g, o, sup); return meshSupportSector(sup, NaN, 0, 0, 1, sec); },
  };
}
const floor = collider('floor', [[[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0]]]);
// 0.1 m thick wall: two faces at x = 3.0 and x = 3.1
const wall = collider('wall', [
  [[3, -20, 0], [3, 20, 0], [3, 20, 6], [3, -20, 6]],
  [[3.1, -20, 0], [3.1, 20, 0], [3.1, 20, 6], [3.1, -20, 6]],
]);
const ceil = collider('ceil', [[[-20, -20, 2.2], [20, -20, 2.2], [20, 20, 2.2], [-20, 20, 2.2]]]);
const mkEnt = (x, y, z) => ({ id: 'p', transform: { x, y, z, yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: PHYSICS.radius, height: PHYSICS.height, eyeH: PHYSICS.eyeHeight } } });

// ---- clamps and flags ----
{
  const b = { vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0.1, sliding: true, peakZ: 0 };
  applyImpulse(b, 1.5, 30, 0, 99);
  ok('clamp H', Math.abs(Math.hypot(b.vx, b.vy) - IMPULSE_MAX_H) < 1e-9, `${b.vx}`);
  ok('clamp V', b.vz === IMPULSE_MAX_V, `${b.vz}`);
  ok('lift flags', b.grounded === false && b.coyote === 0 && b.sliding === false && b.peakZ === 1.5);
  const c = { vx: 1, vy: 2, vz: 5, grounded: true, peakZ: 0 };
  applyImpulse(c, 0, 1, 1, 0);
  ok('iz=0: no lift, vz untouched', c.grounded === true && c.vz === 5 && c.vx === 2 && c.vy === 3);
  const d = { vx: 0, vy: 0, vz: 7, grounded: false, peakZ: 4 };
  applyImpulse(d, 1, 0, 0, 3);
  ok('vz = max(vz, iz); airborne keeps peak', d.vz === 7 && d.peakZ === 4);
}

// ---- max impulse at a 0.1 m wall, 120 steps: never on the far side ----
for (const [label, startX] of [['near', 2.5], ['touching', 2.69]]) {
  const w = meshWorld([floor, wall]);
  const e = mkEnt(startX, 0, 0);
  integrate(e, PHYSICS.fixedDt, null, w, PHYSICS); // settle
  applyImpulse(e.components.body, e.transform.z, 40, 5, 4);
  let maxX = -1e9;
  for (let i = 0; i < 120; i++) { integrate(e, PHYSICS.fixedDt, null, w, PHYSICS); maxX = Math.max(maxX, e.transform.x); }
  ok(`wall (${label}): never past the wall`, maxX < 3.0, `maxX=${maxX}`);
  ok(`wall (${label}): lands`, e.components.body.grounded === true);
}

// ---- ceiling 2.2 m: z <= ceil - height; lift sets fallDistance from peakZ ----
{
  const w = meshWorld([floor, ceil]);
  const e = mkEnt(0, 0, 0);
  integrate(e, PHYSICS.fixedDt, null, w, PHYSICS);
  applyImpulse(e.components.body, e.transform.z, 0, 0, IMPULSE_MAX_V);
  let maxZ = 0, landed = false, fall = 0;
  for (let i = 0; i < 180; i++) {
    integrate(e, PHYSICS.fixedDt, null, w, PHYSICS);
    maxZ = Math.max(maxZ, e.transform.z);
    if (e.components.body.landed) { landed = true; fall = e.components.body.fallDistance; break; }
  }
  const lim = 2.2 - PHYSICS.height;
  ok('ceiling: z <= ceil - height', maxZ <= lim + 1e-9 && maxZ > lim - 0.05, `maxZ=${maxZ} lim=${lim}`);
  ok('ceiling: lands, fallDistance == peak', landed && Math.abs(fall - maxZ) < 1e-6, `fall=${fall} peak=${maxZ}`);
}
// open sky: fallDistance equals the apex rise (no fake extra)
{
  const w = meshWorld([floor]);
  const e = mkEnt(0, 0, 0);
  integrate(e, PHYSICS.fixedDt, null, w, PHYSICS);
  applyImpulse(e.components.body, e.transform.z, 0, 0, 4);
  let maxZ = 0, fall = -1;
  for (let i = 0; i < 180; i++) { integrate(e, PHYSICS.fixedDt, null, w, PHYSICS); maxZ = Math.max(maxZ, e.transform.z); if (e.components.body.landed) { fall = e.components.body.fallDistance; break; } }
  ok('open: fallDistance = apex', Math.abs(fall - maxZ) < 1e-6 && maxZ > 0.3, `fall=${fall} apex=${maxZ}`);
}
// ---- zero allocation ----
{
  const b = { vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, sliding: false, peakZ: 0 };
  for (let i = 0; i < 1000; i++) applyImpulse(b, 0, 1, 1, 1);
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) { b.grounded = true; applyImpulse(b, 0, 3, 2, 1); }
  global.gc(); ok('applyImpulse: no heap growth', process.memoryUsage().heapUsed - h0 < 64 * 1024);
}
console.log(`impulse.test: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
