// AUD-42: water reflection (sky tint at mirrored elevation + Schlick fresnel) - JS twin vs an independent f32 re-evaluation of
// the WGSL expressions at 3 view angles, plus shader/uniform wiring. Run: node engine/render/waterReflect.test.js
import { WATER_REFLECT, waterReflectAt, waterReflectMix, skyLutFromPalette } from './waterReflect.js';
import { WATER_COMPOSITE_WGSL, WATER_COMPOSITE_BLOCK } from './gpu/wgsl/waterComposite.wgsl.js';
import { SKY_LUT_N } from './gpu/wgsl/skyLut.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const f = Math.fround;

// synthetic LUT: r = 10*i, g = 255 - 5*i, b = 100 (distinct per sample)
const lut = new Float32Array(4 * SKY_LUT_N);
for (let i = 0; i < SKY_LUT_N; i++) { lut[i * 4] = 10 * i; lut[i * 4 + 1] = 255 - 5 * i; lut[i * 4 + 2] = 100; }
const ELEV_TOP = 60, out = new Float64Array(4);

// independent f32 evaluation written the way the WGSL reads (clamp / asin / degrees / floor(+0.5))
function gpuRef(dx, dy, dz) {
  const len = f(Math.sqrt(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)));
  let c = len > 1e-6 ? f(-dz / len) : 0; c = Math.min(Math.max(c, 0), 1);
  const m = f(1 - c), m2 = f(m * m);
  const F = f(WATER_REFLECT.f0 + f((1 - WATER_REFLECT.f0) * f(f(m2 * m2) * m)));
  const t = Math.min(Math.max(f(f(Math.asin(c) * (180 / Math.PI)) / ELEV_TOP), 0), 1);
  const idx = Math.floor(f(f(t * (SKY_LUT_N - 1)) + 0.5));
  return { F, sky: [lut[idx * 4], lut[idx * 4 + 1], lut[idx * 4 + 2]], idx };
}

const angles = [[0, 0.5, -10], [0, 10, -5], [0, 40, -1]]; // steep, ~27 deg, grazing (~1.4 deg)
const Fs = [];
for (const [dx, dy, dz] of angles) {
  waterReflectAt(5, dx, dy, dz, lut, ELEV_TOP, out);
  const g = gpuRef(dx, dy, dz);
  ok(Math.abs(out[0] - g.F) < 1e-5, `fresnel twin == f32 ref at (${dx},${dy},${dz}): ${out[0]} vs ${g.F}`);
  ok(out[1] === g.sky[0] && out[2] === g.sky[1] && out[3] === g.sky[2], `sky LUT texel == ref (idx ${g.idx})`);
  Fs.push(out[0]);
}
ok(Fs[0] < Fs[1] && Fs[1] < Fs[2], `fresnel grows toward grazing: ${Fs.map((v) => v.toFixed(3))}`);
ok(Fs[0] < 0.1 && Fs[2] > 0.5, 'steep ~F0 (see into water), grazing mostly sky');
// mirrored elevation: steeper view -> higher LUT index (higher in the sky)
waterReflectAt(5, 0, 0.5, -10, lut, ELEV_TOP, out); const hiR = out[1];
waterReflectAt(5, 0, 40, -1, lut, ELEV_TOP, out); ok(out[1] < hiR, 'grazing view samples near the horizon (low LUT index)');
// mix: F=0 keeps body darkened only, F=1 gives sky*skyMix + body*(1-skyMix)*1
ok(Math.abs(waterReflectMix(100, 0, 200) - 100 * (1 - WATER_REFLECT.darken)) < 1e-9, 'F=0: body * (1 - darken)');
ok(Math.abs(waterReflectMix(100, 1, 200) - (100 * (1 - WATER_REFLECT.skyMix) + 200 * WATER_REFLECT.skyMix)) < 1e-9, 'F=1: skyMix blend');
// no sky -> off
waterReflectAt(5, 0, 1, -1, lut, 0, out); ok(out[0] === 0, 'elevTop 0 -> fresnel 0 (off)');
ok(skyLutFromPalette(null, lut) === 0, 'no palette -> 0');
// wiring
ok(WATER_COMPOSITE_BLOCK.field('reflectU') && WATER_COMPOSITE_BLOCK.field('skyLut'), 'uniform block has reflectU + skyLut');
ok(WATER_COMPOSITE_WGSL.includes(String(WATER_REFLECT.f0)) && WATER_COMPOSITE_WGSL.includes(String(WATER_REFLECT.skyMix)) && WATER_COMPOSITE_WGSL.includes(String(WATER_REFLECT.darken)), 'WGSL carries the shared constants');
ok(/asin\(rc\)/.test(WATER_COMPOSITE_WGSL) && /wu\.skyLut\[/.test(WATER_COMPOSITE_WGSL), 'WGSL samples the sky LUT at the mirrored elevation');
console.log(`waterReflect: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
