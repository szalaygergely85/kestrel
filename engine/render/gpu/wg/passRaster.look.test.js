// ENV-02d: passRaster look host. groundLook null = no look pipeline, no look textures; on = lazy pipeline + NEARLOOK/FARLOOK rg8ui uploaded on version change only.
// Run: node engine/render/gpu/wg/passRaster.look.test.js
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgRasterPass } from './passRaster.js';
import { TERRAIN_LOOK_TEXTURES } from '../wgsl/terrainRaster.wgsl.js';

const mock = makeMockGpuDevice(), d = mock.device, pass = new WgRasterPass(d);
const terrain = { farReady: true, farVersion: 1, mapW: 4, mapH: 4, farType: new Uint8Array(16), nearReady: true, near: { version: 1, w: 3, h: 3, type: new Uint8Array(9) }, groundLook: null, farLook: null };
const world = { terrain };
let pipes = 0; const oc = d.createPipeline; d.createPipeline = (x) => { pipes++; return oc.call(d, x); };
let tw = 0, fmts = []; const ow = d.writeTexture; d.writeTexture = (t, ...a) => { tw++; fmts.push(t.desc ? t.desc.format : t.format); return ow && ow.call(d, t, ...a); };
pass._terrainTextures(world);
assert.equal(pass.lookActive, false); assert.equal(pipes, 0, 'groundLook null: no look pipeline'); assert.equal(pass.terrainPipeLook, null); assert.equal(tw, 2);
terrain.groundLook = { cfg: {} }; terrain.farLook = new Uint8Array(32); terrain.near.look = new Uint8Array(18);
pass._terrainTextures(world);
assert.equal(pass.lookActive, true); assert.equal(pipes, 1); assert.deepEqual(pass.terrainPipeLook.desc.bindings.textures, TERRAIN_LOOK_TEXTURES.slice());
assert.deepEqual(pass.terrainTexL.map((t) => t.slot), [0, 1, 2, 3, 4]); assert.deepEqual(pass.farLookDims, [4, 4]); assert.deepEqual(pass.nearLookDims, [3, 3]);
const w1 = tw; for (let i = 0; i < 10; i++) pass._terrainTextures(world);
assert.equal(tw, w1, 'no re-upload while versions are unchanged'); assert.equal(pipes, 1, 'pipeline built once');
terrain.near.version = 2; pass._terrainTextures(world); assert.equal(tw, w1 + 2, 'near type + near look on a near.version change');
terrain.groundLook = null; pass._terrainTextures(world); assert.equal(pass.lookActive, false, 'off again = plain path');
pass.dispose(); assert.equal(mock.liveCount(), 0);
console.log('passRaster.look.test.js: all checks passed.');
