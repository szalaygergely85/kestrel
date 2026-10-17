// ENV-02d part 3 (38.63 budget): JS twin cost of the ground look path = shadeTerrainCells with look on minus off, p50/p95 (Node only).
// Run: node engine/render/groundLook.bench.mjs [cols=480] [rows=180] [runs=40]   Budget reference: GPU <= 0.15 ms iGPU / 0.03 ms RTX (browser: see docs/lanes/pc-b2.md); the twin has no budget, it is a regression number.
import { shadeTerrainCells } from './terrainShade.js';
import { makeTerrain, makeFb, WORLD, MAP_M } from './groundLookFixture.js';

const cols = Number(process.argv[2] || 480), rows = Number(process.argv[3] || 180), runs = Number(process.argv[4] || 40);
let s = 7; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const pts = new Float64Array(cols * rows * 3);
for (let i = 0; i < cols * rows; i++) { pts[i * 3] = 150 + rnd() * 250; pts[i * 3 + 1] = rnd() * MAP_M; pts[i * 3 + 2] = 3 + rnd() * 140; } // x spans the biome blend (188..212) and the forest strip (300..340)
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
function bench(withLook) {
  const terrain = makeTerrain(withLook), fb = makeFb(cols, rows, (i) => [pts[i * 3], pts[i * 3 + 1]], (i) => pts[i * 3 + 2]);
  for (let k = 0; k < 5; k++) shadeTerrainCells(fb, terrain, WORLD, k * 0.1, 0);
  const ms = [];
  for (let k = 0; k < runs; k++) { const t0 = performance.now(); shadeTerrainCells(fb, terrain, WORLD, 1 + k * 0.05, 0); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b); return { p50: pct(ms, 0.5), p95: pct(ms, 0.95) };
}
const off = bench(false), on = bench(true), f = (v) => v.toFixed(2);
console.log(`look twin ${cols}x${rows} runs=${runs}: off p50 ${f(off.p50)} p95 ${f(off.p95)} ms | on p50 ${f(on.p50)} p95 ${f(on.p95)} ms | delta p50 ${f(on.p50 - off.p50)} p95 ${f(on.p95 - off.p95)} ms`);
