// engine/render/lightShaft.test.js - CANOPY-SHAFT-01a (docs/architecture.md 38.76). node engine/render/lightShaft.test.js
import assert from 'node:assert/strict';
import { shadowSunMatrix } from './shadowSun.js';
import { compileFn, shims } from './gpu/wgsl/wgslProbe.js';
import { SHAFT_SHIFT, SHAFT_MASK, shaftStepsFor, shaftPack, shaftUnpack, shaftIgn, shaftLitQ, shaftW, shaftLift, LIGHT_SHAFT_WGSL, SHADE_SHAFT_WGSL } from './lightShaft.js';

let pass = 0;
const ok = (name, cond, d) => { assert.ok(cond, name + (d ? ' - ' + d : '')); pass++; };

// ---- fixture: sun 30 deg off vertical, canopy slab at z=8 with a 2 m gap, ground z=0 -------------------
const sun = [0.5, 0, Math.sqrt(0.75)];
const RES = 512, BOX = 64;
const opts = { res: RES, boxM: BOX, biasM: 0.04, normalOffsetTexels: 1.5 };
const mk = () => ({ M: new Float64Array(16), planes: new Float64Array(24) });
const M = shadowSunMatrix(sun, [0, 0, 0], opts, { min: 0, max: 12 }, mk()).M;
function makeMap(canopy) {
  const zbuf = new Float32Array(RES * RES).fill(1);
  const put = (x, y, z) => {
    const cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cz = M[2] * x + M[6] * y + M[10] * z + M[14];
    const tx = Math.floor((cx + 1) * 0.5 * RES), ty = Math.floor((cy + 1) * 0.5 * RES);
    if (tx < 0 || ty < 0 || tx >= RES || ty >= RES) return;
    if (cz < zbuf[ty * RES + tx]) zbuf[ty * RES + tx] = cz;
  };
  for (let x = -30; x <= 30; x += 0.06) for (let y = -30; y <= 30; y += 0.06) {
    put(x, y, 0);
    if (canopy && (x < -1 || x > 1)) put(x, y, 8); // gap x in [-1, 1]
  }
  return { W: RES, zbuf };
}
const open = makeMap(false), roof = makeMap(true);
const ray = (x, map) => shaftLitQ(map, M, opts, [x, -10, 2], [0, 1, 0], 20, 10, 5, 7);

// beam under the gap sits at x in [-4.5, -2.5] at z = 2; x = 0 and x = 8 are under the canopy
ok('lit gap produces a shaft band: beam ray bright', ray(-3.5, roof) >= 13, 'q=' + ray(-3.5, roof));
ok('shadowed rays dark', ray(0, roof) <= 2 && ray(8, roof) <= 2, ray(0, roof) + ',' + ray(8, roof));
ok('band contrast', ray(-3.5, roof) - ray(0, roof) >= 10);
ok('no canopy: uniform full q (no band)', [-8, -3.5, 0, 8].every((x) => ray(x, open) === 15));
ok('same inputs twice identical', ray(-3.5, roof) === ray(-3.5, roof) && shaftIgn(12, 34) === shaftIgn(12, 34));
ok('steps 0 -> q 0', shaftLitQ(roof, M, opts, [0, -10, 2], [0, 1, 0], 20, 0, 1, 1) === 0);
ok('preset gate', shaftStepsFor('low') === 0 && shaftStepsFor('medium') === 0 && shaftStepsFor('high') === 6 && shaftStepsFor('ultra') === 10 && shaftStepsFor('x') === 0);
const Mdown = shadowSunMatrix([0.5, 0, -0.3], [0, 0, 0], opts, { min: 0, max: 12 }, mk()).M;
ok('sun below horizon -> q 0', shaftLitQ(open, Mdown, opts, [0, -10, 2], [0, 1, 0], 20, 10, 1, 1) === 0);
ok('outside box = lit', shaftLitQ(roof, M, opts, [500, -10, 2], [0, 1, 0], 20, 10, 1, 1) === 15);
ok('ign in [0,1)', (() => { for (let c = 0; c < 240; c++) for (let r = 0; r < 90; r++) { const v = shaftIgn(c, r); if (!(v >= 0 && v < 1)) return false; } return true; })());

// ---- bits packing: bits 0..19 and 24..31 untouched (contact AO uses 1..7, OUTDOOR 19, cloud 24..31) ----
ok('pack leaves other bits', (() => {
  for (const w of [0, 0xffffffff, 0xff0fffff, 0x12345678, 0x000fffff, 0xff000001]) for (let q = 0; q < 16; q++) {
    const p = shaftPack(w, q);
    if (((p & ~SHAFT_MASK) >>> 0) !== ((w & ~SHAFT_MASK) >>> 0) || shaftUnpack(p) !== q) return false;
  }
  return SHAFT_SHIFT === 20 && SHAFT_MASK === 0x00f00000;
})());

// ---- lift: off is bit-equal, on only moves toward the tint ----
const A = { k: 0.35, iso: 0.25, pw: 4, maxM: 28 };
const out = { fg: [0, 0, 0], bg: [0, 0, 0] };
const fg = [10.3, 99.1, 200.7], bg = [3.3, 30.5, 70.9];
shaftLift(fg, bg, 0, 20, 0.9, 1, A, out);
ok('q 0 no-op bit-equal', out.fg.every((v, i) => Object.is(v, fg[i])) && out.bg.every((v, i) => Object.is(v, bg[i])));
shaftLift(fg, bg, 15, 20, 0.9, 1, { ...A, k: 0 }, out);
ok('k 0 no-op', out.bg.every((v, i) => Object.is(v, bg[i])));
shaftLift(fg, bg, 15, 20, 0.9, 0, A, out);
ok('sunI 0 no-op', out.bg.every((v, i) => Object.is(v, bg[i])));
shaftLift(fg, bg, 15, 20, 0.9, 1, A, out);
ok('lift brightens bg toward tint', out.bg[0] > bg[0] && out.bg[2] > bg[2] && out.fg[0] > fg[0]);
shaftLift(fg, bg, 15, 20, 0.9, 1, A, out, 1);
ok('full fog -> no lift', out.bg.every((v, i) => v === bg[i]));

// ---- WGSL probes ----
ok('no raw % / round / mod / fract / trig in WGSL', !/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(|cos\s*\(|tan\s*\(/.test(LIGHT_SHAFT_WGSL + SHADE_SHAFT_WGSL));
const toCols = (Mm) => [0, 1, 2, 3].map((c) => ({ x: Mm[c * 4], y: Mm[c * 4 + 1], z: Mm[c * 4 + 2], w: Mm[c * 4 + 3] }));
function wgslFor(map, Mm) {
  const fl = Math.hypot(Mm[2], Mm[6], Mm[10]);
  const u = { sunShadowM: toCols(Mm), sunShadowRes: RES, sunShadowBiasM: opts.biasM, sunDir: { x: -Mm[2] / fl, y: -Mm[6] / fl, z: -Mm[10] / fl } };
  const tex = (_t, p) => 0.75 + 0.25 * map.zbuf[p.y * RES + p.x];
  return compileFn(LIGHT_SHAFT_WGSL, 'shaftLitQ', { u, uSunShadow: null, textureLoad: tex, shaftIgn: compileFn(LIGHT_SHAFT_WGSL, 'shaftIgn', {}) });
}
let cells = 0, diff = 0;
for (const [map, Mm] of [[roof, M], [open, M], [roof, Mdown]]) {
  const w = wgslFor(map, Mm);
  for (let i = 0; i < 2400; i++) {
    const col = i % 240, row = (i * 7) % 90;
    const eye = [-12 + (i % 24), -10, 1 + (i % 5)], dir = [Math.sin(i) * 0.3, Math.cos(i * 0.37) * 0.5 + 0.8, 0];
    const dl = Math.hypot(dir[0], dir[1]); dir[0] /= dl; dir[1] /= dl;
    const steps = (i & 1) ? 10 : 6, len = 5 + (i % 23);
    const a = shaftLitQ(map, Mm, opts, eye, dir, len, steps, col, row);
    const b = w(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], len, steps, col, row);
    cells++; if (a !== b) { diff++; assert.ok(Math.abs(a - b) <= 1, `q ${a} vs ${b}`); }
  }
}
ok('WGSL shaftLitQ == oracle on 7200 cells x 3 poses (exact; <=1 boundary)', cells === 7200 && diff <= 7, 'diff=' + diff);
const wW = compileFn(SHADE_SHAFT_WGSL, 'shaftW', { ...shims, pow: Math.pow });
ok('WGSL shaftW == oracle', (() => {
  for (let i = 0; i < 3000; i++) {
    const q = i % 16, len = (i % 40), c = Math.sin(i), f = (i % 11) / 11, sunI = (i % 5) / 4;
    if (Math.abs(wW(q, len, c, sunI, A.k, A.iso, A.pw, A.maxM, f) - shaftW(q, len, c, sunI, A, f)) > 1e-9) return false;
  }
  return true;
})());

// ---- cost at 240x90, 10 steps ----
{
  const eye = [0, -10, 2], dir = [0, 1, 0];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 240 * 90; c++) shaftLitQ(roof, M, opts, eye, dir, 20, 10, c % 240, (c / 240) | 0);
  const t0 = performance.now(); let s = 0;
  for (let c = 0; c < 240 * 90; c++) s += shaftLitQ(roof, M, opts, eye, dir, 20, 10, c % 240, (c / 240) | 0);
  console.log(`shaft JS oracle 240x90 x10 steps: ${(performance.now() - t0).toFixed(2)} ms (${s})`);
}
console.log(`lightShaft.test: ${pass} checks ok`);
