// WG-2b: draw order/ranges, integer uniforms, mirrored winding, sentinel/depth clear, resource reuse.
// Run: node engine/render/gpu/wg/passRaster.test.js  (re-spawns itself with --expose-gc for the heap check)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { StaticMeshBuilder } from '../../../mesh/MeshData.js';
import { DrawList, DRAW_TERRAIN, DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH } from '../../../mesh/DrawList.js';
import { WgRasterPass, NO_STRUCTURES, TERRAIN_REBASE } from './passRaster.js';
import { RASTER_BLOCK } from '../wgsl/raster.wgsl.js';
import { TERRAIN_BLOCK } from '../wgsl/terrainRaster.wgsl.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

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
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) on.run(pp);
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  assert.equal(m2.createCount, created, 'no buffers/pipelines created on warm frames'); assert.equal(on.bindDesc, bd);
  assert.ok(grew < 4e6, 'heap growth over 20000 frames: ' + grew);
  // S8-B2-10c: occl on = HZB build after raster A, cull phase 2, raster B (load-only); first frame / invalidate / resize -> hzbOn 0 (no phase 2, no pass B)
  {
    recOn = true;
    const oc = make({ occl: true });
    oc.view[7] = 1; // forward = +y (the clip.w row)
    const ppo = { _t: { targetRaster: {}, targetVmDepth: {}, texSDepth: {}, subCols: 64, subRows: 32 }, stats: {}, rows: 60 };
    const passes = []; const obp = dev.beginPass; dev.beginPass = (t, o) => { passes.push(o ? 'A' : 'B'); return obp.call(dev, t, o); };
    const frame = () => { rec.length = 0; passes.length = 0; dev._dispatches = 0; oc.run(ppo); return { disp: dev._dispatches, passes: passes.join(''), ind: rec.filter((r) => r[0] === 'ind').length }; };
    const levels = 7; // 64x32 -> 1x1
    let r = frame();
    assert.equal(r.disp, 2 + (levels - 1), 'frame 1: phase 1 per batch + the HZB build, no phase 2'); assert.equal(r.passes, 'A'); assert.equal(r.ind, 3);
    r = frame();
    assert.equal(r.disp, 2 + (levels - 1) + 2, 'frame 2: + one phase-2 dispatch per batch'); assert.equal(r.passes, 'AB', 'raster B is a load-only pass after A'); assert.equal(r.ind, 6, 'phase-2 entries drawn in B');
    oc.invalidateHzb(); r = frame();
    assert.equal(r.disp, 2 + (levels - 1)); assert.equal(r.passes, 'A', 'invalidateHzb: hzbOn 0 frame');
    r = frame(); assert.equal(r.passes, 'AB', 'valid again after one build');
    ppo._t.subCols = 48; r = frame(); assert.equal(r.passes, 'A', 'resize invalidates');
    dev.beginPass = obp; oc.dispose();
    recOn = false;
  }
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

// ALPHA-01c: masked static mesh = per-range draws (opaque ranges: staticPipe, masked ranges: maskPipe + mask uniforms + uv extra stream + atlas texture);
// the R8UI atlas is uploaded once (never per frame); no atlas / no uv stream = one opaque draw as before.
{
  const { RASTER_MASK_BLOCK } = await import('../wgsl/raster.wgsl.js');
  const { MaskAtlas } = await import('../../MaskAtlas.js');
  const m3 = makeMockGpuDevice(), dev = m3.device, dr = [];
  dev.draw = (c, f, i) => dr.push({ pipe: dev._activePipeline, c, f, i, bind: dev._lastBind, u: new Uint32Array(dev._lastBind.uniforms.buffer, dev._lastBind.uniforms.byteOffset, dev._lastBind.uniforms.length).slice() });
  const ps = new WgRasterPass(dev, { gpuCull: false });
  const atlas = new MaskAtlas(); atlas.add('t/a', 2, 2, new Uint8Array([9, 9, 9, 9])); atlas.add('t/checker', 4, 4, new Uint8Array(16));
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), uvb = dev.createBuffer({ usage: 'vertex', bytes: 64 });
  let withUv = true;
  ps.buffers.get = () => (withUv ? { vertexBuffer: vb, uvMaskBuffer: uvb } : { vertexBuffer: vb });
  const mm = { triCount: 6, ranges: [{ start: 0, count: 2 }, { start: 2, count: 3 }, { start: 5, count: 1 }], maskRanges: new Int32Array([0, 0, -1, 0, 0, /**/ 2, 0, 4, 4, 128, /**/ 0, 0, -1, 0, 0]) };
  const world = { maskAtlas: atlas };
  ps.prepare = () => { ps._maskTexture(world); ps.list.begin(); const it = ps.list.push(); it.type = DRAW_STATIC; it.mesh = mm; it.rangeFirst = 0; it.rangeCount = 6; it.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); it.planeIdOr = 0x30000000; };
  ps.vmList = null;
  const pp = { _t: { targetRaster: {}, targetVmDepth: {} }, stats: {} };
  ps.run(pp);
  assert.deepEqual(dr.map((x) => [x.pipe === ps.maskPipe ? 'mask' : 'opaque', x.c, x.f]), [['opaque', 6, 0], ['mask', 9, 6], ['opaque', 3, 15]], 'ranges in order, one draw each');
  const md = dr[1], MU = (n) => md.u[RASTER_MASK_BLOCK.field(n).word];
  assert.deepEqual([MU('maskX0'), MU('maskY0'), MU('maskW'), MU('maskH'), MU('maskCut')], [2, 0, 4, 4, 128], 'atlas rect + cutoff byte in the uniform block');
  assert.equal(MU('planeIdOr'), 0x30000000, 'base words copied into the mask block');
  assert.equal(md.bind.extraBuffers[0], uvb); assert.equal(md.bind.textures[0].slot, 0); assert.equal(md.bind.textures[0].texture, ps.maskTex);
  assert.equal(md.pipe.desc.cull, 'none'); assert.deepEqual(md.pipe.desc.bindings.textures, ['uint']); assert.equal(md.pipe.desc.vertex.extraLayouts[0].layout[0].location, 10);
  assert.equal(pp.stats.maskDraws, 1); assert.equal(pp.stats.maskUploads, 1);
  const created = m3.createCount, wr = m3.writeCount;
  for (let i = 0; i < 500; i++) ps.run(pp);
  assert.equal(pp.stats.maskUploads, 1, '0 atlas uploads per frame after warm-up'); assert.equal(m3.createCount, created, 'no resources created per frame'); assert.equal(m3.writeCount, wr, 'no writeTexture per frame');
  atlas.add('t/c', 2, 2, new Uint8Array(4)); ps.run(pp);
  assert.equal(pp.stats.maskUploads, 2, 'a new atlas version re-uploads once');
  // item window clips the ranges (rasterDrawList parity)
  dr.length = 0; ps.prepare = () => { ps._maskTexture(world); ps.list.begin(); const it = ps.list.push(); it.type = DRAW_STATIC; it.mesh = mm; it.rangeFirst = 3; it.rangeCount = 2; };
  ps.run(pp); assert.deepEqual(dr.map((x) => [x.c, x.f]), [[6, 9]], 'window [3,5) = 2 triangles of the masked range');
  // fallbacks: no uv stream or no atlas -> a single opaque draw over the whole item
  dr.length = 0; withUv = false; ps.prepare = () => { ps._maskTexture(world); ps.list.begin(); const it = ps.list.push(); it.type = DRAW_STATIC; it.mesh = mm; it.rangeFirst = 0; it.rangeCount = 6; };
  ps.run(pp); assert.deepEqual(dr.map((x) => [x.pipe === ps.staticPipe, x.c, x.f]), [[true, 18, 0]]);
  dr.length = 0; withUv = true; world.maskAtlas = null; ps.run(pp); assert.deepEqual(dr.map((x) => [x.pipe === ps.staticPipe, x.c, x.f]), [[true, 18, 0]]);
  ps.dispose(); dev.dispose(vb); dev.dispose(uvb); assert.equal(m3.liveCount(), 0, 'mask texture + pipelines disposed');
  console.log('passRaster.test.js (ALPHA-01c): all checks passed.');
}

// ALPHA-01f (b): masked instanced mesh group (TREES-LP-b, not DRAW_FLAG_ONE_PART) = one draw per mesh range, opaque ranges
// through instancePipe (unchanged shape), masked ranges through instanceMaskPipe (mask uniforms + uv extra stream +
// atlas texture), instanceCount = N on every draw. An opaque-only instanced group (no maskRanges) is byte-identical to before.
{
  const { RASTER_INSTANCED_MASK_BLOCK } = await import('../wgsl/raster.wgsl.js');
  const { MaskAtlas } = await import('../../MaskAtlas.js');
  const m4 = makeMockGpuDevice(), dev = m4.device, dr = [];
  dev.draw = (c, f, i) => dr.push({ pipe: dev._activePipeline, c, f, i, bind: dev._lastBind, u: new Uint32Array(dev._lastBind.uniforms.buffer, dev._lastBind.uniforms.byteOffset, dev._lastBind.uniforms.length).slice() });
  const ps = new WgRasterPass(dev, { gpuCull: false });
  const atlas = new MaskAtlas(); atlas.add('t/a', 2, 2, new Uint8Array([9, 9, 9, 9]));
  const world = { maskAtlas: atlas };
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), uvb = dev.createBuffer({ usage: 'vertex', bytes: 64 });
  ps.buffers.getVoxel = () => ({ vertexBuffer: vb, uvMaskBuffer: uvb });
  const mm = { ranges: [{ start: 0, count: 2 }, { start: 2, count: 3 }], maskRanges: new Int32Array([0, 0, -1, 0, 0, /**/ 2, 0, 4, 4, 128]) };
  const T = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  ps.prepare = () => {
    ps._maskTexture(world); ps.list.begin();
    const it = ps.list.push(); it.type = DRAW_INSTANCED; it.mesh = mm; it.instBuf = { f32: new Float32Array(32) }; it.instCount = 5;
    it.partMatrices.set(T, 0); it.partMatrices.set(T, 12); // not DRAW_FLAG_ONE_PART: instancedRanges() returns mesh.ranges, both parts identity
  };
  ps.vmList = null;
  const pp = { _t: { targetRaster: {}, targetVmDepth: {} }, stats: {} };
  ps.run(pp);
  assert.deepEqual(dr.map((x) => [x.pipe === ps.instanceMaskPipe ? 'mask' : (x.pipe === ps.instancePipe ? 'opaque' : '?'), x.c, x.f, x.i]),
    [['opaque', 6, 0, 5], ['mask', 9, 6, 5]], 'opaque range -> instancePipe, masked range -> instanceMaskPipe, instanceCount = N on both');
  const md = dr[1], MU = (n) => md.u[RASTER_INSTANCED_MASK_BLOCK.field(n).word];
  assert.deepEqual([MU('maskX0'), MU('maskY0'), MU('maskW'), MU('maskH'), MU('maskCut')], [2, 0, 4, 4, 128], 'atlas rect + cutoff byte in the instanced-mask uniform block');
  assert.equal(md.bind.extraBuffers[0], uvb); assert.equal(md.bind.textures[0].texture, ps.maskTex); assert.equal(md.bind.instanceBuffer, dr[0].bind.instanceBuffer, 'same instance buffer on both draws');
  assert.equal(md.pipe.desc.vertex.extraLayouts[0].layout[0].location, 10); assert.deepEqual(md.pipe.desc.bindings.textures, ['uint']);
  assert.equal(pp.stats.instancedDraws, 2);
  // opaque-only instanced group (no maskRanges): unchanged - both ranges through instancePipe, no mask bind touched
  dr.length = 0;
  const mm2 = { ranges: [{ start: 0, count: 2 }, { start: 2, count: 3 }] };
  ps.prepare = () => { ps._maskTexture(world); ps.list.begin(); const it = ps.list.push(); it.type = DRAW_INSTANCED; it.mesh = mm2; it.instBuf = { f32: new Float32Array(32) }; it.instCount = 4; it.partMatrices.set(T, 0); it.partMatrices.set(T, 12); };
  ps.run(pp);
  assert.deepEqual(dr.map((x) => [x.pipe === ps.instancePipe, x.c, x.f, x.i]), [[true, 6, 0, 4], [true, 9, 6, 4]], 'opaque-only group: both ranges through instancePipe unchanged');
  ps.dispose(); dev.dispose(vb); dev.dispose(uvb); assert.equal(m4.liveCount(), 0, 'mask texture + pipelines disposed');
  console.log('passRaster.test.js (ALPHA-01f b): all checks passed.');
}

// PREC-01a (37.9, WebGPU twin): camera-relative raster. view/planes stay absolute f64; every camera raster uniform carries view * T(O) and model - O.
{
  const { frameMatrix } = await import('../../projection.js');
  const m5 = makeMockGpuDevice(), dev = m5.device;
  const rp = new WgRasterPass(dev), dr = [];
  dev.beginPass = () => {};
  dev.draw = (count, first, instances) => dr.push({ pipe: dev._activePipeline, u: new Float32Array(dev._lastBind.uniforms.buffer).slice() });
  const mk = (x, y, z = 7.6) => ({ _cam: { x, y, z, yawDeg: 255, pitchDeg: 20 }, _world: {}, cols: 160, rows: 60, rt: { pxCellW: 1, pxCellH: 2 }, terrainEnabled: false,
    _voxelPool: null, _instances: null, _viewModel: null, _table: null, stats: {}, _t: { targetRaster: {}, targetVmDepth: {} } });
  const grid = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 };
  const p1 = mk(1486.5, 1025.0);
  rp.prepare(p1);
  assert.deepEqual([rp.ox, rp.oy], [1472, 1024], 'O = floor(cam.xy / 16) * 16');
  const M = frameMatrix(p1._cam, grid, new Float64Array(16), 'mesh');
  for (let k = 0; k < 16; k++) assert.equal(rp.view[k], M[k], 'culling matrix stays the absolute f64 matrix');
  for (let k = 0; k < 12; k++) assert.equal(rp.u[RASTER_BLOCK.field('viewProj').word + k], Math.fround(M[k]));
  for (let k = 0; k < 4; k++) assert.equal(rp.u[RASTER_BLOCK.field('viewProj').word + 12 + k], Math.fround(M[k] * 1472 + M[4 + k] * 1024 + M[12 + k]), 'translation column = M*T(O) in f64, then f32');
  assert.deepEqual([rp.u[RASTER_BLOCK.field('origin').word], rp.u[RASTER_BLOCK.field('origin').word + 1]], [1472, 1024], 'origin words in the instanced block');
  const rel = rp.viewRel.slice();
  rp.prepare(mk(1487.9, 1030.2)); assert.deepEqual([rp.ox, rp.oy], [1472, 1024], 'no O change inside a 16 m cell');
  rp.prepare(mk(1488.0, 1040.0)); assert.deepEqual([rp.ox, rp.oy], [1488, 1040], 'O snaps at the cell border');
  rp.prepare(mk(1486.5, 1025.0)); assert.deepEqual([...rp.viewRel], [...rel], 'same pose -> same matrix');
  // draws: translation - O in f64 before the f32 store; instanced local part matrices are NOT rebased; terrain keeps `model` absolute, `modelRel` = model - O
  const sm = new StaticMeshBuilder('prec-quad'); sm.addQuad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0xf0000001, 9 | (5 << 8) | (3 << 16), [0, 0, 0, 0, 0, 0, 0, 0]);
  const msh = sm.build(); msh.ranges = [{ start: 0, count: 2 }];
  const T = [1, 0, 0, 0, 1, 0, 0, 0, 1, 1486.5123, 1025.0123, 6];
  rp.prepare = () => {};
  rp.list.begin();
  const si = rp.list.push(); si.type = DRAW_STATIC; si.mesh = msh; si.rangeCount = 2; si.matrix.set(T);
  const vi = rp.list.push(); vi.type = DRAW_VOXEL; vi.mesh = msh; vi.partMatrices.set(T);
  const ii = rp.list.push(); ii.type = DRAW_INSTANCED; ii.mesh = msh; ii.instBuf = { f32: new Float32Array(16) }; ii.instCount = 1; ii.partMatrices.set(T);
  const ci = rp.list.push(); ci.type = DRAW_CLOTH; ci.mesh = { matId: 1 }; ci.rangeCount = 1; ci.matrix.set(T);
  rp.buffers.getCloth = () => ({ vertexBuffer: dev.createBuffer({ usage: 'vertex', bytes: 64 }), uvBuffer: dev.createBuffer({ usage: 'vertex', bytes: 32 }), indexBuffer: dev.createBuffer({ usage: 'index', bytes: 12 }) });
  const ti = rp.list.push(); ti.type = DRAW_TERRAIN; ti.mesh = { layout: 'terrain' }; ti.rangeCount = 1; ti.matrix.set(T);
  const tvb2 = dev.createBuffer({ usage: 'vertex', bytes: 64 }), tib2 = dev.createBuffer({ usage: 'index', bytes: 24 });
  const og = rp.buffers.get; rp.buffers.get = (m) => m === ti.mesh ? { vertexBuffer: tvb2, indexBuffer: tib2 } : og.call(rp.buffers, m);
  rp.ox = 1472; rp.oy = 1024; rp.vmList = null;
  rp._terrainUniforms({ terrain: { nearReady: false, near: null, _farGridDraw: null, mapCell: 1, mapW: 1 } }); // fills tu viewProj from the last prepare
  rp.run(p1);
  const MW = RASTER_BLOCK.field('model').word + 12;
  const tr = (x) => [x.u[MW], x.u[MW + 1], x.u[MW + 2]];
  const pick = (pipe) => dr.find((x) => x.pipe === pipe);
  assert.deepEqual(tr(pick(rp.staticPipe)), [Math.fround(1486.5123 - 1472), Math.fround(1025.0123 - 1024), 6], 'static: translation - O');
  assert.deepEqual(tr(pick(rp.voxelPipe)), tr(pick(rp.staticPipe)), 'voxel (and view model) rebased the same way');
  assert.deepEqual(tr(pick(rp.clothPipe)), tr(pick(rp.staticPipe)), 'cloth rebased the same way');
  assert.deepEqual(tr(pick(rp.instancePipe)), [Math.fround(1486.5123), Math.fround(1025.0123), 6], 'instanced part matrix is local: not rebased (rows carry iRow.w - origin in the shader)');
  const td2 = pick(rp.terrainPipe).u, TM = TERRAIN_BLOCK.field('model').word + 12, TR = TERRAIN_BLOCK.field('modelRel').word + 12;
  assert.deepEqual([td2[TM], td2[TM + 1], td2[TM + 2]], [Math.fround(1486.5123), Math.fround(1025.0123), 6], 'terrain model stays absolute (vWorldPos)');
  assert.deepEqual([td2[TR], td2[TR + 1], td2[TR + 2]], TERRAIN_REBASE ? [Math.fround(1486.5123 - 1472), Math.fround(1025.0123 - 1024), 6] : [Math.fround(1486.5123), Math.fround(1025.0123), 6], 'terrain modelRel = model - O (clip only) when TERRAIN_REBASE, else = model');
  assert.deepEqual([...td2.slice(TERRAIN_BLOCK.field('viewProj').word, TERRAIN_BLOCK.field('viewProj').word + 16)], [...Float32Array.from(TERRAIN_REBASE ? rp.viewRel : rp.view)], 'terrain viewProj matches its modelRel space');
  assert.deepEqual([...td2.slice(TERRAIN_BLOCK.field('viewProj').word, TERRAIN_BLOCK.field('viewProj').word + 16)].length, 16);
  // 0 allocation per frame: prepare + run on warm state create no resources (heap growth is bounded by the existing 1000-frame checks above)
  const rp2 = new WgRasterPass(dev); const created = m5.createCount, cams = [mk(1486.5, 1025.0), mk(1500, 1030)];
  for (let i = 0; i < 20; i++) rp2.prepare(cams[i & 1]);
  global.gc(); const h0 = process.memoryUsage().heapUsed; // gc first, like the 1000-frame check above (garbage left by earlier blocks is not growth)
  for (let i = 0; i < 100000; i++) rp2.prepare(cams[i & 1]);
  global.gc();
  assert.ok(process.memoryUsage().heapUsed - h0 < 4e6, 'prepare allocates nothing per frame, < 40 B/frame over 100k (origin + viewRel are reused)');
  assert.equal(m5.createCount, created);
  console.log('passRaster.test.js (PREC-01a): all checks passed.');
}

// S8-B2-05/06 host wiring (docs/lanes/pc-b2.md 35/97/109): per-frame wind uniforms (RASTER_BLOCK wind/windT/windK) + instance swayPad.
// No wind (calm field, default) -> every word stays 0 (bit-identical to before this story). Wind on -> words == packWindUniforms's
// own values and p._instances.swayPad == SWAY_MAX (0 when calm).
{
  const { createWind } = await import('../../../world/wind.js');
  const { packWindUniforms, SWAY_MAX } = await import('../../../mesh/sway.js');
  const m8 = makeMockGpuDevice(), dev8 = m8.device;
  const rp2b = new WgRasterPass(dev8, { gpuCull: false });
  const WIND = RASTER_BLOCK.field('wind').word, WIND_T = RASTER_BLOCK.field('windT').word, WIND_K = RASTER_BLOCK.field('windK').word;
  const instStub = { swayPad: -1, addToDrawList() {}, stats: { instancesCulled: 0, instancesLod1: 0 } };
  const mkP8 = (world) => ({ _cam: { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: 0 }, _world: world, cols: 160, rows: 60, rt: { pxCellW: 1, pxCellH: 2 }, terrainEnabled: false,
    _voxelPool: null, _instances: instStub, _viewModel: null, _table: null, stats: {}, _fb: { timeSec: 12.5, frameNo: 0 }, _t: { targetRaster: {}, targetVmDepth: {} } });
  const calm = { wind: createWind(null, 1) };
  rp2b.prepare(mkP8(calm));
  assert.deepEqual([...rp2b.u.subarray(WIND, WIND + 4)], [0, 0, 0, 0], 'no wind: wind4 words unchanged (zero)');
  assert.deepEqual([...rp2b.u.subarray(WIND_T, WIND_T + 4)], [0, 0, 0, 0], 'no wind: windT4 words unchanged (zero)');
  assert.deepEqual([...rp2b.u.subarray(WIND_K, WIND_K + 64)], new Array(64).fill(0), 'no wind: windK words unchanged (zero)');
  assert.equal(rp2b.windOn, false); assert.equal(instStub.swayPad, 0, 'no wind: swayPad 0');
  const blown = { wind: createWind({ dirDeg: 45, speed: 3, gust: { amp: 0.3, periodSec: 2, travel: 8 } }, 7) };
  rp2b.prepare(mkP8(blown));
  const w4 = new Float32Array(4), t4 = new Float32Array(4), k64 = new Float32Array(64);
  packWindUniforms(blown.wind, 12.5, w4, t4, k64);
  assert.deepEqual([...rp2b.u.subarray(WIND, WIND + 4)], [...w4], 'wind on: wind4 == packWindUniforms twin');
  assert.deepEqual([...rp2b.u.subarray(WIND_T, WIND_T + 4)], [...t4], 'wind on: windT4 == packWindUniforms twin');
  assert.deepEqual([...rp2b.u.subarray(WIND_K, WIND_K + 64)], [...k64], 'wind on: windK == packWindUniforms twin');
  assert.equal(rp2b.windOn, true); assert.equal(instStub.swayPad, SWAY_MAX, 'wind on: swayPad == SWAY_MAX');
  rp2b.dispose();
  console.log('passRaster.test.js (S8-B2-05/06 wind host wiring): all checks passed.');
}
