// ALPHA-01f cloud item (1) (docs/architecture.md 4280): `wg/passLight.js` `WgLightPass._uploadLight` copies `light.cloud`
// (lighting.js LightSet.cloud: {strength, cover, invScale, offU, offV}) into the LightU uniform words `cloudCover` (= cover)
// and `cloud` (xyzw = strength, invScale, offU, offV) - the same 4 numbers cloudShadow.js's `cloudCov` and the WGSL twin
// `cloudCov` (light.wgsl.js) read. Unit-level: calls `_uploadLight` directly (no world/shadow-pass setup needed).
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgLightPass } from './passLight.js';
import { LIGHT_BLOCK } from '../wgsl/light.wgsl.js';

const W = (n) => LIGHT_BLOCK.field(n).word;
const mock = makeMockGpuDevice(), d = mock.device;
const wl = new WgLightPass(d);

const baseLight = () => ({
  pos: new Float32Array(4), col: new Float32Array(4), count: 0,
  ambient: [0.1, 0.2, 0.3], sun: null,
  visOx: new Float32Array(1), visOy: new Float32Array(1), visW: new Float32Array(1), visH: new Float32Array(1),
  visVersion: new Int32Array(1), vis: new Uint8Array(1),
});

// S8-B2-12c: light.cloud -> packCloudUniforms(cloud, timeSec) at cloudA..cloudA+7 (cloudB follows), f32-rounded.
const CA = W('cloudA');
assert.equal(W('cloudB'), CA + 4, 'cloudB follows cloudA');
{
  const light = baseLight();
  light.cloud = { strength: 0.4, scale: 48, cover: 0.55, soft: 0.2, deckH: 60, seed: 7, wind: [1.5, -2.5] };
  wl._uploadLight(light, 10);
  const exp = [15, 231, 48, 0.4, 0.55, 0.2, 60, 7]; // (-25 % 256 = -25 in JS) -> see below
  exp[1] = (-2.5 * 10) % 256;
  for (let i = 0; i < 8; i++) assert.equal(wl.lu[CA + i], Math.fround(exp[i]), 'cloud word ' + i);
}
// no light.cloud on a full light set, bare array and null: zeroed, never stale.
{
  wl.lu.fill(0, CA, CA + 8); for (let i = 0; i < 8; i++) wl.lu[CA + i] = 9;
  wl._uploadLight(baseLight(), 5);
  for (let i = 0; i < 8; i++) assert.equal(wl.lu[CA + i], 0);
  for (let i = 0; i < 8; i++) wl.lu[CA + i] = 9;
  wl._uploadLight([0.1, 0.1, 0.1]);
  for (let i = 0; i < 8; i++) assert.equal(wl.lu[CA + i], 0);
  for (let i = 0; i < 8; i++) wl.lu[CA + i] = 9;
  wl._uploadLight(null);
  for (let i = 0; i < 8; i++) assert.equal(wl.lu[CA + i], 0);
}
// zero alloc: the cloud8 scratch is reused.
{ const c8 = wl.cloud8; wl._uploadLight(baseLight(), 1); assert.equal(wl.cloud8, c8); }

// S8-B2-20 (38.17) item (1): light.ao present -> aoStrength (word 31) lands at the cached word index, f32-rounded.
{
  const light = baseLight();
  light.ao = { strength: 0.75, radiusM: 0.8, bias: 0.15, maxCells: 4 };
  wl._uploadLight(light);
  assert.equal(wl.lu[W('aoStrength')], Math.fround(0.75), 'aoStrength <- ao.strength');
  const P = W('aoP');
  assert.deepEqual([...wl.lu.subarray(P, P + 4)], [0.8, 0.15, 4, 0].map(Math.fround), 'aoP <- (radiusM, bias, maxCells, 0)');
}

// no light.ao on a full light set: zeroed (strength 0 = bit-identical to no AO).
{
  const light = baseLight();
  wl.lu[W('aoStrength')] = 9; wl.lu.fill(7, W('aoP'), W('aoP') + 4);
  wl._uploadLight(light);
  assert.equal(wl.lu[W('aoStrength')], 0);
  assert.deepEqual([...wl.lu.subarray(W('aoP'), W('aoP') + 4)], [0, 0, 0, 0], 'aoP zeroed');
}

// bare ambient-array back-compat path (`!isSet`): aoStrength zeroed too, never stale.
{
  wl.lu[W('aoStrength')] = 9;
  wl._uploadLight([0.1, 0.1, 0.1]);
  assert.equal(wl.lu[W('aoStrength')], 0);
  wl.lu[W('aoStrength')] = 9;
  wl._uploadLight(null);
  assert.equal(wl.lu[W('aoStrength')], 0);
}

console.log('passLight.test.js (ALPHA-01f cloud item 1 + S8-B2-20 aoStrength): all checks passed.');
