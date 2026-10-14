// POST-STACK-01b (docs/architecture.md 38.73): POST_WGSL (JS-evaluated via wgslProbe compileFn) vs the JS twin postCells, within 1/255,
// over >= 3000 colours x 4 states x 8 uv/depth points; splice order + uniform append + WGSL lint + mutation. node engine/render/post.wgsl.test.js
import assert from 'node:assert/strict';
import { compileFn, shims } from './gpu/wgsl/wgslProbe.js';
import { POST_WGSL, createPostState, composePost, postCells } from './post.js';
import { ATMOS_GRADE_WGSL, createAtmosState } from './atmos.js';
import { SPRITES_WGSL, SPRITES_BLOCK } from './gpu/wgsl/sprites.wgsl.js';
import { CellBuffer } from './CellBuffer.js';

const ex = { exp: Math.exp, pow: Math.pow };
const q8 = compileFn(POST_WGSL, 'postQ8', ex);
const mistF = compileFn(POST_WGSL, 'postMistF', ex);
const vigF = compileFn(POST_WGSL, 'postVigF', ex);
const ch = compileFn(ATMOS_GRADE_WGSL, 'atmosGradeCh', ex);
const grade = compileFn(ATMOS_GRADE_WGSL, 'atmosGrade', { atmosGradeCh: ch });
const finish = compileFn(POST_WGSL, 'postFinish', { postQ8: q8, atmosGrade: grade, ...ex });
const v3 = (a) => ({ x: a[0], y: a[1], z: a[2] });

// atmos state (a mild biome grade) + a preset grade
const at = createAtmosState();
at.on = true; at.gradeId = false; at.lift.set([0.02, 0.01, 0.03]); at.invGamma.set([0.95, 1, 1.05]); at.gain.set([0.95, 0.9, 1.0]); at.sat = 0.9; at.gradeStamp++;
const PG = { lift: [0.01, 0, 0.01], gamma: [1.05, 1, 0.95], gain: [1.02, 1, 0.98], sat: 1.1 };
const MIST = { rgb: [0.55, 0.6, 0.7], density: 0.03, start: 4, heightK: 0 };
const VIG = { k: 0.45, r0: 0.4, r1: 0.95, rgb: [0.02, 0.02, 0.05] };
const STATES = [
  ['mist', null, { mist: MIST }], ['gradeOverAtmos', at, { grade: PG }], ['vignette', null, { vignette: VIG }],
  ['all', at, { grade: PG, vignette: VIG, mist: MIST }],
];
const COLS = 64, ROWS = 48; // 3072 cells x (fg + bg) colours per state
let worst = 0, n = 0;
for (const [name, atmos, cfg] of STATES) {
  const st = composePost(atmos, cfg, createPostState());
  const rt = new CellBuffer(COLS, ROWS);
  let seed = 777; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const depth = new Float32Array(COLS * ROWS);
  for (let i = 0; i < depth.length; i++) { depth[i] = i % 7 === 0 ? 2 : rnd() * 60; for (let c = 0; c < 3; c++) { rt.fg[i * 4 + c] = (rnd() * 256) | 0; rt.bg[i * 4 + c] = (rnd() * 256) | 0; } }
  const src = { fg: new Uint8Array(rt.fg), bg: new Uint8Array(rt.bg) };
  postCells(rt, depth, st);
  const aspect = COLS / ROWS; // CellBuffer has no pxCell*: twin uses cols/rows
  for (let i = 0; i < COLS * ROWS; i++) {
    const ux = ((i % COLS) + 0.5) / COLS, uy = (((i / COLS) | 0) + 0.5) / ROWS;
    const mf = st.mist[3] > 0 ? mistF(depth[i], 0, st.mist[0], st.mist[1], st.mist[2]) : 0;
    const vf = st.vig[3] > 0 ? vigF(ux, uy, aspect, st.vig[0], st.vig[1], st.vig[2]) : 0;
    for (const [buf, ref] of [[src.fg, rt.fg], [src.bg, rt.bg]]) {
      const o = finish(v3([buf[i * 4] / 255, buf[i * 4 + 1] / 255, buf[i * 4 + 2] / 255]), mf, vf, v3(st.mistRGB), v3(st.vigRGB), st.gradeOn && !st.gradeId ? 1 : 0, v3(st.lift), v3(st.invGamma), v3(st.gain), st.sat);
      for (const [c, k] of [['x', 0], ['y', 1], ['z', 2]]) { worst = Math.max(worst, Math.abs(o[c] - ref[i * 4 + k] / 255)); n++; }
    }
  }
  assert.ok(worst <= 1 / 255 + 1e-9, `${name}: postFinish vs postCells worst ${worst * 255} / 255`);
}
assert.ok(n >= 3000 * 4 * 3, 'probe count ' + n);
// mist 0 at d <= start; vignette symmetric
assert.equal(mistF(4, 0, 0.03, 4, 0), 0); assert.equal(mistF(3, 0, 0.03, 4, 0), 0); assert.ok(mistF(10, 0, 0.03, 4, 0) > 0);
assert.ok(Math.abs(vigF(0.2, 0.3, 1.6, 0.4, 0.3, 0.9) - vigF(0.8, 0.7, 1.6, 0.4, 0.3, 0.9)) < 1e-12);
// splice order: mist -> grade -> vignette inside postFinish; POST_WGSL after ATMOS_GRADE_WGSL in the shader; uniforms at the END of SpritesU
const body = POST_WGSL.slice(POST_WGSL.indexOf('fn postFinish'));
assert.ok(body.indexOf('mf > 0.0') < body.indexOf('atmosGrade(') && body.indexOf('atmosGrade(') < body.indexOf('vf > 0.0'), 'order mist, grade, vignette');
assert.ok(SPRITES_WGSL.includes(POST_WGSL) && SPRITES_WGSL.indexOf(ATMOS_GRADE_WGSL) < SPRITES_WGSL.indexOf(POST_WGSL), 'sprites splice order');
const names = SPRITES_BLOCK.fields ? SPRITES_BLOCK.fields.map((f) => f.name) : null;
if (names) assert.deepEqual(names.slice(-4), ['postVig', 'postVigRGB', 'postMist', 'postMistB']);
assert.equal(SPRITES_BLOCK.field('postMistB').offset, SPRITES_BLOCK.sizeBytes - 16, 'post words at the END');
assert.ok(SPRITES_WGSL.indexOf('postFinish(o.fg.rgb') > SPRITES_WGSL.indexOf('dimAll < 1.0') && SPRITES_WGSL.indexOf('postFinish(o.fg.rgb') < SPRITES_WGSL.indexOf('if (su.atmosLift.w > 0.5)'), 'after fade/dim, before old grade block');
// WGSL lint
assert.ok(!/%|\bround\s*\(|\bmix\s*\(|\bsmoothstep\s*\(|dpdx|fwidth|\bmod\b/.test(POST_WGSL), 'WGSL lint');
// mutation: wrong mist exponent sign must be caught
const bad = compileFn(POST_WGSL.replace('exp(-density * e)', 'exp(-density * e * 2.0)'), 'postMistF', ex);
assert.ok(Math.abs(bad(10, 0, 0.03, 4, 0) - mistF(10, 0, 0.03, 4, 0)) > 0.01, 'mutation caught');
console.log('post.wgsl.test OK: worst ' + (worst * 255).toFixed(3) + '/255 over ' + n + ' channel probes');
