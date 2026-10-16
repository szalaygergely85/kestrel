// AA-DIAG-01: synthetic two-frame fixture for flickerGlyphReasons (mixed255, levelJump, edge, uvDrift each counted once).
import { flickerGlyphReasons, GLYPH_REASONS } from './flicker.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };

const cols = 5, rows = 1, N = cols * rows, KIND = 1, MAT = 5;
const f = new Float32Array(1), u = new Uint32Array(f.buffer);
const bits = (x) => { f[0] = x; return u[0]; };
function frame() {
  return { GI: new Uint32Array(4 * N), GA: new Uint32Array(4 * N), Depth: new Uint32Array(N), level: new Uint8Array(N), preFg: new Uint8Array(4 * N),
    shadeFg: new Uint8Array(4 * N), shadeBg: new Uint8Array(4 * N), finalBg: new Uint8Array(4 * N), outFg: new Uint8Array(4 * N), hist: new Uint32Array(4 * N) };
}
const p = frame(), d = frame(), hmap = new Int32Array(N);
for (let i = 0; i < N; i++) {
  hmap[i] = i; d.GI[i * 4] = p.GI[i * 4] = 100 + i; d.GI[i * 4 + 1] = p.GI[i * 4 + 1] = (MAT << 16) | KIND;
  d.Depth[i] = bits(5); p.hist[i * 4] = d.GI[i * 4]; p.hist[i * 4 + 3] = (MAT << 16) | (KIND << 8) | 4; // history level 4
  p.outFg[i * 4 + 3] = 10; d.preFg[i * 4 + 3] = d.outFg[i * 4 + 3] = d.shadeFg[i * 4 + 3] = 11; // glyph 10 -> 11 everywhere
  d.level[i] = 4; // same level, no drift -> replayHold unless a case below changes it
}
d.level[0] = 255; // mixed255: none vs ramp, no joint coverage
d.level[1] = 12;  // levelJump: |12-4| = 8
d.shadeFg[2 * 4] = 99; // edge: stable input differs from shade output
const du = 1000; d.GA[4 * 3] = bits(du); // uvDrift: way above the footprint limit
// cell 4 stays a plain replayHold (control)
const cnt = { kinds: {}, sub: {} };
flickerGlyphReasons(d, p, hmap, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, cnt);
check('n counts every mapped cell', cnt.n === 5);
check('flips counts every glyph change', cnt.flips === 5);
for (const r of ['mixed255', 'levelJump', 'edge', 'uvDrift', 'replayHold']) check(r + ' counted once', cnt[r] === 1);
check('no other reason fired', GLYPH_REASONS.every((r) => ['mixed255', 'levelJump', 'edge', 'uvDrift', 'replayHold'].includes(r) || !cnt[r]));
check('kind histogram', cnt.kinds[KIND] === 5);
check('a cell with an unchanged glyph is not a flip', (() => { const c = { kinds: {}, sub: {} }; d.outFg[3] = 0; d.outFg[7] = 0; p.outFg[3] = 0; p.outFg[7] = 0; hmap.fill(-1); hmap[0] = 0; hmap[1] = 1; flickerGlyphReasons(d, p, hmap, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, c); return c.n === 2 && c.flips === 0; })());

console.log(`[flickerReasons.test.js] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
