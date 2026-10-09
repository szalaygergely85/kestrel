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

// light.cloud present: 4 floats + cover land at the cached word indices, f32-rounded.
{
  const light = baseLight();
  light.cloud = { strength: 0.4, cover: 0.55, invScale: 1 / 48, offU: 1.5, offV: -2.5 };
  wl._uploadLight(light);
  assert.equal(wl.lu[W('cloudCover')], Math.fround(0.55), 'cloudCover <- cloud.cover');
  assert.equal(wl.lu[W('cloud')], Math.fround(0.4), 'cloud.x <- cloud.strength');
  assert.equal(wl.lu[W('cloud') + 1], Math.fround(1 / 48), 'cloud.y <- cloud.invScale');
  assert.equal(wl.lu[W('cloud') + 2], Math.fround(1.5), 'cloud.z <- cloud.offU');
  assert.equal(wl.lu[W('cloud') + 3], Math.fround(-2.5), 'cloud.w <- cloud.offV');
}

// no light.cloud on a full light set: zeroed (strength 0 = bit-identical to no clouds).
{
  const light = baseLight();
  wl.lu[W('cloudCover')] = 9; wl.lu[W('cloud')] = 9; wl.lu[W('cloud') + 3] = 9;
  wl._uploadLight(light);
  assert.equal(wl.lu[W('cloudCover')], 0); assert.equal(wl.lu[W('cloud')], 0); assert.equal(wl.lu[W('cloud') + 3], 0);
}

// bare ambient-array back-compat path (GpuCellPipeline._uploadLightUniforms twin: `!isSet`): cloud words zeroed too, never stale.
{
  wl.lu[W('cloudCover')] = 9; wl.lu[W('cloud')] = 9; wl.lu[W('cloud') + 1] = 9;
  wl._uploadLight([0.1, 0.1, 0.1]);
  assert.equal(wl.lu[W('cloudCover')], 0); assert.equal(wl.lu[W('cloud')], 0); assert.equal(wl.lu[W('cloud') + 1], 0);
  wl._uploadLight(null);
  assert.equal(wl.lu[W('cloudCover')], 0); assert.equal(wl.lu[W('cloud')], 0);
}

console.log('passLight.test.js (ALPHA-01f cloud item 1): all checks passed.');
