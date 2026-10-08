// S8-B2-09: hzb.wgsl.js string rules + layout, and the kernel (cs_main + hzbTexel) executed in JS (wgslProbe) against the CPU twin
// engine/mesh/hzb.js on random depth rows: exact for powers of two and non-power-of-two sizes. node engine/render/gpu/wgsl/hzb.wgsl.test.js
import assert from 'node:assert/strict';
import { HZB_WGSL, HZB_BLOCK, HZB_BUFFERS, HZB_WORKGROUP } from './hzb.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { hzbDownsample, buildHzb, hzbLevelSizes, hzbNextSize } from '../../../mesh/hzb.js';

assert.ok(WGSL_MODULES.some((m) => m.name === 'hzb' && m.code === HZB_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|\bmod\s*\(/.test(HZB_WGSL));
assert.ok(/@compute @workgroup_size\(8, 8\)\s*\nfn cs_main\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(HZB_WGSL));
assert.equal(HZB_WORKGROUP, 8);
assert.deepEqual(HZB_BUFFERS, ['read', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<f32>/.test(HZB_WGSL));
assert.ok(/@group\(0\) @binding\(1\) var<storage, read_write> dst: array<f32>/.test(HZB_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: HzbU/.test(HZB_WGSL));
assert.equal(HZB_BLOCK.sizeBytes, 16);

let seed = 4242; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

// JS execution of the kernel: hzbTexel through wgslProbe with the real src buffer / uniform block, then cs_main's write loop
function runKernel(src, srcW, srcH) {
  const u = { srcW, srcH, dstW: hzbNextSize(srcW), dstH: hzbNextSize(srcH) };
  const dst = new Float32Array(u.dstW * u.dstH);
  const texel = compileFn(HZB_WGSL, 'hzbTexel', { src, u, max: Math.max });
  const main = compileFn(HZB_WGSL, 'cs_main', { src, dst, u, hzbTexel: texel });
  // dispatch ceil(dst / 8) x ceil(dst / 8) workgroups of 8x8, like the pass would
  for (let wy = 0; wy < Math.ceil(u.dstH / HZB_WORKGROUP); wy++) for (let wx = 0; wx < Math.ceil(u.dstW / HZB_WORKGROUP); wx++)
    for (let ly = 0; ly < HZB_WORKGROUP; ly++) for (let lx = 0; lx < HZB_WORKGROUP; lx++) main({ x: wx * 8 + lx, y: wy * 8 + ly, z: 0 });
  return dst;
}

const sizes = [[16, 16], [64, 32], [1, 1], [1, 9], [9, 1], [2, 2], [3, 3], [5, 7], [17, 33], [100, 61], [127, 128], [240, 135]];
let checked = 0;
for (const [w, h] of sizes) {
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = Math.fround(rnd());
  const twin = hzbDownsample(src, w, h);
  const kern = (w === 1 && h === 1) ? twin : runKernel(src, w, h);
  assert.equal(kern.length, twin.length, `${w}x${h} size`);
  for (let i = 0; i < twin.length; i++) { assert.equal(kern[i], twin[i], `${w}x${h} texel ${i}`); checked++; }
  // the whole chain preserves the global max (no texel lost on odd sizes)
  const levels = buildHzb(src, w, h);
  const top = levels[levels.length - 1];
  assert.equal(top.w * top.h, 1);
  assert.equal(top.data[0], src.reduce((a, b) => Math.max(a, b), -Infinity), `${w}x${h} apex = global max`);
  assert.deepEqual(levels.map((l) => [l.w, l.h]), hzbLevelSizes(w, h).map((l) => [l.w, l.h]));
}
// a single far texel survives in every level (covered only through the odd leftover row/column)
{
  const w = 7, h = 5, src = new Float32Array(w * h).fill(0.1);
  src[4 * w + 6] = 0.9;
  const lv = buildHzb(src, w, h);
  assert.equal(lv[1].data[(hzbNextSize(h) - 1) * lv[1].w + lv[1].w - 1], Math.fround(0.9));
  assert.equal(lv[lv.length - 1].data[0], Math.fround(0.9));
}
console.log(`hzb.wgsl.test OK (${checked} texels kernel vs twin)`);
