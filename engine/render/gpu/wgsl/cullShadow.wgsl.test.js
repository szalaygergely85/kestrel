// WG-4b: cullShadow.wgsl.js string rules + layout + helper fns evaluated in JS (wgslProbe) against the CPU twin (instances.js fillShadowBands).
// node engine/render/gpu/wgsl/cullShadow.wgsl.test.js
import assert from 'node:assert/strict';
import { CULL_SHADOW_WGSL, CULL_SHADOW_BLOCK, CULL_SHADOW_BUFFERS } from './cullShadow.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { classifyAABB, CULL_OUT } from '../../../mesh/culling.js';
import { makeInstanceGroup, fillShadowBands, INSTANCE_STRIDE, SHADOW_BAND_HYST_M } from '../../../mesh/instances.js';

// string rules (38.5)
assert.ok(WGSL_MODULES.some((m) => m.name === 'cullShadow' && m.code === CULL_SHADOW_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|\bmod\s*\(/.test(CULL_SHADOW_WGSL));
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_main\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(CULL_SHADOW_WGSL));
assert.ok(/const STRIDE: u32 = 16u;/.test(CULL_SHADOW_WGSL));
assert.deepEqual(CULL_SHADOW_BUFFERS, ['read', 'rw', 'rw', 'rw', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<u32>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(0\) @binding\(1\) var<storage, read_write> band: array<u32>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(0\) @binding\(4\) var<storage, read_write> args: array<atomic<u32>>/.test(CULL_SHADOW_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: CullShadowU/.test(CULL_SHADOW_WGSL));
assert.ok(/atomicAdd\(&args\[u\.slot[01] \+ 1u\], 1u\)/.test(CULL_SHADOW_WGSL), 'instanceCount is word +1 of the indirect args slot');
assert.equal(CULL_SHADOW_BLOCK.field('planes').word, 0); assert.equal(CULL_SHADOW_BLOCK.field('eye').word, 24);
assert.equal(CULL_SHADOW_BLOCK.field('count').word, 32); assert.equal(CULL_SHADOW_BLOCK.sizeBytes % 16, 0);
assert.equal(SHADOW_BAND_HYST_M, 2);

// probe: the band update + plane test against fillShadowBands, incl. persistent hysteresis state over a moving eye
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const planes = new Float64Array([1, 0, 0, 60, -1, 0, 0, 60, 0, 1, 0, 40, 0, -1, 0, 40, 0, 0, 1, 10, 0, 0, -1, 100]);
const R = 3.5, LOD0 = 25, CAST = 48;
const u = { planes: [], eye: { x: 0, y: 0, z: LOD0, w: CAST }, params: { x: R, y: SHADOW_BAND_HYST_M, z: 0, w: 0 } };
for (let i = 0; i < 6; i++) u.planes.push({ x: planes[i * 4], y: planes[i * 4 + 1], z: planes[i * 4 + 2], w: planes[i * 4 + 3] });
const aabbOutside = compileFn(CULL_SHADOW_WGSL, 'aabbOutside', { u });
const bandUpdate = compileFn(CULL_SHADOW_WGSL, 'bandUpdate', { u });
const N = 3000, g = makeInstanceGroup('trees', N); g.count = N;
const f32 = Math.fround;
for (let i = 0; i < N; i++) g.ib.f32.set([1, 0, 0, f32((rnd() - 0.5) * 140), 0, 1, 0, f32((rnd() - 0.5) * 100), 0, 0, 1, f32(rnd() * 12 - 2)], i * INSTANCE_STRIDE);
const bandGpu = new Uint32Array(N); let kept = 0, band1 = 0;
for (let step = 0; step < 12; step++) {
  const ex = f32(-30 + step * 6.5), ey = f32(step * 1.3 - 8);
  u.eye.x = ex; u.eye.y = ey;
  fillShadowBands(g, ex, ey, LOD0, CAST, planes, R);
  const want0 = [], want1 = [];
  const rowKey = (a, i) => Array.from(a.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE)).join(',');
  const got0 = [], got1 = [];
  for (let i = 0; i < N; i++) {
    const o = i * INSTANCE_STRIDE, tx = g.ib.f32[o + 3], ty = g.ib.f32[o + 7], tz = g.ib.f32[o + 11];
    const dx = tx - u.eye.x, dy = ty - u.eye.y;
    const b = bandUpdate(Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)))), bandGpu[i]);
    bandGpu[i] = b;
    if (b === 2) continue;
    if (aabbOutside(tx, ty, tz)) continue;
    (b ? got1 : got0).push(rowKey(g.ib.u32, i));
  }
  for (let i = 0; i < g.shadowCount[0]; i++) want0.push(rowKey(g.shadowIb[0].u32, i));
  for (let i = 0; i < g.shadowCount[1]; i++) want1.push(rowKey(g.shadowIb[1].u32, i));
  assert.deepEqual(got0.sort(), want0.sort(), 'band 0 set step ' + step);
  assert.deepEqual(got1.sort(), want1.sort(), 'band 1 set step ' + step);
  assert.deepEqual(Array.from(bandGpu), Array.from(g.shadowBand.subarray(0, N)), 'persistent band state step ' + step);
  kept += want0.length + want1.length; band1 += want1.length;
}
assert.ok(kept > 3000 && band1 > 300, `fixture mixes bands: kept ${kept}, band1 ${band1}`);
// direct hysteresis cases
for (const [d, prev, exp] of [[10, 0, 0], [26.9, 0, 0], [27.1, 0, 1], [22.5, 1, 0], [24.5, 1, 1], [49.9, 1, 1], [50.1, 1, 2], [45.5, 2, 1], [46.5, 2, 2], [10, 2, 0], [60, 0, 2]]) {
  const want = (() => { let b = prev; if (b === 2 && d < CAST - 2) b = 1; if (b === 1 && d < LOD0 - 2) b = 0; if (b === 0 && d > LOD0 + 2) b = 1; if (b === 1 && d > CAST + 2) b = 2; return b; })();
  assert.equal(want, exp, `fixture sanity d=${d} prev=${prev}`);
  assert.equal(bandUpdate(d, prev), exp, `band d=${d} prev=${prev}`);
}
console.log('cullShadow.wgsl.test OK');
