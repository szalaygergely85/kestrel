// engine/physics/bounds.test.js (WS1-01). Run: node engine/physics/bounds.test.js
import { projectBounds, boundsOvershoot } from './bounds.js';
import { makeOk } from '../test/assert.js';
import { spawnSync } from 'node:child_process';

// AUD-09: the heap-growth gate needs a quiet, gc-able heap: re-spawn once with --expose-gc (as chargen/mesh.test.js)
if (typeof globalThis.gc !== 'function' && !process.env.BOUNDS_TEST_GC) {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, BOUNDS_TEST_GC: '1' } });
  process.exit(r.status ?? 1);
}
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));

const circ = { shape: 'circle', x: 1496.5, y: 1024.5, r: 96 };
const union = { shape: 'union', parts: [
  { shape: 'circle', x: 1496.5, y: 1024.5, r: 96 },
  { shape: 'capsule', ax: 1440, ay: 1034, bx: 1350, by: 1048, r: 40 },
  { shape: 'capsule', ax: 1350, ay: 1048, bx: 1240, by: 1047, r: 40 },
] };
const out = { x: 0, y: 0, nx: 0, ny: 0 };
const R = 0.4;

// old circle projection (pre WS1-01 integrate 4b), the oracle
function oldProj(b, x, y, radius, o) {
  const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy), lim = b.r - radius;
  if (d > lim && d > 1e-6) { const nx = dx / d, ny = dy / d; o.x = b.x + nx * lim; o.y = b.y + ny * lim; o.nx = nx; o.ny = ny; return true; }
  return false;
}
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const o2 = { x: 0, y: 0, nx: 0, ny: 0 };
let same = true;
for (let i = 0; i < 1000; i++) {
  const x = 1496.5 + (rnd() - 0.5) * 300, y = 1024.5 + (rnd() - 0.5) * 300;
  const a = projectBounds(circ, x, y, R, out), b = oldProj(circ, x, y, R, o2);
  if (a !== b || (a && (out.x !== o2.x || out.y !== o2.y || out.nx !== o2.nx || out.ny !== o2.ny))) same = false;
}
ok('circle: bit-identical to old projection on 1k random points', same);

ok('inside circle part: no hit', !projectBounds(union, 1500, 1030, R, out));
ok('inside capsule 1 (west of circle): no hit', !projectBounds(union, 1380, 1045, R, out));
ok('inside capsule 2: no hit', !projectBounds(union, 1260, 1047, R, out));
ok('seam of capsules (1350,1048): no hit', !projectBounds(union, 1350, 1060, R, out));
ok('circle/capsule overlap seam: no hit', !projectBounds(union, 1420, 1034, R, out));
ok('overshoot <= 0 inside, > 0 outside', boundsOvershoot(union, 1300, 1048, R) < 0 && boundsOvershoot(union, 1100, 1048, R) > 0);

// west end cap: hit with normal pointing west, lands at r - radius from the end point
ok('west of capsule end: hit', projectBounds(union, 1150, 1047, R, out));
ok('west cap normal ~(-1,0), x = 1240 - 39.6', Math.abs(out.nx + 1) < 1e-9 && Math.abs(out.x - (1240 - 39.6)) < 1e-9, JSON.stringify(out));
// side wall of capsule: normal on the segment normal, north of the corridor
ok('north of corridor: hit, normal ~(0,-1)', projectBounds(union, 1300, 1000, R, out) && out.ny < -0.99);
// outside corner lands inside the union
let inside = true;
for (let i = 0; i < 2000; i++) {
  const x = 1100 + rnd() * 600, y = 900 + rnd() * 250;
  if (projectBounds(union, x, y, R, out) && boundsOvershoot(union, out.x, out.y, R) > 1e-6) inside = false;
}
ok('outside points always land inside the union', inside);
projectBounds(union, 1300, 1000, R, out);
ok('projected point re-projects to no hit (within eps)', !projectBounds(union, out.x, out.y, R, o2) || boundsOvershoot(union, out.x, out.y, R) < 1e-6);

// velocity clip on the part normal (same rule integrate uses)
projectBounds(union, 1300, 1000, R, out);
let vx = 3, vy = -4; const vn = vx * out.nx + vy * out.ny; if (vn > 0) { vx -= vn * out.nx; vy -= vn * out.ny; }
ok('velocity clipped: no outward component, tangent kept', Math.abs(vx * out.nx + vy * out.ny) < 1e-9 && Math.abs(vx) > 2.9);

// 0 alloc over 10k steps
// The loop lives in a function that is warmed up first: unoptimised top-level code boxes every double temp
// (that was the old ~360 KB 'growth', constant for 10k and 100k calls; bounds.js itself allocates nothing).
function run(k) { let hits = 0; for (let i = 0; i < k; i++) if (projectBounds(union, 1100 + (i % 600), 1000 + (i % 80), R, out)) hits++; return hits; }
for (let w = 0; w < 5; w++) run(10000);
globalThis.gc && globalThis.gc();
const h0 = process.memoryUsage().heapUsed;
const n = run(10000);
globalThis.gc && globalThis.gc();   // retained growth (a leak) survives gc; JIT/young-gen noise does not
const dh = process.memoryUsage().heapUsed - h0;
ok('10k steps: heap growth < 64 KB', dh < 65536, `${dh} B, hits ${n}`);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
console.log('ALL PASS');
