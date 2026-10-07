// WG-3a: deriv.wgsl.js string rules + layout + the fs_main body evaluated in JS (wgslProbe) against the JS twin
// detailShade.js computeDerivatives. node engine/render/gpu/wgsl/deriv.wgsl.test.js
import assert from 'node:assert/strict';
import { DERIV_WGSL, DERIV_BLOCK, DERIV_TEXTURES, DERIV_TARGETS } from './deriv.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, makeTex, textureLoad, shims } from './wgslProbe.js';
import { GBuffer, KIND_TERRAIN } from '../../GBuffer.js';
import { computeDerivatives } from '../../detailShade.js';

assert.ok(WGSL_MODULES.some((m) => m.name === 'deriv' && m.code === DERIV_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec/.test(DERIV_WGSL));
assert.ok(/fn vs_main/.test(DERIV_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\) -> @location\(0\) vec4u/.test(DERIV_WGSL));
assert.ok(new RegExp(`kind0 == ${KIND_TERRAIN}u`).test(DERIV_WGSL), 'terrain kind interpolated from GBuffer.js');
assert.deepEqual(DERIV_TEXTURES, ['uint', 'uint', 'uint']);
assert.deepEqual(DERIV_TARGETS, ['rgba32uint']);
for (let i = 0; i < 3; i++) assert.ok(new RegExp('@group\\(0\\) @binding\\(' + i + '\\) var \\w+: texture_2d<u32>').test(DERIV_WGSL), 'binding ' + i);
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: DerivU/.test(DERIV_WGSL));
assert.equal(DERIV_BLOCK.sizeBytes, 16);
assert.deepEqual(['cols', 'rows', 'tanHalfHFov', 'planeDistY'].map((n) => DERIV_BLOCK.field(n).word), [0, 1, 2, 3]);

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const f2u = (x) => { f32[0] = x; return u32[0]; };
const u2f = (b) => { u32[0] = b; return f32[0]; };
let seed = 99;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };

const cols = 12, rows = 9, tanHalfHFov = 0.7265425280053609, planeDistY = 3.3;
let cells = 0, checkedNonZero = 0;
for (let trial = 0; trial < 20; trial++) {
  const g = new GBuffer(cols, rows);
  g.cam.tanHalfHFov = tanHalfHFov; g.cam.planeDistY = planeDistY;
  const depth = new Float32Array(cols * rows);
  const gi = [], ga = [], dp = [];
  for (let i = 0; i < cols * rows; i++) {
    // small plane/kind alphabets: every neighbour combination (both/one/none) occurs
    const kind = [0, 1, 2, 3, 4, 5, 7][Math.floor(rand() * 7)];
    const pid = Math.floor(rand() * 2);
    g.kind[i] = kind; g.planeId[i] = kind ? pid : 0;
    g.u[i] = Math.fround(rand() * 8 - 2); g.v[i] = Math.fround(rand() * 8 - 2);
    depth[i] = Math.fround(0.5 + rand() * 30);
    gi.push([g.planeId[i] >>> 0, (kind | (2 << 8) | (5 << 16)) >>> 0, 0, 0]);
    ga.push([f2u(g.u[i]), f2u(g.v[i]), f2u(3), f2u(0)]);
    dp.push([f2u(depth[i]), 0, 0, 0]);
  }
  computeDerivatives(g, depth);
  const tex = { uGI: makeTex(cols, rows, gi), uGA: makeTex(cols, rows, ga), uDepth: makeTex(cols, rows, dp), u: { cols, rows, tanHalfHFov: Math.fround(tanHalfHFov), planeDistY: Math.fround(planeDistY) } };
  const fetchSample = compileFn(DERIV_WGSL, 'fetchSample', { textureLoad, ...tex, ...shims });
  const run = compileFn(DERIV_WGSL, 'fs_main', { textureLoad, fetchSample, ...tex, ...shims });
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    const o = run({ x: x + 0.5, y: y + 0.5 });
    const got = [o.x, o.y, o.z, o.w].map((b) => u2f(b >>> 0));
    cells++;
    if (g.kind[i] === 0 || g.kind[i] === KIND_TERRAIN) {
      // WGSL skips empty + terrain cells (US-016 accepted deviation); the JS twin leaves empty cells zero
      assert.deepEqual([o.x, o.y, o.z, o.w], [0, 0, 0, 0], `skip kind ${g.kind[i]} at ${x},${y}`);
      continue;
    }
    const want = [g.dudx[i], g.dvdx[i], g.dudy[i], g.dvdy[i]];
    for (let k = 0; k < 4; k++) {
      const tol = 1e-5 * Math.max(1, Math.abs(want[k]));
      assert.ok(Math.abs(got[k] - want[k]) <= tol, `trial ${trial} cell ${x},${y} comp ${k}: got ${got[k]} want ${want[k]}`);
    }
    checkedNonZero++;
  }
}
console.log(`deriv.wgsl.test.js: string/layout rules and ${checkedNonZero}/${cells} JS-evaluated cells vs computeDerivatives passed.`);
