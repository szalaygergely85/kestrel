// US-073b (docs/architecture.md 38.25): stable.wgsl.js string/layout rules + `stableCell` (+ reproject/blend helpers) evaluated in JS through wgslProbe
// against the JS twin temporalStable.js `stabilize()` over random two-frame scenes (pitched wall, pitched floor, ortho floor; pans, yaw, z moves,
// edge/water/sky/model/level-255 cells, UV drift, plane changes). The probe feeds the shader the GPU's own data shapes (edge = final != shade,
// water = layer word, f32-rounded uniforms/depth/uv), so only the tie-masked half-cell/half-texel cells may differ. Mutation-checked.
// Not probed (needs vec4 ops): fs_main's pack/unpack of the outputs; covered by the compile check + 073c's gpucompare `stable` row.
// node engine/render/gpu/wgsl/stable.wgsl.test.js
import assert from 'node:assert/strict';
import { STABLE_WGSL, STABLE_BLOCK, STABLE_TEXTURES, STABLE_TARGETS } from './stable.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, shims } from './wgslProbe.js';
import {
  beginFrame, stabilize, createStableState, createStableBuffers, edgeMaskFromShade, waterMaskFromLayer, CHANNEL_SNAP, DEFAULT_DETAIL, LEVEL_NONE,
} from '../../temporalStable.js';
import { packStableUniforms, WgStablePass } from '../wg/passStable.js';
import { allocWgTargets } from '../wg/targets.js';
import { WgShadePass } from '../wg/passShade.js';
import { unprojectPitched } from '../../projection.js';
import { KIND_NONE, KIND_WALL, KIND_FLOOR, KIND_MODEL, KIND_MESH } from '../../GBuffer.js';
import { makeMockGpuDevice } from '../../../test/assert.js';

// ---------------- string / layout rules ----------------
assert.ok(WGSL_MODULES.some((m) => m.name === 'stable' && m.code === STABLE_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec|\bint\(/.test(STABLE_WGSL), 'no raw % / round / GLSL names');
assert.ok(/fn vs_main/.test(STABLE_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\) -> FO/.test(STABLE_WGSL));
assert.ok(/@location\(0\) fg: vec4f/.test(STABLE_WGSL) && /@location\(1\) bg: vec4f/.test(STABLE_WGSL) && /@location\(2\) hist: vec4u/.test(STABLE_WGSL));
assert.deepEqual(STABLE_TARGETS, ['rgba8', 'rgba8', 'rgba32ui']);
assert.ok(4 + 4 + 16 <= 32, 'attachment bytes within the 32 B per-sample limit');
const wgslTypes = { uint: 'texture_2d<u32>', sint: 'texture_2d<i32>', float: 'texture_2d<f32>' };
STABLE_TEXTURES.forEach((k, i) => assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${wgslTypes[k].replace(/[<>]/g, '\\$&')}`).test(STABLE_WGSL), `binding ${i} ${k}`));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: StableU/.test(STABLE_WGSL));
assert.ok(STABLE_WGSL.includes(`const LEVEL_NONE: u32 = ${LEVEL_NONE}u;`) && LEVEL_NONE === 255, 'LEVEL_NONE interpolated from the twin');
assert.ok(STABLE_WGSL.includes('floor(pc.x + 0.5)') && STABLE_WGSL.includes('floor(pc.y + 0.5)'), 'history cell = floor(x + 0.5)');
assert.ok(STABLE_WGSL.includes('floor(v * 255.0 + 0.5)'), 'byte quantise floor(v+0.5)');
assert.ok(!/textureSample|sampler/.test(STABLE_WGSL), 'history is read by textureLoad only');
const w = (n) => STABLE_BLOCK.field(n).word;
assert.deepEqual(['curA', 'curB', 'curC', 'prevA', 'prevB', 'prevC', 'dEye', 'gridCols', 'snap', 'detailDefault'].map(w), [0, 4, 8, 12, 16, 20, 24, 28, 32, 33]);
assert.equal(STABLE_BLOCK.sizeBytes, 144);
assert.equal(CHANNEL_SNAP, 48);

// ---------------- WGSL emulation of stableCell ----------------
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const f2u = (x) => { f32[0] = x; return u32[0]; };
let seed = 7321;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const tex = (cols, rows, fn) => { const data = new Array(cols * rows); for (let i = 0; i < data.length; i++) data[i] = fn(i); return { w: cols, h: rows, data }; };
// lenient textureLoad (select() evaluates both arms in the JS shim; the GPU returns 0 outside)
const tl = (t, c) => { const d = c.x >= 0 && c.y >= 0 && c.x < t.w && c.y < t.h ? t.data[c.y * t.w + c.x] : null; return d ? { x: d[0], y: d[1], z: d[2], w: d[3] } : { x: 0, y: 0, z: 0, w: 0 }; };
const unorm = (b) => Math.fround(b / 255);
const rgbF = (px) => [unorm((px >> 16) & 255), unorm((px >> 8) & 255), unorm(px & 255)];

function uniformObject(words, ints) {
  const v4 = (n) => { const a = w(n); return { x: words[a], y: words[a + 1], z: words[a + 2], w: words[a + 3] }; };
  return {
    curA: v4('curA'), curB: v4('curB'), curC: v4('curC'), prevA: v4('prevA'), prevB: v4('prevB'), prevC: v4('prevC'), dEye: v4('dEye'),
    gridCols: ints[w('gridCols')], gridRows: ints[w('gridRows')], histValid: ints[w('histValid')], ortho: ints[w('ortho')], snap: ints[w('snap')], pad0: ints[w('pad0')], detailDefault: words[w('detailDefault')],
  };
}

function compileStable(src, ctx) {
  const base = { ...shims, textureLoad: tl, LEVEL_NONE, ...ctx, giKind: (y) => y & 0xff, vec3f: (x, y, z) => ({ x, y, z }) };
  for (const n of ['byteOf', 'packRgb', 'blendCh', 'blendPacked', 'reproject']) base[n] = compileFn(src, n, base);
  return compileFn(src, 'stableCell', base);
}

/** One plane through the scene: fills vd/u/v per cell for `cam` terms (st.cur) with a world plane n.P = d. */
function planeHit(st, plane, out) {
  const c = st.cur, P0 = [0, 0, 0], P1 = [0, 0, 0];
  for (let r = 0; r < c.rows; r++) for (let q = 0; q < c.cols; q++) {
    unprojectPitched(c, q, r, 0, P0); unprojectPitched(c, q, r, 1, P1);
    const D = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]];
    const den = plane.n[0] * D[0] + plane.n[1] * D[1] + plane.n[2] * D[2];
    const vd = Math.abs(den) < 1e-9 ? -1 : (plane.d - (plane.n[0] * P0[0] + plane.n[1] * P0[1] + plane.n[2] * P0[2])) / den;
    const i = r * c.cols + q;
    if (!(vd > 0)) { out.vd[i] = 0; continue; }
    out.vd[i] = vd;
    out.u[i] = P0[0] + D[0] * vd + (plane.n[0] === 0 && plane.n[1] === 0 ? 0 : 0); // u = world x (wall/floor: x varies along the plane)
    out.v[i] = plane.n[2] === 0 ? P0[2] + D[2] * vd : P0[1] + D[1] * vd; // wall: world z, floor: world y
    out.hit[i] = 1;
  }
}

/** Builds a fresh frame: scene data + the GPU data shapes. Mutated randomly (edge/water/sky/model/level/colour jumps) from `planes`. */
function makeFrame(st, cols, rows, plane, opts) {
  const n = cols * rows;
  const geo = { vd: new Float32Array(n), u: new Float32Array(n), v: new Float32Array(n), hit: new Uint8Array(n) };
  planeHit(st, plane, geo);
  const f = {
    cols, rows, geo,
    kind: new Uint8Array(n), planeId: new Int32Array(n), level: new Uint8Array(n), glyph: new Uint16Array(n), shadeGlyph: new Uint16Array(n),
    shadeFg: new Uint32Array(n), shadeBg: new Uint32Array(n), finalFg: new Uint32Array(n), finalBg: new Uint32Array(n),
    waterX: new Uint32Array(n).fill(0x7f800000), waterW: new Uint32Array(n),
  };
  const baseKind = plane.n[2] === 0 ? KIND_WALL : KIND_FLOOR;
  for (let i = 0; i < n; i++) {
    const hit = geo.hit[i] === 1;
    f.kind[i] = !hit ? KIND_NONE : (rand() < 0.03 ? [KIND_MODEL, KIND_MESH, KIND_NONE][Math.floor(rand() * 3)] : baseKind);
    f.planeId[i] = 1 + (Math.floor((i % cols) / 12) + (opts.planeShift || 0) * 0) ;
    f.level[i] = rand() < 0.04 ? LEVEL_NONE : 3 + Math.floor(rand() * 4);
    f.glyph[i] = 40 + Math.floor(rand() * 50); f.shadeGlyph[i] = f.glyph[i];
    const sg = 90 + Math.floor(rand() * 20);
    f.shadeFg[i] = (sg << 16) | ((sg + 5) << 8) | (sg + 10); f.shadeBg[i] = 0x101418;
    f.finalFg[i] = f.shadeFg[i]; f.finalBg[i] = f.shadeBg[i];
    if (rand() < 0.04) { // edge cell: the edge pass changed exactly one of fg r / bg b / glyph
      const m = Math.floor(rand() * 3);
      if (m === 0) f.finalFg[i] = (f.finalFg[i] & 0x00ffff) | (((((f.finalFg[i] >> 16) & 255) ^ 0x20)) << 16);
      else if (m === 1) f.finalBg[i] = (f.finalBg[i] & 0xffff00) | ((f.finalBg[i] & 255) ^ 0x18);
      else f.glyph[i] = (f.glyph[i] + 7) & 255; // final glyph differs from the shade glyph (shadeGlyph kept in shadeGlyph below)
    }
    if (rand() < 0.03) { f.waterX[i] = f2u(1 + rand() * 5); f.waterW[i] = 0; }
    else if (rand() < 0.01) { f.waterX[i] = f2u(2); f.waterW[i] = 32; } // flagged layer word: not a water cell
  }
  return f;
}

function toTextures(f, hist) {
  const { cols, rows } = f, n = cols * rows;
  const t = {};
  t.uGI = tex(cols, rows, (i) => [f.planeId[i] >>> 0, f.kind[i] | 0, 0, 0]);
  t.uGA = tex(cols, rows, (i) => [f2u(f.geo.u[i]), f2u(f.geo.v[i]), 0, 0]);
  t.uDepth = tex(cols, rows, (i) => [f2u(f.geo.vd[i]), 0, 0, 0]);
  t.uShadeFg = tex(cols, rows, (i) => [...rgbF(f.shadeFg[i]), unorm(f.shadeGlyph[i])]);
  t.uShadeBg = tex(cols, rows, (i) => [...rgbF(f.shadeBg[i]), 1]);
  t.uFinalFg = tex(cols, rows, (i) => [...rgbF(f.finalFg[i]), unorm(f.glyph[i])]);
  t.uFinalBg = tex(cols, rows, (i) => [...rgbF(f.finalBg[i]), 1]);
  t.uLevel = tex(cols, rows, (i) => [f.level[i], 0, 0, 0]);
  t.uWater = tex(cols, rows, (i) => [f.waterX[i], 0, 0, f.waterW[i]]);
  t.uHistFg = tex(cols, rows, (i) => [...rgbF(hist.fg[i]), unorm(hist.glyph[i])]);
  t.uHistBg = tex(cols, rows, (i) => [...rgbF(hist.bg[i]), 1]);
  t.uHist = tex(cols, rows, (i) => [hist.planeId[i] >>> 0, f2u(hist.u[i]), f2u(hist.v[i]), hist.level[i] | (hist.kind[i] << 8)]);
  return t;
}

const COLS = 40, ROWS = 20, N = COLS * ROWS;
const GRID = { cols: COLS, rows: ROWS, pxCellW: 8, pxCellH: 16 };
const WALL = { n: [0, 1, 0], d: -5 }, FLOOR = { n: [0, 0, 1], d: 0 };

/** Two-frame scene: A (invalid) -> history from the twin; B with cam1. Returns twin out + emulated cells. */
function scene(src, cam0, cam1, plane, tweak) {
  const st = createStableState();
  beginFrame(st, cam0, GRID);
  const fa = makeFrame(st, COLS, ROWS, plane, {});
  const hist = createStableBuffers(COLS, ROWS);
  stabilize(twinInput(fa), createStableBuffers(COLS, ROWS), hist, st); // frame A is invalid (no prev camera): out == input = frame B's history
  beginFrame(st, cam1, GRID);
  const fb = makeFrame(st, COLS, ROWS, plane, {});
  // make frame B resemble A where the geometry coincides: same colours/levels/glyph pattern so the blend/hold rules run
  for (let i = 0; i < N; i++) {
    const j = i;
    fb.planeId[i] = fa.planeId[j]; fb.level[i] = rand() < 0.1 ? (fa.level[j] === LEVEL_NONE ? 4 : Math.min(8, Math.max(0, fa.level[j] + (rand() < 0.5 ? 1 : 2) * (rand() < 0.5 ? -1 : 1)))) : fa.level[j];
    const jump = rand() < 0.15 ? (rand() < 0.5 ? 48 : 49) : (rand() < 0.5 ? 47 : Math.floor(rand() * 20));
    const base = (fa.shadeFg[j] >> 16) & 255, nv = Math.min(255, Math.max(0, base + (rand() < 0.5 ? jump : -jump)));
    if (fb.finalFg[i] === fb.shadeFg[i]) { fb.shadeFg[i] = (nv << 16) | (fb.shadeFg[i] & 0xffff); fb.finalFg[i] = fb.shadeFg[i]; }
    if (tweak) tweak(fb, fa, i);
  }
  const inpB = twinInput(fb);
  const out = createStableBuffers(COLS, ROWS);
  const cell = stabilize(inpB, hist, out, st);
  // GPU side
  const words = new Float32Array(STABLE_BLOCK.sizeWords), ints = new Int32Array(words.buffer);
  packStableUniforms(st, COLS, ROWS, words, ints);
  words[w('detailDefault')] = DETAIL;
  ints[w('pad0')] = 1; // waterOn (the probe binds a real water layer)
  const u = uniformObject(words, ints);
  const fn = compileStable(src, { ...toTextures(fb, hist), u });
  return { st, fb, out, hist, fn, used: cell, u };
}
// detail used by both sides (the twin takes inp.detail, the shader u.detailDefault); a coarse value so the UV-drift rule is partly active
let DETAIL = 3;
function twinInput(f) {
  const edge = edgeMaskFromShade(f.finalFg, f.finalBg, f.glyph, f.shadeFg, f.shadeBg, f.shadeGlyph, new Uint8Array(N));
  const water = waterMaskFromLayer(f.waterX, f.waterW, new Uint8Array(N));
  return {
    cols: COLS, rows: ROWS, kind: f.kind, planeId: f.planeId, u: f.geo.u, v: f.geo.v, vd: f.geo.vd, level: f.level, glyph: f.glyph,
    fg: f.finalFg, bg: f.finalBg, edge, water, detail: new Float32Array(N).fill(DETAIL),
  };
}

function compare(s) {
  let mism = 0, ties = 0, used = 0, tieUsed = 0;
  const bad = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c, o = s.fn({ x: c, y: r });
    const want = s.out;
    if (want.tie[i]) { ties++; continue; }
    if (!want.fresh[i]) used++;
    const same = o.fg === want.fg[i] && o.bg === want.bg[i] && o.glyph === want.glyph[i] && o.level === want.level[i] && o.kind === want.kind[i]
      && (o.plane | 0) === want.planeId[i] && o.ub === f2u(want.u[i]) && o.vb === f2u(want.v[i]) && o.fresh === want.fresh[i];
    if (!same) { mism++; if (bad.length < 3) bad.push({ c, r, got: o, want: { fg: want.fg[i], bg: want.bg[i], glyph: want.glyph[i], level: want.level[i], fresh: want.fresh[i] } }); }
  }
  return { mism, ties, used, bad };
}

const cases = [
  ['pitched wall pan', { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }, (k) => ({ x: 0.12 * k, y: 0, z: 1.6 + 0.02 * k, yawDeg: 0.3 * k, pitchDeg: 0 }), WALL],
  ['pitched floor pan+z', { x: 0, y: 0, z: 6, yawDeg: 10, pitchDeg: -25 }, (k) => ({ x: 0.15 * k, y: -0.1 * k, z: 6 + 0.05 * k, yawDeg: 10 + 0.4 * k, pitchDeg: -25 + 0.2 * k }), FLOOR],
  ['ortho floor pan', { x: 0, y: 12, z: 12, yawDeg: 180, pitchDeg: -45, projection: 'ortho', orthoHalfH: 4 }, (k) => ({ x: 0.083 * k, y: 12 + 0.037 * k, z: 12, yawDeg: 180, pitchDeg: -45, projection: 'ortho', orthoHalfH: 4 }), FLOOR],
];

let probes = 0, totalUsed = 0;
const runCase = (src, name, cam0, camK, plane, k, tweak) => {
  DETAIL = plane === WALL ? 3 : (cam0.projection === 'ortho' ? 1 : 0.7);
  const s = scene(src, cam0, camK(k), plane, tweak);
  const r = compare(s);
  return { name, k, ...r, tieShare: r.ties / N, st: s.st };
};
for (const [name, cam0, camK, plane] of cases) {
  for (let k = 1; k <= 4; k++) {
    const r = runCase(STABLE_WGSL, name, cam0, camK, plane, k);
    assert.ok(r.st.histValid, `${name} k=${k}: history valid`);
    assert.equal(r.mism, 0, `${name} k=${k}: ${r.mism} non-tie mismatches vs the twin ${JSON.stringify(r.bad)}`);
    assert.ok(r.tieShare <= 0.05, `${name} k=${k}: tie share ${r.tieShare}`);
    assert.ok(r.used > 40, `${name} k=${k}: only ${r.used} cells took history`);
    totalUsed += r.used; probes += N;
  }
}
// invalid history: copy through, fresh everywhere (both sides)
{
  const cam = cases[0][1];
  const s = scene(STABLE_WGSL, cam, { ...cam, x: 3 }, WALL); // > 2 m cut
  assert.equal(s.u.histValid, 0);
  const r = compare(s);
  assert.equal(r.mism, 0); assert.equal(r.used, 0, 'cut: nothing takes history');
}

// ---------------- mutation tests ----------------
const mutations = [
  ['floor(x+0.5) -> floor(x) (history cell)', 'floor(pc.x + 0.5)', 'floor(pc.x)'],
  ['floor(y+0.5) -> floor(y)', 'floor(pc.y + 0.5)', 'floor(pc.y)'],
  ['snap threshold > -> >=', 'abs(d) > u.snap', 'abs(d) >= u.snap'],
  ['blend rounding (+1)', '(p + c + 1u) >> 1u', '(p + c) >> 1u'],
  ['glyph hold window <=1 -> <1', 'abs(i32(lvC) - i32(lvP)) <= 1', 'abs(i32(lvC) - i32(lvP)) < 1'],
  ['edge: fg.r ignored', 'if (fgC.x != sf.x || ', 'if ('],
  ['edge: glyph ignored', 'fgC.w != sf.w || ', ''],
  ['edge: bg.b ignored', ' || bgC.z != sb.z) { return o; }', ') { return o; }'],
  ['water cells take history', 'if (u.pad0 != 0 && wl.x != 0x7f800000u && (wl.w & 32u) == 0u) { return o; }', ''],
  ['level 255 not rejected', ' || lvC == LEVEL_NONE) { return o; }', ') { return o; }'],
  ['hist level 255 not rejected', 'if (lvP == LEVEL_NONE) { return o; }', ''],
  ['sky/model not rejected', 'if (kind == 0u || kind == 8u || lvC', 'if (lvC'],
  ['kind/plane match dropped', 'if (hk != kind || hh.x != gi.x) { return o; }', ''],
  ['UV drift window x2', '0.5 / u.detailDefault', '1.0 / u.detailDefault'],
  ['dEye.z dropped', 'let wz = pz + u.dEye.z;', 'let wz = pz;'],
  ['ortho branch swapped in prev projection', 'cf = (vx / u.prevA.w + 1.0)', 'cf = (vx / vdP / u.prevA.w + 1.0)'],
  ['perspective divide dropped in rows', 'rf = (1.0 - vy / vdP / u.prevC.y)', 'rf = (1.0 - vy / u.prevC.y)'],
];
assert.ok(STABLE_WGSL.includes('u.pad0 != 0 && wl.x'), 'water test is gated by waterOn (pad0): the 1x1 dummy reads 0 = water out of bounds');
for (const [name, from, to] of mutations) {
  assert.ok(STABLE_WGSL.includes(from), `mutation anchor missing: ${name}`);
  const src = STABLE_WGSL.replace(from, to);
  let caught = 0;
  for (const [cn, cam0, camK, plane] of cases) for (let k = 1; k <= 4 && !caught; k++) {
    const r = runCase(src, cn, cam0, camK, plane, k);
    if (r.mism > 0) caught++;
  }
  assert.ok(caught > 0, `mutation survived: ${name}`);
}

// ---------------- host side: uniforms, device pass, shade level target, stable-off identity ----------------
{
  const st = createStableState();
  beginFrame(st, cases[1][1], GRID); beginFrame(st, cases[1][2](1), GRID);
  const words = new Float32Array(STABLE_BLOCK.sizeWords), ints = new Int32Array(words.buffer);
  packStableUniforms(st, COLS, ROWS, words, ints);
  const u = uniformObject(words, ints);
  assert.equal(u.histValid, 1); assert.equal(u.gridCols, COLS); assert.equal(u.snap, CHANNEL_SNAP); assert.equal(u.detailDefault, DEFAULT_DETAIL);
  assert.ok(Math.abs(u.curA.x - st.cur.fX) < 1e-6 && Math.abs(u.prevB.x - st.prev.rX) < 1e-6 && Math.abs(u.dEye.x - st.dEx) < 1e-6, 'terms + dEye packed');
  assert.equal(u.ortho, 0);
}
{
  const mock = makeMockGpuDevice(), d = mock.device;
  const calls = [];
  d.beginPass = (target) => calls.push(['pass', target]); d.bind = (pipe, desc) => calls.push(['bind', desc]); d.draw = () => calls.push(['draw']); d.endPass = () => {};
  const t = allocWgTargets(d, COLS, ROWS, 1, { stable: true });
  assert.equal(t.texLevel.desc.format, 'r8ui'); assert.ok(t.targetShadeLevel);
  const sp = new WgStablePass(d);
  assert.deepEqual(sp.pipe.desc.targetFormats, ['rgba8', 'rgba8', 'rgba32ui']);
  assert.equal(sp.run({}, t), false, 'no targets before resize');
  sp.resize(COLS, ROWS);
  assert.equal(sp.outFg, null, 'no output before the first run');
  const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
  assert.equal(sp.beginFrame(cam, GRID), false, 'first frame invalid');
  const k0 = sp._k;
  assert.equal(sp.run({}, t), true);
  assert.equal(sp._k, k0 ^ 1, 'ping-pong flips after a run');
  const firstOut = sp.outFg;
  assert.equal(sp.beginFrame(cam, GRID), true, 'second frame valid');
  sp.run({}, t);
  assert.equal(sp.tex[9].texture, firstOut, 'history = last frame output (partner set)');
  assert.notEqual(sp.outFg, firstOut, 'writes the other set');
  sp.invalidate(); assert.equal(sp.beginFrame(cam, GRID), false, 'invalidate()');
  const kBefore = sp._k;
  assert.equal(sp.run({}, { ...t, texLevel: null }), false); assert.equal(sp._k, kBefore, 'no flip without a run');
  // stable OFF: nothing created, shade pass unchanged
  const t2 = allocWgTargets(d, COLS, ROWS, 1);
  assert.ok(!('texLevel' in t2) && !('targetShadeLevel' in t2), 'off: no level texture / target');
  const off = new WgShadePass(d), on = new WgShadePass(d, { stable: true });
  assert.deepEqual(off.pipeShade.desc.targetFormats, ['rgba8', 'rgba8']); assert.equal(off.pipeShade.desc.fragment.targets, 2);
  assert.deepEqual(on.pipeShade.desc.targetFormats, ['rgba8', 'rgba8', 'r8ui']); assert.equal(on.pipeShade.desc.fragment.targets, 3);
  assert.equal(off.stable, false); assert.equal(on.stable, true);
}

console.log(`stable.wgsl.test.js: string/layout + ${probes} cells (3 poses x 4 pans, ${totalUsed} took history) WGSL-emulation == temporalStable.js on non-tie cells; ${mutations.length} mutations caught; host pass + shade level target + stable-off identity ok.`);
