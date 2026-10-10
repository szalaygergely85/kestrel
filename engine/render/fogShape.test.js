// AUD-45: JS twin of the WGSL height fog + sun in-scatter (D-039). Node only.
import assert from 'node:assert/strict';
import { FOG_SHAPE, FOG_SHAPE_WGSL, fogShapeF, fogScatterW, fogScatterColor, fogDirShear, fogShapeCtx, fogCellDirJS } from './fogShape.js';
import { SKY_GLOW } from './skyGlow.js';

const P = FOG_SHAPE;
// Independent closed form (written out again, not calling the module).
const ref = (f, d, z, s) => (f <= 0 ? 0 : Math.min(f * (1 + P.heightGain * Math.min(Math.exp(-(z + s * d * 0.5 - P.base) * P.k), P.maxValley)), 1));
for (const f of [0, 0.05, 0.3, 0.7, 1]) for (const d of [10, 60, 200]) for (const z of [-5, 0, 6, 20, 80]) for (const s of [-0.4, 0, 0.3]) {
  assert.ok(Math.abs(fogShapeF(f, d, z, s) - ref(f, d, z, s)) < 1e-12, `fogShapeF ${f} ${d} ${z} ${s}`);
}
assert.equal(fogShapeF(0, 50, 0, 0), 0, 'f == 0 untouched (short range)');
assert.equal(fogShapeF(1, 50, 0, 0), 1, 'f == 1 stays 1');
assert.ok(fogShapeF(0.4, 100, 0, 0) > fogShapeF(0.4, 100, 60, 0), 'denser low than high');
assert.ok(fogShapeF(0.4, 100, 0, -0.3) > fogShapeF(0.4, 100, 0, 0.3), 'looking down into the valley is denser than looking up');
// Modest at the start of the ramp: a barely-fogged cell gains at most heightGain * maxValley * f.
assert.ok(fogShapeF(0.05, 40, 0, 0) - 0.05 <= 0.05 * P.heightGain * P.maxValley + 1e-12);

// Scatter: peaks toward the sun, 0 away from it, 0 with the sun below the horizon, 0 with sunI 0.
const wMax = fogScatterW(1, 0.5, 1);
assert.ok(Math.abs(wMax - P.scatterGain) < 1e-12);
assert.equal(fogScatterW(-0.5, 0.5, 1), 0);
assert.equal(fogScatterW(1, -0.3, 1), 0);
assert.equal(fogScatterW(1, 0.5, 0), 0);
assert.ok(fogScatterW(0.9, 0.5, 1) < wMax && fogScatterW(0.9, 0.5, 1) > fogScatterW(0.5, 0.5, 1));
const out = [0, 0, 0];
fogScatterColor(out, [100, 100, 100], 0);
assert.deepEqual(out, [100, 100, 100]);
fogScatterColor(out, [100, 100, 100], 1);
assert.deepEqual(out, [...SKY_GLOW.tint]);

// WGSL snippet carries the same constants (generated from FOG_SHAPE, single source).
for (const k of ['base', 'k', 'heightGain', 'maxValley', 'scatterK', 'scatterGain']) {
  const v = Number.isInteger(P[k]) ? P[k].toFixed(1) : String(P[k]);
  assert.ok(FOG_SHAPE_WGSL.includes(v), `WGSL has ${k}=${v}`);
}
assert.ok(FOG_SHAPE_WGSL.includes('vec3f(255.0, 205.0, 130.0)'), 'sun tint reused from SKY_GLOW');

// Shear cell direction: unit length and equal to the sky's atan-based ray (sky.js / WGSL fillSky branch).
const t = { cols: 80, rows: 40, dirX: Math.sin(0.7), dirY: -Math.cos(0.7), planeX: 0.9 * Math.cos(0.7), planeY: 0.9 * Math.sin(0.7), planeDistY: 30, horizonRow: 18 };
Object.assign(fogShapeCtx, { on: true, mode: 0, terms: t });
for (const [c, r] of [[0, 0], [40, 18], [79, 39], [10, 30]]) {
  const d = fogCellDirJS(c, r);
  assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-12);
  const cx = (2 * (c + 0.5)) / t.cols - 1, hx = t.dirX + t.planeX * cx, hy = t.dirY + t.planeY * cx;
  const er = Math.atan2(t.horizonRow - r, t.planeDistY), n = Math.hypot(hx, hy);
  const e = [hx / n * Math.cos(er), hy / n * Math.cos(er), Math.sin(er)];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(d[i] - e[i]) < 1e-9, `shear dir ${c},${r}`);
}
fogShapeCtx.on = false;
console.log('fogShape.test.js OK');
