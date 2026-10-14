// GI-PROBE-04 perf (38.72 section 5: JS twin <= 2 ms extra at 240x90). p50/p95 of lightSurfaces and shadeTerrainCells, GI off vs on (Node only).
// Run: node --expose-gc engine/render/gi.bench.mjs [runs=40]   (gc only needed for the alloc line)
import { lightSurfaces } from './lighting.js';
import { shadeTerrainCells } from './terrainShade.js';
import { makeGI, mkLS, makeFb, POSES } from './giFixture.js';
import { makeTerrain, makeFb as makeTerFb, WORLD, MAP_M } from './groundLookFixture.js';
// engine/ may not import tools/: minimal copy of the allocProbe recipe (warm, gc, heap delta, min of windows)
function allocProbe(run, o) { const gc = globalThis.gc; if (typeof gc !== 'function') return { skipped: true }; for (let w = 0; w < o.warm; w++) run(o.n);
  let best = Infinity; for (let w = 0; w < o.windows; w++) { gc(); gc(); const h0 = process.memoryUsage().heapUsed; run(o.n); best = Math.min(best, process.memoryUsage().heapUsed - h0); } return { skipped: false, bytes: best }; }
const runs = Number(process.argv[2] || 40), gi = makeGI(), f = (v) => v.toFixed(2);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const stat = (fn) => { for (let k = 0; k < 6; k++) fn(k); const ms = []; for (let k = 0; k < runs; k++) { const t0 = performance.now(); fn(k); ms.push(performance.now() - t0); } ms.sort((a, b) => a - b); return { p50: pct(ms, 0.5), p95: pct(ms, 0.95) }; };
const out = {};
for (const [cols, rows] of [[240, 90], [480, 180]]) {
  const fb = makeFb(cols, rows), ls = mkLS();
  const lit = (on) => { ls.gi = on ? gi : null; return stat((k) => lightSurfaces(fb, ls, POSES[k % 3], null)); };
  const a = lit(false), b = lit(true);
  console.log(`lightSurfaces ${cols}x${rows}: off p50 ${f(a.p50)} p95 ${f(a.p95)} | on p50 ${f(b.p50)} p95 ${f(b.p95)} | delta p50 ${f(b.p50 - a.p50)} p95 ${f(b.p95 - a.p95)} ms`);
  out[`light${cols}`] = b.p50 - a.p50;
  // terrain: u,v spread over the GI field rect (64 m), camera-like scan so neighbouring cells are near each other
  const terrain = makeTerrain(false), tfb = makeTerFb(cols, rows, (i) => [(i % cols) / cols * 64, Math.floor(i / cols) / rows * 64], () => 20);
  const ter = (on) => { tfb.lights = on ? { gi } : null; return stat((k) => shadeTerrainCells(tfb, terrain, WORLD, k * 0.05, 0)); };
  const c = ter(false), d = ter(true);
  console.log(`shadeTerrainCells ${cols}x${rows}: off p50 ${f(c.p50)} p95 ${f(c.p95)} | on p50 ${f(d.p50)} p95 ${f(d.p95)} | delta p50 ${f(d.p50 - c.p50)} p95 ${f(d.p95 - c.p95)} ms`);
  out[`terrain${cols}`] = d.p50 - c.p50;
  if (cols === 480) {
    ls.gi = gi; tfb.lights = { gi };
    const ra = allocProbe((n) => { for (let i = 0; i < n; i++) lightSurfaces(fb, ls, POSES[i % 3], null); }, { n: 20, warm: 4, windows: 6 });
    const rb = allocProbe((n) => { for (let i = 0; i < n; i++) shadeTerrainCells(tfb, terrain, WORLD, i, 0); }, { n: 20, warm: 4, windows: 6 });
    console.log(`alloc gi on 480x180: lightSurfaces ${ra.skipped ? 'SKIP' : ra.bytes + ' B'}/20 frames, shadeTerrainCells ${rb.skipped ? 'SKIP' : rb.bytes + ' B'}/20 frames`);
    out.allocL = ra.bytes; out.allocT = rb.bytes;
  }
}
if (process.argv.includes('--check')) process.exit(out.light240 <= 2 && out.terrain240 <= 2 ? 0 : 1);
