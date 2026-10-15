// ENV-03b (docs/architecture.md 38.65) Node tests: fog fit, off/never-applied byte identity (3 sky poses + sky LUT), wNone=1 identity,
// lo/hi swap symmetry, grade vs look-lib L.grade (design/preview), liveFogVersion plumbing, 0 alloc.
// Run: node engine/render/atmos.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { CellBuffer } from './CellBuffer.js';
import { fillSky } from './sky.js';
import { skyLutFromPalette } from './waterReflect.js';
import { atmosFogFitError, createAtmosState, mixAtmos, applyAtmosToPalette, gradeRGB, gradeCells, applySkyHaze, ATMOS_GRADE_WGSL } from './atmos.js';
import { compileFn, shims } from './gpu/wgsl/wgslProbe.js';
import { SPRITES_WGSL } from './gpu/wgsl/sprites.wgsl.js';
import { ensureGcChild, heapGrowth } from '../test/allocGate.js';
ensureGcChild();
globalThis.window = globalThis.window || globalThis; paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
// CLOUD-LIVE-01: morning now carries a clouds block; this suite's goldens are the cloudless sky, so strip it on a shallow copy.
const P0 = assets.palette;
const P = { ...P0, timeOfDay: { ...P0.timeOfDay, [P0.defaultTime]: { ...P0.timeOfDay[P0.defaultTime], clouds: undefined } } };
const LL = (() => { const root = {}; new Function('window', readFileSync(new URL('../../design/preview/look-lib.js', import.meta.url), 'utf8'))(root); return root.LOOKLIB; })();

// ---- fog fit
const fitErr = atmosFogFitError();
assert.ok(fitErr <= 0.09, 'fog fit error ' + fitErr);

// ---- helpers
const POSES = [{ yawDeg: 0, pitchDeg: 0 }, { yawDeg: 90, pitchDeg: 12 }, { yawDeg: 200, pitchDeg: -8 }];
function fnv(buf, h = 0x811c9dc5) { for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
function frameHashes(pal, post) {
  const out = [];
  for (const pose of POSES) {
    const rt = new CellBuffer(96, 48);
    fillSky({ rt, palette: pal, depth: null, timeSec: 3 }, pose, null);
    if (post) post(rt);
    out.push(fnv(rt.bg, fnv(rt.fg, fnv(rt.glyphIdx))));
  }
  const lut = new Float32Array(32 * 4); skyLutFromPalette(pal, lut); out.push(fnv(new Uint8Array(lut.buffer)));
  return out;
}
// pinned from the pre-change code (HEAD sky.js / fastShade.js / waterReflect.js)
const PRE = [2263763744, 2656898473, 3132894739, 3149903576];
assert.deepEqual(frameHashes(P), PRE, 'never applied: frames byte-identical to pre-change');

// ---- table: 2 entries x 3 slots
const rec = (fog, d, haze, hk, lift, gamma, gain, sat) => ({ fog: Float32Array.from(fog), fogDensity: d, haze: Float32Array.from(haze), hazeAmount: hk, lift: Float32Array.from(lift), gamma: Float32Array.from(gamma), gain: Float32Array.from(gain), sat });
const table = { n: 2, recs: [
  rec([150, 190, 160], 0.004, [200, 220, 190], 0.5, [0.02, 0.01, 0.03], [1.05, 1, 0.95], [1.05, 1.02, 0.95], 1.1),
  rec([200, 150, 120], 0.006, [240, 180, 140], 0.6, [0.03, 0.02, 0.01], [1, 1.1, 1], [1, 0.95, 0.9], 0.9),
  rec([40, 50, 90], 0.003, [60, 70, 120], 0.3, [0.01, 0.02, 0.05], [1.1, 1, 1], [0.6, 0.6, 0.7], 0.8),
  rec([110, 160, 110], 0.012, [150, 190, 140], 0.4, [0.0, 0.01, 0.0], [0.95, 1, 1.05], [1, 1.05, 0.95], 1.2),
  rec([170, 120, 90], 0.01, [220, 150, 100], 0.5, [0.02, 0.0, 0.0], [1, 1, 1], [1.1, 0.95, 0.9], 1.0),
  rec([30, 40, 50], 0.008, [50, 60, 80], 0.2, [0.0, 0.0, 0.04], [1, 1.05, 1.1], [0.5, 0.55, 0.65], 0.7),
] };
const drv = { w: new Float32Array(2), wNone: 1, tod: new Float32Array([1, 0, 0]), version: 1 };
const base = { start: P.fog.far.start, full: P.fog.far.full, curve: P.fog.far.curve, near: P.rgb[P.fog.far.color], far: P.rgb[P.fog.far.colorFar] };
const st = createAtmosState();

// ---- wNone = 1 with on = true: identity (fog == base, grade identity, frames byte-identical)
const farBase = P.fog.far, nearRgbBase = P.rgb[farBase.color].slice();
mixAtmos(table, drv, base, st);
assert.equal(st.on, true); assert.equal(st.gradeId, true);
assert.deepEqual([st.fogStart, st.fogFull, st.fogCurve], [base.start, base.full, base.curve]);
assert.deepEqual(Array.from(st.fogNear), Array.from(base.near)); assert.deepEqual(Array.from(st.fogFar), Array.from(base.far));
const v0 = P.liveFogVersion | 0;
applyAtmosToPalette(P, st);
assert.equal(P.liveFogVersion, v0 + 1, 'apply bumps liveFogVersion');
assert.notEqual(P.fog.far, farBase, 'live record installed'); assert.equal(P.fog.farBase, farBase);
const L = P.fog.far;
assert.deepEqual([L.start, L.full, L.curve], [farBase.start, farBase.full, farBase.curve]);
assert.deepEqual(Array.from(P.rgb[L.color]), Array.from(nearRgbBase));
assert.deepEqual(frameHashes(P, (rt) => gradeCells(rt, st)), PRE, 'wNone 1, on: bytes identical');
applyAtmosToPalette(P, st); assert.equal(P.fog.far, L, 'live record persistent (no per-bump alloc)');

// ---- off restores
st.on = false; applyAtmosToPalette(P, st);
assert.equal(P.fog.far, farBase); assert.equal(P.atmos, null);
const v1 = P.liveFogVersion; applyAtmosToPalette(P, st); assert.equal(P.liveFogVersion, v1, 'off twice = no extra bump');
assert.deepEqual(frameHashes(P), PRE, 'applied then off: byte-identical');

// ---- real mix: changes frames (haze + grade), fog density blend
drv.w[0] = 1; drv.w[1] = 0; drv.wNone = 0; mixAtmos(table, drv, base, st);
assert.ok(Math.abs(st.fogFull - 2.5 / 0.004) < 1e-3 && st.fogStart === 0 && Math.abs(st.fogCurve - 0.55) < 1e-6, 'entry fog = fit');
applyAtmosToPalette(P, st);
const mixed = frameHashes(P);
assert.notDeepEqual(mixed.slice(0, 3), PRE.slice(0, 3), 'haze changes the sky');
assert.notEqual(mixed[3], PRE[3], 'LUT haze changes');
st.on = false; applyAtmosToPalette(P, st);

// ---- lo/hi swap symmetric (entry a with w, b with 1-w  ==  the swapped table with swapped weights)
const out1 = createAtmosState(), out2 = createAtmosState();
for (const wv of [0.25, 0.5, 0.8]) {
  const dA = { w: Float32Array.from([wv, 1 - wv]), wNone: 0, tod: Float32Array.from([0.3, 0.5, 0.2]), version: 1 };
  const tSwap = { n: 2, recs: [] };
  for (let s = 0; s < 3; s++) { tSwap.recs[s] = table.recs[3 + s]; tSwap.recs[3 + s] = table.recs[s]; }
  const dB = { w: Float32Array.from([1 - wv, wv]), wNone: 0, tod: dA.tod, version: 1 };
  mixAtmos(table, dA, base, out1); mixAtmos(tSwap, dB, base, out2);
  for (const k of ['fogNear', 'fogFar', 'haze', 'lift', 'invGamma', 'gain']) for (let c = 0; c < 3; c++) assert.ok(Math.abs(out1[k][c] - out2[k][c]) <= 1e-6 * (1 + Math.abs(out1[k][c])), 'swap ' + k);
  for (const k of ['fogStart', 'fogFull', 'fogCurve', 'hazeK', 'sat']) assert.ok(Math.abs(out1[k] - out2[k]) <= 1e-6 * (1 + Math.abs(out1[k])), 'swap ' + k);
}

// ---- grade vs look-lib L.grade, within 1/255 (cell LUT path and gradeRGB)
const stg = createAtmosState();
let maxD = 0, maxC = 0, maxW = 0, nW = 0;
const wgslCh = compileFn(ATMOS_GRADE_WGSL, 'atmosGradeCh', { pow: Math.pow });
const wgslGrade = compileFn(ATMOS_GRADE_WGSL, 'atmosGrade', { atmosGradeCh: wgslCh, vec3f: shims.vec3f });
for (const s of [{ w: [1, 0], t: [1, 0, 0] }, { w: [0.4, 0.6], t: [0.2, 0.3, 0.5] }, { w: [0, 1], t: [0, 0, 1] }, { w: [0.3, 0.3], t: [0.5, 0.5, 0] }]) {
  mixAtmos(table, { w: Float32Array.from(s.w), wNone: 1 - s.w[0] - s.w[1], tod: Float32Array.from(s.t), version: 1 }, base, stg);
  const gr = { lift: Array.from(stg.lift), gamma: Array.from(stg.invGamma, (x) => 1 / x), gain: Array.from(stg.gain), sat: stg.sat };
  const rt = new CellBuffer(64, 64);
  let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < rt.fg.length; i += 4) for (let c = 0; c < 3; c++) { rt.fg[i + c] = (rnd() * 256) | 0; rt.bg[i + c] = (rnd() * 256) | 0; }
  const src = new Uint8Array(rt.fg); gradeCells(rt, stg);
  const tmp = [0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    const ref = LL.grade([src[i] / 255, src[i + 1] / 255, src[i + 2] / 255], gr);
    tmp[0] = src[i]; tmp[1] = src[i + 1]; tmp[2] = src[i + 2]; gradeRGB(tmp, stg);
    { // ENV-03c: the WGSL atmosGrade (JS-evaluated) vs gradeRGB, 0..1 vs 0..255
      const o = wgslGrade({ x: src[i] / 255, y: src[i + 1] / 255, z: src[i + 2] / 255 }, { x: stg.lift[0], y: stg.lift[1], z: stg.lift[2] }, { x: stg.invGamma[0], y: stg.invGamma[1], z: stg.invGamma[2] }, { x: stg.gain[0], y: stg.gain[1], z: stg.gain[2] }, stg.sat);
      nW++; maxW = Math.max(maxW, Math.abs(o.x * 255 - tmp[0]) / 255, Math.abs(o.y * 255 - tmp[1]) / 255, Math.abs(o.z * 255 - tmp[2]) / 255);
    }
    for (let c = 0; c < 3; c++) {
      maxC = Math.max(maxC, Math.abs(rt.fg[i + c] / 255 - Math.min(1, Math.max(0, ref[c]))));
      maxD = Math.max(maxD, Math.abs(tmp[c] / 255 - ref[c]));
    }
  }
}
assert.ok(maxD <= 1 / 255, 'gradeRGB vs L.grade ' + maxD); assert.ok(maxC <= 1 / 255, 'gradeCells vs L.grade ' + maxC);
assert.ok(ATMOS_GRADE_WGSL.includes('fn atmosGrade(c: vec3f'));
assert.ok(nW >= 3000 * 4 && maxW <= 1 / 255, 'WGSL atmosGrade vs gradeRGB ' + maxW + ' over ' + nW);
{ // splice + uniform append + skip-when-off + mutation
  assert.ok(SPRITES_WGSL.includes(ATMOS_GRADE_WGSL) && SPRITES_WGSL.includes("if (su.atmosLift.w > 0.5)"), "sprites splice");
  assert.ok(!/%|\bround\s*\(|\bmix\s*\(|dpdx|fwidth/.test(ATMOS_GRADE_WGSL), "WGSL lint");
  const bad = compileFn(ATMOS_GRADE_WGSL.replace('(1.0 - x)', '(1.0 + x)'), 'atmosGradeCh', { pow: Math.pow });
  assert.ok(Math.abs(bad(0.5, 0.1, 1, 1) - wgslCh(0.5, 0.1, 1, 1)) > 0.01, 'mutation caught');
}
{ const rt = new CellBuffer(8, 8); for (let i = 0; i < 64; i++) rt.glyphIdx[i] = i; const g0 = new Uint8Array(rt.glyphIdx); const f3 = rt.fg[3]; gradeCells(rt, stg); assert.deepEqual(rt.glyphIdx, g0, 'glyphs unchanged'); assert.equal(rt.fg[3], f3); }

// ---- 0 alloc: mix + apply + LUT haze + grade (after warm-up)
const rtA = new CellBuffer(160, 60), lutA = new Float32Array(128), dm = { w: Float32Array.from([0.5, 0.2]), wNone: 0.3, tod: Float32Array.from([0.6, 0.4, 0]), version: 1 };
const stA = createAtmosState();
const frame = () => { for (let i = 0; i < 300; i++) { dm.w[0] = 0.5 - (i % 7) * 0.01; dm.version++; mixAtmos(table, dm, base, stA); applyAtmosToPalette(P, stA); applySkyHaze(lutA, 32, stA); gradeCells(rtA, stA); } };
const grown = heapGrowth(frame);
assert.ok(grown < 4096, 'heap growth ' + grown);
stA.on = false; applyAtmosToPalette(P, stA);
console.log('atmos.test ok', JSON.stringify({ fitErr: +fitErr.toFixed(4), maxD255: +(maxD * 255).toFixed(3), maxC255: +(maxC * 255).toFixed(3), heapGrowth: grown }));

// ENV-GATEFIX: gradeCells on the real RenderTarget shape (fg/bg live in rt.cells; gpucompare + main pass the RenderTarget)
{ const rt = { cells: new CellBuffer(8, 8), cols: 8, rows: 8 }; for (let i = 0; i < rt.cells.fg.length; i += 4) { rt.cells.fg[i] = 200; rt.cells.bg[i + 1] = 90; }
  const ref = { fg: new Uint8Array(rt.cells.fg), bg: new Uint8Array(rt.cells.bg) }; gradeCells(ref, stg); gradeCells(rt, stg);
  assert.deepEqual(rt.cells.fg, ref.fg, 'RenderTarget fg graded like bare CellBuffer'); assert.deepEqual(rt.cells.bg, ref.bg, 'RenderTarget bg'); }
