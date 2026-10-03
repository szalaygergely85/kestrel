// US-142a1: ballistic geometry, content/frame/save, selection, occlusion, two-sided composite and static GPU uploads.
import assert from 'node:assert/strict';
import { World } from '../world/World.js';
import { serialize, deserialize } from '../world/serialize.js';
import { collectWaterfallDefs, createWaterfalls } from '../world/waterfalls.js';
import { createWaterSelection, selectWater, renderWaterJS, lastWaterSelection } from './water.js';
import { projTerms, shearProjection, unprojectCell } from './projection.js';
import { frustumPlanes } from '../mesh/culling.js';
import { resolveWaterLooks, fillWaterSlotTable, WL_STRIDE, waterfallHash } from './waterLook.js';
import { waterCompositeJS } from './waterComposite.js';
import { WaterLayer } from './gpu/waterLayer.js';
import { makeMockGpuDevice } from '../test/assert.js';

let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; }
const raw = { id: 'fall', lip: [-3, 0, 3, 0], z: 8, drop: 8, outDeg: 180 };
const world = World.load({ name: 'fall-fixture', waterfalls: [raw] }, null);
const fall = world.waterfalls[0], m = fall.mesh;
ok(fall.out === 1.5 && fall.look === 'water', 'load defaults');
ok(m.cols === 12 && m.index.length / 3 === m.cols * m.rows * 2, 'half-metre lip columns');
for (let r = 0; r <= m.rows; r++) {
  const b = r * (m.cols + 1) * 4, t = m.verts[b + 1] / fall.out;
  ok(Math.abs(m.verts[b + 2] - (8 - 4.9 * t * t)) < 2e-6, 'ballistic profile');
  ok(Math.abs(m.verts[b + 3] - Math.min(r * 0.5, m.length)) < 1e-6, 'half-metre arc rows');
}
ok(m.verts[2] === 8 && Math.abs(m.verts[m.rows * (m.cols + 1) * 4 + 2]) < 1e-6, 'lip and exact drop endpoint');
for (const change of [{ drop: 1 }, { drop: 21 }, { drop: '8' }, { out: 0 }, { out: Infinity }, { lip: [0, 0, 0, 0] }, { outDeg: NaN }, { z: NaN }, { look: '' }]) {
  assert.throws(() => collectWaterfallDefs({ waterfalls: [{ ...raw, ...change }] }, []), /waterfall "fall"/); checks++;
}
assert.throws(() => collectWaterfallDefs({ waterfalls: [raw, raw] }, []), /duplicate/); checks++;
assert.throws(() => collectWaterfallDefs({ waterfalls: Array.from({ length: 9 }, (_, i) => ({ ...raw, id: String(i) })) }, []), /more than 8/); checks++;
const frame = { x: 100, y: 200, z: 10, yawSteps: 1 };
const local = collectWaterfallDefs({}, [{ id: 'tower', frame, level: { def: { waterfalls: [raw] } } }])[0];
ok(local.id === 'tower.fall' && local.z === 18 && local.outDeg === 270, 'placed level id/z/bearing');
ok(local.lip[0] === 100 && local.lip[1] === 197 && local.lip[2] === 100 && local.lip[3] === 203, 'placed lip rotation');
const saved = serialize(world), restored = deserialize(saved, null);
ok(JSON.stringify(restored.waterfallDef) === JSON.stringify([raw]) && restored.waterfalls.length === 1, 'save/load rebuilds sheets');
saved.waterfalls[0].lip[0] = 999;
ok(world.waterfallDef[0].lip[0] === -3, 'save copy isolation');
ok(!('waterfalls' in serialize(World.load({}, null))), 'old saves have no new empty field');

const cols = 80, rows = 40, n = cols * rows, grid = { cols, rows, pxCellW: 1, pxCellH: 2 };
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
const looks = resolveWaterLooks({ water: { sheetAlpha: 0.75, highlight: [240, 250, 255] } });
const table = new Float32Array(12 * WL_STRIDE);
const palette = { defaultTime: 'clear', timeOfDay: { clear: { sunElev: 45, ambientI: 0.3, sunI: 0.7 } } };
function frameAt(y, yaw) {
  const cam = { x: 0.13, y, z: 4, yawDeg: yaw, pitchDeg: 0 };
  projTerms(cam, grid, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  return { cam, fb: { gbuf: { cols, rows, kind: new Uint8Array(n) }, depth: { depth: new Float32Array(n).fill(Infinity) },
    rt: { glyphIdx: new Uint8Array(n), fg: new Uint8Array(n * 4).fill(40), bg: new Uint8Array(n * 4).fill(80), mask: new Uint8Array(n) },
    matTable: { fog: { start: 100, full: 200, fgRGB: [0, 0, 0], bgRGB: [0, 0, 0] } }, palette, waterLooks: looks, timeSec: 10 } };
}
let sides = [];
for (const [y, yaw] of [[10, 0], [-10, 180]]) {
  const { cam, fb } = frameAt(y, yaw), target = renderWaterJS(fb, world, cam, M, planes);
  const hits = [];
  for (let i = 0; i < n; i++) if (target.kind[i]) hits.push(i);
  ok(hits.length > 200 && hits.every((i) => (target.objectId[i] & 47) === 40), 'sheet-only world renders slot8 with sheet flag');
  ok(hits.every((i) => target.z[i] >= 0 && target.z[i] <= m.length && target.depth[i] > 0), 'arc and depth channels');
  sides.push(target.objectId[hits[0]] & 16);
  waterCompositeJS(fb, world, terms, null, false, false); waterCompositeJS(fb, world, terms, null, false, true);
  ok(hits.every((i) => [92, 26, 7].includes(fb.rt.glyphIdx[i])), 'fall ramp replaces scene glyph on both sides');
  ok(hits.every((i) => fb.waterMask[i] === 0), 'transparent sheet preserves behind-scene edges');
  const fg = fb.rt.fg.slice();
  waterCompositeJS(fb, world, terms, null, false, true);
  // A sheet uses its own alpha directly. Check the blend against independently
  // reconstructed unpremultiplied sheet RGB at a representative visible cell.
  fb.rt.fg.fill(40); fb.rt.bg.fill(80);
  waterCompositeJS(fb, world, terms, null, false, true);
  fillWaterSlotTable(lastWaterSelection(), world, looks, table, 10);
  const i = hits[0], fi = i * 4, point = new Float64Array(3);
  unprojectCell(terms, i % cols, (i / cols) | 0, fb.water.depth[i], point);
  const h = waterfallHash(table, 8 * WL_STRIDE, point[0], point[1], fb.water.z[i]);
  const bright = 0.6 + (h % 3) * 0.2, k = palette.timeOfDay.clear.ambientI + palette.timeOfDay.clear.sunI * Math.sin(Math.PI / 4);
  let sr = Math.min(255, table[8 * WL_STRIDE] * k * bright), sg = Math.min(255, table[8 * WL_STRIDE + 1] * k * bright), sb = Math.min(255, table[8 * WL_STRIDE + 2] * k * bright);
  if ((h >>> 8) * (1 / 16777216) > 0.92) { sr = table[8 * WL_STRIDE + 8]; sg = table[8 * WL_STRIDE + 9]; sb = table[8 * WL_STRIDE + 10]; }
  const a = 0.75, byte = (v) => Math.floor(v + 0.5);
  ok(fb.rt.fg[fi] === byte(40 + (sr - 40) * a) && fb.rt.fg[fi + 1] === byte(40 + (sg - 40) * a) && fb.rt.fg[fi + 2] === byte(40 + (sb - 40) * a), 'alpha .75 blends the unpremultiplied sheet colour');
  // Explicit zero alpha must leave RGB behind the sheet unchanged.
  fb.waterLooks = resolveWaterLooks({ water: { sheetAlpha: 0 } }); fb.rt.fg.fill(40); fb.rt.bg.fill(80);
  waterCompositeJS(fb, world, terms, null, false, true);
  ok(hits.every((i) => fb.rt.fg[i * 4] === 40 && fb.rt.bg[i * 4] === 80), 'alpha zero preserves scene RGB');
  ok(fg.some((v, i) => i % 4 !== 3 && v !== 40), 'alpha .75 changes scene RGB');
  fb.depth.depth.fill(1);
  renderWaterJS(fb, world, cam, M, planes);
  ok(!fb.water.kind.some(Boolean), 'near scene occludes sheet');
}
ok(sides[0] !== sides[1], 'opposite sides flip back flag');
const sel = createWaterSelection(), visible = frameAt(10, 0);
const many = createWaterfalls(Array.from({ length: 6 }, (_, i) => ({ ...fall, id: String(i), lip: [-3, -i * 3, 3, -i * 3] })));
selectWater({ waterfalls: many }, visible.cam, planes, sel);
ok(sel.sheetCount === 4 && sel.sheets[8].id === '0' && sel.sheets[11].id === '3', 'four nearest midpoint sheets, stable ties');
const offscreen = createWaterfalls([{ ...fall, id: 'behind', lip: [-3, 30, 3, 30] }, ...many.slice(0, 4)]);
selectWater({ waterfalls: offscreen }, visible.cam, planes, sel);
ok(sel.sheetCount === 4 && !sel.sheets.slice(8).some((f) => f.id === 'behind'), 'cull before nearest selection');
const lipNear = createWaterfalls([{ id: 'lip-near', lip: [-1, 0, 1, 0], z: 8, drop: 20, outDeg: 0, out: 1.5 }])[0];
const aabbNear = createWaterfalls([{ id: 'aabb-near', lip: [4, 0, 6, 0], z: 8, drop: 2, outDeg: 0, out: 1.5 }])[0];
const rankCam = { x: 0, y: 0, z: 4 }, noCull = new Float64Array(24);
const lipDistance = (f) => ((f.lip[0] + f.lip[2]) * 0.5) ** 2 + ((f.lip[1] + f.lip[3]) * 0.5) ** 2 + (f.z - rankCam.z) ** 2;
const aabbDistance = (f) => ((f.mesh.x0 + f.mesh.x1) * 0.5) ** 2 + ((f.mesh.y0 + f.mesh.y1) * 0.5) ** 2 + ((f.mesh.z0 + f.mesh.z1) * 0.5 - rankCam.z) ** 2;
ok(lipDistance(lipNear) < lipDistance(aabbNear) && aabbDistance(aabbNear) < aabbDistance(lipNear), 'ballistic extent reverses lip-midpoint and sheet-AABB rankings');
selectWater({ waterfalls: [aabbNear, lipNear] }, rankCam, noCull, sel);
ok(sel.sheetCount === 2 && sel.sheets[8].id === 'lip-near', 'nearest waterfall selection uses lip midpoint');
fillWaterSlotTable(sel, {}, looks, table, 1e9);
ok(table[8 * WL_STRIDE + 36] >= 0 && table[8 * WL_STRIDE + 36] < 614.4, 'long clock folded on CPU');
const lb = 8 * WL_STRIDE, h0 = waterfallHash(table, lb, 0.13, 0, 3.7);
fillWaterSlotTable(sel, {}, looks, table, 1e9);
ok(waterfallHash(table, lb, 0.13, 0, 3.7) === h0, 'frozen clock deterministic');
for (const change of [{ fallSpeed: 7 }, { fallSpeed: Infinity }, { fallRamp: ' ' }, { highlight: [0, 0, 256] }, { sheetAlpha: -1 }]) {
  assert.throws(() => resolveWaterLooks({ bad: change }), /waterLook "bad"/); checks++;
}
const mock = makeMockGpuDevice(), layer = new WaterLayer(mock.device), buffers = layer.sheet(m);
const count = mock.createCount;
for (let i = 0; i < 1000; i++) assert.equal(layer.sheet(m), buffers);
ok(mock.createCount === count && mock.writeCount === 0, 'static buffers reused without uploads');
layer.dispose(); ok(buffers.vertexBuffer._disposed && buffers.indexBuffer._disposed, 'sheet buffers disposed');
if (globalThis.gc) {
  for (let i = 0; i < 10000; i++) { selectWater({ waterfalls: many }, visible.cam, planes, sel); fillWaterSlotTable(sel, {}, looks, table, 10); }
  const w = { waterfalls: many }, empty = {}; globalThis.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { selectWater(w, visible.cam, planes, sel); fillWaterSlotTable(sel, empty, looks, table, 10); }
  globalThis.gc(); ok(process.memoryUsage().heapUsed - before < 65536, 'selection/uniform heap stable after warmup');
}
console.log(`waterfall: ${checks} checks PASS`);
