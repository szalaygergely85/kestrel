// R6c (38.60): impostor.wgsl.js string rules + the rule helpers evaluated in JS (wgslProbe) against the R6b twin (impostorCard.js),
// 2000 seeded cases each: view pick, band bits, mip pick, texel offset, texel decode (incl. 16-bit oct byte order), depth offset, world normal,
// and the cs_card keep/flags rule against compactGroup's card bucket. node engine/render/gpu/wgsl/impostor.wgsl.test.js
import assert from 'node:assert/strict';
import { IMP_CULL_WGSL, IMP_CARD_WGSL, IMP_BLOCK, IMP_CULL_BUFFERS } from './impostor.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { impViewPick, impBandBits, impMipPick, impTexelOffset, impDecodeTexel, enableGroupImpostor, IMP_BAND_M, IMP_CE, IMP_SE } from '../../../mesh/impostorCard.js';
import { impMipOffset, decodeImpNormal, IMP_BYTES } from '../../../mesh/impostorBake.js';
import { makeInstanceGroup, compactGroup, createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE } from '../../../mesh/instances.js';

// ---- string rules
for (const [name, code] of [['impostorCull', IMP_CULL_WGSL], ['impostorCard', IMP_CARD_WGSL]]) {
  assert.ok(WGSL_MODULES.some((m) => m.name === name && m.code === code), name + ' registered');
  assert.ok(!/[^%]%[^%]/.test(code) && !/\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_/.test(code), name + ' string rules');
}
assert.ok(!/frag_depth/.test(IMP_CULL_WGSL) && /@builtin\(frag_depth\)/.test(IMP_CARD_WGSL), 'frag_depth only in the card fragment');
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_card\(/.test(IMP_CULL_WGSL) && /fn vs_main/.test(IMP_CARD_WGSL) && /fn fs_main/.test(IMP_CARD_WGSL));
assert.deepEqual(IMP_CULL_BUFFERS, ['read', 'rw', 'rw']);
assert.ok(/atomicAdd\(&args\[u\.slot \+ 1u\], 1u\)/.test(IMP_CULL_WGSL));
assert.equal(IMP_BLOCK.sizeBytes % 16, 0);
assert.ok(/KIND_MESH: u32 = 9u/.test(IMP_CARD_WGSL) && /const IMP_BAND_M: f32 = 8\.0;/.test(IMP_CARD_WGSL));
assert.equal(IMP_BAND_M, 8);

// ---- probes
let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const R = 3.7, vMin = -0.4, vMax = 9.3;
const bytes = new Uint8Array(IMP_BYTES);
for (let i = 0; i < bytes.length; i++) bytes[i] = (rnd() * 256) | 0;
for (let i = 5; i < bytes.length; i += 8) if (rnd() < 0.3) bytes[i] = 0; // coverage holes
const imp = { bytes, radius: R, vMin, vMax };
const BASE = 16; // species word offset inside the shared atlas buffer
const atlas = new Uint32Array(BASE + IMP_BYTES / 4);
atlas.set(new Uint32Array(bytes.buffer, bytes.byteOffset, IMP_BYTES / 4), BASE);

const K = { PI4: Math.PI / 4, IMP_BAND_M: 8, IMP_CE, IMP_SE, IMP_PER_VIEW: 1344 * 8, atan2: Math.atan2, cos: Math.cos, sin: Math.sin, atlas };
const impViewPickW = compileFn(IMP_CARD_WGSL, 'impViewPick', K);
const impBandBitsW = compileFn(IMP_CARD_WGSL, 'impBandBits', K);
const impMipPickW = compileFn(IMP_CARD_WGSL, 'impMipPick', K);
const impMipOffsetW = compileFn(IMP_CARD_WGSL, 'impMipOffset', K);
K.impMipOffset = impMipOffsetW;
const impTexelOffsetW = compileFn(IMP_CARD_WGSL, 'impTexelOffset', K);
K.impTexelOffset = impTexelOffsetW;
const impFetchW = compileFn(IMP_CARD_WGSL, 'impFetch', K);
const impDepthOffsetW = compileFn(IMP_CARD_WGSL, 'impDepthOffset', K);
const impOctDecodeW = compileFn(IMP_CARD_WGSL, 'impOctDecode', K);
K.impOctDecode = impOctDecodeW;
const impNormalWorldW = compileFn(IMP_CARD_WGSL, 'impNormalWorld', K);

let covered = 0, bands = 0;
for (let i = 0; i < 2000; i++) {
  // 1. view pick
  const ex = (rnd() - 0.5) * 400, ey = (rnd() - 0.5) * 400, tx = (rnd() - 0.5) * 400, ty = (rnd() - 0.5) * 400, yaw = (rnd() - 0.5) * 12.5;
  assert.equal(impViewPickW(ex, ey, tx, ty, yaw), impViewPick(ex, ey, tx, ty, yaw), 'view pick');
  // 2. band bits, mesh + card copy
  const impM = 45 + rnd() * 60, d = impM - 2 + rnd() * 12;
  for (const lod of [0, 1]) assert.equal(impBandBitsW(d, impM, lod), impBandBits(d, impM, lod), 'band bits');
  if (impBandBits(d, impM, 0)) bands++;
  // 3. mip
  const px = rnd() * 60;
  assert.equal(impMipPickW(px), impMipPick(px), 'mip');
  // 4. texel offset + decode + depth + normal
  const view = (rnd() * 8) | 0, mip = (rnd() * 3) | 0, cu = (rnd() * 2.4 - 1.2) * R, cv = vMin - 1 + rnd() * (vMax - vMin + 2);
  assert.equal(impMipOffsetW(view, mip), impMipOffset(view, mip), 'mip offset');
  assert.equal(impTexelOffsetW(view, mip, cu, cv, R, vMin, vMax), impTexelOffset(imp, view, mip, cu, cv), 'texel offset');
  const out = { mat: 0, o: 0, nx: 0, ny: 0, nz: 1 };
  const cov = impDecodeTexel(imp, view, mip, cu, cv, yaw, out);
  const t = impFetchW(view, mip, cu, cv, R, vMin, vMax, BASE);
  assert.equal(t.covered === 1, cov, 'coverage');
  if (cov) {
    covered++;
    assert.equal(t.mat, out.mat, 'mat');
    assert.equal(impDepthOffsetW(t.q, R), out.o, 'depth offset');
    const n = impNormalWorldW(t.nbits, view, yaw);
    assert.equal(n.x, out.nx, 'nx'); assert.equal(n.y, out.ny, 'ny'); assert.equal(n.z, out.nz, 'nz');
    const o8 = impTexelOffset(imp, view, mip, cu, cv), loc = new Float64Array(3);
    decodeImpNormal(bytes, o8, loc); // byte order 2/3 high + 6/7 low
    assert.equal(impOctDecodeW(t.nbits).z, loc[2], 'oct z');
  }
}
assert.ok(covered > 800 && bands > 300, `mixed fixture: covered ${covered}, band ${bands}`);

// ---- cs_card keep/flags rule vs compactGroup's card bucket (CPU instance path)
{
  const impM = 60, N = 600, eye = { x: 3, y: -5, z: 2 }, maxDist = 300;
  const g = makeInstanceGroup('t', N);
  enableGroupImpostor(g, imp, impM, createInstanceBuffer);
  g.maxDistM = maxDist; g.count = N;
  for (let i = 0; i < N; i++) writeUnitInstance(g.ib, i, (rnd() - 0.5) * 700, (rnd() - 0.5) * 700, rnd() * 20, 0, 1000 + i, 0);
  compactGroup(g, null, 5, null, 0, 0, eye);
  const want = new Map();
  for (let i = 0; i < g.cardCount; i++) { const r = g.cardIb.u32.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE); want.set(r[12], r[13]); }
  const got = new Map(), f = g.ib.f32, s = g.ib.u32;
  const md2 = maxDist * maxDist;
  for (let i = 0; i < N; i++) { // the kernel body (planes off): distance cut, d < impM -> mesh only, else card row with flags | band bits
    const o = i * INSTANCE_STRIDE, dx = f[o + 3] - eye.x, dy = f[o + 7] - eye.y, dz = f[o + 11] - eye.z;
    if (dx * dx + dy * dy + dz * dz > md2) continue;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < impM) continue;
    got.set(s[o + 12], (s[o + 13] | impBandBitsW(d, impM, 1)) >>> 0);
  }
  assert.equal(got.size, want.size, 'card count'); assert.ok(want.size > 100, 'fixture has cards: ' + want.size);
  for (const [k, v] of want) assert.equal(got.get(k), v, 'card flags ' + k);
}
console.log('impostor.wgsl.test.js: 2000 cases pick/band/mip/texel/decode/depth/normal == R6b twin, cs_card rule == compactGroup card bucket');
