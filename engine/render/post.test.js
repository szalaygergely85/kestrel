// POST-STACK-01a (docs/architecture.md 38.73) Node tests on a REAL RenderTargetCanvas2D (DOM stubbed only at canvas/document level).
// Run: node engine/render/post.test.js
import assert from 'node:assert/strict';
import paletteMod from '../../design/palette.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { ensureGcChild, heapGrowth } from '../test/allocGate.js';
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';
import { fillSky } from './sky.js';
import { createAtmosState, mixAtmos, gradeCells } from './atmos.js';
import { validatePost, createPostState, composePost, postCells } from './post.js';
ensureGcChild();
globalThis.window = globalThis.window || { innerWidth: 1000, innerHeight: 600, devicePixelRatio: 1 }; paletteMod;
const mctx = { font: '', textBaseline: '', textAlign: '', measureText() { const px = parseFloat(this.font) || 1; return { width: px * 0.6, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.25 }; } };
const mkCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), ...mctx }) });
globalThis.document = { createElement: mkCanvas };
const mkRT = (c, r) => new RenderTargetCanvas2D(mkCanvas(), c, r); // the real class, real constructor
const { assets } = await loadTestAssets(); const P = assets.palette;

const POSES = [{ yawDeg: 0, pitchDeg: 0 }, { yawDeg: 90, pitchDeg: 12 }, { yawDeg: 200, pitchDeg: -8 }];
const sky = (rt, pose) => { fillSky({ rt: rt.cells, palette: P, depth: null, timeSec: 3 }, pose, null); return rt; };
const snap = (rt) => [new Uint8Array(rt.cells.fg), new Uint8Array(rt.cells.bg), new Uint8Array(rt.cells.glyphIdx)];

// biome atmosphere with a real (non-identity) grade
const rec = (lift, gamma, gain, sat) => ({ fog: Float32Array.of(150, 190, 160), fogDensity: 0.004, haze: Float32Array.of(200, 220, 190), hazeAmount: 0.5, lift: Float32Array.from(lift), gamma: Float32Array.from(gamma), gain: Float32Array.from(gain), sat });
const r = rec([0.02, 0.01, 0.03], [1.05, 1, 0.95], [1.05, 1.02, 0.95], 1.1);
const table = { n: 1, recs: [r, r, r] };
const base = { start: P.fog.far.start, full: P.fog.far.full, curve: P.fog.far.curve, near: P.rgb[P.fog.far.color], far: P.rgb[P.fog.far.colorFar] };
const atm = createAtmosState(); mixAtmos(table, { w: Float32Array.of(0.7), wNone: 0.3, tod: Float32Array.of(1, 0, 0), version: 1 }, base, atm);
assert.equal(atm.on, true); assert.equal(atm.gradeId, false);

// AC: identity post + atmos -> bit-equal to gradeCells alone, 3 poses (also null cfg, and a cfg with only identity grade)
const IDENT = { bloom: null, grade: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1 }, vignette: null, mist: null };
for (const cfg of [IDENT, null]) {
  const ps = composePost(atm, validatePost(cfg), createPostState());
  for (const pose of POSES) {
    const a = sky(mkRT(96, 48), pose), b = sky(mkRT(96, 48), pose);
    gradeCells(a, atm); postCells(b, null, ps);
    assert.deepEqual(snap(b), snap(a), 'identity post + atmos == gradeCells alone');
  }
}
// grade really changed something (guards a vacuous test)
{ const a = sky(mkRT(96, 48), POSES[0]), b = sky(mkRT(96, 48), POSES[0]); gradeCells(a, atm); assert.notDeepEqual(snap(a)[0], snap(b)[0]); }

// AC: post null + atmos off -> RT untouched (even with a depth buffer)
{ const off = createAtmosState(); const ps = composePost(off, null, createPostState());
  const depth = new Float32Array(96 * 48).fill(500);
  for (const pose of POSES) { const a = sky(mkRT(96, 48), pose), b = sky(mkRT(96, 48), pose); postCells(b, depth, ps); assert.deepEqual(snap(b), snap(a), 'untouched'); } }

// composition: atmos off -> preset grade alone; atmos + preset -> the formulas of 38.73
{ const G = { lift: [0.01, 0.02, 0], gamma: [1.1, 1, 0.9], gain: [0.9, 1, 1.1], sat: 0.8 };
  const o = composePost(null, { grade: G }, createPostState());
  assert.equal(o.gradeOn, true); assert.ok(Math.abs(o.invGamma[0] - 1 / 1.1) < 1e-6); assert.ok(Math.abs(o.sat - 0.8) < 1e-6);
  const c = composePost(atm, { grade: G }, createPostState());
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(c.lift[i] - (atm.lift[i] + G.lift[i])) < 1e-6); assert.ok(Math.abs(c.gain[i] - atm.gain[i] * G.gain[i]) < 1e-6); assert.ok(Math.abs(c.invGamma[i] - atm.invGamma[i] / G.gamma[i]) < 1e-6); }
  assert.ok(Math.abs(c.sat - atm.sat * 0.8) < 1e-6); }

// AC: validator throws per bad field
const V = (o) => ({ bloom: null, grade: null, vignette: null, mist: null, ...o });
const okVig = { k: 0.3, r0: 0.4, r1: 0.9, rgb: [0, 0, 0] }, okMist = { rgb: [0.5, 0.5, 0.6], density: 0.02, start: 4, heightK: 0 };
const okGrade = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1 }, okBloom = { radius: 2, gain: 1, haloBg: 0.2, haloMin: 0.3 };
validatePost(V({ bloom: okBloom, grade: okGrade, vignette: okVig, mist: okMist })); validatePost(null);
const bad = [
  ['unknown key', { foo: 1 }], ['bloom.radius', V({ bloom: { ...okBloom, radius: -1 } })], ['bloom.gain NaN', V({ bloom: { ...okBloom, gain: NaN } })],
  ['grade.gamma 0', V({ grade: { ...okGrade, gamma: [1, 0, 1] } })], ['grade.gamma neg', V({ grade: { ...okGrade, gamma: [-1, 1, 1] } })],
  ['grade.sat 2.1', V({ grade: { ...okGrade, sat: 2.1 } })], ['grade.sat neg', V({ grade: { ...okGrade, sat: -0.1 } })],
  ['grade.lift len', V({ grade: { ...okGrade, lift: [0, 0] } })], ['grade.gain neg', V({ grade: { ...okGrade, gain: [1, -1, 1] } })],
  ['vignette.k 0.61', V({ vignette: { ...okVig, k: 0.61 } })], ['vignette.k neg', V({ vignette: { ...okVig, k: -0.1 } })],
  ['vignette r0>=r1', V({ vignette: { ...okVig, r0: 0.9 } })], ['vignette.rgb', V({ vignette: { ...okVig, rgb: [0, 0, 2] } })],
  ['mist.density 0.21', V({ mist: { ...okMist, density: 0.21 } })], ['mist.density neg', V({ mist: { ...okMist, density: -1 } })],
  ['mist.start neg', V({ mist: { ...okMist, start: -1 } })], ['mist.heightK neg', V({ mist: { ...okMist, heightK: -1 } })], ['mist.rgb', V({ mist: { ...okMist, rgb: [0, 0] } })],
];
for (const [name, cfg] of bad) assert.throws(() => validatePost(cfg), /validatePost/, name);

// AC: vignette symmetric + aspect-correct (40x20 cells, square pixels -> aspect 2)
{ const rt = mkRT(40, 20); rt.pxCellW = 1; rt.pxCellH = 1;
  for (let i = 0; i < rt.cells.fg.length; i += 4) { rt.cells.fg[i] = rt.cells.fg[i + 1] = rt.cells.fg[i + 2] = 200; rt.cells.bg[i] = rt.cells.bg[i + 1] = rt.cells.bg[i + 2] = 200; }
  const ps = composePost(null, { vignette: { k: 0.5, r0: 0.3, r1: 0.9, rgb: [0, 0, 0] } }, createPostState());
  postCells(rt, null, ps);
  const px = (x, y) => rt.cells.fg[(y * 40 + x) * 4], W = 40, H = 20;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { assert.equal(px(x, y), px(W - 1 - x, y), 'mirror x'); assert.equal(px(x, y), px(x, H - 1 - y), 'mirror y'); }
  assert.ok(px(0, 0) < px(20, 10) && px(20, 10) === 200, 'corner darkest, centre untouched');
  const a = px(29, 10 - 0), b = px(20, 0); // centre row (y~0) at x=0.475 -> 0.95 px-units; top row (y=-0.95) at x~0
  assert.ok(Math.abs(a - b) <= 1, `aspect-correct ${a} vs ${b}`);
}

// AC: mist 0 at d <= start; grows with d; glyphs and alpha untouched; fg and bg both
{ const rt = mkRT(8, 8); for (let i = 0; i < rt.cells.fg.length; i += 4) { rt.cells.fg[i] = 100; rt.cells.bg[i + 1] = 100; }
  rt.cells.glyphIdx.fill(7); const before = snap(rt); const d = new Float32Array(64); for (let i = 0; i < 64; i++) d[i] = i < 16 ? 4 : 4 + i * 4; // first 16 cells at d == start
  const ps = composePost(null, { mist: { rgb: [0.8, 0.8, 0.9], density: 0.02, start: 4, heightK: 0 } }, createPostState());
  postCells(rt, d, ps);
  for (let i = 0; i < 16; i++) for (let k = 0; k < 4; k++) { assert.equal(rt.cells.fg[i * 4 + k], before[0][i * 4 + k]); assert.equal(rt.cells.bg[i * 4 + k], before[1][i * 4 + k]); }
  assert.ok(rt.cells.fg[40 * 4] > 100 && rt.cells.fg[63 * 4] > rt.cells.fg[40 * 4], 'mist grows with depth');   assert.ok(rt.cells.bg[63 * 4] > 0, 'bg red moved toward mist'); assert.deepEqual(rt.cells.glyphIdx, before[2]); assert.equal(rt.cells.fg[63 * 4 + 3], before[0][63 * 4 + 3], 'alpha untouched');
  // order: mist before grade (grade sees the fog colour) -> result differs from grade then mist
  const full = composePost(atm, { mist: { rgb: [0.8, 0.8, 0.9], density: 0.02, start: 4, heightK: 0 } }, createPostState());
  const A = mkRT(8, 8), B = mkRT(8, 8); for (const t of [A, B]) for (let i = 0; i < t.cells.fg.length; i += 4) t.cells.fg[i] = 100;
  postCells(A, d, full); const m = composePost(null, { mist: { rgb: [0.8, 0.8, 0.9], density: 0.02, start: 4, heightK: 0 } }, createPostState()); postCells(B, d, m); gradeCells(B, atm);
  assert.deepEqual(A.cells.fg, B.cells.fg, 'chain == mist then grade'); }

// Bit-equality: fused postCells vs the original three-pass implementation (kept here as the reference), 3 poses x 4 configs, +/- zF32
function refMist(cb, depth, z, s) {
  const b8 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);
  const dens = s.mist[0], start = s.mist[1], hk = s.mist[2], mr = s.mistRGB[0] * 255, mg = s.mistRGB[1] * 255, mb = s.mistRGB[2] * 255;
  const fg = cb.fg, bg = cb.bg, n = Math.min(depth.length, fg.length >> 2);
  for (let c = 0; c < n; c++) {
    const e = depth[c] - start; if (!(e > 0)) continue;
    let f = 1 - Math.exp(-dens * e); if (hk > 0 && z) f *= Math.exp(-hk * z[c]); if (f <= 0) continue;
    const o = c << 2;
    fg[o] = b8(fg[o] + (mr - fg[o]) * f + 0.5); fg[o + 1] = b8(fg[o + 1] + (mg - fg[o + 1]) * f + 0.5); fg[o + 2] = b8(fg[o + 2] + (mb - fg[o + 2]) * f + 0.5);
    bg[o] = b8(bg[o] + (mr - bg[o]) * f + 0.5); bg[o + 1] = b8(bg[o + 1] + (mg - bg[o + 1]) * f + 0.5); bg[o + 2] = b8(bg[o + 2] + (mb - bg[o + 2]) * f + 0.5);
  }
}
function refVig(rt, cb, s) {
  const b8 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);
  const cols = cb.cols, rows = cb.rows, aspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1)), inv = 1 / Math.sqrt(aspect * aspect + 1);
  const k = s.vig[0], r0 = s.vig[1], r1 = s.vig[2], ir = 1 / (r1 - r0), vr = s.vigRGB[0] * 255, vg = s.vigRGB[1] * 255, vb = s.vigRGB[2] * 255, fg = cb.fg, bg = cb.bg;
  for (let y = 0; y < rows; y++) { const ny = ((y + 0.5) / rows) * 2 - 1;
    for (let x = 0; x < cols; x++) {
      const nx = (((x + 0.5) / cols) * 2 - 1) * aspect; let t = (Math.sqrt(nx * nx + ny * ny) * inv - r0) * ir; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const f = k * t * t * (3 - 2 * t); if (f <= 0) continue; const o = (y * cols + x) << 2;
      fg[o] = b8(fg[o] + (vr - fg[o]) * f + 0.5); fg[o + 1] = b8(fg[o + 1] + (vg - fg[o + 1]) * f + 0.5); fg[o + 2] = b8(fg[o + 2] + (vb - fg[o + 2]) * f + 0.5);
      bg[o] = b8(bg[o] + (vr - bg[o]) * f + 0.5); bg[o + 1] = b8(bg[o + 1] + (vg - bg[o + 1]) * f + 0.5); bg[o + 2] = b8(bg[o + 2] + (vb - bg[o + 2]) * f + 0.5); } }
}
function refPost(rt, depth, s, z) {
  const cb = rt.cells || rt;
  if (s.mist[3] > 0 && depth) refMist(cb, depth, z, s);
  if (s.gradeOn) gradeCells(rt, s);
  if (s.vig[3] > 0) refVig(rt, cb, s);
}
{ const D = new Float32Array(96 * 48), Z = new Float32Array(96 * 48); for (let i = 0; i < D.length; i++) { D[i] = (i * 7919) % 200; Z[i] = (i % 13) * 0.7; }
  const G = { lift: [0.01, 0.02, 0], gamma: [1.1, 1, 0.9], gain: [0.9, 1, 1.1], sat: 0.8 };
  const CFGS = [
    [null, { vignette: okVig }], [atm, { grade: G, vignette: okVig }], [atm, { mist: { ...okMist, heightK: 0.1 } }],
    [atm, { grade: G, vignette: { k: 0.5, r0: 0.2, r1: 0.8, rgb: [0.1, 0, 0.2] }, mist: okMist }],
  ];
  for (const [a, cfg] of CFGS) for (const pose of POSES) for (const z of [null, Z]) {
    const s1 = composePost(a, cfg, createPostState()), s2 = composePost(a, cfg, createPostState());
    const x = sky(mkRT(96, 48), pose), y = sky(mkRT(96, 48), pose);
    postCells(x, D, s1, z); refPost(y, D, s2, z); postCells(x, D, s1, z); refPost(y, D, s2, z); // twice: also exercises the cached LUT / vignette table
    assert.deepEqual(snap(x), snap(y), 'fused == three-pass reference');
  } }

// 0 alloc per frame with everything on (compose only on change, not per frame)
{ const rt = mkRT(160, 60); const d = new Float32Array(160 * 60).fill(90);
  const ps = composePost(atm, { grade: okGrade, vignette: okVig, mist: okMist }, createPostState());
  const frame = () => { for (let i = 0; i < 300; i++) postCells(rt, d, ps); };
  const grown = heapGrowth(frame, () => { frame(); frame(); frame(); }); // warm past the JIT tiers first
  assert.ok(grown < 4096, 'heap growth ' + grown);
  const t0 = performance.now(); const rt2 = mkRT(480, 180), d2 = new Float32Array(480 * 180).fill(90); for (let i = 0; i < 10; i++) postCells(rt2, d2, ps);
  console.log('post.test ok', JSON.stringify({ heapGrowth: grown, msAt480x180: +((performance.now() - t0) / 10).toFixed(2) })); }
