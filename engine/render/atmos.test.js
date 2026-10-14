// ENV-03b (arch 38.65) Node tests: fog fit, off = identity, wNone 1 = identity, symmetric swap, grade vs L.grade, sky haze, 0 alloc.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import palette from '../../design/palette.js';
import { ATMOS_FOG_FIT, createAtmosState, mixAtmos, applyAtmosToPalette, refreshFogCtx, gradeRGB, applyAtmosGrade } from './atmos.js';
import { fastShadeSky } from './fastShade.js';
import { skyLutFromPalette } from './waterReflect.js';
import { CellBuffer } from './CellBuffer.js';
import { ensureGcChild } from '../test/allocGate.js';
ensureGcChild();
globalThis.window = globalThis.window || globalThis;

const fresh = () => ({ ...palette, rgb: { ...palette.rgb }, hue: { ...palette.hue }, fog: { ...palette.fog } });
// reference L.grade (design/preview/look-lib.js), written out again
const Lgrade = (c, gr) => {
  const r0 = gr.gain[0] * (c[0] + gr.lift[0] * (1 - c[0])), g0 = gr.gain[1] * (c[1] + gr.lift[1] * (1 - c[1])), b0 = gr.gain[2] * (c[2] + gr.lift[2] * (1 - c[2]));
  const r = Math.pow(Math.max(r0, 0), 1 / gr.gamma[0]), g = Math.pow(Math.max(g0, 0), 1 / gr.gamma[1]), b = Math.pow(Math.max(b0, 0), 1 / gr.gamma[2]);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [l + (r - l) * gr.sat, l + (g - l) * gr.sat, l + (b - l) * gr.sat];
};
const F = (a) => Float32Array.from(a);
const rec = (o) => ({ fog: F(o.fog), fogDensity: o.d, haze: F(o.haze), hazeAmount: o.ha, lift: F(o.lift), gamma: F(o.gamma), gain: F(o.gain), sat: o.sat });
const A = rec({ fog: [200, 220, 230], d: 0.004, haze: [250, 230, 200], ha: 0.5, lift: [0.02, 0.02, 0.03], gamma: [1, 1.1, 0.95], gain: [1.04, 1.0, 0.92], sat: 1.1 });
const B = rec({ fog: [90, 110, 140], d: 0.012, haze: [120, 140, 190], ha: 0.8, lift: [0.0, 0.01, 0.0], gamma: [0.97, 1, 1], gain: [0.9, 0.95, 1.0], sat: 0.9 });
const table = { n: 2, recs: [A, A, A, B, B, B] };
const w = new Float32Array(2), tod = new Float32Array([1, 0, 0]);
const drv = { w, wNone: 1, tod, on: true };
const base = { nearRGB: [150, 170, 190], farRGB: [180, 200, 220], start: 50, full: 900, curve: 1.3 };
const near = (a, b, e) => Math.abs(a - b) <= e;

// 1. fit error <= 0.09 against 1 - exp(-d t) for d t in [0,3] (existing curve, start 0, full = fullK / d)
let worst = 0;
for (let x = 0; x <= 3.0001; x += 0.01) {
  const t = x / ATMOS_FOG_FIT.fullK, fit = t >= 1 ? 1 : Math.pow(t, ATMOS_FOG_FIT.curve);
  worst = Math.max(worst, Math.abs(fit - (1 - Math.exp(-x))));
}
assert.ok(worst <= 0.09, 'fog fit error ' + worst);

// 2. never applied / applied off: palette untouched, sky + water LUT hashes equal to the pre-change baseline
function skyHash(P) {
  const h = crypto.createHash('sha1'), o = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] };
  for (let az = 0; az < 360; az += 17) for (let el = 0; el < 80; el += 3) { fastShadeSky(P, az, el, P.defaultTime, o); h.update(JSON.stringify(o)); }
  const lut = new Float32Array(128), top = skyLutFromPalette(P, lut); h.update(Buffer.from(lut.buffer)); h.update(String(top));
  return h.digest('hex');
}
const BASELINE = 'db84e48c371e77cec00fd7953c8e40dbf70057b8'; // same loop on the tree before ENV-03b (fastShade/waterReflect unmodified)
const P = fresh(), st = createAtmosState();
assert.equal(skyHash(P), BASELINE, 'never applied == pre-change');
const farRec = P.fog.far;
applyAtmosToPalette(P, st); // state.on false
assert.equal(P.fog.far, farRec); assert.equal(P.liveFogVersion | 0, 0, 'off never-applied: no version bump');

// 3. wNone = 1 with on = true: identity (fog == base, grade identity, bytes identical)
mixAtmos(table, drv, base, st);
assert.equal(st.gradeOn, false); assert.equal(st.hazeK, 0);
assert.deepEqual([st.fogStart, st.fogFull, st.fogCurve], [50, 900, 1.3]); assert.deepEqual([...st.fogNear], [150, 170, 190]);
applyAtmosToPalette(P, st);
const live = P.fog.far;
assert.notEqual(live, farRec); assert.equal(P.fog.farBase, farRec); assert.deepEqual([live.start, live.full, live.curve], [50, 900, 1.3]);
assert.deepEqual(P.rgb[live.color], [150, 170, 190]); assert.deepEqual(P.rgb[live.colorFar], [180, 200, 220]);
assert.equal(skyHash(P), BASELINE, 'wNone=1 sky bytes identical');
const cb1 = new CellBuffer(8, 4); for (let i = 0; i < cb1.fg.length; i++) { cb1.fg[i] = (i * 37) & 255; cb1.bg[i] = (i * 91) & 255; }
const snap = cb1.fg.slice(), snapB = cb1.bg.slice();
applyAtmosGrade({ cells: cb1 }, st);
assert.deepEqual(cb1.fg, snap); assert.deepEqual(cb1.bg, snapB);

// 4. off again restores the base record and bumps once; the live record is persistent (same object on re-apply)
const v = P.liveFogVersion;
drv.on = false; mixAtmos(table, drv, base, st); applyAtmosToPalette(P, st);
assert.equal(P.fog.far, farRec); assert.equal(P.liveFogVersion, v + 1); assert.equal(P.atmosLive, null);
applyAtmosToPalette(P, st); assert.equal(P.liveFogVersion, v + 1, 'off twice: no further bump');
drv.on = true; w[0] = 1; w[1] = 0; drv.wNone = 0; mixAtmos(table, drv, base, st); applyAtmosToPalette(P, st);
assert.equal(P.fog.far, live, 'same live record object');

// 5. blend values + lo/hi swap symmetry
assert.ok(near(st.fogFull, ATMOS_FOG_FIT.fullK / 0.004, 1e-3) && st.fogStart === 0 && near(st.fogCurve, 0.55, 1e-12));
assert.deepEqual([...st.fogNear], [...F(A.fog)]);
const swap = (wa, wb) => { w[0] = wa; w[1] = wb; drv.wNone = 1 - wa - wb; mixAtmos(table, drv, base, st); return { full: st.fogFull, c: [...st.fogNear], hk: st.hazeK, g: [...st.gain], s: st.sat }; };
const lo = swap(0.3, 0.7);
const origRecs = table.recs;
table.recs = [B, B, B, A, A, A]; // swap the entries AND the weights: identical result
const lo2 = swap(0.7, 0.3); table.recs = origRecs;
assert.ok(near(lo2.full, lo.full, 1e-9) && lo2.c.every((x, i) => near(x, lo.c[i], 1e-9)) && near(lo2.hk, lo.hk, 1e-12) && near(lo2.s, lo.s, 1e-12), 'swap symmetric');
// partial none: hazeK shrinks, grade fades to identity, density mixes in 1/full space
swap(0.5, 0.0); drv.wNone = 0.5; mixAtmos(table, drv, base, st);
assert.ok(near(st.hazeK, 0.5 * 0.5, 1e-12) && near(st.sat, 0.5 + 0.5 * 1.1, 1e-12) && near(1 / st.fogFull, 0.5 / 900 + 0.5 * 0.004 / 2.5, 1e-12));
assert.ok(near(st.haze[0], 250, 1e-4), 'haze colour is premultiplied by hazeAmount');

// 6. grade vs L.grade within 1/255, on 3000 cells (6000 colours) x 4 states
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const states = [[1, 0, [1, 0, 0]], [0, 1, [0, 1, 0]], [0.4, 0.6, [1, 0, 0]], [0.5, 0.25, [0.2, 0.3, 0.5]]];
for (const [wa, wb, t3] of states) {
  tod.set(t3); swap(wa, wb);
  const gr = { lift: st.lift, gamma: [1 / st.invGamma[0], 1 / st.invGamma[1], 1 / st.invGamma[2]], gain: st.gain, sat: st.sat };
  const cb = new CellBuffer(60, 50);
  for (let i = 0; i < cb.fg.length; i++) { cb.fg[i] = rnd() * 256; cb.bg[i] = rnd() * 256; }
  const f0 = cb.fg.slice(), b0 = cb.bg.slice();
  applyAtmosGrade({ cells: cb }, st);
  let maxE = 0, maxE2 = 0;
  for (let i = 0; i < 3000; i++) for (const [src, dst] of [[f0, cb.fg], [b0, cb.bg]]) {
    const ref = Lgrade([src[i * 4] / 255, src[i * 4 + 1] / 255, src[i * 4 + 2] / 255], gr);
    const rgb = [src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]; gradeRGB(rgb, st);
    for (let c = 0; c < 3; c++) {
      const r = Math.min(1, Math.max(0, ref[c]));
      maxE = Math.max(maxE, Math.abs(dst[i * 4 + c] / 255 - r));
      maxE2 = Math.max(maxE2, Math.abs(Math.min(255, Math.max(0, rgb[c])) / 255 - r));
    }
    assert.equal(dst[i * 4 + 3], src[i * 4 + 3], 'glyph byte untouched');
  }
  assert.ok(maxE <= 1 / 255 + 1e-9 && maxE2 < 1e-9, `grade error ${maxE} ${maxE2}`);
}

// 7. sky haze: horizon mixes toward haze, top untouched
tod.set([1, 0, 0]); swap(1, 0);
const lutA = new Float32Array(128), lutB = new Float32Array(128);
P.atmosLive = null; const top0 = skyLutFromPalette(P, lutA); P.atmosLive = st; const top1 = skyLutFromPalette(P, lutB);
assert.equal(top0, top1); assert.ok(lutB[0] !== lutA[0] && lutB[124] === lutA[124], 'horizon hazed, top (t=1) untouched');
assert.ok(near(lutB[0], lutA[0] + (st.haze[0] - lutA[0]) * st.hazeK, 1e-3), 'horizon = mix by hazeK');
const o1 = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] }, o2 = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] };
fastShadeSky(P, 10, 0, P.defaultTime, o1); P.atmosLive = null; fastShadeSky(P, 10, 0, P.defaultTime, o2);
assert.ok(o1.bg[0] !== o2.bg[0], 'fastShadeSky applies haze at the horizon'); P.atmosLive = st;

// 8. terrain ctx refresh on liveFogVersion
const ctx = { fog: { start: 1, full: 2, curve: 1, nearRGB: null, farRGB: null } };
assert.equal(refreshFogCtx(ctx, P, P.liveFogVersion | 0), false);
assert.equal(refreshFogCtx(ctx, P, -1), true); assert.equal(ctx.fog.full, P.fog.far.full);

// 9. 0 alloc (heap, with --expose-gc)
if (globalThis.gc) {
  const cb = new CellBuffer(480, 180); tod.set([0.5, 0.5, 0]);
  const loop = (n) => { for (let i = 0; i < n; i++) { w[0] = 0.5 + (i & 1) * 0.1; w[1] = 0.3; drv.wNone = 1 - w[0] - w[1]; mixAtmos(table, drv, base, st); applyAtmosToPalette(P, st); applyAtmosGrade({ cells: cb }, st); } };
  loop(50); globalThis.gc(); const h0 = process.memoryUsage().heapUsed; loop(300); globalThis.gc();
  assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'no per-step allocation');
  const t0 = performance.now(); loop(20); console.log('atmos: ms/step incl. grade 480x180:', ((performance.now() - t0) / 20).toFixed(2));
}
console.log('atmos tests OK (fit worst ' + worst.toFixed(4) + ')');
