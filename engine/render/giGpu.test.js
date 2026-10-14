// GI-PROBE-05: GPU twin of sampleGI. compileFn evaluates the WGSL giSample against the JS sampler (>= 3000 points x 4 states, 1/255),
// pack round trip, WGSL lint, GI-off shaders byte-identical, binding map, upload bookkeeping. Run: node engine/render/giGpu.test.js
import assert from 'node:assert/strict';
import { makeGI } from './giFixture.js';
import { sampleGI, mixGIState, decodeGIChannel, GI_CHANNELS } from './giProbe.js';
import { packGIField, packGIMix, GI_SAMPLE_WGSL, GIH, GI_HDR_WORDS, giBufferWords } from './giGpu.js';
import { compileFn } from './gpu/wgsl/wgslProbe.js';
import { LIGHT_WGSL, LIGHT_GI_WGSL } from './gpu/wgsl/light.wgsl.js';
import { SHADE_WGSL, SHADE_LEVEL_WGSL, SHADE_LOOK_WGSL, SHADE_GI_WGSL, SHADE_LEVEL_GI_WGSL, SHADE_LOOK_GI_WGSL, SHADE_LEVEL_LOOK_GI_WGSL } from './gpu/wgsl/shade.wgsl.js';
import { WgGiBuffer } from './gpu/wg/giUpload.js';

let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const gi = makeGI(); const f = gi.field;
for (const p of [3, 10, 11, 70, 71, 140]) f.valid[p] = 0; // invalid probes: renormalise path
f.base.forEach((_, i) => { f.base[i] = 2 * Math.sin(i * 0.37); }); // terrain-following layers

// 1. pack round trip: header + decoded channels
{
  const w = packGIField(f, gi), fl = new Float32Array(w.buffer);
  assert.equal(w.length, giBufferWords(f));
  assert.equal(w[GIH.W], f.w); assert.equal(w[GIH.L], f.layers); assert.equal(fl[GIH.CELL], f.cellM);
  const oBias = w[GIH.OBIAS], oScale = w[GIH.OSCALE], oData = w[GIH.ODATA], bytes = new Uint8Array(w.buffer);
  for (let t = 0; t < 400; t++) {
    const p = (rnd() * f.w * f.h * f.layers) | 0, c = (rnd() * GI_CHANNELS) | 0;
    const v = fl[oBias + c] + bytes[oData * 4 + p * GI_CHANNELS + c] / 255 * fl[oScale + c];
    assert.ok(Math.abs(v - decodeGIChannel(f, p, c)) < 1e-5, 'decode ' + p + ',' + c);
  }
  assert.equal(w[GIH.OVALID] * 4 + 3, w[GIH.OVALID] * 4 + 3);
  assert.equal(bytes[w[GIH.OVALID] * 4 + 3], 0, 'invalid bit packed');
  assert.ok(w.byteLength < 1.1e6 * 2, 'buffer within the 38.72 per-band budget order');
}

// 2. compileFn probes: giSample vs sampleGI, 4 states x 3200 points, within 1/255
const states = [
  { name: 'noon', hour: 13, sky: [0.3, 0.35, 0.4], sun: [1, 0.9, 0.8], cfg: { skyFloor: 0.15 } },
  { name: 'dusk', hour: 18.7, sky: [0.25, 0.2, 0.3], sun: [1.1, 0.6, 0.3], cfg: { skyFloor: 0.15 } },
  { name: 'night-moon', hour: 23, sky: [0.05, 0.06, 0.12], sun: [0.2, 0.25, 0.4], cfg: { night: true, skyFloor: 0.1 } },
  { name: 'emis', hour: 7, sky: [0.3, 0.3, 0.3], sun: [1, 1, 1], cfg: { emisK: 2.5, skyFloor: 0.3 } },
];
const out = new Float32Array(3);
let worst = 0, npts = 0;
for (const s of states) {
  mixGIState(gi, s.hour, s.sky, s.sun, s.cfg);
  const words = packGIField(f, gi);
  const giSample = compileFn(GI_SAMPLE_WGSL, 'giSample', { uGIB: words });
  for (let t = 0; t < 3200; t++) {
    const x = -10 + rnd() * 90, y = -2 + rnd() * 22, z = -10 + rnd() * 90;
    let nx = rnd() * 2 - 1, ny = rnd() * 2 - 1, nz = rnd() * 2 - 1; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    sampleGI(gi, x, y, z, nx, ny, nz, out);
    const g = giSample(x, y, z, nx, ny, nz);
    const e = Math.max(Math.abs(g.x - out[0]), Math.abs(g.y - out[1]), Math.abs(g.z - out[2]));
    if (e > worst) worst = e; npts++;
    assert.ok(e <= 1 / 255, `${s.name} point ${t}: (${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}) wgsl ${g.x.toFixed(4)},${g.y.toFixed(4)},${g.z.toFixed(4)} js ${out[0].toFixed(4)},${out[1].toFixed(4)},${out[2].toFixed(4)}`);
  }
}
assert.ok(npts >= 12000);
// all-invalid column corner + GI off flag: ambient fallback = skyRGB
{
  const w2 = packGIField(f, gi); w2[GIH.ON] = 0;
  const g = compileFn(GI_SAMPLE_WGSL, 'giSample', { uGIB: w2 })(1, 1, 1, 0, 1, 0);
  assert.ok(Math.abs(g.x - gi.skyRGB[0]) < 1e-6 && Math.abs(g.z - gi.skyRGB[2]) < 1e-6, 'off flag -> flat sky');
}

// 3. lint + variants
const lint = (n, src) => {
  assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample/.test(src), n + ': no raw % / round / derivatives');
  assert.ok(!/\b(fn|let|var)\s+(fn|var|let|const|struct|type|enum|override|loop|switch)\b/.test(src), n + ': no keyword identifiers');
  assert.equal((src.match(/\{/g) || []).length, (src.match(/\}/g) || []).length, n + ': braces balance');
  assert.equal((src.match(/\(/g) || []).length, (src.match(/\)/g) || []).length, n + ': parens balance');
  const binds = [...src.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((m) => m[1]);
  assert.equal(new Set(binds).size, binds.length, n + ': unique group-0 bindings');
};
lint('giSample', GI_SAMPLE_WGSL);
for (const [n, off, on, bind] of [['light', LIGHT_WGSL, LIGHT_GI_WGSL, 8], ['shade', SHADE_WGSL, SHADE_GI_WGSL, 16], ['shadeLevel', SHADE_LEVEL_WGSL, SHADE_LEVEL_GI_WGSL, 16], ['shadeLook', SHADE_LOOK_WGSL, SHADE_LOOK_GI_WGSL, 16]]) {
  lint(n + ' off', off); lint(n + ' gi', on);
  assert.ok(!off.includes('uGIB') && !off.includes('giSample'), n + ': GI off shader has no GI text (byte-identical to today)');
  assert.ok(on.includes(`@group(0) @binding(${bind}) var<storage, read> uGIB`), n + ': storage buffer at binding ' + bind);
}
assert.ok(SHADE_LEVEL_LOOK_GI_WGSL.includes('giTerrK(uT') && SHADE_GI_WGSL.includes('giTerrK(hG'), 'terrain + carpet ambient spliced');
assert.ok(LIGHT_GI_WGSL.includes('L -= Lamb *') && !LIGHT_GI_WGSL.includes('L -= u.ambient *'), 'AO multiplies the GI ambient');

// 4. upload bookkeeping: full upload once, header write only on a mix bump, 0 calls in steady state
{
  let creates = 0, writes = 0, lastLen = 0;
  const dev = { createBuffer: (d) => { creates++; return { d }; }, writeBuffer: (h, data, off, len) => { writes++; lastLen = len; }, dispose() {} };
  const g = new WgGiBuffer(dev);
  assert.equal(g.sync(null), null); assert.equal(g.sync({ on: false, field: f }), null);
  const sto = g.sync(gi); assert.ok(sto && sto[0].buffer && creates === 1 && writes === 0);
  for (let i = 0; i < 100; i++) g.sync(gi);
  assert.equal(creates, 1); assert.equal(writes, 0, 'steady state: no GPU calls');
  mixGIState(gi, 14, [0.3, 0.3, 0.3], [1, 1, 1], {}); g.sync(gi);
  assert.equal(writes, 1); assert.equal(lastLen, GI_HDR_WORDS * 4, 'mix bump rewrites the 128 B header only');
  gi.field = Object.assign({}, f, { version: 9 }); g.sync(gi); assert.equal(writes, 2, 'same size field change -> writeBuffer, no realloc'); assert.equal(creates, 1);
  gi.field = f;
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 20000; i++) g.sync(gi); const dh = process.memoryUsage().heapUsed - h0; assert.ok(dh < 64e3, 'sync 0-alloc steady state, heap delta ' + dh); }
}
console.log(`giGpu.test.js OK (${npts} probe points x ${states.length} states, worst err ${(worst * 255).toFixed(3)}/255)`);
