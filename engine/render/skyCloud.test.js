// CLOUD-FLUFF-01b: WGSL `skyCloud` (compileVecFn probe) vs the JS oracle cloudAt + cloudSunTerms over the deck range:
// >= 3000 dirs x sunI {0.25, 0.5, 0.9} x 2 drift offsets, random cloud params. Glyph exact, colours within 1e-3 (f64 both).
// Also liveCloudsRecord (the shared live day/night colour record): reuse, no alloc, inherits the static fields.
import assert from 'node:assert/strict';
import { SKY_CLOUD_WGSL, } from './skyCloud.js';
import { cloudAt, cloudSunTerms, cloudDriftOffset, liveCloudsRecord, CLOUD_RAMP } from './sky.js';
import { hashFast01 } from './terrainShade.js';
import { dirFromAzEl } from '../core/transform.js';
import { compileVecFn } from './gpu/wgsl/wgslVec.js';

const cloudSm = compileVecFn(SKY_CLOUD_WGSL, 'cloudSm');
const cloudNoise = compileVecFn(SKY_CLOUD_WGSL, 'cloudNoise', { hashFast: hashFast01 });
const su = {};
const skyCloud = compileVecFn(SKY_CLOUD_WGSL, 'skyCloud', { su, cloudSm, cloudNoise });
let seed = 4242; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const V = (a) => ({ x: a[0], y: a[1], z: a[2], w: a[3] === undefined ? 0 : a[3] });
const band = [2, 35, 55];
let n = 0, clouds = 0, worst = 0;
for (let set = 0; set < 6; set++) {
  const C = { seed: Math.floor(rnd() * 50), scale: 1.5 + rnd() * 3, bias: 0.2 + rnd() * 0.3, cover: 0.3 + rnd() * 0.3, puffK: 2 + rnd() * 4, wispCover: 0.4 + rnd() * 0.3, wispK: 1 + rnd() * 3,
    litK: 1 + rnd() * 2, litDy: 0.05 + rnd() * 0.1, bodyK: 0.6 + rnd() * 0.6, wind: Float32Array.from([rnd() * 3, rnd() * 2 - 1]),
    lit: [230 + rnd() * 25, 220 + rnd() * 30, 210 + rnd() * 40], shade: [120 + rnd() * 40, 130 + rnd() * 40, 150 + rnd() * 40] };
  for (const t of [3.7, 311.2]) {
    const off = cloudDriftOffset(C, t, new Float32Array(2));
    Object.assign(su, { cloudA: V([1, C.seed, C.scale, C.bias]), cloudB: V([C.cover, C.puffK, C.wispCover, C.wispK]), cloudC: V([C.litK, C.litDy, C.bodyK, 0]),
      cloudD: V([off[0], off[1], band[0], band[1]]), cloudE: V([band[2], 0, 0, 0]), cloudLit: V(C.lit), cloudShade: V(C.shade) });
    for (let i = 0; i < 600; i++) {
      const az = rnd() * 360, el = i % 9 === 0 ? -3 + rnd() * 6 : rnd() * 70;
      const d = dirFromAzEl(az, el, [0, 0, 0]);
      const base = [60 + rnd() * 150, 90 + rnd() * 120, 150 + rnd() * 100];
      for (const sunI of [0.25, 0.5, 0.9]) {
        const out = { base: [...base], band, fg: [0, 0, 0], bg: [0, 0, 0], glyph: 0 };
        cloudSunTerms(sunI, out);
        cloudAt(d[0], d[1], d[2], el, C, off, out);
        const o = skyCloud(V(base), { x: d[0], y: d[1], z: d[2] }, el, sunI);
        const jg = out.glyph < 32 ? 0 : out.glyph - 32;
        assert.equal(o.g, CLOUD_RAMP.includes(String.fromCharCode(out.glyph)) && out.glyph !== 32 ? jg : 0, 'glyph ' + [set, t, az, el, sunI, o.g, out.glyph]);
        for (const [k, j] of [['x', 0], ['y', 1], ['z', 2]]) {
          const dd = Math.max(Math.abs(o.bg[k] - out.bg[j]), out.glyph ? Math.abs(o.fg[k] - out.fg[j]) : 0); worst = Math.max(worst, dd);
          assert.ok(dd < 1e-3, 'colour ' + [set, t, az, el, sunI, k, dd]);
        }
        n++; if (o.g) clouds++;
      }
    }
  }
}
assert.ok(n >= 10000 && clouds > 800, 'probe covers cloud cells ' + clouds + '/' + n);

// liveCloudsRecord: no live blend -> same object; live -> one reused record that inherits and overrides lit/shade
{
  const base = Object.freeze({ seed: 3, lit: Object.freeze([1, 2, 3]), shade: Object.freeze([4, 5, 6]), wind: [1, 0] });
  const cache = { base: null, rec: null };
  assert.equal(liveCloudsRecord(base, null, cache), base);
  assert.equal(liveCloudsRecord(base, { cloudsLit: null }, cache), base);
  assert.equal(liveCloudsRecord(null, { cloudsLit: [1] }, cache), null);
  const L1 = new Float32Array([9, 8, 7]), S1 = new Float32Array([6, 5, 4]);
  const r1 = liveCloudsRecord(base, { cloudsLit: L1, cloudsShade: S1 }, cache), r2 = liveCloudsRecord(base, { cloudsLit: S1, cloudsShade: L1 }, cache);
  assert.equal(r1, r2, 'record reused'); assert.equal(r2.lit, S1); assert.equal(r2.shade, L1); assert.equal(r2.seed, 3); assert.equal(r2.wind, base.wind);
}
console.log('skyCloud OK', n, 'samples, cloud cells', clouds, 'worst', worst.toExponential(2));
