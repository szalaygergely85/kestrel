// RIVER-03 (38.45): WgWaterPass river ribbons on the device mock - pipeline, buffers (static, uploaded at bindWorld), slot table rows 12..13,
// draw list = the selection's runs, uniforms (kind 3, slot, shape.xy, clip region words), edge wos rows, waterSlots/active, 0 resources per frame.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { World } from '../../../world/World.js';
import { projTerms, shearProjection, createPitchedTerms } from '../../projection.js';
import { frustumPlanes } from '../../../mesh/culling.js';
import { selectWater, createWaterSelection, RIVER_RUNS_STRIDE, WATER_RIVER_SLOT0 } from '../../water.js';
import { WATER_U_STRIDE, U_SHAPE } from '../../../mesh/waterMesh.js';
import { WL_STRIDE, WL_SLOTS, defaultWaterLooks, fillWaterSlotTable } from '../../waterLook.js';
import { WATER_BLOCK } from '../wgsl/water.wgsl.js';
import { WATER_RIVER_VERTEX_STRIDE_BYTES } from '../wgsl/waterRiver.wgsl.js';
import { WgWaterPass } from './passWater.js';

const COLS = 80, ROWS = 30, grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 };
const path = Array.from({ length: 12 }, (_, i) => [i * 20, 2 * Math.sin(i), 10 - i * 0.2, 3, 1.5]);
const world = World.load({ name: 'rfix', water: [
  { id: 'lake', shape: 'rect', rect: [-30, -30, 15, 30], z: 9.5 },
  { id: 'rv', shape: 'river', path, clip: ['lake'] },
] }, null);
const cam = { x: -5, y: -6, z: 14, yawDeg: 90, pitchDeg: -30 };
const terms = {}, view = new Float64Array(16), planes = new Float64Array(24);
projTerms(cam, grid, terms); shearProjection(terms, view); frustumPlanes(view, planes);
const raster = { view, planes, pitched: false, pitch: createPitchedTerms() };
const p = { _world: world, _cam: cam, _table: null, _palette: { timeOfDay: { day: { sunElev: 40, ambientI: 0.3, sunI: 0.9 } }, defaultTime: 'day' }, _light: { sun: { on: true } }, _fb: { timeSec: 2 }, cols: COLS, rows: ROWS, rt: { pxCellW: 1, pxCellH: 2 }, _rasterPass: raster };

const mock = makeMockGpuDevice(), d = mock.device;
const binds = [], draws = [];
d.beginPass = () => {}; d.bind = (pipe, desc) => binds.push({ pipe, uniforms: Float32Array.from(desc.uniforms), vb: desc.vertexBuffer, ib: desc.indexBuffer }); d.draw = (count, first, n) => draws.push({ bind: binds.length - 1, count, first, n });

const wp = new WgWaterPass(d);
const rd = wp.riverPipe.desc;
assert.equal(rd.vertex.strideBytes, WATER_RIVER_VERTEX_STRIDE_BYTES); assert.equal(rd.vertex.layout.length, 2);
assert.deepEqual(rd.targetFormats, ['rgba32ui']); assert.equal(rd.frontFace, 'cw'); assert.equal(rd.bindings.uniformBytes, WATER_BLOCK.sizeBytes);
wp.resize(COLS, ROWS, 2);
wp.bindWorld(world);
const mesh = world.water.rivers[0].mesh;
assert.ok(mesh && wp.layer._sheets.has(mesh), 'ribbon buffers uploaded once at bindWorld');

assert.equal(wp.prepare(p, raster), true);
const sel = wp.sel;
assert.equal(sel.riverCount, 1); assert.equal(sel.count, 1, 'the lake region still takes slot 0');
assert.equal(wp.stats.waterSlots, 2);
// look table row 12 == the JS twin row; edge wos covers 14 slots
const ref = selectWater(world, cam, planes, createWaterSelection());
const refTable = new Float32Array(WL_SLOTS * WL_STRIDE); fillWaterSlotTable(ref, world, defaultWaterLooks(), refTable, 2);
assert.deepEqual([...wp.wlTable], [...refTable]);
assert.equal(wp.wlTable[WATER_RIVER_SLOT0 * WL_STRIDE + 51], 3); assert.equal(wp.wlTable[WATER_RIVER_SLOT0 * WL_STRIDE + 32], 3);
assert.equal(wp.waterOS.length, WL_SLOTS * 2);
assert.equal(wp.waterOS[WATER_RIVER_SLOT0 * 2], refTable[WATER_RIVER_SLOT0 * WL_STRIDE + 3]);

const sceneDepth = d.createTexture({ format: 'r32ui', width: COLS, height: ROWS });
wp.runWater(sceneDepth);
const rb = binds.filter((b) => b.pipe === wp.riverPipe);
assert.equal(rb.length, 1, 'one ribbon bind');
const ro = 0, nRuns = sel.riverRuns[ro];
assert.ok(nRuns >= 1 && nRuns <= 8);
const rd2 = draws.filter((x) => binds[x.bind].pipe === wp.riverPipe);
assert.equal(rd2.length, nRuns, 'one draw per run');
for (let r = 0; r < nRuns; r++) { assert.equal(rd2[r].count, sel.riverRuns[ro + 2 + r * 2]); assert.equal(rd2[r].first, sel.riverRuns[ro + 1 + r * 2]); }
const buf = wp.layer.sheet(mesh);
assert.equal(rb[0].vb, buf.vertexBuffer); assert.equal(rb[0].ib, buf.indexBuffer);
{
  const u = rb[0].uniforms, ui = new Int32Array(u.buffer), uu = new Uint32Array(u.buffer), F = (n) => WATER_BLOCK.field(n).word;
  const b = WATER_RIVER_SLOT0 * WATER_U_STRIDE;
  assert.equal(ui[F('kind')], 3); assert.equal(uu[F('slot')], WATER_RIVER_SLOT0);
  assert.equal(u[F('shape')], Math.fround(sel.u[b + U_SHAPE])); assert.equal(u[F('shape') + 1], Math.fround(sel.u[b + U_SHAPE + 1]));
  // clip: the lake rect, local to O; the second clip is none
  const lakeIdx = world.water.ids.indexOf('lake'), wt = world.water;
  assert.equal(sel.clip[0], lakeIdx);
  assert.equal(ui[F('clipK0')], 0); assert.equal(ui[F('clipK1')], -1);
  const ox = sel.O[0], oy = sel.O[1];
  assert.deepEqual([...u.slice(F('clip0'), F('clip0') + 4)], [wt.x0[lakeIdx] - ox, wt.y0[lakeIdx] - oy, wt.x1[lakeIdx] - ox, wt.y1[lakeIdx] - oy].map(Math.fround));
}
// the sheet-mesh cache is shared: no new resources on warm frames
d.beginPass = () => {}; d.bind = () => {}; d.draw = () => {};
for (let i = 0; i < 5; i++) { wp.prepare(p, raster); wp.runWater(sceneDepth); }
const created = mock.createCount;
for (let i = 0; i < 200; i++) { wp.prepare(p, raster); wp.runWater(sceneDepth); }
assert.equal(mock.createCount, created, 'warm frames create no resources');
wp.dispose(); d.dispose(sceneDepth);
assert.equal(mock.liveCount(), 0);
void RIVER_RUNS_STRIDE;
console.log('passWater.river.test.js: all checks passed');
