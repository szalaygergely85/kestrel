// AA-DIAG-01: synthetic two-frame fixture for flickerGlyphReasons (mixed255, levelJump, edge, uvDrift each counted once).
import { flickerGlyphReasons, GLYPH_REASONS, glyphClassTable } from './flicker.js';

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
d.Depth[3] = bits(50); // ... and the right neighbour is far deeper on another plane (edge trigger)
const du = 1000; d.GA[4 * 3] = bits(du); // uvDrift: way above the footprint limit
// cell 4 stays a plain replayHold (control)
const cnt = { kinds: {}, sub: {} };
flickerGlyphReasons(d, p, hmap, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, cnt);
check('n counts every mapped cell', cnt.n === 5);
check('flips counts every glyph change', cnt.flips === 5);
for (const r of ['mixed255', 'levelJump', 'edge', 'uvDrift', 'replayHold']) check(r + ' counted once', cnt[r] === 1);
check('no other reason fired', GLYPH_REASONS.every((r) => ['mixed255', 'levelJump', 'edge', 'uvDrift', 'replayHold'].includes(r) || !cnt[r]));
// AA-DIAG-EDGE: a same-plane, equal-depth cell (ceiling) whose preFg differs from shadeFg has no edge trigger -> falls through to its real reason, edgeNoTrig counted.
{
  const c = { kinds: {}, sub: {} }; d.shadeFg[4 * 4] = 77; d.GI[4 * 4] = d.GI[3 * 4]; // cell 4 = same plane as neighbour 3, same depth
  flickerGlyphReasons(d, p, hmap, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, c);
  check('no-trigger cell is not edge (only cell 2 stays edge)', c.edge === 1);
  check('edgeNoTrig counted for the ceiling cell', c.sub['edgeNoTrig:' + KIND] >= 1);
  check('ceiling cell fell through to a real reason (plane here)', c.plane === 1);
  d.shadeFg[4 * 4] = 0;
}
check('kind histogram', cnt.kinds[KIND] === 5);
check('a cell with an unchanged glyph is not a flip', (() => { const c = { kinds: {}, sub: {} }; d.outFg[3] = 0; d.outFg[7] = 0; p.outFg[3] = 0; p.outFg[7] = 0; hmap.fill(-1); hmap[0] = 0; hmap[1] = 1; flickerGlyphReasons(d, p, hmap, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, c); return c.n === 2 && c.flips === 0; })());

// AA-14a (38.84): mixed255 split + lineShift + octPop. 6x1 strip, every cell the same surface, glyph 10 (ramp, level 4) in both frames unless a case edits it.
{
  const C = 6, R = 1, M = C * R, PIPE = 124 - 32, STIP = 50;
  const gcls = glyphClassTable([STIP]);
  const mk = () => { const q = { GI: new Uint32Array(4 * M), GA: new Uint32Array(4 * M), Depth: new Uint32Array(M), level: new Uint8Array(M), preFg: new Uint8Array(4 * M), shadeFg: new Uint8Array(4 * M),
    shadeBg: new Uint8Array(4 * M), finalBg: new Uint8Array(4 * M), outFg: new Uint8Array(4 * M), hist: new Uint32Array(4 * M) }; return q; };
  const setup = () => {
    const P = mk(), D = mk(), hm = new Int32Array(M);
    for (let i = 0; i < M; i++) { hm[i] = i; D.GI[i * 4] = P.GI[i * 4] = 100 + i; D.GI[i * 4 + 1] = P.GI[i * 4 + 1] = (MAT << 16) | KIND; D.Depth[i] = bits(5);
      P.hist[i * 4] = D.GI[i * 4]; P.hist[i * 4 + 3] = (MAT << 16) | (KIND << 8) | 4; P.outFg[i * 4 + 3] = D.outFg[i * 4 + 3] = D.preFg[i * 4 + 3] = D.shadeFg[i * 4 + 3] = 10; D.level[i] = 4; }
    return { P, D, hm };
  };
  const curG = (D, i, g) => { D.level[i] = 255; D.outFg[i * 4 + 3] = D.preFg[i * 4 + 3] = D.shadeFg[i * 4 + 3] = g; }; // cur: 255-side glyph g
  const prevG = (P, i, g) => { P.hist[i * 4 + 3] = (MAT << 16) | (KIND << 8) | 255; P.outFg[i * 4 + 3] = g; }; // prev: 255-side glyph g
  const run = (s, extra = {}) => { const c = { kinds: {}, sub: {} }; flickerGlyphReasons(s.D, s.P, s.hm, C, R, { tanHalfX: 1, tanHalfY: 1, ortho: 0, gcls, ...extra }, c); return c; };

  { // a 1-cell line moved one cell right: new row (cur line at 3, prev ramp) + old row (prev line at 2, cur ramp) = 2 x m255:line, both lineShift
    const s = setup(); curG(s.D, 3, PIPE); prevG(s.P, 2, PIPE);
    const c = run(s);
    check('shifted line: mixed255 x2', c.mixed255 === 2); check('shifted line: m255:line x2', c['m255:line'] === 2); check('shifted line: lineShift x2', c.lineShift === 2);
  }
  { // vertical neighbour (2D strip): not testable in a 1-row strip; the opposite direction (line moved left) is
    const s = setup(); curG(s.D, 2, PIPE); prevG(s.P, 3, PIPE);
    check('line moved left: lineShift x2', run(s).lineShift === 2);
  }
  { // a line that appears with no neighbour source: m255:line, NOT a shift
    const s = setup(); curG(s.D, 3, PIPE);
    const c = run(s);
    check('isolated pop: m255:line', c['m255:line'] === 1 && c.mixed255 === 1); check('isolated pop: no lineShift', !c.lineShift);
  }
  { // a line vanishing without a neighbour taking over
    const s = setup(); prevG(s.P, 3, PIPE);
    const c = run(s);
    check('isolated vanish: m255:line, no shift', c['m255:line'] === 1 && !c.lineShift);
  }
  { // a different line code next door on the cur side does not count for the ramp-side test (same code required)
    const s = setup(); prevG(s.P, 2, PIPE); curG(s.D, 3, 13); // cur '-' at 3 (code 13), prev '|' at 2
    check('other code next door: old row is not a shift', run(s).lineShift === 1); // new row (cur '-' vs prev line at neighbour) shifts; old row ('|' gone, cur 3 is '-') does not
  }
  { // fog stipple on the 255 side
    const s = setup(); curG(s.D, 1, STIP);
    const c = run(s); check('stipple: m255:stip', c['m255:stip'] === 1 && !c['m255:line'] && !c.lineShift);
  }
  { // blank and other
    const s = setup(); curG(s.D, 1, 0); curG(s.D, 4, 77);
    const c = run(s); check('blank: m255:blank', c['m255:blank'] === 1); check('other glyph: m255:other', c['m255:other'] === 1); check('split sums to mixed255', c['m255:blank'] + c['m255:other'] === c.mixed255);
  }
  { // octPop: octave of cell 1 differs between the frames, cell 2 does not
    const s = setup(); s.D.outFg[1 * 4 + 3] = s.D.preFg[1 * 4 + 3] = s.D.shadeFg[1 * 4 + 3] = 11; s.D.outFg[2 * 4 + 3] = s.D.preFg[2 * 4 + 3] = s.D.shadeFg[2 * 4 + 3] = 11;
    const c = run(s, { octave: (fr, i) => (fr === s.D && i === 1 ? 2 : 1) });
    check('octPop counted once', c.octPop === 1);
    check('no octave hook = no octPop', !run(s).octPop);
  }
}

// AA-32b: seamShift = uvDrift sub-count; cell 2 has another plane in history, but history cell 1 holds its plane at a matching uv (seam moved with the image).
{
  const run = (nbPlane) => {
    const P = frame(), D = frame(), hm = new Int32Array(N), KIND = 9; // KIND_MESH (plane change is not a 'plane' reason there)
    for (let i = 0; i < N; i++) {
      hm[i] = i; D.GI[i * 4] = P.hist[i * 4] = 100 + i; D.GI[i * 4 + 1] = P.GI[i * 4 + 1] = (MAT << 16) | KIND; D.Depth[i] = bits(5); P.hist[i * 4 + 3] = (MAT << 16) | (KIND << 8) | 4;
      P.outFg[i * 4 + 3] = 10; D.preFg[i * 4 + 3] = D.outFg[i * 4 + 3] = D.shadeFg[i * 4 + 3] = 11; D.level[i] = 4;
    }
    D.GI[2 * 4] = 200; D.GA[2 * 4] = bits(1000); P.hist[1 * 4] = nbPlane; P.hist[1 * 4 + 1] = bits(1000); // cell 2: cur plane 200 uv 1000, hist plane 100+2, uv 0
    const c = { kinds: {}, sub: {} }; flickerGlyphReasons(D, P, hm, cols, rows, { tanHalfX: 1, tanHalfY: 1, ortho: 0 }, c); return c;
  };
  const a = run(200); check('seam moved: cells stay counted as uvDrift (cells 1 and 2)', a.uvDrift === 2); check('seam moved: seamShift x1', a.seamShift === 1);
  const b = run(300); check('no same-plane neighbour: uvDrift stays', b.uvDrift === 2 && !b.seamShift);
}

console.log(`[flickerReasons.test.js] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
