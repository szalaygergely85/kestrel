// WG-3d: WgShadowPass on the device mock - pipelines (depth only, bias), draw list == the GL caster list (shadowList.js),
// dirty-skip, light plug-in params, depth copy readback, terrain pipe module, zero allocation per frame.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, DRAW_STATIC, DRAW_TERRAIN, LevelMeshCache, addStructures } from '../../../mesh/DrawList.js';
import { buildShadowList, createShadowList, shadowWorldZ } from '../../../mesh/shadowList.js';
import { createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar, resolveSunShadowOptions } from '../../shadowSun.js';
import { dirFromAzEl } from '../../../core/transform.js';
import { WgShadowPass } from './passShadow.js';
import { SHADOW_DEPTH_COPY_WGSL, SHADOW_TERRAIN_WGSL, SHADOW_TERRAIN_BLOCK as TERRAIN_BLOCK } from '../wgsl/shadow.wgsl.js';
import { SHADOW_Z_LINE, RASTER_Z_LINE, RASTER_BLOCK } from '../wgsl/raster.wgsl.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
const struct = (i, x, y) => ({ id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } });

const mock = makeMockGpuDevice(), d = mock.device;
const draws = [], passes = [];
d.beginPass = (target, opts) => passes.push({ target, opts });
d.draw = (count, first, instances) => draws.push({ pipe: d._activePipeline, count, first, instances, uniforms: d._lastBind.uniforms });

const shadows = { res: 256 };
const sh = new WgShadowPass(d, { shadows });
assert.ok(sh.enabled && sh.depthTex && sh.target);
assert.deepEqual([sh.depthTex.desc.format, sh.depthTex.desc.sampled, sh.depthTex.desc.width], ['depth24', true, 256]);
assert.deepEqual(sh.target.desc.color, []); assert.equal(sh.target.desc.depth, sh.depthTex);
for (const pipe of sh.pipes) {
  const pd = pipe.desc;
  assert.equal(pd.fragment.targets, 0); assert.deepEqual(pd.targetFormats, []); assert.equal(pd.depthFormat, 'depth32f');
  assert.deepEqual(pd.depth, { test: true, write: true }); assert.deepEqual(pd.depthBias, { factor: 2, units: 4 });
}
assert.equal(sh.staticPipe.desc.fragment.src, null, 'depth only: no fragment stage');
assert.equal(sh.terrainPipe.desc.fragment.src.entry, 'fs_main', 'terrain keeps the footprint carve');
assert.equal(sh.voxelPipe.desc.cull, 'back'); assert.equal(sh.clothPipe.desc.cull, 'none');
assert.equal(sh.terrainPipe.desc.bindings.uniformBytes, TERRAIN_BLOCK.sizeBytes);
// every shadow vertex stage ends with the [0.5, 1] depth line (38.5 item 6), none keeps the raster [0,1] one
for (const pipe of sh.pipes) {
  const code = pipe.desc.vertex.src.wgsl;
  assert.ok(code.includes(SHADOW_Z_LINE) && !code.includes(RASTER_Z_LINE), 'shadow pipe uses the shadow z line');
}
assert.equal(sh.terrainPipe.desc.vertex.src.wgsl, SHADOW_TERRAIN_WGSL, 'terrain shadow: own module (vs_main + fs_main, one block)');
assert.equal(sh.terrainPipe.desc.fragment.src.wgsl, SHADOW_TERRAIN_WGSL);
assert.equal(new WgShadowPass(d, { shadows: { sun: 'dda' }, renderer: 'dda' }).enabled, false);

// ---- fixtures: three structures (one behind the camera), a fake terrain draw item ----
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
const levelCache = new LevelMeshCache();
const camList = new DrawList(16); camList.begin(); addStructures(camList, world, cam, levelCache, 2000);
const raster = { list: camList, levelCache, meshCache: null, strictMatIdFor: null };
const sun = { on: true, dir: dirFromAzEl(135, 40, new Float64Array(3)) };
const p = { _light: { sun }, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: null, terrainEnabled: false };

// GL-twin caster list: same inputs through the same builder
const so = resolveSunShadowOptions(shadows, 'mesh');
const refList = createShadowList(), refMat = createSunShadowMatrix(), centre = new Float64Array(3);
sunShadowCentre(cam, so, centre);
const zr = shadowWorldZ(world, levelCache, { min: 0, max: 0 });
const smr = shadowSunMatrix(sun.dir, centre, so, zr, refMat);
buildShadowList(refList, camList, world, smr.planes, { centre: { x: centre[0], y: centre[1], z: centre[2] }, eye: { x: cam.x, y: cam.y }, meshLod0M: so.meshLod0M, instCastM: so.instCastM, cache: levelCache, fogFarM: sunShadowFogFar(null, so), cloths: null });
const refStatic = []; for (let i = 0; i < refList.count; i++) if (refList.items[i].type === DRAW_STATIC) refStatic.push([refList.items[i].rangeCount * 3, refList.items[i].rangeFirst * 3]);
assert.ok(refStatic.length >= 2, 'fixture has casters (incl. the one behind the camera)');

assert.equal(sh.run(p, raster), true); assert.equal(sh.active, true);
assert.equal(sh.stats.shadowItems, refList.count); assert.equal(sh.stats.shadowDraws, draws.length);
assert.deepEqual(draws.filter((x) => x.pipe === sh.staticPipe).map((x) => [x.count, x.first]), refStatic, 'draw list == GL caster list');
assert.equal(passes[0].target, sh.target); assert.equal(passes[0].opts.clear, true);
const vp = new Float32Array(sh.u.buffer).slice(16, 32);
assert.deepEqual([...vp], [...sh.sunMatF32], 'uViewProj = M_sun'); assert.ok(sh.sunMatF32.some((x) => x !== 0));
for (let i = 0; i < 16; i++) assert.ok(Math.abs(sh.sunMatF32[i] - smr.M[i]) < 1e-5);
const lp = sh.lightParams();
assert.deepEqual([lp.active, lp.texture, lp.matrix, lp.res], [true, sh.depthTex, sh.sunMatF32, 256]);
assert.ok(lp.texelM > 0 && lp.biasM === so.biasM && lp.normalOffsetTexels === so.normalOffsetTexels);

// dirty-skip: identical inputs -> no pass, map still valid
const nPass = passes.length, nDraw = draws.length;
assert.equal(sh.run(p, raster), true); assert.equal(sh.skips, 1); assert.equal(passes.length, nPass); assert.equal(draws.length, nDraw); assert.equal(sh.stats.shadowDraws, 0);
// sun off -> inactive (sunMode 0)
sun.on = false; assert.equal(sh.run(p, raster), false); assert.equal(sh.active, false); assert.equal(sh.lightParams().active, false); sun.on = true;

// terrain item: carve footprints land in the terrain block, model words, count
const tvb = d.createBuffer({ usage: 'vertex', bytes: 64 }), tib = d.createBuffer({ usage: 'index', bytes: 24 });
const tmesh = { layout: 'terrain' };
sh.buffers.get = (m) => (m === tmesh ? { vertexBuffer: tvb, indexBuffer: tib } : Object.getPrototypeOf(sh.buffers).get.call(sh.buffers, m));
const tl = createShadowList(); tl.begin();
const ti = tl.push(); ti.type = DRAW_TERRAIN; ti.mesh = tmesh; ti.rangeCount = 2; ti.rangeFirst = 1; ti.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 16, 32, 2]);
draws.length = 0; sh._render(tl, world, sh.sunMatF32);
const td = draws[0];
assert.equal(td.pipe, sh.terrainPipe); assert.equal(td.count, 6); assert.equal(td.first, 3);
const tw = new Uint32Array(sh.tu.buffer);
assert.equal(tw[TERRAIN_BLOCK.field('structCount').word], 3);
assert.deepEqual([...sh.tu.slice(TERRAIN_BLOCK.field('structFoot').word, TERRAIN_BLOCK.field('structFoot').word + 4)], [0, -20, 1, -19]);
assert.deepEqual([...sh.tu.slice(TERRAIN_BLOCK.field('model').word + 12, TERRAIN_BLOCK.field('model').word + 16)], [16, 32, 2, 1]);
sh.buffers.get = Object.getPrototypeOf(sh.buffers).get;

// ---- depth copy readback (shadowDepthCopy): r32ui res x res, one fullscreen draw ----
const out = new Uint32Array(256 * 256).fill(7);
let rb = null; d.readback = (tex, rect, o) => { rb = { tex, rect }; o.fill(0x3f800000); };
draws.length = 0;
sh.run(p, raster);
assert.equal(await sh.readbackDepth(out), true);
assert.deepEqual(rb.rect, { x: 0, y: 0, w: 256, h: 256 }); assert.equal(rb.tex.desc.format, 'r32ui'); assert.equal(out[0], 0x3f800000);
assert.deepEqual(draws.map((x) => [x.pipe === sh.copyPipe, x.count]), [[true, 3]]);
assert.deepEqual(sh.copyPipe.desc.bindings.textures, ['depth']); assert.deepEqual(sh.copyPipe.desc.targetFormats, ['r32ui']);
assert.deepEqual(sh.copyBind.textures, [{ slot: 0, texture: sh.depthTex }]);
assert.ok(SHADOW_DEPTH_COPY_WGSL.includes('texture_depth_2d'));
sun.on = false; sh.run(p, raster); assert.equal(await sh.readbackDepth(out), false, 'no map this frame -> false'); sun.on = true;

// ---- zero allocation over 1000 frames (no dirty-skip: every frame renders), no new device resources ----
const sh2 = new WgShadowPass(d, { shadows: { res: 256, dirtySkip: false } });
for (let i = 0; i < 20; i++) sh2.run(p, raster);
const created = mock.createCount, writes = mock.writeCount, u = sh2.u;
d.draw = () => {}; d.beginPass = () => {}; // the recording hooks above allocate
for (let i = 0; i < 3000; i++) sh2.run(p, raster); // JIT warm-up
global.gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) sh2.run(p, raster);
global.gc(); const grew = process.memoryUsage().heapUsed - h0;
assert.equal(mock.createCount, created, 'warm frames create no resources'); assert.equal(sh2.u, u);
assert.equal(sh2.renders, 4020, 'dirtySkip off renders every frame');
assert.ok(grew < 64 * 1024, `heap growth over 1000 frames ${grew} B`);

sh2.dispose(); sh.dispose(); d.dispose(tvb); d.dispose(tib);
console.log(`passShadow.test.js: all checks passed (heap +${grew} B / 1000 frames).`);

// ALPHA-01c: masked static casters draw per range with the discard pipeline (fragment entry fs_mask_shadow, texMask from the raster pass); opaque ranges keep staticPipe.
{
  const { RASTER_MASK_BLOCK } = await import('../wgsl/raster.wgsl.js');
  const m4 = makeMockGpuDevice(), dev = m4.device, dr = [];
  dev.draw = (c, f, i) => dr.push({ pipe: dev._activePipeline, c, f, u: new Uint32Array(dev._lastBind.uniforms.buffer, dev._lastBind.uniforms.byteOffset, dev._lastBind.uniforms.length).slice(), bind: dev._lastBind });
  const s4 = new WgShadowPass(dev, { shadows: { res: 256 } });
  assert.equal(s4.maskPipe.desc.fragment.src.entry, 'fs_mask_shadow'); assert.equal(s4.maskPipe.desc.fragment.targets, 0);
  assert.deepEqual(s4.maskPipe.desc.bindings.textures, ['uint']); assert.equal(s4.maskPipe.desc.depthFormat, 'depth32f');
  assert.ok(s4.maskPipe.desc.vertex.src.wgsl.includes(SHADOW_Z_LINE), 'shadow depth line');
  const tex = dev.createTexture({ format: 'r8ui', width: 2, height: 2 }), vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), uvb = dev.createBuffer({ usage: 'vertex', bytes: 64 });
  const mesh = { ranges: [{ start: 0, count: 2 }, { start: 2, count: 2 }], maskRanges: new Int32Array([0, 0, -1, 0, 0, 3, 1, 4, 4, 77]) };
  const item = { mesh, rangeFirst: 0, rangeCount: 4 }, entry = { vertexBuffer: vb, uvMaskBuffer: uvb };
  s4._raster = { maskReady: true, maskTex: tex };
  s4._staticCaster(item, entry);
  assert.deepEqual(dr.map((x) => [x.pipe === s4.maskPipe, x.c, x.f]), [[false, 6, 0], [true, 6, 6]]);
  const W = (n) => dr[1].u[RASTER_MASK_BLOCK.field(n).word];
  assert.deepEqual([W('maskX0'), W('maskY0'), W('maskW'), W('maskH'), W('maskCut')], [3, 1, 4, 4, 77]);
  assert.equal(dr[1].bind.textures[0].texture, tex); assert.equal(dr[1].bind.extraBuffers[0], uvb);
  dr.length = 0; s4._raster.maskReady = false; s4._staticCaster(item, entry);
  assert.deepEqual(dr.map((x) => [x.pipe === s4.staticPipe, x.c, x.f]), [[true, 12, 0]], 'no atlas: one opaque caster draw');
  s4.dispose(); dev.dispose(tex); dev.dispose(vb); dev.dispose(uvb); assert.equal(m4.liveCount(), 0);
  console.log('passShadow.test.js (ALPHA-01c): masked casters ok.');
}

// ONEPART-b (38.9): a DRAW_FLAG_ONE_PART instanced caster (meshGroup) on an uneven 2-range mesh draws ONE whole-mesh range; without the flag it keeps per range
{
  const { DRAW_INSTANCED, DRAW_FLAG_ONE_PART } = await import('../../../mesh/DrawList.js');
  const m5 = makeMockGpuDevice(), dev = m5.device, dr = [];
  dev.draw = (c, f, i) => dr.push({ pipe: dev._activePipeline, c, f, i });
  const s5 = new WgShadowPass(dev, { shadows: { res: 256 } });
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), ib = dev.createBuffer({ usage: 'index', bytes: 64 });
  const imesh = { layout: 'static', triCount: 12, ranges: [{ start: 0, count: 1 }, { start: 1, count: 11 }] };
  s5.buffers.getVoxel = () => ({ vertexBuffer: vb, indexBuffer: ib });
  const il = createShadowList();
  for (const flags of [DRAW_FLAG_ONE_PART, 0]) {
    il.begin(); const it = il.push(); it.type = DRAW_INSTANCED; it.mesh = imesh; it.flags = flags; it.instCount = 3; it.instBuf = { f32: new Float32Array(48) }; it.partMatrices.fill(0); it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    dr.length = 0; s5._render(il, world, s5.sunMatF32);
    const inst = dr.filter((x) => x.pipe === s5.instancePipe).map((x) => [x.c, x.f, x.i]);
    assert.deepEqual(inst, flags ? [[36, 0, 3]] : [[3, 0, 3], [33, 3, 3]], flags ? 'ONE_PART: one draw, whole mesh' : 'no flag: per range');
  }
  console.log('passShadow.test.js (ONEPART-b): one-part instanced shadow caster ok.');
}

// ALPHA-01f (c): masked instanced caster (meshGroup, NOT DRAW_FLAG_ONE_PART per shadowList.js's lift) - opaque range through
// instancePipe unchanged, masked range through instanceMaskPipe (fs_mask_shadow discard, mask uniforms, uv extra stream),
// instanceCount = N on both. This is the ONE_PART-lift the shadowList.js NEEDS line asked for: a masked group no longer
// collapses to an unmasked, range[0]-only shadow.
{
  const { RASTER_INSTANCED_MASK_BLOCK } = await import('../wgsl/raster.wgsl.js');
  const { DRAW_INSTANCED } = await import('../../../mesh/DrawList.js');
  const m6 = makeMockGpuDevice(), dev = m6.device, dr = [];
  dev.draw = (c, f, i) => dr.push({ pipe: dev._activePipeline, c, f, i, bind: dev._lastBind, u: new Uint32Array(dev._lastBind.uniforms.buffer, dev._lastBind.uniforms.byteOffset, dev._lastBind.uniforms.length).slice() });
  const s6 = new WgShadowPass(dev, { shadows: { res: 256 } });
  assert.equal(s6.instanceMaskPipe.desc.fragment.src.entry, 'fs_mask_shadow');
  assert.deepEqual(s6.instanceMaskPipe.desc.bindings.textures, ['uint']);
  assert.equal(s6.instanceMaskPipe.desc.vertex.extraLayouts[0].layout[0].location, 10);
  const tex = dev.createTexture({ format: 'r8ui', width: 2, height: 2 });
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), uvb = dev.createBuffer({ usage: 'vertex', bytes: 64 });
  s6._raster = { maskReady: true, maskTex: tex };
  s6.buffers.getVoxel = () => ({ vertexBuffer: vb, uvMaskBuffer: uvb });
  const mm = { ranges: [{ start: 0, count: 2 }, { start: 2, count: 3 }], maskRanges: new Int32Array([0, 0, -1, 0, 0, /**/ 5, 2, 4, 4, 200]) };
  const il = createShadowList();
  il.begin();
  const it = il.push(); it.type = DRAW_INSTANCED; it.mesh = mm; it.flags = 0; it.instCount = 4; it.instBuf = { f32: new Float32Array(48) };
  it.partMatrices.fill(0); it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 0); it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 12);
  s6._render(il, world, s6.sunMatF32);
  assert.deepEqual(dr.map((x) => [x.pipe === s6.instanceMaskPipe ? 'mask' : (x.pipe === s6.instancePipe ? 'opaque' : '?'), x.c, x.f, x.i]),
    [['opaque', 6, 0, 4], ['mask', 9, 6, 4]], 'opaque range -> instancePipe, masked range -> instanceMaskPipe, instanceCount = N on both');
  const md = dr[1], W2 = (n) => md.u[RASTER_INSTANCED_MASK_BLOCK.field(n).word];
  assert.deepEqual([W2('maskX0'), W2('maskY0'), W2('maskW'), W2('maskH'), W2('maskCut')], [5, 2, 4, 4, 200]);
  assert.equal(md.bind.extraBuffers[0], uvb); assert.equal(md.bind.textures[0].texture, tex);
  // no mask atlas ready: both ranges fall back to instancePipe (same as the opaque-only path)
  dr.length = 0; s6._raster.maskReady = false; s6._render(il, world, s6.sunMatF32);
  assert.deepEqual(dr.map((x) => x.pipe === s6.instancePipe), [true, true], 'maskReady false -> opaque instancePipe for every range');
  s6.dispose(); dev.dispose(tex); dev.dispose(vb); dev.dispose(uvb); assert.equal(m6.liveCount(), 0);
  console.log('passShadow.test.js (ALPHA-01f c): masked instanced caster ok.');
}

// S8-B2-05/06 host wiring (docs/lanes/pc-b2.md 35/97/109): per-frame wind uniforms (RASTER_BLOCK wind/windT/windK), same as passRaster.js.
// No wind (calm field, default) -> every word stays 0 (bit-identical to before). Wind on -> words == packWindUniforms's own values.
{
  const { createWind } = await import('../../../world/wind.js');
  const { packWindUniforms, SWAY_MAX } = await import('../../../mesh/sway.js');
  const m7 = makeMockGpuDevice(), dev7 = m7.device;
  const s7 = new WgShadowPass(dev7, { shadows: { res: 64 } });
  const WIND = RASTER_BLOCK.field('wind').word, WIND_T = RASTER_BLOCK.field('windT').word, WIND_K = RASTER_BLOCK.field('windK').word;
  const cam7 = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
  const sun7 = { on: true, dir: dirFromAzEl(135, 40, new Float64Array(3)) };
  const list7 = new DrawList(4); list7.begin();
  const raster7 = { list: list7, levelCache: new LevelMeshCache(), meshCache: null, strictMatIdFor: null };
  const calm = { structures: [], wind: createWind(null, 1) };
  const p7 = { _light: { sun: sun7 }, _cam: cam7, _world: calm, _table: null, _palette: null, _voxelPool: null, _instances: null, terrainEnabled: false, _fb: { timeSec: 9 } };
  s7.run(p7, raster7);
  assert.deepEqual([...s7.u.subarray(WIND, WIND + 4)], [0, 0, 0, 0], 'no wind: wind4 words unchanged (zero)');
  assert.deepEqual([...s7.u.subarray(WIND_T, WIND_T + 4)], [0, 0, 0, 0], 'no wind: windT4 words unchanged (zero)');
  assert.deepEqual([...s7.u.subarray(WIND_K, WIND_K + 64)], new Array(64).fill(0), 'no wind: windK words unchanged (zero)');
  assert.equal(s7.windOn, false);
  const blown = { structures: [], wind: createWind({ dirDeg: 45, speed: 3, gust: { amp: 0.3, periodSec: 2, travel: 8 } }, 7) };
  const p7b = { ...p7, _world: blown };
  list7.begin();
  s7.run(p7b, raster7);
  const w4 = new Float32Array(4), t4 = new Float32Array(4), k64 = new Float32Array(64);
  packWindUniforms(blown.wind, 9, w4, t4, k64);
  assert.deepEqual([...s7.u.subarray(WIND, WIND + 4)], [...w4], 'wind on: wind4 == packWindUniforms twin');
  assert.deepEqual([...s7.u.subarray(WIND_T, WIND_T + 4)], [...t4], 'wind on: windT4 == packWindUniforms twin');
  assert.deepEqual([...s7.u.subarray(WIND_K, WIND_K + 64)], [...k64], 'wind on: windK == packWindUniforms twin');
  assert.equal(s7.windOn, true);
  s7.dispose();
  console.log('passShadow.test.js (S8-B2-05/06 wind host wiring): all checks passed.');
}
