// WG-3e: WgWaterPass on the device mock - pipelines, the water draw list/uniform words vs the GL pass values, composite uniform words,
// plug-in surface (edge texture / dummy / resize / readback), zero allocation + no new resources over 1000 frames.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { World } from '../../../world/World.js';
import { projTerms, shearProjection, createPitchedTerms, pitchedTerms } from '../../projection.js';
import { frustumPlanes } from '../../../mesh/culling.js';
import { selectWater, createWaterSelection, RUNS_STRIDE } from '../../water.js';
import { WATER_U_STRIDE, U_KIND, U_Z, U_AABB, U_SHAPE } from '../../../mesh/waterMesh.js';
import { WL_STRIDE, WL_SLOTS, WFOG_LEN, defaultWaterLooks, fillWaterSlotTable, waterFogParams } from '../../waterLook.js';
import { sunFromWorld } from '../../lighting.js';
import { WATER_BLOCK, WATER_TEXTURES } from '../wgsl/water.wgsl.js';
import { WATER_COMPOSITE_BLOCK, WATER_COMPOSITE_TEXTURES } from '../wgsl/waterComposite.wgsl.js';
import { WATER_CLEAR_X } from '../waterLayer.js';
import { WgWaterPass } from './passWater.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

const COLS = 80, ROWS = 30, grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 };
const world = World.load({ name: 'wfix', water: [
  { id: 'sea', shape: 'rect', rect: [-60, -60, 60, 60], z: 0 },
  { id: 'pond', shape: 'circle', c: [10, 20], r: 6, z: 1 },
], waterfalls: [{ id: 'fall', lip: [-3, 10, 3, 10], z: 8, drop: 8, outDeg: 180 }] }, null);
const palette = { timeOfDay: { day: { sunElev: 40, ambientI: 0.3, sunI: 0.9 } }, defaultTime: 'day' };
const cam = { x: 2, y: -5, z: 1.6, yawDeg: 160, pitchDeg: -5 };
const terms = {}, view = new Float64Array(16), planes = new Float64Array(24);
projTerms(cam, grid, terms); shearProjection(terms, view); frustumPlanes(view, planes);
const raster = { view, planes, pitched: false, pitch: createPitchedTerms() };
const p = { _world: world, _cam: cam, _table: null, _palette: palette, _light: { sun: { on: true } }, _fb: { timeSec: 3.5 }, cols: COLS, rows: ROWS, rt: { pxCellW: 1, pxCellH: 2 }, _rasterPass: raster };

const mock = makeMockGpuDevice(), d = mock.device;
const binds = [], draws = [], passes = [];
d.beginPass = (target, opts) => { passes.push({ target, opts }); };
d.bind = (pipe, desc) => { d._activePipeline = pipe; binds.push({ pipe, uniforms: Float32Array.from(desc.uniforms), vb: desc.vertexBuffer, ib: desc.indexBuffer, textures: desc.textures.map((t) => t.texture) }); };
d.draw = (count, first, instances) => draws.push({ bind: binds.length - 1, count, first, instances });

const wp = new WgWaterPass(d);
// pipelines
const wd = wp.waterPipe.desc, cd = wp.compPipe.desc;
assert.deepEqual(wd.targetFormats, ['rgba32ui']); assert.equal(wd.depthFormat, 'depth24'); assert.deepEqual(wd.depth, { test: true, write: true });
assert.equal(wd.frontFace, 'cw'); assert.equal(wd.cull, 'none'); assert.equal(wd.vertex.strideBytes, 16); assert.equal(wd.vertex.layout.length, 1);
assert.deepEqual(wd.bindings.textures, [...WATER_TEXTURES]); assert.equal(wd.bindings.uniformBytes, WATER_BLOCK.sizeBytes);
assert.deepEqual(cd.targetFormats, ['rgba8', 'rgba8']); assert.deepEqual(cd.bindings.textures, [...WATER_COMPOSITE_TEXTURES]); assert.equal(cd.bindings.uniformBytes, WATER_COMPOSITE_BLOCK.sizeBytes);
assert.equal(cd.fragment.targets, 2);
assert.equal(wp.active, false); assert.equal(wp.edgeWaterTexture, wp.dummy, 'dummy while off');
wp.resize(COLS, ROWS, 2);
assert.equal(wp.layer.texture.desc.format, 'rgba32ui'); assert.equal(wp.layer.compFg.desc.format, 'rgba8');
assert.deepEqual([wp.layer.texture.desc.width, wp.layer.texture.desc.height], [COLS, ROWS]);
wp.bindWorld(world);
assert.ok(wp.layer._sheets.size === 1, 'sheet buffers uploaded at bindWorld');

// ---- prepare: selection == the GL selection ----
assert.equal(wp.prepare(p, raster), true); assert.equal(wp.active, true);
assert.equal(wp.edgeWaterTexture, wp.layer.texture);
const ref = selectWater(world, cam, planes, createWaterSelection());
assert.equal(wp.sel.count, ref.count); assert.equal(wp.sel.sheetCount, ref.sheetCount);
assert.ok(ref.count === 2 && ref.sheetCount === 1, `fixture selects 2 regions + 1 sheet (${ref.count}/${ref.sheetCount})`);
assert.equal(wp.stats.waterSlots, 3);
const refTable = new Float32Array(WL_SLOTS * WL_STRIDE); fillWaterSlotTable(ref, world, defaultWaterLooks(), refTable, 3.5);
assert.deepEqual([...wp.wlTable], [...refTable]);
for (let s = 0; s < WL_SLOTS; s++) { assert.equal(wp.waterOS[s * 2], refTable[s * WL_STRIDE + 3]); assert.equal(wp.waterOS[s * 2 + 1], refTable[s * WL_STRIDE + 7]); }

// ---- water pass: draw list + uniform words == GL _passWater values ----
const sceneDepth = d.createTexture({ format: 'r32ui', width: COLS, height: ROWS });
wp.runWater(sceneDepth);
assert.equal(passes[0].target, wp.layer.target); assert.deepEqual(passes[0].opts.clear.color, [[WATER_CLEAR_X, 0, 0, 0]]); assert.equal(passes[0].opts.clear.depth, 1);
const F = (n) => WATER_BLOCK.field(n).word;
const expDraws = [];
const clip = wp.clip;
for (let s = 0; s < ref.count; s++) {
  const ro = s * RUNS_STRIDE;
  for (let r = 0; r < ref.runs[ro]; r++) expDraws.push({ slot: s, count: ref.runs[ro + 2 + r * 2], first: ref.runs[ro + 1 + r * 2], sheet: false });
}
for (let k = 0; k < ref.sheetCount; k++) expDraws.push({ slot: 8 + k, count: ref.sheets[8 + k].mesh.index.length, first: 0, sheet: true });
assert.equal(draws.length, expDraws.length); assert.equal(wp.stats.waterDraws, expDraws.length);
const ox = ref.O[0], oy = ref.O[1], M = view;
for (let i = 0; i < draws.length; i++) {
  const dr = draws[i], e = expDraws[i], bd = binds[dr.bind], u = bd.uniforms, ub = new Uint32Array(u.buffer);
  assert.equal(dr.count, e.count, 'index count'); assert.equal(dr.first, e.first, 'first index'); assert.equal(dr.instances, 1);
  assert.equal(bd.pipe, wp.waterPipe); assert.equal(bd.textures[0], sceneDepth);
  const bufs = e.sheet ? wp.layer.sheet(ref.sheets[e.slot].mesh) : clip;
  assert.equal(bd.ib, bufs.indexBuffer); assert.equal(bd.vb, bufs.vertexBuffer);
  const w = e.slot * WATER_U_STRIDE;
  for (let k = 0; k < 12; k++) assert.equal(u[F('mvp') + k], Math.fround(M[k]));
  for (let k = 0; k < 4; k++) assert.equal(u[F('mvp') + 12 + k], Math.fround(M[k] * ox + M[4 + k] * oy + M[12 + k]));
  assert.equal(ub[F('kind')] | 0, e.sheet ? 2 : ref.u[w + U_KIND]); assert.equal(ub[F('slot')], e.slot);
  if (e.sheet) { assert.equal(u[F('shape')], Math.fround(ref.u[w + U_SHAPE])); assert.equal(u[F('shape') + 1], Math.fround(ref.u[w + U_SHAPE + 1])); assert.equal(u[F('shape') + 2], 0); }
  else {
    for (let k = 0; k < 4; k++) { assert.equal(u[F('aabb') + k], Math.fround(ref.u[w + U_AABB + k])); assert.equal(u[F('shape') + k], Math.fround(ref.u[w + U_SHAPE + k])); }
    assert.equal(u[F('z')], Math.fround(ref.u[w + U_Z]));
  }
}
// binds are per slot (runs of one slot share one bind)
assert.equal(new Set(draws.map((x) => x.bind)).size, 3);

// ---- composite: uniform words == GL _passWaterComposite uniforms ----
const shadeFg = d.createTexture({ format: 'rgba8', width: COLS, height: ROWS }), shadeBg = d.createTexture({ format: 'rgba8', width: COLS, height: ROWS });
const gi = d.createTexture({ format: 'rgba32ui', width: COLS, height: ROWS }), depth = sceneDepth, light = d.createTexture({ format: 'rgba32ui', width: COLS, height: ROWS });
binds.length = 0; draws.length = 0; passes.length = 0;
wp.runComposite({ shadeFg, shadeBg, gi, depth, light, shadowActive: true }, p);
assert.equal(passes[0].target, wp.layer.compTarget); assert.equal(wp.edgeFg, wp.layer.compFg); assert.equal(wp.edgeBg, wp.layer.compBg);
assert.deepEqual(draws.map((x) => [x.count, x.first, x.instances]), [[3, 0, 1]]);
assert.deepEqual(binds[0].textures, [shadeFg, shadeBg, gi, depth, wp.layer.texture, light]);
{
  const u = binds[0].uniforms, ui = new Int32Array(u.buffer), C = (n) => WATER_COMPOSITE_BLOCK.field(n).word;
  const sun = sunFromWorld(world, palette, {});
  assert.deepEqual([ui[C('gridCols')], ui[C('gridRows')], ui[C('sunMapOn')], ui[C('projMode')]], [COLS, ROWS, 1, 0]);
  assert.deepEqual([...u.slice(C('sunDir'), C('sunDir') + 3)], [sun.dirX, sun.dirY, sun.dirZ].map(Math.fround));
  assert.equal(u[C('ambientI')], Math.fround(0.3)); assert.equal(u[C('sunI')], Math.fround(0.9)); assert.equal(u[C('timeSec')], 3.5);
  assert.equal(u[C('posX')], 2); assert.equal(u[C('posY')], -5); assert.equal(u[C('eyeH')], Math.fround(1.6));
  assert.equal(u[C('dirX')], Math.fround(Math.sin(160 * Math.PI / 180))); assert.equal(u[C('dirY')], Math.fround(-Math.cos(160 * Math.PI / 180)));
  assert.deepEqual([...u.slice(C('wl'), C('wl') + WL_SLOTS * WL_STRIDE)], [...refTable]);
  const fog = new Float32Array(WFOG_LEN); waterFogParams(null, palette, true, fog);
  assert.deepEqual([...u.slice(C('wfog'), C('wfog') + WFOG_LEN)], [...fog]);
}
// sun shadow off -> sunMapOn 0
binds.length = 0; wp.runComposite({ shadeFg, shadeBg, gi, depth, light, shadowActive: false }, p);
assert.equal(new Int32Array(binds[0].uniforms.buffer)[WATER_COMPOSITE_BLOCK.field('sunMapOn').word], 0);
// pitched projection words
raster.pitched = true; pitchedTerms({ ...cam, pitchDeg: -30 }, grid, raster.pitch);
binds.length = 0; wp.runComposite({ shadeFg, shadeBg, gi, depth, light }, p);
{
  const u = binds[0].uniforms, C = (n) => WATER_COMPOSITE_BLOCK.field(n).word, q = raster.pitch;
  assert.equal(new Int32Array(u.buffer)[C('projMode')], 1);
  assert.deepEqual([...u.slice(C('pitchA'), C('pitchA') + 4)], [q.fX, q.fY, q.fZ, q.tanHalfX].map(Math.fround));
  assert.deepEqual([...u.slice(C('pitchC'), C('pitchC') + 4)], [q.uZ, q.tanHalfY, q.cosP, q.sinP].map(Math.fround));
}
raster.pitched = false;

// ---- readback shape ----
let rbCall = null; d.readback = (tex, rect, out) => { rbCall = { tex, rect, out }; out.fill(9); return Promise.resolve(); };
const rb = await wp.readbackWater();
assert.ok(rb instanceof Uint32Array && rb.length === 4 * COLS * ROWS && rb[0] === 9); assert.equal(rbCall.tex, wp.layer.texture);
assert.deepEqual(rbCall.rect, { x: 0, y: 0, w: COLS, h: ROWS });
assert.equal(await wp.readbackWater(), rb, 'reused buffer');

// ---- off: nothing selected -> inactive, no passes, dummy bound, readback null ----
const dry = World.load({ name: 'dry' }, null);
const far = { ...p, _world: dry, _cam: { x: 5000, y: 5000, z: 1.6, yawDeg: 0, pitchDeg: 0 } };
projTerms(far._cam, grid, terms); const v2 = new Float64Array(16), pl2 = new Float64Array(24); shearProjection(terms, v2); frustumPlanes(v2, pl2);
passes.length = 0;
assert.equal(wp.prepare(far, { view: v2, planes: pl2 }), false); assert.equal(wp.stats.waterDraws, 0);
wp.runWater(sceneDepth); wp.runComposite({ shadeFg, shadeBg, gi, depth, light }, far);
assert.equal(passes.length, 0); assert.equal(wp.edgeWaterTexture, wp.dummy); assert.equal(await wp.readbackWater(), null);

// ---- resize: new targets, same pipelines ----
const oldTex = wp.layer.texture, pipes = [wp.waterPipe, wp.compPipe];
wp.resize(COLS, ROWS, 2); assert.equal(wp.layer.texture, oldTex, 'same size is a no-op');
wp.resize(40, 20, 2); assert.notEqual(wp.layer.texture, oldTex); assert.equal(wp.layer.texture.desc.width, 40); assert.deepEqual([wp.waterPipe, wp.compPipe], pipes);
wp.resize(COLS, ROWS, 2);

// ---- zero allocation over 1000 frames, no new device resources ----
d.beginPass = () => {}; d.bind = () => {}; d.draw = () => {};
const frame = () => { wp.prepare(p, raster); wp.runWater(sceneDepth); wp.runComposite({ shadeFg, shadeBg, gi, depth, light, shadowActive: true }, p); };
for (let i = 0; i < 20; i++) frame();
const created = mock.createCount, wu = wp.wu, cu = wp.cu;
for (let i = 0; i < 3000; i++) frame();
global.gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) frame();
global.gc(); const grew = process.memoryUsage().heapUsed - h0;
assert.equal(mock.createCount, created, 'warm frames create no resources'); assert.equal(wp.wu, wu); assert.equal(wp.cu, cu);
assert.ok(grew < 64 * 1024, `heap growth over 1000 frames ${grew} B`);

wp.dispose();
d.dispose(sceneDepth); d.dispose(shadeFg); d.dispose(shadeBg); d.dispose(gi); d.dispose(light);
assert.equal(mock.liveCount(), 0, 'dispose frees everything');
console.log(`passWater.test.js: all checks passed (heap +${grew} B / 1000 frames).`);
