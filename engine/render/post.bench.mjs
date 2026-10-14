// POST-STACK-01a-perf: postCells p50/p95 (ms) with everything on (mist + composed grade + vignette). Run: node engine/render/post.bench.mjs
// Budget (docs/architecture.md 38.73): <= 0.8 ms p50 at 480x180. Uses bare CellBuffers (no DOM).
import { CellBuffer } from './CellBuffer.js';
import { createAtmosState, mixAtmos } from './atmos.js';
import { createPostState, composePost, postCells } from './post.js';
const rec = (l, g, ga, s) => ({ fog: Float32Array.of(150, 190, 160), fogDensity: 0.004, haze: Float32Array.of(200, 220, 190), hazeAmount: 0.5, lift: Float32Array.from(l), gamma: Float32Array.from(g), gain: Float32Array.from(ga), sat: s });
const r = rec([0.02, 0.01, 0.03], [1.05, 1, 0.95], [1.05, 1.02, 0.95], 1.1);
const atm = createAtmosState();
mixAtmos({ n: 1, recs: [r, r, r] }, { w: Float32Array.of(1), wNone: 0, tod: Float32Array.of(1, 0, 0), version: 1 }, { start: 10, full: 100, curve: 1, near: [100, 100, 100], far: [150, 150, 150] }, atm);
const cfg = { grade: { lift: [0.01, 0.02, 0], gamma: [1.1, 1, 0.9], gain: [0.9, 1, 1.1], sat: 0.8 }, vignette: { k: 0.4, r0: 0.4, r1: 0.95, rgb: [0, 0, 0] }, mist: { rgb: [0.6, 0.65, 0.75], density: 0.02, start: 4, heightK: 0 } };
for (const [cols, rows, kind] of [[480, 180, 'noise'], [240, 90, 'noise'], [480, 180, 'scene'], [240, 90, 'scene']]) {
  const cb = new CellBuffer(cols, rows), depth = new Float32Array(cols * rows);
  // noise = worst case (every cell distinct); scene = sky-like banded gradient rows with 1/8 detail cells (typical ASCII frame)
  const seed = () => { for (let i = 0; i < cb.fg.length; i++) { const c = i >> 2, y = (c / cols) | 0, d = kind === 'scene' && c % 8 !== 0; cb.fg[i] = d ? (y * 3 + (i & 3)) & 255 : (i * 31) & 255; cb.bg[i] = d ? (y * 2 + (i & 3) * 5) & 255 : (i * 17) & 255; } };
  for (let i = 0; i < depth.length; i++) depth[i] = kind === 'scene' && i % 8 !== 0 ? 4 + ((i / cols) | 0) : (i * 7919) % 120;
  const ps = composePost(atm, cfg, createPostState()), t = [];
  for (let i = 0; i < 400; i++) { seed(); const t0 = performance.now(); postCells(cb, depth, ps); if (i >= 100) t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  console.log(`post ${cols}x${rows} ${kind}: p50 ${t[t.length >> 1].toFixed(3)} ms  p95 ${t[Math.floor(t.length * 0.95)].toFixed(3)} ms`);
}
