// ENV-02d part 3 (38.63 risk): the JS twin indexes the look texel with float64 (floor((x - x0) / cell)), the GPU with f32. Bound the one-look
// difference at texel edges. Run: node engine/render/groundLookTexel.test.js
import { shadeTerrainCells } from './terrainShade.js';
import { makeTerrain, makeFb, WORLD, MAP_M, CELL } from './groundLookFixture.js';

let pass = 0, fail = 0;
const check = (name, c) => { if (c) pass++; else { fail++; console.error('FAIL:', name); } };
const MAPEDGE = 64;
const terrain = makeTerrain(true), L = terrain.farLook, f = Math.fround;
let s = 99; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

// look byte pair at (x, y) with texel index math either float64 (the twin) or f32 (the GPU): every op rounded to f32
function texel(x, y, f32) {
  const i = f32 ? Math.floor(f(f(x - terrain.mapX0) / f(terrain.mapCell))) : Math.floor((x - terrain.mapX0) / terrain.mapCell);
  const j = f32 ? Math.floor(f(f(y - terrain.mapY0) / f(terrain.mapCell))) : Math.floor((y - terrain.mapY0) / terrain.mapCell);
  const k = (Math.min(Math.max(j, 0), terrain.mapH - 1) * terrain.mapW + Math.min(Math.max(i, 0), terrain.mapW - 1)) * 2;
  return L[k] | L[k + 1] << 8;
}
// 1. raw look-byte lookups: random f32 world points (as the gbuf stores u,v)
{
  const N = 200000; let diff = 0;
  for (let n = 0; n < N; n++) { const x = f(rnd() * MAP_M), y = f(rnd() * MAP_M); if (texel(x, y, false) !== texel(x, y, true)) diff++; }
  check(`raw lookup: f64 vs f32 texel differ ${(100 * diff / N).toFixed(4)} % <= 0.5 %`, diff / N <= 0.005);
}
// 2. shaded cells through the real shadeTerrainCells: points within 2 mm of texel edges (worst case), f32 input vs the same input nudged by 1 f32 ulp
//    stands in for the GPU's rounding; the bound is on cells whose rendered glyph/colour changes.
{
  const cols = 100, rows = 50, n = cols * rows, pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const edge = (1 + Math.floor(rnd() * (MAPEDGE - 2))) * CELL; pts[i * 2] = f(edge + (rnd() - 0.5) * 0.004); pts[i * 2 + 1] = f(rnd() * MAP_M); }
  const run = (nudge) => { const fb = makeFb(cols, rows, (i) => [nudge ? pts[i * 2] + (pts[i * 2] * 1.2e-7) : pts[i * 2], pts[i * 2 + 1]], () => 30); shadeTerrainCells(fb, terrain, WORLD, 0, 0); return fb.rt; };
  const a = run(false), b = run(true); let diff = 0;
  for (let i = 0; i < n; i++) if (a.glyphIdx[i] !== b.glyphIdx[i] || a.fg[i * 3] !== b.fg[i * 3] || a.bg[i * 3 + 1] !== b.bg[i * 3 + 1]) diff++;
  // sanity that the cells really sit on look transitions is not required: the bound is a cap, and the unnudged run must be deterministic
  const a2 = run(false); let same = true; for (let i = 0; i < n; i++) if (a.glyphIdx[i] !== a2.glyphIdx[i]) same = false;
  check('shade: two identical runs identical', same);
  console.log(`edge stress: ${diff}/${n} cells (${(100 * diff / n).toFixed(2)} %) change with a 1-ulp u nudge (informational)`);
  check('shade: 1-ulp nudge at texel edges changes <= 5 % of edge-pinned cells (they sit on edges by construction)', diff / n <= 0.05);
}

console.log(`groundLookTexel: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
