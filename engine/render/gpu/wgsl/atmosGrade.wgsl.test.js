// ENV-03c: ATMOS_GRADE_WGSL (atmosCh/atmosGrade) vs gradeRGB (JS twin of design L.grade) on >= 3000 colours x 4 states, <= 1/255; sprites block layout; uniform writer.
// node engine/render/gpu/wgsl/atmosGrade.wgsl.test.js
import assert from 'node:assert/strict';
import { compileFn, shims } from './wgslProbe.js';
import { ATMOS_GRADE_WGSL, createAtmosState, gradeRGB, writeAtmosGradeUniform } from '../../atmos.js';
import { SPRITES_WGSL, SPRITES_BLOCK } from './sprites.wgsl.js';

assert.ok(SPRITES_WGSL.includes('fn atmosGrade(') && SPRITES_WGSL.includes('su.atmosLift.w > 0.5'), 'sprites pass carries the grade');
assert.ok(!/\.(rgb|xyz)\s*[*+\-]?=[^=]/.test(ATMOS_GRADE_WGSL), 'no swizzle assignment');
const last = SPRITES_BLOCK.fields ? SPRITES_BLOCK.fields : null;
for (const n of ['atmosLift', 'atmosInvGamma', 'atmosGain']) assert.ok(SPRITES_BLOCK.field(n).word >= SPRITES_BLOCK.field('dimRect').word + 16, n + ' appended after dimRect');
assert.equal(SPRITES_BLOCK.field('atmosGain').word + 4, SPRITES_BLOCK.sizeWords, 'the 3 vec4 are the END of SpritesU');

const pow = Math.pow;
const atmosCh = compileFn(ATMOS_GRADE_WGSL, 'atmosCh', { ...shims, pow, max: Math.max });
const atmosGrade = compileFn(ATMOS_GRADE_WGSL, 'atmosGrade', { ...shims, pow, atmosCh });
const v3 = (a) => ({ x: a[0], y: a[1], z: a[2] });

const STATES = [
  { lift: [0.02, 0.03, 0.06], gamma: [1.1, 1, 0.9], gain: [0.55, 0.6, 0.9], sat: 0.7 },   // night-like
  { lift: [0.0, 0.0, 0.0], gamma: [1, 1, 1], gain: [1.05, 1.0, 0.95], sat: 1.1 },          // day-like
  { lift: [0.05, 0.03, 0.01], gamma: [0.9, 0.95, 1.05], gain: [1.1, 0.9, 0.8], sat: 0.85 }, // dusk-like
  { lift: [0.1, 0.0, 0.05], gamma: [1.3, 1.2, 1.1], gain: [0.9, 1.0, 1.2], sat: 1.6 },     // extreme
];
let seed = 7; const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
let worst = 0, n = 0;
for (const s of STATES) {
  const st = createAtmosState();
  st.on = true; st.gradeOn = true; st.lift.set(s.lift); st.gain.set(s.gain); st.sat = s.sat;
  for (let i = 0; i < 3; i++) st.invGamma[i] = 1 / s.gamma[i];
  const ig = Array.from(st.invGamma);
  const cols = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (let k = 0; k < 800; k++) cols.push([Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]);
  for (const c of cols) {
    const want = gradeRGB(Float64Array.from(c), st);
    const got = atmosGrade(v3([c[0] / 255, c[1] / 255, c[2] / 255]), v3(s.lift), v3(ig), v3(s.gain), s.sat);
    for (const [i, ch] of ['x', 'y', 'z'].entries()) { worst = Math.max(worst, Math.abs(got[ch] * 255 - want[i])); }
    n++;
  }
  // uniform writer
  const u = new Float32Array(12); writeAtmosGradeUniform(u, 0, st);
  assert.equal(u[3], 1); assert.ok(Math.abs(u[7] - s.sat) < 1e-6); assert.ok(Math.abs(u[8] - s.gain[0]) < 1e-6);
  st.gradeOn = false; writeAtmosGradeUniform(u, 0, st); assert.equal(u[3], 0, 'identity grade = off');
  writeAtmosGradeUniform(u, 0, null); assert.equal(u[3], 0, 'null state = off');
}
assert.ok(n >= 3000, 'colours ' + n);
assert.ok(worst <= 1, 'worst |atmosGrade - gradeRGB| = ' + worst + ' (of 255)');
console.log('atmosGrade.wgsl.test OK: ' + n + ' colours x 4 states worst ' + worst.toFixed(5) + '/255');
