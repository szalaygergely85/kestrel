// ENV-01c (38.62): decor.wgsl.js string rules + the integer decision fns evaluated in JS (wgslProbe; mulU/mulI/addU/addI = Math.imul/add shims)
// against the ENV-01a twin (decorScatter.js decorCell), 2500 random cells x 3 layers: present/LOD, species, xcm/ycm, jq, yaw q, scale q, d2.
// node engine/render/gpu/wgsl/decor.wgsl.test.js
import assert from 'node:assert/strict';
import { DECOR_WGSL, DECOR_BLOCK, DECOR_BUFFERS, DECOR_WORKGROUP } from './decor.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn } from './wgslProbe.js';
import { packDecorLayers, decorCell, decorHash, jitterCm, decorSpecies, DECOR_OUT_WORDS, MAX_DIST_CM, O_SPECIES, O_XCM, O_YCM, O_JQX, O_JQY, O_YAWQ, O_SCALEQ, O_DIST2 } from '../../../mesh/decorScatter.js';

// ---- string rules
assert.ok(WGSL_MODULES.some((m) => m.name === 'decor' && m.code === DECOR_WGSL), 'registered');
assert.ok(!/[^%]%[^%]/.test(DECOR_WGSL) && !/\bround\s*\(|dpdx|dpdy|fwidth|textureSample|texelFetch|gl_|frag_depth|\bmod\s*\(/.test(DECOR_WGSL), 'string rules');
assert.ok(/@compute @workgroup_size\(64\)\s*\nfn cs_decor\(@builtin\(global_invocation_id\) gid: vec3u\)/.test(DECOR_WGSL) && DECOR_WORKGROUP === 64);
assert.deepEqual(DECOR_BUFFERS, ['read', 'read', 'read', 'rw', 'rw']);
assert.equal(DECOR_BLOCK.sizeBytes % 16, 0);
assert.ok(/atomicAdd\(&args\[u\.argsBase \+ slot \* ARGS_WORDS \+ 1u\], 1u\)/.test(DECOR_WGSL), 'instanceCount append');
assert.ok(DECOR_WGSL.includes('fn aabbOutside('), 'plane test shared from cull.wgsl.js');
assert.ok(DECOR_WGSL.includes('if (fadeLim > ' + MAX_DIST_CM + ')'), 'fadeLim clamp from the twin constant');

// ---- probes
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const cfg = { layers: [
  { seed: 0x1234abcd, cellM: 3.5, jitterM: 1.2, drawM: 70, species: [{ weight: 3, lodM: 25, maxDistM: 70, grassLike: true, scaleMin: 0.8, scaleMax: 1.3 }, { weight: 1, lodM: 30, maxDistM: 60, scaleMin: 0.5, scaleMax: 1.1 }] },
  { seed: 0xdeadbeef, cellM: 2.2, jitterM: 0.9, drawM: 45, densityQ8: 384, species: [{ weight: 1, lodM: 15, maxDistM: 40, scaleMin: 0.6, scaleMax: 1.0 }, { weight: 2, lodM: 20, maxDistM: 45, scaleMin: 0.7, scaleMax: 1.4 }, { weight: 1, lodM: 99, maxDistM: 45, grassLike: true, scaleMin: 1, scaleMax: 1 }] },
  { seed: 7, cellM: 1.4, jitterM: 0.6, drawM: 30, densityQ8: 128, species: [{ weight: 5, lodM: 12, maxDistM: 30, scaleMin: 0.3, scaleMax: 0.9 }] },
] };
const packed = packDecorLayers(cfg);
const dout = new Int32Array(DECOR_OUT_WORDS), tout = new Int32Array(DECOR_OUT_WORDS);
const dfadeArrs = [Int32Array.of(6000, 4500), Int32Array.of(4000, 4500, 3000), Int32Array.of(3500)];
const K = { dw: packed.words, dout, mulU: (a, b) => Math.imul(a, b) >>> 0, mulI: (a, b) => Math.imul(a, b), addU: (a, b) => (a + b) >>> 0, addI: (a, b) => (a + b) | 0 };
const hashRaw = compileFn(DECOR_WGSL, 'decorHash', K);
K.decorHash = (ix, iy, s, k) => hashRaw(ix, iy, s, k) >>> 0;
K.jitterCm = compileFn(DECOR_WGSL, 'jitterCm', K);
K.decorSpecies = compileFn(DECOR_WGSL, 'decorSpecies', K);
// WGSL i32 '/' truncates toward zero; JS '/' is float, so the probe source gets an explicit trunc
const floorDivW = compileFn(DECOR_WGSL.replace('var q = a / b;', 'var q = Math.trunc(a / b);'), 'floorDivI', { ...K, Math });

// hash + jitter + species direct
for (let i = 0; i < 4000; i++) {
  const ix = ri(-70000, 70000), iy = ri(-70000, 70000), s = (rnd() * 4294967296) >>> 0, k = ri(0, 7);
  assert.equal(K.decorHash(ix, iy, s, k), decorHash(ix, iy, s, k), 'hash');
  const h = (rnd() * 4294967296) >>> 0, j = ri(0, 200);
  assert.equal(K.jitterCm(h, j), jitterCm(h, j), 'jitter');
  assert.equal(K.decorSpecies(2 + (i % 3) * 8, h >>> 16), decorSpecies(packed.words, 2 + (i % 3) * 8, h >>> 16), 'species');
}
// floor division == Math.floor, negative eye coordinates included
for (let i = 0; i < 2000; i++) { const a = ri(-4000000, 4000000), b = ri(1, 900); assert.equal(floorDivW(a, b), Math.floor(a / b), 'floorDiv ' + a + '/' + b); }

// whole cells
const stats = [0, 1, 2].map(() => ({ lod0: 0, lod1: 0, none: 0, species: new Set(), carpet: 0 }));
for (let layer = 0; layer < 3; layer++) {
  const fn = compileFn(DECOR_WGSL, 'decorCell', { ...K, dfade: dfadeArrs[layer] });
  const cell = packed.words[2 + layer * 8 + 1], draw = packed.words[2 + layer * 8 + 3], span = Math.ceil(draw / cell) + 3;
  for (let i = 0; i < 2500; i++) {
    const eyeX = ri(-300000, 300000), eyeY = ri(-300000, 300000);
    const ix = Math.floor(eyeX / cell) + ri(-span, span), iy = Math.floor(eyeY / cell) + ri(-span, span);
    const mask = rnd() < 0.1 ? 0 : (ri(1, 127) | (rnd() < 0.4 ? 128 : 0));
    const carpetCut = rnd() < 0.3 ? 0 : ri(300, 2500);
    dout.fill(-9); tout.fill(-9);
    const a = fn(layer, ix, iy, mask, eyeX, eyeY, carpetCut), b = decorCell(packed, layer, ix, iy, mask, eyeX, eyeY, dfadeArrs[layer], carpetCut, tout);
    assert.equal(a, b, `present/LOD layer ${layer} cell ${ix},${iy}`);
    const st = stats[layer];
    if (a === 0) { st.none++; continue; }
    if (a === 1) st.lod0++; else st.lod1++;
    st.species.add(tout[O_SPECIES]); if (mask & 128) st.carpet++;
    for (const [n, o] of [['species', O_SPECIES], ['xcm', O_XCM], ['ycm', O_YCM], ['jqx', O_JQX], ['jqy', O_JQY], ['yawQ', O_YAWQ], ['scaleQ', O_SCALEQ], ['d2', O_DIST2]]) assert.equal(dout[o], tout[o], n);
  }
}
for (let l = 0; l < 3; l++) {
  const st = stats[l];
  assert.ok(st.lod0 > 30 && st.lod1 > 30 && st.none > 500, `layer ${l} mix ${JSON.stringify([st.lod0, st.lod1, st.none])}`);
  assert.equal(st.species.size, cfg.layers[l].species.length, `layer ${l} species coverage`);
}
assert.ok(stats[0].carpet > 5, 'carpet bit cells reached');

// fadeLim / carpetCut clamp (huge values) identical to the twin
{
  const big = Int32Array.of(900000, 900000);
  const fn = compileFn(DECOR_WGSL, 'decorCell', { ...K, dfade: big });
  let hit = 0;
  for (let i = 0; i < 3000; i++) {
    const ix = ri(-30, 30), iy = ri(-30, 30), cc = ri(0, 1) ? 99999 : 0;
    const a = fn(0, ix, iy, 100 | 128, 0, 0, cc), b = decorCell(packed, 0, ix, iy, 100 | 128, 0, 0, big, cc, tout);
    assert.equal(a, b, 'clamp cell'); if (a) hit++;
  }
  assert.ok(hit > 100, 'clamp fixture hits');
}

// ground: bilinear z within 1 mm of the double-precision oracle
{
  const NW = 17, NH = 13, tex = Float32Array.from({ length: NW * NH }, () => rnd() * 40 - 5);
  const u = { nearOrg: { x: -3.5, y: 8, z: 1.25 }, nearW: NW, nearH: NH };
  const g = compileFn(DECOR_WGSL, 'decorGround', { ...K, u, nearTexel: (i, j) => tex[j * NW + i] });
  for (let n = 0; n < 2000; n++) {
    const x = u.nearOrg.x + (rnd() * 1.3 - 0.15) * NW * 1.25, y = u.nearOrg.y + (rnd() * 1.3 - 0.15) * NH * 1.25;
    const fx = (x - u.nearOrg.x) / u.nearOrg.z - 0.5, fy = (y - u.nearOrg.y) / u.nearOrg.z - 0.5;
    const i = Math.min(Math.max(Math.floor(fx), 0), NW - 2), j = Math.min(Math.max(Math.floor(fy), 0), NH - 2);
    const tu = Math.min(Math.max(fx - i, 0), 1), tv = Math.min(Math.max(fy - j, 0), 1);
    const t = (a, b) => tex[b * NW + a];
    const z = t(i, j) * (1 - tu) * (1 - tv) + t(i + 1, j) * tu * (1 - tv) + t(i, j + 1) * (1 - tu) * tv + t(i + 1, j + 1) * tu * tv;
    assert.ok(Math.abs(g(x, y) - z) < 1e-3, 'ground within 1 mm');
  }
}
console.log('decor.wgsl.test OK');
