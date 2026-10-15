// CANOPY-SHAFT-01b (arch 38.76 rule 8a, item 2): compileFn probe of shade `shaftW` + `shaftLiftC` vs the JS oracle lightShaft.js `shaftLift`
// over the full bits (q = 0..15) x k / len / cosSun / sunI / fog range. Bytes exact after rounding (ties within 1e-3 of .5 may differ by 1).
// Run: node engine/render/gpu/wgsl/shaftLift.wgsl.test.js
import assert from 'node:assert/strict';
import { SHADE_SHAFT_WGSL, shaftW as shaftWJs, shaftLift, SHAFT_Q } from '../../lightShaft.js';
import { SKY_GLOW } from '../../skyGlow.js';
import { SHADE_WGSL } from './shade.wgsl.js';
import { compileFn, shims } from './wgslProbe.js';

const f = Math.fround;
const shaftW = compileFn(SHADE_SHAFT_WGSL, 'shaftW', { ...shims, pow: (a, b) => f(Math.pow(a, b)) });
// shaftLiftC works on vec3f objects (outside the probe subset): the source line must be the exact lerp, replayed per channel in f32.
const m = SHADE_WGSL.match(/fn shaftLiftC\(c: vec3f, w: f32, sunI: f32\) -> vec3f \{ return (.*); \}/);
assert.ok(m && m[1] === 'c + (FOG_SUN_TINT * sunI - c) * w', 'shaftLiftC source shape: ' + (m && m[1]));
const liftC = (c, w, sunI, T) => f(c + f(f(f(T * sunI) - c) * w));
const T = SKY_GLOW.tint, out = { fg: [0, 0, 0], bg: [0, 0, 0] };
let n = 0, tie = 0, maxDw = 0;
const ks = [0.05, 0.35, 0.8], isos = [0, 0.25, 0.6], pws = [1, 4, 8], maxMs = [12, 28, 60];
const lens = [0, 3, 14, 28, 55, 200], cosS = [-0.7, 0, 0.2, 0.6, 0.95, 1], sunIs = [0, 0.25, 0.6, 1], fogs = [0, 0.3, 0.9];
const cols = [[0, 0, 0], [40, 90, 30], [200, 180, 120], [255, 255, 255]];
for (let q = 0; q <= SHAFT_Q; q++) for (const k of ks) for (const iso of isos) for (const pw of pws) for (const maxM of maxMs) {
  const A = { k, iso, pw, maxM };
  for (const len of lens) for (const c of cosS) for (const si of sunIs) for (const fg of fogs) {
    const wj = shaftWJs(q, len, c, si, A, fg), wg = shaftW(q, len, c, si, k, iso, pw, maxM, fg);
    if (wj === 0) assert.equal(wg, 0, 'off -> exactly 0'); else maxDw = Math.max(maxDw, Math.abs(wg - wj));
    assert.ok(Math.abs(wg - wj) <= 2e-6 + 2e-6 * Math.abs(wj), `w q=${q} len=${len} cos=${c} sunI=${si} f=${fg}: js ${wj} wgsl ${wg}`);
    if ((n++ & 15) !== 0) continue; // colour replay on a stride (still thousands of cases)
    for (const bg of cols) {
      shaftLift(bg, bg, q, len, c, si, A, out, fg);
      for (let i = 0; i < 3; i++) {
        const gb = liftC(bg[i], wg, si, T[i]), gf = liftC(bg[i], f(wg * 0.5), si, T[i]);
        for (const [js, gp] of [[out.bg[i], gb], [out.fg[i], gf]]) {
          const rj = Math.round(js), rg = Math.round(gp);
          if (rj !== rg) { assert.ok(Math.abs(Math.abs(js % 1) - 0.5) < 1e-3 && Math.abs(rj - rg) <= 1, `byte q=${q} ch=${i} js ${js} wgsl ${gp}`); tie++; }
        }
      }
    }
  }
}
assert.ok(n >= 2000);
console.log(`shaftLift.wgsl: ${n} weight cases (maxDw ${maxDw.toExponential(2)}), colour lift bytes exact (${tie} ties +-1) OK`);
