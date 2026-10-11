// engine/physics/boundsPolygon.test.js (MAP-11, arch 38.43): polygon walk bounds - inside/outside, push-back, concave notch,
// bucket edges, sprint-speed walk (no tunnelling, no stuck corners), 0 alloc. Run: node engine/physics/boundsPolygon.test.js
import { projectBounds, boundsOvershoot, validatePolygon, compilePolygon } from './bounds.js';
import { makeOk } from '../test/assert.js';
import { spawnSync } from 'node:child_process';

if (typeof globalThis.gc !== 'function' && !process.env.BPOLY_GC) {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, BPOLY_GC: '1' } });
  process.exit(r.status ?? 1);
}
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));
const out = { x: 0, y: 0, nx: 0, ny: 0 };
const R = 0.4;
// L-shaped (concave) polygon, both windings; 400 x 300 so several 64 m buckets
const L = [[0, 0], [400, 0], [400, 100], [150, 100], [150, 300], [0, 300]];
const mk = (pts) => ({ shape: 'polygon', pts });
const B = mk(L), Brev = mk(L.slice().reverse());
// brute-force oracle: inside by ray cast, distance to all edges
function oracle(pts, x, y) {
  let c = false, d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c;
    const sx = b[0] - a[0], sy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (y - a[1]) * sy) / (sx * sx + sy * sy)));
    d = Math.min(d, Math.hypot(x - a[0] - sx * t, y - a[1] - sy * t));
  }
  return { inside: c, d };
}
const lcg = (s) => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

// 1. inside / outside table
ok('inside deep: no hit', !projectBounds(B, 50, 50, R, out) && boundsOvershoot(B, 50, 50, R) < 0);
ok('outside: hit', projectBounds(B, -10, 50, R, out) && boundsOvershoot(B, -10, 50, R) > 0);
ok('concave notch (300, 200) is outside', projectBounds(B, 300, 200, R, out));
ok('far outside the grid', projectBounds(B, 5000, 5000, R, out));
ok('winding independent', projectBounds(Brev, 300, 200, R, out) && !projectBounds(Brev, 50, 50, R, out));

// 2. push-back: result is R inside the edge, normal outward
projectBounds(B, -10, 50, R, out);
ok('west edge: x = +R, normal (-1,0)', Math.abs(out.x - R) < 1e-9 && Math.abs(out.y - 50) < 1e-9 && out.nx === -1 && out.ny === 0, JSON.stringify(out));
ok('inside by more than R: no hit', !projectBounds(B, 50, 2, R, out));
ok('inside by < R: pushed in', projectBounds(B, 50, 0.1, R, out) && Math.abs(out.y - R) < 1e-9 && out.ny === -1);
ok('exactly on an edge: pushed R inward (east arm lies at y < 100)', projectBounds(B, 200, 100, R, out) && Math.abs(out.ny - 1) < 1e-9 && Math.abs(out.y - (100 - R)) < 1e-9, JSON.stringify(out));
{
  let bad = 0, wrong = 0; const rnd = lcg(7);
  for (let i = 0; i < 20000; i++) {
    const x = -80 + rnd() * 560, y = -80 + rnd() * 460, o = oracle(L, x, y);
    const hit = projectBounds(B, x, y, R, out);
    if (hit !== (!o.inside || o.d < R)) wrong++;
    if (hit) { const o2 = oracle(L, out.x, out.y); if (!o2.inside || o2.d < R - 1e-6) bad++; }
  }
  ok('20k random points: hit flag matches the brute-force oracle', wrong === 0, 'wrong ' + wrong);
  ok('20k random points: projected point is inside by >= R', bad === 0, 'bad ' + bad);
}

// 3. validation
const throws = (pts) => { try { validatePolygon(pts); return false; } catch { return true; } };
ok('validate: ok polygon', !throws(L));
ok('validate: <3, >128, NaN, repeat', throws([[0, 0], [1, 1]]) && throws(Array.from({ length: 129 }, (_, i) => [i, i * i])) && throws([[0, 0], [NaN, 1], [2, 2]]) && throws([[0, 0], [0, 0], [5, 5]]));
ok('validate: self-intersecting bow-tie', throws([[0, 0], [100, 100], [100, 0], [0, 100]]));

// 4. sprint-speed walks at the edge: no tunnelling, no stuck corners
function walk(b, x, y, vx, vy, steps, speed) {
  const dt = 1 / 60; let escaped = 0;
  for (let i = 0; i < steps; i++) {
    x += vx * speed * dt; y += vy * speed * dt;
    if (projectBounds(b, x, y, R, out)) { x = out.x; y = out.y; }
    if (!(boundsOvershoot(b, x, y, R) <= 1e-6)) escaped++;
  }
  return { x, y, escaped };
}
{
  let esc = 0; const rnd = lcg(99);
  for (let k = 0; k < 300; k++) {
    const a = rnd() * 6.283, w = walk(B, 50 + rnd() * 80, 50 + rnd() * 40, Math.cos(a), Math.sin(a), 1500, 14);
    esc += w.escaped;
  }
  ok('300 random 14 m/s walks x 1500 steps never leave the polygon', esc === 0, 'escaped steps ' + esc);
  const w = walk(B, 10, 150, -0.707, 0.707, 120, 10);
  ok('45 deg into the west wall slides along it', w.escaped === 0 && Math.abs(w.x - R) < 1e-6 && w.y > 155, JSON.stringify(w));
  const c = walk(B, 300, 50, -0.6, 0.8, 600, 8);
  ok('into the concave notch corner: ends inside, not tunnelled', c.escaped === 0 && oracle(L, c.x, c.y).inside, JSON.stringify(c));
  const t = walk(B, 200, 50, 0, -1, 400, 14);
  ok('north edge head-on', t.escaped === 0 && Math.abs(t.y - R) < 1e-6);
  // stuck-corner check: heading into the reflex vertex (150,100) from the east arm along the diagonal keeps moving or settles on the edge, never NaN
  const d = walk(B, 250, 60, -1, 0.4, 900, 6);
  ok('reflex vertex: finite result', Number.isFinite(d.x) && Number.isFinite(d.y) && d.escaped === 0, JSON.stringify(d));
}

// 5. bucket boundaries: points on 64 m bucket lines agree with the oracle
{
  let wrong = 0;
  for (const x of [0, 64, 128, 192, 256, 320, 384]) for (const y of [0, 64, 128, 192, 256]) for (const d of [-1e-9, 0, 1e-9, 0.37]) for (const q of [[x + d, y], [x, y + d]]) {
    const o = oracle(L, q[0], q[1]), hit = projectBounds(B, q[0], q[1], R, out);
    if (o.d > 1e-7 && hit !== (!o.inside || o.d < R)) wrong++;
  }
  ok('bucket-line points match the oracle', wrong === 0, 'wrong ' + wrong);
}

// 6. map-sized polygon (120 verts, ~2 km) + 7. 0 alloc
{
  const pts = []; for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2, r = 900 + 120 * Math.sin(a * 5); pts.push([1000 + r * Math.cos(a), 1000 + r * Math.sin(a)]); }
  validatePolygon(pts);
  const big = mk(pts); compilePolygon(big);
  let wrong = 0; const rnd = lcg(5);
  for (let i = 0; i < 20000; i++) {
    const x = -200 + rnd() * 2400, y = -200 + rnd() * 2400, o = oracle(pts, x, y);
    if (o.d > 1e-7 && projectBounds(big, x, y, R, out) !== (!o.inside || o.d < R)) wrong++;
  }
  ok('120-vertex 2 km polygon: 20k points match the oracle', wrong === 0, 'wrong ' + wrong);
  const o = { x: 0, y: 0, nx: 0, ny: 0 }; let s = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { projectBounds(big, 100 + (i % 1800), 100 + ((i * 7) % 1800), R, o); s += boundsOvershoot(big, 5 + (i % 1500), 5 + ((i * 3) % 1500), R); } };
  run(20000); gc(); const h0 = process.memoryUsage().heapUsed;
  const t0 = performance.now(); run(400000); const us = (performance.now() - t0) / 400000 * 1000;
  gc(); const dh = process.memoryUsage().heapUsed - h0;
  ok('bucket lookup: 400k project+overshoot calls allocate ~0 (< 256 KB)', dh < 262144, 'dh ' + dh);
  ok('per-step cost well under 0.02 ms', us < 20, us.toFixed(2) + ' us');
  console.log('  ' + us.toFixed(2) + ' us per project+overshoot pair, heap +' + dh + ' B, s=' + (s > 0));
}
console.log(`boundsPolygon: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
