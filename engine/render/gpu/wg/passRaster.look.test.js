// ENV-02d part 2: raster host look textures (lazy look pipeline, NEARLOOK/FARLOOK rg8uint upload on version change, lookActive gating, 0 alloc warm).
// Run: node engine/render/gpu/wg/passRaster.look.test.js
import assert from 'node:assert/strict';
import { WgRasterPass } from './passRaster.js';
import { makeMockGpuDevice } from '../../../test/assert.js';

const mock = makeMockGpuDevice(), d = mock.device, pass = new WgRasterPass(d);
const mk = (look) => ({ farReady: true, nearReady: true, mapW: 4, mapH: 4, farType: new Uint8Array(16), farVersion: 1, farLook: look ? new Uint8Array(32) : null,
  groundLook: look ? { cfg: {} } : null, near: { w: 2, h: 3, type: new Uint8Array(6), version: 1, look: look ? new Uint8Array(12) : undefined } });
const world = { terrain: mk(false) };
pass._terrainTextures(world);
assert.equal(pass.lookActive, false, 'look off: inactive'); assert.equal(pass.terrainLookPipe, null, 'look off: no look pipeline built');
world.terrain = mk(true); pass._terrainTextures(world);
assert.equal(pass.lookActive, true); assert.ok(pass.terrainLookPipe);
assert.deepEqual(pass.terrainLookPipe.desc.bindings.textures, ['uint', 'uint', 'uint', 'uint', 'uint']);
assert.deepEqual(pass.terrainTexL.map((t) => t.slot), [0, 1, 2, 3, 4]);
assert.deepEqual(pass.nearLookDims, [2, 3]); assert.deepEqual(pass.farLookDims, [4, 4]);
assert.equal(pass.lookUploads, 2);
const cnt = mock.createCount, wc = mock.writeCount;
for (let i = 0; i < 500; i++) pass._terrainTextures(world);
assert.equal(pass.lookUploads, 2, 'no re-upload without a version change'); assert.equal(mock.createCount, cnt); assert.equal(mock.writeCount, wc);
world.terrain.near.version++; pass._terrainTextures(world);
assert.equal(pass.lookUploads, 3, 'near.version bump re-uploads the near look only');
world.terrain.near.look = undefined; pass._terrainTextures(world);
assert.equal(pass.lookActive, false, 'near band without look bytes: inactive (type/look would disagree)');
world.terrain = mk(false); pass._terrainTextures(world);
assert.equal(pass.lookActive, false, 'look turned off again');
console.log('passRaster.look: ok');
