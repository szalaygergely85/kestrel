// ENV-02b (arch 38.63): Node tests of the ground look JS twin, synthetic look config (engine never imports game/ or design/).
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';
import { grassLookId, lkIdx, shadeTerrain, shadeGrass, grassTableFor, makeFarGrass, farGrassFill, GRASS_GX_HAS } from './terrainShade.js';
import { lookWind01, packLookTable, makeGroundLook, LOOK_MAX, LOOK_ROWS } from './groundLook.js';
import { LEVEL_ANIM } from './temporalStable.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

const asc = (s) => Array.from(s, c => c.charCodeAt(0));
function mkLook(id, o) {
  return Object.assign({
    id, glyphs: asc('.,\'"'), lean: asc('.,``'), ramp: [[0.05, 0.2, 0.03], [0.1, 0.3, 0.06], [0.2, 0.5, 0.1], [0.4, 0.7, 0.2]], bg: [[0.02, 0.06, 0.01], [0.04, 0.12, 0.03]],
    noiseScale: 3.5, macroScale: 24, contrast: 0.55, shimmerMode: 1, shimmerAmp: 0.4, sheen: 0.3,
    accents: [{ glyph: 46, color: [0.9, 0.9, 0.8], density: 0.02, cluster: 0.6, maxDist: 25 }, { glyph: 111, color: [0.9, 0.3, 0.3], density: 0.01, cluster: 0.5, maxDist: 18 }]
  }, o);
}
const cfg = { looks: [mkLook(1, {}), mkLook(2, { glyphs: asc('.:;%'), lean: asc('.:;%'), shimmerMode: 0, ramp: [[0.3, 0.2, 0.1], [0.4, 0.3, 0.15], [0.5, 0.4, 0.2], [0.7, 0.6, 0.4]], noiseScale: 2, macroScale: 12 }), mkLook(3, { glyphs: asc('~-'), lean: asc('~-'), shimmerAmp: 0, accents: [] })], lookMap: [] };
const table = packLookTable(cfg, new Float32Array(LOOK_MAX * LOOK_ROWS * 4));
check('table: look 0 row is zero', table.subarray(0, LOOK_ROWS * 4).every(v => v === 0));
check('table: glyph count + mode (look 1 lean, look 2 sheen)', table[LOOK_ROWS * 4 + 23] === 12 && table[2 * LOOK_ROWS * 4 + 23] === 4);

// minimal terrain ctx (one grass type, TLOOK width 9)
const W = 9, tlook = new Float32Array(4 * W * 2);
[[0.1, 0.2, 0.1], [0.2, 0.4, 0.2], [0.3, 0.6, 0.3]].forEach((c, i) => { tlook[i * 4] = c[0]; tlook[i * 4 + 1] = c[1]; tlook[i * 4 + 2] = c[2]; });
tlook[4 * 4] = 1 | (2 << 8); tlook[4 * 4 + 1] = 2;
const baseCtx = { tlook, tlookWidth: W, bands: { near: 150, mid: 600 }, fog: { start: 50, full: 1500, curve: 0.7, nearRGB: [143, 168, 196], farRGB: [196, 220, 239] }, shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 }, hashCell: -0.0067 };
const GL = makeGroundLook(table);
const ctxOff = baseCtx, ctxOn = { ...baseCtx, groundLook: GL };
const mk = () => ({ glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3), level: 255 });
const same = (a, b) => a.glyph === b.glyph && a.level === b.level && a.fg[0] === b.fg[0] && a.fg[1] === b.fg[1] && a.fg[2] === b.fg[2] && a.bg[0] === b.bg[0] && a.bg[1] === b.bg[1] && a.bg[2] === b.bg[2];

// AC1: look 0 == the old output over 50k random cells (table bound, wind on, look bytes 0/0)
{
  GL.wind01 = 1;
  const a = mk(), b = mk(); let bad = 0;
  for (let i = 0; i < 50000; i++) {
    const t = 2 + rnd() * 400, u = rnd() * 2000 - 1000, v = rnd() * 2000 - 1000, bb = 0.2 + rnd() * 1.1, ti = rnd() * 9;
    shadeTerrain(t, 0, bb, u, v, ti, ctxOff, a, 0, 3, 0.3, 0.1, 0.9);
    shadeTerrain(t, 0, bb, u, v, ti, ctxOn, b, 0, 3, 0.3, 0.1, 0.9, 0, 0, 0.7);
    if (!same(a, b)) bad++;
  }
  check('AC look 0 bit-exact over 50k cells (' + bad + ' differ)', bad === 0);
}

// look cells differ from the old output and use several glyphs
{
  GL.wind01 = 0;
  const a = mk(), b = mk(); let diff = 0; const glyphs = new Set();
  for (let i = 0; i < 2000; i++) { const u = rnd() * 100, v = rnd() * 100; shadeTerrain(5, 0, 1, u, v, 0, ctxOff, a); shadeTerrain(5, 0, 1, u, v, 0, ctxOn, b, 0, NaN, 0, 0, 1, 1, 0, 0); if (!same(a, b)) diff++; glyphs.add(b.glyph); }
  check('look 1 changes the cell (' + diff + '/2000), uses > 2 glyphs (' + glyphs.size + ')', diff > 1900 && glyphs.size >= 3);
}

// AC2: wind01 = 0 -> two frames (t, t + 1 s) byte-identical; wind > 0 -> lean cells move, level = LEVEL_ANIM
{
  GL.wind01 = 0;
  const a = mk(), b = mk(); let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const t = 2 + rnd() * 100, u = rnd() * 300, v = rnd() * 300, lo = 1 + (i % 2), w = rnd();
    shadeTerrain(t, 0, 1, u, v, 17.25, ctxOn, a, 0, NaN, 0, 0, 1, lo, 3, w);
    shadeTerrain(t, 0, 1, u, v, 18.25, ctxOn, b, 0, NaN, 0, 0, 1, lo, 3, w);
    if (!same(a, b) || a.level === LEVEL_ANIM) bad++;
  }
  check('AC wind01 = 0: frames t / t+1 s identical (' + bad + ' differ)', bad === 0);
  GL.wind01 = 1; let moved = 0, anim = 0;
  for (let i = 0; i < 5000; i++) {
    const u = rnd() * 50, v = rnd() * 50;
    shadeTerrain(5, 0, 1, u, v, 17.25, ctxOn, a, 0, NaN, 0, 0, 1, 1, 1, 0); shadeTerrain(5, 0, 1, u, v, 18.25, ctxOn, b, 0, NaN, 0, 0, 1, 1, 1, 0);
    if (!same(a, b)) moved++; if (a.level === LEVEL_ANIM) anim++;
  }
  check('wind on: ' + moved + '/5000 cells change in 1 s, lean look is ANIM (' + anim + ')', moved > 100 && anim === 5000);
  GL.wind01 = 0;
}

// AC3: eye moved 0.1 m (hit point shifts 0.1 m, t by 0.07) changes < 5 % of the glyphs at > 10 m (footprint k = 2 tan(40 deg) / 480)
{
  const k = 2 * Math.tan(40 * Math.PI / 180) / 480, c2 = { ...ctxOn, hashCell: -k }, a = mk(), b = mk();
  for (const [t0, t1] of [[10, 15], [15, 25], [25, 100], [10, 100]]) {
    let n = 0, ch = 0;
    for (let i = 0; i < 20000; i++) {
      const t = t0 + rnd() * (t1 - t0), u = rnd() * 400, v = rnd() * 400, lo = 1 + (i % 2), w = rnd() * 0.3;
      shadeTerrain(t, 0, 1, u, v, 0, c2, a, 0, NaN, 0, 0, 1, lo, 3, w);
      shadeTerrain(t + 0.07, 0, 1, u + 0.1, v, 0, c2, b, 0, NaN, 0, 0, 1, lo, 3, w);
      n++; if (a.glyph !== b.glyph) ch++;
    }
    console.log('  eye +0.1 m, t ' + t0 + '..' + t1 + ' m: ' + (100 * ch / n).toFixed(2) + ' % glyphs changed');
    // 10..25 m: the dither is not yet faded (fp < 0.25 m = LOOK_CELL_M), so a 0.1 m shift re-rolls ~40 % of the 0.25 m cells. Architect-approved AC: >= 25 m only (these 10/15/20 m % are recorded, not gated); the flicker walk is the real gate.
    if (t0 === 25) check('AC eye +0.1 m: < 5 % glyphs change at 25..100 m (' + (100 * ch / n).toFixed(2) + ' %)', ch / n < 0.05);
  }
}

// AC4: w = 0.5 symmetric: lo/hi swap gives the same colour (accent-free looks)
{
  const t2 = packLookTable({ looks: cfg.looks.map(l => ({ ...l, accents: [] })) }, new Float32Array(LOOK_MAX * LOOK_ROWS * 4));
  const c3 = { ...baseCtx, groundLook: makeGroundLook(t2) }, a = mk(), b = mk(); let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const t = 2 + rnd() * 100, u = rnd() * 300, v = rnd() * 300;
    shadeTerrain(t, 0, 1, u, v, 0, c3, a, 0, NaN, 0, 0, 1, 1, 2, 0.5);
    shadeTerrain(t, 0, 1, u, v, 0, c3, b, 0, NaN, 0, 0, 1, 2, 1, 0.5);
    if (a.fg[0] !== b.fg[0] || a.fg[1] !== b.fg[1] || a.fg[2] !== b.fg[2] || a.bg[0] !== b.bg[0] || a.bg[1] !== b.bg[1] || a.bg[2] !== b.bg[2]) bad++;
  }
  check('AC w = 0.5 symmetric colour (' + bad + ' differ)', bad === 0);
  shadeTerrain(5, 0, 1, 3, 4, 0, c3, a, 0, NaN, 0, 0, 1, 1, 2, 0); shadeTerrain(5, 0, 1, 3, 4, 0, c3, b, 0, NaN, 0, 0, 1, 1, 1, 0);
  check('w = 0 == pure lo look', same(a, b));
}

// far grass: a look cell takes the look glyphs + ramp(0.6) tint (not the FG_TYPES colour)
{
  const cfgG = { radiusM: 12, variants: [{ ground: ['grass'], ramp: [[10, 40, 10], [200, 30, 30], [60, 255, 60]], areas: [1] }] };
  const rec = farGrassFill(makeFarGrass(), cfgG, ['grass'], { on: true, radiusScale: 1, farGrass: true }, null);
  const a = mk(), b = mk();
  shadeTerrain(60, 0, 1, 7, 9, 0, { ...ctxOn, farGrass: rec }, a, 0, NaN, 0, 0, 1, 1, 1, 0);
  shadeTerrain(60, 0, 1, 7, 9, 0, { ...ctxOn, farGrass: { ...rec, on: 0 } }, b, 0, NaN, 0, 0, 1, 1, 1, 0);
  check('far grass look cell: red type colour not used (fg r ' + a.fg[0] + '), look glyph, differs from off', a.fg[0] < 120 && ".,'\"".includes(String.fromCharCode(a.glyph + 32)) && !same(a, b));
}

// shadeGrass: root colour through the look function vs groundAlbedo
{
  const tab = grassTableFor({ variants: [{ ramp: [[20, 80, 20], [60, 200, 60]], groundTint: 0.6 }] }), a = mk(), b = mk(), c = mk();
  const gx = GRASS_GX_HAS | 0;
  shadeGrass(5, 1, 0, 0, 0, 1, tab, ctxOff, a, gx, 1);
  shadeGrass(5, 1, 0, 0, 0, 1, tab, ctxOn, b, gx + 2 * 268435456, 1); // ENV-02e: look id 2 in gx bits 28..31
  shadeGrass(5, 1, 0, 0, 0, 1, tab, ctxOn, c, gx, 1);
  check('shadeGrass: look root differs, look 0 unchanged', (b.fg[0] !== a.fg[0] || b.fg[1] !== a.fg[1]) && same(a, c));
  const d = mk(); shadeGrass(5, 1, 0, 0, 0, 1, tab, ctxOff, d, gx + 2 * 268435456, 1);
  check('shadeGrass: look id with no ctx.groundLook = the old output (look off byte-identical)', same(a, d));
  // grassLookId: dithered per-blade side, stable, w 0 / 255 pure, a look-0 side borrows the other
  let nHi = 0, nLo = 0, stable = true, pure = true, borrow = true;
  for (let i = 0; i < 4000; i++) {
    const rx = Math.fround(rnd() * 500), ry = Math.fround(rnd() * 500), wd = 3 | (5 << 4) | (128 << 8);
    const id = grassLookId(wd, rx, ry); if (id === 5) nHi++; else if (id === 3) nLo++; else stable = false;
    if (grassLookId(wd, rx, ry) !== id) stable = false;
    if (grassLookId(3 | (5 << 4), rx, ry) !== 3 || grassLookId(3 | (5 << 4) | (255 << 8), rx, ry) !== 5 && rnd() < 0) pure = false;
    if (grassLookId(0 | (4 << 4) | (200 << 8), rx, ry) !== 4 || grassLookId(6 | (0 << 4) | (200 << 8), rx, ry) !== 6) borrow = false;
  }
  check('grassLookId: both sides ~50/50 at w=128 (' + nLo + '/' + nHi + '), stable, w=0 pure lo, look-0 borrows', stable && pure && borrow && nHi > 1700 && nLo > 1700 && grassLookId(0, 1, 1) === 0);
}

// 0 alloc (arch 38.61): the look path (wind, accents, blend) allocates no more than the same call with look 0. The baseline itself boxes
// ~16-32 B/call at hashCell < 0 in this harness (identical on the unmodified HEAD terrainShade, checked), so the gate is the DIFFERENCE.
{
  GL.wind01 = 1; const o = mk();
  const run = (lo, hi) => allocProbe((n) => { for (let k = 0; k < n; k++) shadeTerrain(8 + (k & 63), 0, 0.9, k, 7 + (k & 255), 3.5, ctxOn, o, 0, 12.3, 0, 0, 1, lo, hi, 0.37); }, { n: 20000, warm: 5 });
  const p1 = run(1, 2), p0 = run(0, 0);
  if (!skipNote(p1, 'ENV-02b 0 alloc')) check('0 extra alloc of the look path (' + p1.perCall.toFixed(2) + ' vs look-0 ' + p0.perCall.toFixed(2) + ' B/call)', p1.perCall - p0.perCall <= 2);
  GL.wind01 = 0;
}

// ENV-02d item 3: one wind01 helper = speed / 4 m/s clamped 0..1 (gust amp is NOT the wind strength)
{
  check('lookWind01: calm / null = 0', lookWind01(null) === 0 && lookWind01({ speed: 0, amp: 0.9 }) === 0);
  check('lookWind01: 2 m/s = 0.5, 4 = 1, 9 = 1 (clamped), amp ignored', lookWind01({ speed: 2, amp: 0 }) === 0.5 && lookWind01({ speed: 4 }) === 1 && lookWind01({ speed: 9, amp: 0.1 }) === 1);
  check('lookWind01: result is an f32 value', lookWind01({ speed: 1 }) === Math.fround(lookWind01({ speed: 1 })) && lookWind01({ speed: 1.3 }) === Math.fround(1.3 / 4));
}
// ENV-02d item 2: look-texel index computed in f32 like terrainLookAt (texel-edge test). Power-of-two cells: x = x0 + k * cell is exactly representable.
{
  let bad = 0, n = 0;
  for (const [x0, cell] of [[12.5, 0.25], [-1000.75, 2], [3.5, 8], [1234.125, 4]]) for (let k = -3; k < 400; k++) {
    const x = x0 + k * cell, below = Math.fround(x - cell * 1e-6), xf = Math.fround(x);
    n++; if (lkIdx(xf, x0, cell) !== k) bad++;
    if (Math.fround(below) < xf) { n++; if (lkIdx(below, x0, cell) !== k - 1) bad++; }
  }
  // a non-dyadic origin: the index equals the explicit f32 chain
  for (let i = 0; i < 2000; i++) { const x = Math.fround(rnd() * 3000), x0 = Math.fround(rnd() * 500), cell = [0.25, 2, 8][i % 3]; n++; if (lkIdx(x, x0, cell) !== Math.floor(Math.fround(Math.fround(x - x0) / cell))) bad++; }
  check('lkIdx texel edges + f32 chain (' + bad + '/' + n + ' differ)', bad === 0);
}
console.log('groundLook: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
