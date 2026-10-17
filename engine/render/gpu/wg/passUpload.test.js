// GS-01b (carve mask atlas) + AUD-02/33 (instance upload size + sharing) on the device mock.
// Run: node engine/render/gpu/wg/passUpload.test.js
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { StaticMeshBuilder } from '../../../mesh/MeshData.js';
import { DRAW_INSTANCED, DRAW_FLAG_ONE_PART } from '../../../mesh/DrawList.js';
import { createShadowList } from '../../../mesh/shadowList.js';
import { createInstanceBuffer, touchInstances, INSTANCE_BYTES } from '../../../mesh/instances.js';
import { insideStructFoot } from '../../../mesh/rasterJS.js';
import { WgRasterPass } from './passRaster.js';
import { WgShadowPass } from './passShadow.js';
import { StructMaskAtlas } from '../StructMaskAtlas.js';
import { TERRAIN_BLOCK } from '../wgsl/terrainRaster.wgsl.js';
import { SHADOW_TERRAIN_BLOCK } from '../wgsl/shadow.wgsl.js';

const struct = (x, y, w, h, mask) => ({ id: `s${x}`, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, carveMask: mask });

// ---- StructMaskAtlas: packing, change detection, zero work when unchanged ----
{
  const mock = makeMockGpuDevice(), d = mock.device;
  const atlas = new StructMaskAtlas(d);
  const tu = new Float32Array(64);
  const mA = new Uint8Array([1, 0, 1, 0, 1, 1]), mB = new Uint8Array([0, 1, 1, 0]); // 3x2 and 2x2
  const structs = [struct(10, 20, 3, 2, mA), { kind: 'mesh', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }, struct(0, 0, 4, 4, null), struct(30, 30, 2, 2, mB)];
  assert.equal(atlas.sync(structs, tu, 8), 3, 'mesh structures skipped (same order as the passes structFoot packing)');
  assert.deepEqual([...tu.slice(8, 20)], [0, 1, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0], 'rowOff / hasMask per box (unmasked box: hasMask 0)');
  assert.deepEqual([atlas.w, atlas.h, atlas.uploads], [3, 4, 1]);
  const data = d.writeTexture && atlas.tex._lastTexWrite.data;
  assert.deepEqual([...data], [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0], 'rows stacked, columns padded with 0');
  const tw = mock.texWriteCount, cr = mock.createCount;
  for (let i = 0; i < 50; i++) atlas.sync(structs, tu, 8);
  assert.equal(mock.texWriteCount, tw); assert.equal(mock.createCount, cr); assert.equal(atlas.uploads, 1, 'unchanged mask list: no upload, no allocation');
  // JS twin parity: atlas lookup == insideStructFoot with the same masks
  const foot = new Float64Array([10, 20, 13, 22, 0, 0, 4, 4, 30, 30, 32, 32]), masks = [mA, null, mB];
  const at = (x, y) => { // what the WGSL does
    for (let i = 0; i < 3; i++) {
      const o = i * 4; if (!(x >= foot[o] && x < foot[o + 2] && y >= foot[o + 1] && y < foot[o + 3])) continue;
      if (tu[8 + i * 4 + 1] < 0.5) return true;
      if (data[(Math.trunc(y - foot[o + 1]) + tu[8 + i * 4]) * atlas.w + Math.trunc(x - foot[o])] !== 0) return true;
    }
    return false;
  };
  for (let y = -1; y < 35; y += 0.5) for (let x = -1; x < 35; x += 0.5) assert.equal(at(x, y), insideStructFoot(foot, 3, x, y, masks), `parity ${x},${y}`);
  // a different mask list rebuilds once (and resizes the texture)
  structs[0].carveMask = new Uint8Array(6).fill(1);
  atlas.sync(structs, tu, 8); assert.equal(atlas.uploads, 2);
  structs.pop(); atlas.sync(structs, tu, 8); assert.equal(atlas.uploads, 3); assert.equal(atlas.h, 2);
  assert.throws(() => { structs[0].carveMask = new Uint8Array(5); atlas.sync(structs, tu, 8); }, /carveMask 5 != 3x2/);
  atlas.dispose(); assert.equal(mock.liveCount(), 0);
}

// ---- passes: masks reach the terrain uniform blocks; no mask anywhere = hasMask 0 everywhere ----
const mock = makeMockGpuDevice(), d = mock.device;
const raster = new WgRasterPass(d), shadow = new WgShadowPass(d, { shadows: { res: 256 } });
raster.prepare = () => {};
const world = { structures: [struct(1, 2, 3, 2, new Uint8Array([1, 0, 1, 0, 1, 1])), struct(9, 9, 2, 2, null)], terrain: { nearReady: false, near: null, _farGridDraw: null, mapCell: 1, mapW: 1 } };
raster._terrainUniforms(world);
{
  const w = TERRAIN_BLOCK.field('structMask').word;
  assert.deepEqual([...raster.tu.slice(w, w + 8)], [0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(raster.terrainTex[2].texture, raster.structMasks.tex, 'atlas bound at slot 2');
  assert.equal(raster.structMasks.uploads, 1);
  raster._terrainUniforms(world); assert.equal(raster.structMasks.uploads, 1, 'second frame: no upload');
}
{
  const n = shadow._fillFoot(world), w = SHADOW_TERRAIN_BLOCK.field('structMask').word;
  assert.equal(n, 2); assert.deepEqual([...shadow.tu.slice(w, w + 8)], [0, 1, 0, 0, 0, 0, 0, 0]);
  const fp = (shadow._world = world, shadow.footprints());
  assert.equal(fp.masks[0], world.structures[0].carveMask); assert.equal(fp.masks[1], null);
  assert.equal(shadow.terrainPipe.desc.bindings.textures[0], 'uint'); assert.equal(shadow.terrainBindDesc.textures[0].texture, shadow.structMasks.tex);
}
{ // levels without a mask: every hasMask word is 0 (byte-identical carve to the pre-GS-01b whole-bbox test)
  const m2 = makeMockGpuDevice(), r2 = new WgRasterPass(m2.device);
  r2._terrainUniforms({ structures: [struct(0, 0, 4, 4, null), struct(5, 5, 2, 2, undefined)], terrain: world.terrain });
  const w = TERRAIN_BLOCK.field('structMask').word;
  assert.deepEqual([...r2.tu.slice(w, w + 8)], [0, 0, 0, 0, 0, 0, 0, 0]); assert.equal(r2.structMasks.h, 1);
}

// ---- AUD-02/33: instance upload = used rows only, nothing when the version is unchanged, shadow shares the raster copy ----
{
  const mb = new StaticMeshBuilder('upload-quad');
  mb.addQuad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0xf0000001, 9 | (5 << 8) | (3 << 16), [0, 0, 0, 0, 0, 0, 0, 0]);
  const mesh = mb.build(); mesh.ranges = [{ start: 0, count: 2 }];
  const ib = createInstanceBuffer(64);
  const runRaster = (cnt) => {
    raster.list.begin(); const it = raster.list.push(); it.type = DRAW_INSTANCED; it.mesh = mesh; it.instBuf = ib; it.instCount = cnt; it.flags = DRAW_FLAG_ONE_PART;
    it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); it.partFlags[0] = 1;
    d.beginPass = () => {}; d.draw = () => {}; raster.run({ _t: { targetRaster: {}, targetVmDepth: {} }, stats: {} });
  };
  const writes = () => (raster.instanceBuffers.get(ib).buffer._lastWrite);
  runRaster(10); // first use: buffer created with data (counts as the upload)
  const ent = raster.instanceBuffers.get(ib), w0 = mock.writeCount;
  runRaster(10); runRaster(4); assert.equal(mock.writeCount, w0, 'same version, count <= uploaded: no write'); assert.equal(raster.instSkips, 2);
  touchInstances(ib); runRaster(5);
  assert.equal(mock.writeCount, w0 + 1); assert.equal(writes().byteLength, 5 * INSTANCE_BYTES, 'new version: only 5 rows (not capacity 64)');
  runRaster(8); assert.equal(writes().byteLength, 8 * INSTANCE_BYTES, 'same version but more rows than uploaded: extend'); assert.equal(ent.count, 8);
  // shadow: shares the raster copy while it holds this version; otherwise its own copy, count rows, once per version
  shadow._raster = raster;
  const sl = createShadowList();
  const runShadow = (cnt, consumer = 0) => {
    sl.begin(); const it = sl.push(); it.type = DRAW_INSTANCED; it.mesh = mesh; it.instBuf = ib; it.instCount = cnt; it.flags = DRAW_FLAG_ONE_PART;
    it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    shadow.buffers.getVoxel = raster.buffers.getVoxel.bind(raster.buffers);
    d.beginPass = () => {}; d.draw = () => {}; shadow.renderCasters(shadow.target, shadow.sunMatF32, sl, world, null, 0, false, consumer);
  };
  const c0 = mock.createCount, w1 = mock.writeCount;
  runShadow(6); assert.equal(shadow.instShared, 1, 'raster copy has this version + rows: shared'); assert.equal(mock.createCount, c0); assert.equal(mock.writeCount, w1);
  touchInstances(ib); // raster copy is now stale for this version
  runShadow(6); assert.equal(shadow.instShared, 1); assert.equal(shadow.instanceBuffers.get(ib)[0].buffer._lastWrite, undefined, 'first own copy is created with data');
  const w2 = mock.writeCount; runShadow(6); assert.equal(mock.writeCount, w2, 'own copy, same version: skipped');
  touchInstances(ib); runShadow(3); assert.equal(shadow.instanceBuffers.get(ib)[0].buffer._lastWrite.byteLength, 3 * INSTANCE_BYTES, 'own copy: only used rows');
  runShadow(2, 1); assert.equal(shadow.instanceBuffers.get(ib).length, 2, 'point-light consumer keeps its own copy');
}
console.log('passUpload.test.js: carve mask atlas (pack / change detect / parity) and instance upload (rows, version skip, share) ok.');
