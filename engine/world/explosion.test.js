// engine/world/explosion.test.js (US-136, architecture.md 32.4). Run: node --expose-gc engine/world/explosion.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { explosionHits } from './explosion.js';
import { raycastColliders } from '../physics/meshCollide.js';
import { buildBvh } from '../physics/bvh.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// Wall: plane x = 5, y,z in -10..10. Stub world = the same raycastColliders path World.raySegment uses (mesh mode).
const pos = Float64Array.from([5, -10, -10, 5, 10, -10, 5, 10, 10, 5, -10, -10, 5, 10, 10, 5, -10, 10]);
const bvh = buildBvh(pos, null, null);
const col = { id: 'w', kind: 'trimesh', bvh, min: Float64Array.from([5, -10, -10]), max: Float64Array.from([5, 10, 10]), enabled: true };
const hit = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0, collider: -1 };
const world = {
  raySegment(ax, ay, az, bx, by, bz, out) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    if (dx * dx + dy * dy + dz * dz < 1e-18) return false;
    if (!raycastColliders([col], 1, ax, ay, az, dx, dy, dz, 1, hit)) return false;
    out.t = hit.t; out.x = ax + dx * hit.t; out.y = ay + dy * hit.t; out.z = az + dz * hit.t;
    return true;
  },
};
const cand = (list) => ({
  count: list.length,
  x: list.map((c) => c[0]), y: list.map((c) => c[1]), z: list.map((c) => c[2]), r: list.map((c) => c[3]), h: list.map((c) => c[4]),
});
const oi = new Int32Array(32), of = new Float64Array(32), od = new Float64Array(96), ray = { t: 0, x: 0, y: 0, z: 0 };

// ---- falloff: surface distance 0 (touching), R/2, R ----
{
  const R = 4, r = 0.3;
  // centre z=0 at the target mid-height: target feet -0.85, h 1.7 -> cz = ez = 0, so dS = d - r
  const c = cand([[r, 0, -0.85, r, 1.7], [R / 2 + r, 0, -0.85, r, 1.7], [R + r, 0, -0.85, r, 1.7], [R + r - 0.01, 0, -0.85, r, 1.7], [0, 0, -0.85, r, 1.7]]);
  const n = explosionHits(world, 0, 0, 0, R, c, oi, of, od, ray);
  ok('falloff: 4 hits (dS=R skipped)', n === 4, `n=${n}`);
  ok('falloff: touching = 1', oi[0] === 0 && near(of[0], 1));
  ok('falloff: R/2 = 0.5', oi[1] === 1 && near(of[1], 0.5));
  ok('falloff: just inside R ~ 0.0025', oi[2] === 3 && near(of[2], 0.01 / R, 1e-9), `${of[2]}`);
  ok('falloff: centre inside blast = 1, dir (0,0,1)', oi[3] === 4 && near(of[3], 1) && od[9] === 0 && od[10] === 0 && od[11] === 1);
  ok('dir unit +x', near(od[0], 1) && near(od[1], 0) && near(od[2], 0));
}
// ---- vertical: blast above a tall target uses the nearest column point ----
{
  const c = cand([[0.5, 0, 0, 0.3, 1.7]]);
  const n = explosionHits(world, 0, 0, 1.0, 3, c, oi, of, od, ray); // ez inside [0,1.7] -> dz=0
  ok('vertical: clamp(ez) -> dS = 0.5-0.3', n === 1 && near(of[0], 1 - 0.2 / 3), `${of[0]}`);
  const n2 = explosionHits(world, 0, 0, 5, 3, c, oi, of, od, ray); // 3.3 above the head: dS=hypot(.5,3.3)-.3 > 3? 3.337-.3=3.04 -> skip
  ok('vertical: far above skipped', n2 === 0, `n2=${n2}`);
}
// ---- occlusion ----
{
  // blast at x=2; target A beyond the wall (x=7), B beside it on the same side (x=3, y=6), C hugging the wall near side (x=4.6)
  const c = cand([[7, 0, -0.85, 0.3, 1.7], [3, 3, -0.85, 0.3, 1.7], [4.6, 0, -0.85, 0.3, 1.7]]);
  const n = explosionHits(world, 2, 0, 0, 10, c, oi, of, od, ray);
  ok('wall: behind skipped, beside + near-side hit', n === 2 && oi[0] === 1 && oi[1] === 2, `n=${n} idx=${Array.from(oi.slice(0, n))}`);
  // capsule overlapping the wall plane from the near side: centre 0.2 before the wall -> t*L = L - 0.2 > L - r - 0.05 => not blocked
  const c2 = cand([[4.85, 0, -0.85, 0.3, 1.7]]);
  ok('wall: capsule touching the wall face still hit', explosionHits(world, 2, 0, 0, 10, c2, oi, of, od, ray) === 1);
  // wall disabled -> everything hit
  col.enabled = false;
  ok('wall disabled: behind target hit', explosionHits(world, 2, 0, 0, 10, c, oi, of, od, ray) === 3);
  col.enabled = true;
}
// ---- radius edge with capsule radius ----
{
  const c = cand([[0, 10.2, -0.85, 0.3, 1.7]]); // centre 10.2 away, dS = 9.9 < 10
  ok('edge: capsule touching the radius is hit with tiny f', explosionHits(world, 0, 0, 0, 10, c, oi, of, od, ray) === 1 && near(of[0], 0.01, 1e-9), `${of[0]}`);
  const c2 = cand([[0, 10.3, -0.85, 0.3, 1.7]]);
  ok('edge: dS = R skipped', explosionHits(world, 0, 0, 0, 10, c2, oi, of, od, ray) === 0);
}
// ---- output cap ----
{
  const c = cand([[1, 0, -0.85, 0.3, 1.7], [0, 1, -0.85, 0.3, 1.7], [-1, 0, -0.85, 0.3, 1.7]]);
  ok('cap respected', explosionHits(world, 0, 0, 0, 5, c, new Int32Array(2), of, od, ray) === 2);
}
// ---- perf + zero alloc: 16 candidates ----
{
  const list = [];
  for (let i = 0; i < 16; i++) list.push([1 + (i % 8), -4 + i * 0.5, -0.85, 0.3, 1.7]);
  const c = cand(list);
  const run = () => explosionHits(world, 0, 0, 0, 12, c, oi, of, od, ray);
  for (let i = 0; i < 2000; i++) run();
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) run();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20000;
  global.gc();
  ok('16 candidates <= 0.35 ms', ms <= 0.35, `${ms.toFixed(4)} ms`);
  console.log(`  info explosionHits(16) ${ms.toFixed(4)} ms/call (stub ray world)`);
  ok('explosionHits: no heap growth', process.memoryUsage().heapUsed - h0 < 64 * 1024);
}
console.log(`explosion.test: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
