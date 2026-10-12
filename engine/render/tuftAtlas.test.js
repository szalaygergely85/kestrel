// engine/render/tuftAtlas.test.js - TUFT-01a part 1. Run: node --expose-gc engine/render/tuftAtlas.test.js
import { createHash } from 'node:crypto';
import { buildTuftAtlas, tuftLookup, texelR, texelG, tuftPlaneT } from './tuftAtlas.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const a = buildTuftAtlas(1), b = buildTuftAtlas(1), c = buildTuftAtlas(2);
const sha = (d) => createHash('sha256').update(d).digest('hex');
ok('byte-identical across two builds', Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0);
ok('different seed differs', sha(a.data) !== sha(c.data));
ok('dims 8 x 16 x 24 x 2 bytes', a.n === 8 && a.w === 16 && a.h === 24 && a.data.length === 8 * 16 * 24 * 2);
const PIN = 'eff04632cc06b6e7470a4263a13a4730d248901a4c7088ccfda5be10a5466f24';
ok('pinned sha (seed 1)', sha(a.data) === PIN, sha(a.data));

for (let k = 0; k < a.n; k++) {
  ok(`shape ${k}: 5-9 strokes`, a.strokes[k] >= 5 && a.strokes[k] <= 9, String(a.strokes[k]));
  let cov = 0, baseRow = 0, tipRow = 0;
  for (let r = 0; r < a.h; r++) for (let col = 0; col < a.w; col++) {
    const p = tuftLookup(a, k, (col + 0.5) / a.w, (r + 0.5) / a.h);
    if (texelR(p)) { cov++; if (r === 0) baseRow++; if (r > 14) tipRow++; }
  }
  ok(`shape ${k}: coverage ${cov}, base row ${baseRow}, upper rows ${tipRow}`, cov > 40 && cov < 300 && baseRow >= 3 && tipRow >= 1);
}
{ let mn = 255, mx = 0; for (let i = 0; i < a.data.length; i += 2) if (a.data[i]) { mn = Math.min(mn, a.data[i]); mx = Math.max(mx, a.data[i]); }
  ok('r range in 1..254', mn >= 1 && mx <= 254 && mx > 200, mn + '..' + mx); }

// plane solve vs bisection on 10000 pseudo-random rays (deterministic LCG)
{
  let s = 12345; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let worst = 0, n = 0, nanMiss = 0, bad = 0;
  for (let i = 0; i < 10000; i++) {
    const ex = rnd() * 4 - 2, ey = rnd() * 4 - 2, ez = rnd() * 3, gz = rnd();
    let dx = rnd() * 2 - 1, dy = rnd() * 2 - 1, dz = rnd() * 2 - 1; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const rx = rnd() * 2 - 1, ry = rnd() * 2 - 1, lx = rnd() * 1.2 - 0.6, ly = rnd() * 1.2 - 0.6, an = rnd() * Math.PI, nx = Math.cos(an), ny = Math.sin(an);
    const f = (t) => nx * (ex + t * dx - rx - lx * (ez + t * dz - gz)) + ny * (ey + t * dy - ry - ly * (ez + t * dz - gz));
    const t = tuftPlaneT(ex, ey, ez, dx, dy, dz, rx, ry, gz, lx, ly, nx, ny);
    let lo = -100, hi = 100; const flo = f(lo);
    if (flo * f(hi) > 0) { if (!(Number.isNaN(t) || t < -100 || t > 100)) bad++; continue; }
    for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2; if (f(m) * flo > 0) lo = m; else hi = m; }
    if (Number.isNaN(t)) { nanMiss++; continue; }
    n++; worst = Math.max(worst, Math.abs(t - (lo + hi) / 2));
  }
  ok(`plane solve == bisection (${n} rays, worst ${worst.toExponential(2)}, parallel ${nanMiss}, unbracketed-bad ${bad})`, n > 9000 && worst < 1e-9 && bad === 0);
}

// 0 alloc in lookup/solve (locals only inside run; min heap delta of 5 runs)
{
  const run = () => { let acc = 0; for (let i = 0; i < 1e6; i++) { const p = tuftLookup(a, i & 7, (i & 15) / 16, (i % 24) / 24); acc += texelR(p) + texelG(p) + tuftPlaneT(0.1, 0.2, 1, 0.3, 0.4, -0.5, 0, 0, 0, 0.1, 0.1, 0.6, 0.8); } return acc; };
  let sink = run();
  if (global.gc) {
    let best = Infinity;
    for (let r = 0; r < 5; r++) { global.gc(); const h0 = process.memoryUsage().heapUsed; sink += run(); best = Math.min(best, process.memoryUsage().heapUsed - h0); }
    ok(`0 alloc (< 2 B/call, min heap delta ${best} B / 1e6 calls)`, best < 2e6, String(best));
  } else ok('0 alloc (gc not exposed: byte probe skipped)', Number.isFinite(sink));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
