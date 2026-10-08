// WG-2b: draw order/ranges, integer uniforms, mirrored winding, sentinel/depth clear, resource reuse.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { StaticMeshBuilder } from '../../../mesh/MeshData.js';
import { DrawList, DRAW_TERRAIN, DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH } from '../../../mesh/DrawList.js';
import { WgRasterPass, NO_STRUCTURES } from './passRaster.js';
import { RASTER_BLOCK } from '../wgsl/raster.wgsl.js';
import { TERRAIN_BLOCK } from '../wgsl/terrainRaster.wgsl.js';

const mock = makeMockGpuDevice(), d = mock.device;
const pass = new WgRasterPass(d), draws = [], clears = [];
d.beginPass = (target, opts) => clears.push({ target, opts });
d.draw = (count, first, instances) => draws.push({ pipe: d._activePipeline, count, first, instances,
  uniforms: new Uint32Array(d._lastBind.uniforms.buffer).slice(), bind: d._lastBind, extra: d._lastBind.extraBuffers && d._lastBind.extraBuffers[0] });
const builder = new StaticMeshBuilder('wg-raster-quad');
builder.addQuad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0xf0000001, 9 | (5 << 8) | (3 << 16), [0, 0, 0, 0, 0, 0, 0, 0]);
const mesh = builder.build(); mesh.ranges = [{ start: 0, count: 2 }];
const p = { _t: { targetRaster: {}, targetVmDepth: {} }, stats: {} };
const staticItem = pass.list.push(); staticItem.type = DRAW_STATIC; staticItem.mesh = mesh; staticItem.rangeCount = 2;
staticItem.planeIdOr = 0x90000000; staticItem.objectId = 0x8001; staticItem.zBase = 3;
staticItem.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6]);
const voxel = pass.list.push(); voxel.type = DRAW_VOXEL; voxel.mesh = mesh; voxel.mirror = 1;
voxel.partMatrices.set(staticItem.matrix); voxel.partFlags[0] = 1;
const instance = pass.list.push(); instance.type = DRAW_INSTANCED; instance.mesh = mesh;
instance.instBuf = { f32: new Float32Array(32) }; instance.instCount = 2;
instance.partMatrices.set(staticItem.matrix); instance.partFlags[0] = 1;
const vmList = new DrawList(1), vm = vmList.push();
vm.type = DRAW_VOXEL; vm.mesh = mesh; vm.partMatrices.set(staticItem.matrix); vm.partFlags[0] = 1;
pass.vmList = vmList;
pass.prepare = () => {};
pass.run(p);
assert.deepEqual(draws.map(x => [x.count, x.first, x.instances]), [[6, 0, 1], [6, 0, 1], [6, 0, 2], [6, 0, 1]]);
assert.deepEqual(draws.map(x => x.pipe.desc.frontFace), ['cw', 'ccw', 'cw', 'cw']);
assert.equal(draws[1].pipe.desc.cull, 'back');
assert.equal(draws[0].uniforms[RASTER_BLOCK.field('planeIdOr').word], 0x90000000);
assert.equal(draws[0].uniforms[RASTER_BLOCK.field('objectId').word], 0x8001);
assert.deepEqual([...new Float32Array(draws[0].uniforms.buffer)].slice(12, 16), [4, 5, 6, 1]);
assert.equal(draws[1].uniforms[RASTER_BLOCK.field('axisAligned').word], 1);
assert.equal(clears[0].opts.clear.color[2][0], 0x7f800000, 'empty depth cells retain infinity sentinel');
assert.equal(clears[1].target, p._t.targetVmDepth, 'viewmodel clear touches only shared depth');
assert.equal(clears[2].opts, undefined, 'viewmodel draw reloads world G-buffer');
assert.equal(p.stats.vmDraws, 1); assert.equal(p.stats.instances, 2);
const resources = mock.createCount, uniforms = pass.u, bindDesc = pass.bindDesc;
for (let i = 0; i < 1000; i++) pass.run(p);
assert.equal(mock.createCount, resources, 'warm frames allocate no buffers, textures, or pipelines');
assert.equal(pass.u, uniforms); assert.equal(pass.bindDesc, bindDesc);
assert.equal(mock.writeCount, 1000, 'instanced buffer is updated without recreation');
// Cloth: dynamic pos/normal buffer + static uv as an extra vertex stream; two-sided; flat words from the mesh material.
const uvBuf = d.createBuffer({ usage: 'vertex', bytes: 32 }), clothVb = d.createBuffer({ usage: 'vertex', bytes: 64 }), clothIb = d.createBuffer({ usage: 'index', bytes: 12 });
pass.buffers.getCloth = () => ({ vertexBuffer: clothVb, uvBuffer: uvBuf, indexBuffer: clothIb });
const cloth = pass.list.push(); cloth.type = DRAW_CLOTH; cloth.mesh = { matId: 7 }; cloth.rangeCount = 3; cloth.rangeFirst = 1; cloth.matrix.set(staticItem.matrix);
draws.length = 0; pass.run(p);
const cd = draws.find((x) => x.pipe === pass.clothPipe);
assert.equal(cd.pipe, pass.clothPipe); assert.equal(cd.pipe.desc.cull, 'none'); assert.equal(cd.pipe.desc.frontFace, 'cw');
assert.equal(cd.pipe.desc.vertex.extraLayouts[0].layout[0].location, 1, 'uv extra stream at location 1');
assert.equal(cd.extra, uvBuf); assert.equal(cd.count, 9); assert.equal(cd.first, 3);
assert.equal(cd.uniforms[RASTER_BLOCK.field('flat').word + 1] >>> 16, 7, 'cloth material in flat.y');
assert.equal(p.stats.clothDraws, 1);
// Terrain (WG-2c): own pipeline (cull none, indexed), model/objectId words, r8ui type textures bound at slots 0/1.
const tvb = d.createBuffer({ usage: 'vertex', bytes: 64 }), tib = d.createBuffer({ usage: 'index', bytes: 24 });
const origGet = pass.buffers.get; pass.buffers.get = (m) => m === tmesh ? { vertexBuffer: tvb, indexBuffer: tib } : origGet.call(pass.buffers, m);
const tmesh = { layout: 'terrain' };
const terr = pass.list.push(); terr.type = DRAW_TERRAIN; terr.mesh = tmesh; terr.rangeCount = 2; terr.rangeFirst = 1; terr.objectId = 0x7003;
terr.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 16, 32, 2]);
draws.length = 0; pass.run(p);
const td = draws.find((x) => x.pipe === pass.terrainPipe);
assert.ok(td, 'terrain draw issued'); assert.equal(td.pipe.desc.cull, 'none'); assert.equal(td.pipe.desc.frontFace, 'cw');
assert.equal(td.count, 6); assert.equal(td.first, 3); assert.equal(td.bind.indexBuffer, tib);
assert.equal(td.uniforms[TERRAIN_BLOCK.field('objectId').word], 0x7003);
assert.deepEqual([...new Float32Array(td.uniforms.buffer)].slice(TERRAIN_BLOCK.field('model').word + 12, TERRAIN_BLOCK.field('model').word + 16), [16, 32, 2, 1]);
assert.deepEqual(td.bind.textures.map((t) => t.slot), [0, 1]); assert.deepEqual(td.pipe.desc.bindings.textures, ['uint', 'uint']);
assert.equal(p.stats.terrainDraws, 1);
// Type textures: uploaded on version change only (r8ui, resized when the bake size differs), never per frame.
const world = { terrain: { farReady: true, farVersion: 1, mapW: 4, mapH: 4, farType: new Uint8Array(16), nearReady: true, near: { version: 1, w: 3, h: 3, type: new Uint8Array(9) } } };
let tw = 0; const ow = d.writeTexture; d.writeTexture = (...a) => { tw++; return ow && ow.apply(d, a); };
pass._terrainTextures(world);
assert.equal(tw, 2);
assert.deepEqual(pass.farDims, [4, 4]); assert.deepEqual(pass.nearDims, [3, 3]);
for (let i = 0; i < 10; i++) pass._terrainTextures(world);
assert.equal(tw, 2, 'no re-upload while versions are unchanged');
world.terrain.farVersion = 2; pass._terrainTextures(world); assert.equal(tw, 3); d.writeTexture = ow;
pass.dispose(); d.dispose(tvb); d.dispose(tib); d.dispose(uvBuf); d.dispose(clothVb); d.dispose(clothIb); assert.equal(mock.liveCount(), 0);
console.log('passRaster.test.js: all checks passed.');
// MESH-INST-01 feed: DRAW_FLAG_ONE_PART draws the whole mesh as one range (one draw per group), ranges ignored.
{
  const { DRAW_FLAG_ONE_PART } = await import('../../../mesh/DrawList.js');
  const m2 = Object.assign(Object.create(Object.getPrototypeOf(mesh)), mesh); m2.ranges = [{ start: 0, count: 1 }, { start: 1, count: 1 }]; m2.triCount = 2;
  pass.list.begin();
  const g = pass.list.push(); g.type = DRAW_INSTANCED; g.mesh = m2; g.instBuf = { f32: new Float32Array(48) }; g.instCount = 3; g.flags = DRAW_FLAG_ONE_PART;
  g.partMatrices.set(staticItem.matrix);
  pass.vmList = null; draws.length = 0; pass.run(p);
  const gd = draws.filter((x) => x.pipe === pass.instancePipe);
  assert.deepEqual(gd.map((x) => [x.count, x.first, x.instances]), [[6, 0, 3]], 'one-part group = one instanced draw over all triangles');
  assert.ok(pass.meshGroups && pass.meshDrawArg, 'raster pass owns the MeshGroupSet + meshDraw arg');
}

// 38.8a 26a: worlds without `structures` use ONE frozen module-level empty array (no `|| []` allocation per frame)
{
  assert.ok(Object.isFrozen(NO_STRUCTURES) && NO_STRUCTURES.length === 0);
  const src = WgRasterPass.prototype._terrainUniforms.toString();
  assert.ok(src.includes('NO_STRUCTURES') && !/\|\|\s*\[\]/.test(src), '_terrainUniforms must not allocate a fallback array');
  const t = { nearReady: false, near: null, _farGridDraw: null, mapCell: 1, mapW: 1 };
  pass.view = pass.view || new Float32Array(16);
  pass._terrainUniforms({ terrain: t });
  assert.equal(new Uint32Array(pass.tu.buffer)[TERRAIN_BLOCK.field('structCount').word], 0);
}

// WG-4a: GPU cull path. Supported batches (meshGroup, single-range voxel unit) -> one dispatch each + drawIndirect per active LOD entry;
// unsupported (multi-range voxel unit) keeps the CPU DRAW_INSTANCED item; gpuCull:false leaves every batch on the CPU path.
{
  const { makeInstanceGroup } = await import('../../../mesh/instances.js');
  const { INSTANCE_BYTES } = await import('../../../mesh/instances.js');
  const { DRAW_FLAG_ONE_PART } = await import('../../../mesh/DrawList.js');
  const m2 = makeMockGpuDevice(), dev = m2.device;
  const mk = (tris, ranges) => ({ triCount: tris, ranges, bbox: [-1, -1, 0, 1, 1, 2], layout: 'static' });
  const one = mk(2, [{ start: 0, count: 2 }]), lod1 = mk(1, [{ start: 0, count: 1 }]), multi = mk(2, [{ start: 0, count: 1 }, { start: 1, count: 1 }]);
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), ib = dev.createBuffer({ usage: 'index', bytes: 24 });
  const group = (n, lodCells, meshGroup) => {
    const g = makeInstanceGroup('g' + n, 8); g.count = n; g.lodCells = lodCells;
    g.parts.count = 1; g.parts.m[0] = g.parts.m[4] = g.parts.m[8] = 1; g.parts.flags[0] = 1;
    if (meshGroup) g.mesh = {}; return g;
  };
  const gMesh = group(5, 0, true), gVox = group(6, 4, false), gMulti = group(3, 0, false);
  const make = (opts) => {
    const ps = new WgRasterPass(dev, opts);
    ps.buffers.getVoxel = () => ({ vertexBuffer: vb, indexBuffer: ib });
    ps.vmList = null;
    ps.prepare = () => {
      ps.list.begin(); ps.gpuN = 0;
      const hook = ps.cull ? ps._gpuHook : null;
      if (!(hook && hook.accept(gMesh, one, null))) { const it = ps.list.push(); it.type = DRAW_INSTANCED; it.mesh = one; it.instBuf = gMesh.ib; it.instCount = 5; it.flags = DRAW_FLAG_ONE_PART; }
      if (!(hook && hook.accept(gVox, one, lod1))) { const it = ps.list.push(); it.type = DRAW_INSTANCED; it.mesh = one; it.instBuf = gVox.ib; it.instCount = 6; }
      if (!(hook && hook.accept(gMulti, multi, null))) { const it = ps.list.push(); it.type = DRAW_INSTANCED; it.mesh = multi; it.instBuf = gMulti.ib; it.instCount = 3; }
    };
    return ps;
  };
  let recOn = true; const rec = []; const odraw = dev.draw; dev.draw = (c, f, i) => { if (recOn) rec.push(['draw', c, f, i]); return odraw.call(dev, c, f, i); };
  const oind = dev.drawIndirect; dev.drawIndirect = (b, o) => { if (recOn) rec.push(['ind', o]); return oind.call(dev, b, o); };
  const pp = { _t: { targetRaster: {}, targetVmDepth: {} }, stats: {}, rows: 60 };
  const on = make({});
  assert.ok(on.cull, 'gpuCull defaults on');
  dev._dispatches = 0; on.run(pp);
  assert.equal(on.gpuN, 2, 'meshGroup + single-range voxel unit go to the kernel'); assert.equal(dev._dispatches, 2, 'one dispatch per supported batch');
  assert.equal(rec.filter((r) => r[0] === 'ind').length, 3, 'drawIndirect per active entry: meshGroup LOD0 + voxel LOD0 + LOD1');
  assert.equal(rec.filter((r) => r[0] === 'draw').length, 2, 'multi-range voxel unit falls back to the CPU path: one draw per range');
  assert.equal(pp.stats.gpuCullDraws, 3);
  // instance pipe vertex layout accepts the 64 B rows the kernel writes
  assert.equal(on.instancePipe.desc.vertex.instanceStrideBytes, INSTANCE_BYTES);
  assert.deepEqual(on.instancePipe.desc.vertex.instanceLayout.map((a) => a.offsetBytes), [0, 16, 32, 48]);
  // zero allocation per warm frame
  recOn = false;
  const created = m2.createCount, bd = on.bindDesc;
  for (let i = 0; i < 2000; i++) on.run(pp);
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) on.run(pp);
  const grew = process.memoryUsage().heapUsed - h0;
  assert.equal(m2.createCount, created, 'no buffers/pipelines created on warm frames'); assert.equal(on.bindDesc, bd);
  assert.ok(grew < 4e6, 'heap growth over 20000 frames: ' + grew);
  // gpucull=0: everything on the CPU path, no compute
  recOn = true;
  rec.length = 0; dev._dispatches = 0; dev._indirectDraws = 0;
  const off = make({ gpuCull: false });
  assert.equal(off.cull, null); off.run(pp);
  assert.equal(dev._dispatches, 0); assert.equal(dev._indirectDraws || 0, 0); assert.equal(off.gpuN, 0);
  assert.equal(rec.filter((r) => r[0] === 'draw').length, 4, 'CPU path: 1 + 1 + 2 range draws');
  on.dispose(); off.dispose();
}
console.log('passRaster.test.js (WG-4a): all checks passed.');
