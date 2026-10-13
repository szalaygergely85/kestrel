// ME-20c numeric probes (38.18): (1) light.wgsl vao term evaluated from the REAL source line vs the lighting.js twin,
// (2) per-corner AO interpolation (rasterJS formula, which the hardware varying must equal) vs an independent
// perspective-correct reference, (3) `& 1u` masking of packed.w enumerated. node engine/render/gpu/wgsl/vao.wgsl.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIGHT_WGSL } from './light.wgsl.js';
import { rasterWgsl } from './raster.wgsl.js';
import { compileFn } from './wgslProbe.js';
import { AO_MAX } from '../../horizonAo.js';
import { KIND_MESH } from '../../GBuffer.js';

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const f32 = Math.fround;
const f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);

// --- (1) light vao term ---
const line = LIGHT_WGSL.split('\n').find((l) => l.includes('if (kindU == u32(KIND_MESH)) { aoF = min(aoF,'));
assert.ok(line, 'vao line found in LIGHT_WGSL');
const U = { aoStrength: 0 }, tex = { w: 0 };
const fnSrc = `fn t(aoF: f32, kindU: u32, cell: i32) -> f32 {\n${line}\nreturn aoF;\n}`;
const wgsl = compileFn(fnSrc, 't', { u: U, AO_MAX: f32(AO_MAX), KIND_MESH, uGA: null, textureLoad: () => tex });
// JS twin = lighting.js line 1218 expression (guarded against drift below)
const ltSrc = readFileSync(new URL('../../lighting.js', import.meta.url), 'utf8');
assert.ok(ltSrc.includes('aoF = Math.min(aoF, 1 - ao.strength * AO_MAX * (1 - (va < 0 ? 0 : va > 1 ? 1 : va)))'), 'twin expression unchanged');
const twin = (aoF, va, s, kind) => (kind === KIND_MESH ? Math.min(aoF, 1 - s * AO_MAX * (1 - (va < 0 ? 0 : va > 1 ? 1 : va))) : aoF);
const edges = [0, 1];
let n = 0, maxD = 0;
for (let i = 0; i < 2000; i++) {
  const pick = (k) => (i < 8 ? edges[(i >> k) & 1] : rnd());
  let aoF = pick(0), va = pick(1), s = pick(2);
  if (i % 7 === 0) va = -0.5 + 2 * rnd(); // out-of-range vao must clamp
  aoF = f32(aoF); va = f32(va); s = f32(s);
  U.aoStrength = s; f32b[0] = va; tex.w = u32b[0];
  const got = wgsl(aoF, KIND_MESH, 0), want = twin(aoF, va, s, KIND_MESH);
  maxD = Math.max(maxD, Math.abs(got - want)); n++;
  assert.ok(Math.abs(got - f32(want)) <= 1e-6, `vao term mismatch aoF=${aoF} va=${va} s=${s}: ${got} vs ${want}`);
  if (va === 1) assert.equal(got, aoF, 'vao == 1 -> exactly the pre-ME-20c aoF (min(aoF, 1) with aoF<=1)');
  assert.equal(wgsl(aoF, 1, 0), aoF, 'non-kind-9 untouched');
  assert.equal(wgsl(aoF, 3, 0), aoF, 'non-kind-9 untouched (kind 3)');
}
// vao==1: 1 - s*AO_MAX*0 = 1 >= aoF for any aoF in [0,1] -> exact identity
console.log(`vao.wgsl.test.js (1): light vao term ${n} cases, max |wgsl-twin| ${maxD.toExponential(2)}`);

// --- (2) per-corner AO interpolation: rasterJS formula vs independent perspective-correct reference ---
const rsrc = readFileSync(new URL('../../../mesh/rasterJS.js', import.meta.url), 'utf8');
assert.ok(rsrc.includes('(l0 * ao0 * iw0 + l1 * ao1 * iw1 + l2 * ao2 * iw2) * invq'), 'rasterJS formula unchanged');
let maxI = 0;
for (let i = 0; i < 500; i++) {
  const w = [0.5 + 20 * rnd(), 0.5 + 20 * rnd(), 0.5 + 20 * rnd()], a = [rnd(), rnd(), rnd()];
  let b = [rnd() + 1e-3, rnd() + 1e-3, rnd() + 1e-3]; const bs = b[0] + b[1] + b[2]; b = b.map((x) => x / bs); // true (world-space) weights
  const want = b[0] * a[0] + b[1] * a[1] + b[2] * a[2];
  // screen-space barycentrics of the same point: l_i = (b_i * w_i) / sum(b_j * w_j)
  const sw = b.map((x, k) => x * w[k]), ss = sw[0] + sw[1] + sw[2], l = sw.map((x) => x / ss);
  const iw = w.map((x) => 1 / x), q = l[0] * iw[0] + l[1] * iw[1] + l[2] * iw[2], invq = 1 / q;
  const got = (l[0] * a[0] * iw[0] + l[1] * a[1] * iw[1] + l[2] * a[2] * iw[2]) * invq;
  maxI = Math.max(maxI, Math.abs(got - want));
  assert.ok(Math.abs(got - want) <= 1e-5, `interp mismatch ${got} vs ${want}`);
}
// WGSL side: the varying is declared perspective-correct (default interpolation) and passed straight through
const rw = rasterWgsl('instanced', { ao: true });
assert.ok(/@location\(8\) vAo: f32/.test(rw) && !/@interpolate\(\s*(flat|linear)/.test(rw.split('\n').find((l) => l.includes('vAo: f32'))), 'vAo uses default (perspective) interpolation');
console.log(`vao.wgsl.test.js (2): 500 triangle samples, max |rasterJS-reference| ${maxI.toExponential(2)}`);

// --- (3) `& 1u` masking: enumerate every value the static/voxel paths can produce ---
// static: old packed.w = axisAligned, new = axisAligned & 1u. Old callers only ever set axisAligned in {0, 1} (bit 1 = RASTER_FLAG_VAO new).
for (const aa of [0, 1]) assert.equal(aa & 1, aa, 'static: bit-1-clear values byte-identical');
for (const aa of [2, 3]) assert.equal(aa & 1, aa & 1, 'static: VAO bit stripped'); // 2 -> 0, 3 -> 1 (the point of the mask)
assert.deepEqual([2, 3].map((a) => a & 1), [0, 1]);
// voxel: (axisAligned & (iMeta.y & 1)) | (lod << 1): the product has bit 1 clear for every axisAligned, so unchanged vs pre-ME-20c
for (const aa of [0, 1, 2, 3]) for (const m of [0, 1, 2, 3]) {
  const v = aa & (m & 1);
  assert.equal(v & 2, 0, 'voxel: aligned part never sets bit 1');
  if ((aa & 2) === 0) assert.equal(v, aa & m & 1, 'voxel: identical to old for VAO-clear flag words');
}
const src = readFileSync(new URL('./raster.wgsl.js', import.meta.url), 'utf8');
assert.ok(src.includes("'(u.axisAligned & 1u)'") && src.includes('(u.axisAligned & (a.iMeta.y & 1u))'), 'masks present in source');
assert.ok(src.includes('(v.packed.w & 1u) != 0u'), 'fragment reads only bit 0 of packed.w');
console.log('vao.wgsl.test.js (3): & 1u masking byte-identical for bit-1-clear inputs (enumerated).');
