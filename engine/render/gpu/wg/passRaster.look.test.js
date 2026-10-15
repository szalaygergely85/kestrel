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
// swap to a new world with the same near.version: its near look must be uploaded (REV-ENV02D 1)
const t2 = { ...terrain, near: { ...terrain.near, look: new Uint8Array(18).fill(7) }, farLook: new Uint8Array(32) }, world2 = { terrain: t2 };
const ou = pass._uploadLook; const ups = []; pass._uploadLook = function (tex, dims, w, h, data) { ups.push(data); return ou.call(this, tex, dims, w, h, data); };
pass._terrainTextures(world2); assert.ok(ups.includes(t2.near.look) && ups.includes(t2.farLook), 'new world, same versions: both looks re-uploaded');
// near band not ready on the new world: lookWorld must not advance, so the later ready frame still uploads
const t3 = { ...t2, nearReady: false, near: { ...t2.near, look: new Uint8Array(18).fill(9) } }, world3 = { terrain: t3 }; ups.length = 0;
pass._terrainTextures(world3); assert.ok(!ups.includes(t3.near.look)); t3.nearReady = true; pass._terrainTextures(world3);
assert.ok(ups.includes(t3.near.look), 'near look uploaded once ready (not skipped by an early world mark)'); pass._uploadLook = ou;
// BH2-R1: a published band without look (cache hit after a runtime toggle) must fall back to the no-look pipeline
const t4 = { ...terrain, near: { version: 9, w: 3, h: 3, type: new Uint8Array(9) } }; pass._terrainTextures({ terrain: t4 });
assert.equal(pass.lookActive, false, 'near without look: lookActive false (no stale NEARLOOK)');
terrain.groundLook = null; pass._terrainTextures(world); assert.equal(pass.lookActive, false, 'off again = plain path');
pass.dispose(); assert.equal(mock.liveCount(), 0);
console.log('passRaster.look.test.js: all checks passed.');
