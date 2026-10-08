// WG-4a: cull.wgsl.js string rules + layout + the helper fns evaluated in JS (wgslProbe) against the CPU twin
// (culling.js classifyAABB, instances.js compactGroup LOD block). node engine/render/gpu/wgsl/cull.wgsl.test.js
import assert from 'node:assert/strict';
import { CULL_WGSL, CULL_BLOCK, CULL_BUFFERS, CULL_WORKGROUP } from './cull.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { classifyAABB, CULL_OUT } from '../../../mesh/culling.js';
import { INSTANCE_STRIDE, makeInstanceGroup, compactGroup } from '../../../mesh/instances.js';

// string rules (38.5)
assert.ok(WGSL_MODULES.some((m) => m.name === 'cull' && m.code === CULL_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|\bmod\s*\(/.test(CULL_WGSL));
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_main\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(CULL_WGSL));
assert.equal(CULL_WORKGROUP, 64);
assert.equal(INSTANCE_STRIDE, 16);
assert.ok(/const STRIDE: u32 = 16u;/.test(CULL_WGSL), 'stride interpolated from instances.js');
assert.deepEqual(CULL_BUFFERS, ['read', 'rw', 'rw', 'rw', 'rw']);
assert.ok(/@group\(0\) @binding\(0\) var<storage, read> src: array<u32>/.test(CULL_WGSL));
for (let i = 1; i <= 3; i++) assert.ok(CULL_WGSL.includes('@group(0) @binding(' + i + ') var<storage, read_write> '), 'binding ' + i);
assert.ok(/@group\(0\) @binding\(4\) var<storage, read_write> args: array<atomic<u32>>/.test(CULL_WGSL));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: CullU/.test(CULL_WGSL));
assert.ok(/atomicAdd\(&args\[u\.slot[01] \+ 1u\], 1u\)/.test(CULL_WGSL), 'instanceCount is word +1 of the indirect args slot');
assert.equal(CULL_BLOCK.field('planes').word, 0);
assert.equal(CULL_BLOCK.field('eye').word, 24);
assert.equal(CULL_BLOCK.field('count').word, 36);
assert.equal(CULL_BLOCK.sizeBytes % 16, 0);

// probe: helpers against the CPU twin
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const planes = new Float64Array([1, 0, 0, 50, -1, 0, 0, 50, 0, 1, 0, 30, 0, -1, 0, 30, 0, 0, 1, 10, 0, 0, -1, 100]); // an axis-aligned box frustum
const u = { planes: [], eye: { x: 3, y: -4, z: 1, w: 900 }, lodRow: { x: 0.01, y: 0.02, z: 0.03, w: 1 }, params: { x: 2.5, y: 4000, z: 7.2, w: 8.8 }, lodOn: 1, swayPad: 0 };
for (let i = 0; i < 6; i++) u.planes.push({ x: planes[i * 4], y: planes[i * 4 + 1], z: planes[i * 4 + 2], w: planes[i * 4 + 3] });
const aabbOutside = compileFn(CULL_WGSL, 'aabbOutside', { u });
const pickLod = compileFn(CULL_WGSL, 'pickLod', { u });
const distOut = compileFn(CULL_WGSL, 'distOut', { u });
let outs = 0;
for (let i = 0; i < 4000; i++) {
  const x = Math.fround((rnd() - 0.5) * 220), y = Math.fround((rnd() - 0.5) * 120), z = Math.fround((rnd() - 0.5) * 200);
  const R = u.params.x;
  const cpu = classifyAABB(planes, x - R, y - R, z - R, x + R, y + R, z + R) === CULL_OUT;
  assert.equal(aabbOutside(x, y, z), cpu, `aabb ${x},${y},${z}`);
  if (cpu) outs++;
}
assert.ok(outs > 500 && outs < 3500, 'fixture mixes in and out: ' + outs);
// S8-B2-06 swayPad: the sphere grows by the pad (and ONLY the frustum test: params.y / lod stay), twin = classifyAABB with R + pad, compactGroup(.., swayPad)
{
  u.swayPad = 1; let grown = 0;
  const g = makeInstanceGroup('t', 3000); g.count = 3000;
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    const x = Math.fround((rnd() - 0.5) * 220), y = Math.fround((rnd() - 0.5) * 120), z = Math.fround((rnd() - 0.5) * 200);
    g.ib.f32.set([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z], i * INSTANCE_STRIDE); g.ib.u32[i * INSTANCE_STRIDE + 12] = i; rows.push([x, y, z]);
    const R = u.params.x + 1;
    const cpu = classifyAABB(planes, x - R, y - R, z - R, x + R, y + R, z + R) === CULL_OUT;
    assert.equal(aabbOutside(x, y, z), cpu, `padded aabb ${x},${y},${z}`);
    if (cpu === false && classifyAABB(planes, x - u.params.x, y - u.params.x, z - u.params.x, x + u.params.x, y + u.params.x, z + u.params.x) === CULL_OUT) grown++;
  }
  assert.ok(grown > 20, `the pad rescues instances at the frustum edge (${grown})`);
  const keep = (pad) => { compactGroup(g, planes, u.params.x, null, 0, pad); return g.drawCount[0]; };
  const k0 = keep(0), k1 = keep(1);
  assert.equal(k1 - k0, grown, 'compactGroup(swayPad) keeps exactly the rescued instances');
  u.swayPad = 0;
}
// LOD pick incl. hysteresis band and w <= 0
const cwOf = (t) => u.lodRow.x * t[0] + u.lodRow.y * t[1] + u.lodRow.z * t[2] + u.lodRow.w;
for (const [t, prev] of [[[0, 0, 0], 0], [[100, 100, 100], 1], [[-100, -100, -100], 1], [[100, 100, 100], 0], [[-30, -20, 10], 1]]) {
  const cw = cwOf(t), cells = u.params.y / cw;
  const exp = cw > 1e-6 ? (cells < u.params.z ? 1 : cells > u.params.w ? 0 : prev) : 0;
  assert.equal(pickLod(t[0], t[1], t[2], prev), exp, 'lod ' + t);
}
u.lodOn = 0; assert.equal(pickLod(1, 2, 3, 1), 0, 'LOD off -> LOD0'); u.lodOn = 1;
assert.equal(distOut(3, -4, 1 + 30.1), true); assert.equal(distOut(3, -4, 1 + 29.9), false);
u.eye.w = 0; assert.equal(distOut(1e6, 0, 0), false, 'w <= 0 = no distance cull');
console.log('cull.wgsl.test OK');
