// AUD-40: sky glow/haze parity probes (JS twin vs an independent re-derivation + WGSL source constants) at 3 sun elevations.
import assert from 'node:assert/strict';
import { SKY_GLOW, applySkyGlow, skyGlowStrength, SKY_GLOW_WGSL } from './skyGlow.js';

const P = SKY_GLOW;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// independent oracle (written out again, not calling applySkyGlow)
const BY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function oracle(col, cosA, elev, sunZ, sunI, cx = 0, cy = 0) {
  const s = Math.min(1, Math.max(0, sunI)) * sm(P.sunFadeLo, P.sunFadeHi, sunZ);
  const c = Math.max(cosA, 0);
  let g = (c ** P.haloK * P.haloGain + c ** P.coreK * P.coreGain) * s;
  const d = ((BY[cy % 4][cx % 4] + 0.5) / 16 - 0.5) * P.ditherAmp * Math.min(g * 40, 1);
  const w = 1 - sm(0, P.hazeTopDeg, Math.max(elev, 0));
  return col.map((v, i) => Math.min(255, v * (1 + w * P.hazeLift) + P.hazeWarm[i] * w * s + P.tint[i] * g + d));
}

const base = [90, 140, 200];
for (const elDeg of [5, 35, 75]) { // sun elevation: low, mid, high
  const sunZ = Math.sin(elDeg * Math.PI / 180), sunI = 1;
  for (const [cosA, elev] of [[1, elDeg], [0.97, elDeg + 8], [0.6, 20], [0, 2], [-0.5, 50]]) {
    const cx = Math.round(cosA * 7 + 9), cy = Math.round(elev) + 3;
    const got = applySkyGlow([...base], cosA, elev, sunZ, sunI, cx, cy), want = oracle(base, cosA, elev, sunZ, sunI, cx, cy);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `el ${elDeg} cos ${cosA}`);
  }
  // glow is strongest at the sun, warmer than the base, and weaker away from it (same elevation row, so haze is equal)
  const core = applySkyGlow([...base], 1, 40, sunZ, sunI), halo = applySkyGlow([...base], 0.99, 40, sunZ, sunI), far = applySkyGlow([...base], 0, 40, sunZ, sunI);
  assert.ok(core[0] > halo[0] && halo[0] > far[0] - 1e-9, `falloff at sun el ${elDeg}`);
  assert.deepEqual(far, base.map((v) => v), 'no glow/haze at 40 deg away from the sun');
  // horizon haze lightens the horizon but not the zenith
  const hz = applySkyGlow([...base], -1, 0, sunZ, sunI), zen = applySkyGlow([...base], -1, 60, sunZ, sunI);
  assert.ok(hz[0] > base[0] && hz[1] > base[1] && hz[2] >= base[2], 'haze lightens');
  assert.deepEqual(zen, base);
}
// follows the time of day: sun below horizon or night intensity 0 -> glow off
assert.equal(skyGlowStrength(-0.5, 1), 0);
assert.equal(skyGlowStrength(0.8, 0), 0);
assert.deepEqual(applySkyGlow([...base], 1, 40, -0.5, 1), base);
// constants live in one place: the WGSL text carries the exact params
for (const k of ['haloK', 'haloGain', 'coreK', 'coreGain', 'ditherAmp', 'hazeTopDeg', 'hazeLift']) {
  const lit = Number.isInteger(P[k]) ? P[k].toFixed(1) : String(P[k]);
  assert.ok(SKY_GLOW_WGSL.includes(lit), `WGSL has ${k}=${lit}`);
}
assert.ok(SKY_GLOW_WGSL.includes('vec3f(255.0, 205.0, 130.0)'));
console.log('skyGlow.test OK');
