// FD-01: synthetic 8x4 frames for flickerDefaultReasons - one cell per class -> exact counts; excluded cells; 0 alloc.
import { flickerDefaultReasons, DEFAULT_REASONS } from './flicker.js';
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };
const cols = 8, rows = 4, N = cols * rows, KIND = 1, MAT = 5;
const f = new Float32Array(1), u = new Uint32Array(f.buffer);
const bits = (x) => { f[0] = x; return u[0]; };
const frame = () => ({ GI: new Uint32Array(4 * N), Depth: new Uint32Array(N), level: new Uint8Array(N), preFg: new Uint8Array(4 * N), shadeFg: new Uint8Array(4 * N), Light: new Uint32Array(4 * N) });
const p = frame(), d = frame(), hmap = new Int32Array(N);
for (let i = 0; i < N; i++) {
  hmap[i] = -1; // only the cells set below are counted
  d.GI[i * 4 + 1] = p.GI[i * 4 + 1] = (MAT << 16) | KIND;
  p.preFg[i * 4 + 3] = p.shadeFg[i * 4 + 3] = 40; d.preFg[i * 4 + 3] = d.shadeFg[i * 4 + 3] = 41; // plain ramp glyph change 40 -> 41
  d.level[i] = p.level[i] = 5;
  for (let k = 0; k < 3; k++) d.Light[i * 4 + k] = p.Light[i * 4 + k] = bits(1);
}
const LINE = 45 - 32, LINE2 = 124 - 32; // '-' and '|'
const set = (i, h = i) => { hmap[i] = h; };
// row 0: cells 0..7 (spaced so no accidental line neighbours: lines only at the cell itself)
set(0); d.shadeFg[0 * 4 + 3] = 99; // edge
set(2); d.preFg[2 * 4 + 3] = d.shadeFg[2 * 4 + 3] = LINE; p.preFg[2 * 4 + 3] = 40; // linePop: line vs ramp, no neighbour carries the other glyph
set(4); d.preFg[4 * 4 + 3] = d.shadeFg[4 * 4 + 3] = LINE; p.preFg[4 * 4 + 3] = p.shadeFg[4 * 4 + 3] = LINE2; // lineCode: line on both sides, other code
set(6); d.level[6] = 255; d.preFg[6 * 4 + 3] = 0; d.shadeFg[6 * 4 + 3] = 0; // m255:blank
// row 1: cells 8..15
set(8); d.preFg[8 * 4 + 3] = d.shadeFg[8 * 4 + 3] = LINE; p.preFg[8 * 4 + 3] = p.shadeFg[8 * 4 + 3] = 40; // lineShift: cur line glyph sits next to h in prev,
p.preFg[9 * 4 + 3] = p.shadeFg[9 * 4 + 3] = LINE; d.preFg[9 * 4 + 3] = d.shadeFg[9 * 4 + 3] = 40; // ... and prev glyph (40) sits next to i in cur (cell 9 is not counted)
set(10); // altSwap: same level, other glyph (defaults)
set(12); d.level[12] = 7; d.Light[12 * 4] = bits(1.2); // levelLight (dL 17 %, step 2 -> jump)
set(14); d.level[14] = 6; // levelTex (light equal, step 1)
// row 2: cells 16..23
set(16); d.level[16] = 9; // levelTex/jump (light equal, step 4)
set(18); d.GI[18 * 4 + 1] = (MAT << 16) | 2; // kind change: not counted as a flip
set(20); d.GI[20 * 4 + 1] = (MAT + 1) << 16 | KIND; // mat change: not counted
set(22); d.preFg[22 * 4 + 3] = p.preFg[22 * 4 + 3] = 40; // same glyph: no flip
// cell 24: hmap -1 (left unset) even though its glyph changed
const run = () => { const c = { kinds: {}, sub: {} }; flickerDefaultReasons(d, p, hmap, cols, rows, null, c); return c; };
const c = run(); 
check("n = mapped cells (12)", c.n === 12);
check('flips = 9 (kind/mat/same-glyph/unmapped excluded)', c.flips === 9);
const want = { edge: 1, linePop: 1, lineCode: 1, 'm255:blank': 1, lineShift: 1, altSwap: 1, levelLight: 1, 'levelLight/jump': 1, levelTex: 2, 'levelTex/jump': 1 };
for (const r of DEFAULT_REASONS) check(r + ' count', (c[r] || 0) === (want[r] || 0));
check('kinds tally', c.kinds[KIND] === 9);
// heap guard: 1000 calls on a warm cnt allocate nothing measurable
const cnt = { kinds: {}, sub: {} }; for (let k = 0; k < 3000; k++) flickerDefaultReasons(d, p, hmap, cols, rows, null, cnt);
if (global.gc) global.gc();
const h0 = process.memoryUsage().heapUsed;
for (let k = 0; k < 1000; k++) flickerDefaultReasons(d, p, hmap, cols, rows, null, cnt);
const grew = process.memoryUsage().heapUsed - h0;
check('1000 calls allocate ~0 (heap grew ' + grew + ' B)', grew < 200000);
console.log(`flickerDefault.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
