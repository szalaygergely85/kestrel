// engine/render/viewModel.test.js - US-078a (docs/architecture.md 30.1).
// Run: node engine/render/viewModel.test.js  (re-spawns itself with --expose-gc)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VoxelPool } from './voxelPool.js';
import { createViewModelLayer, VM_OBJECT_ID, VM_MAX_HANDLES } from './viewModel.js';
import { projTerms, shearProjection, projectPoint, pitchedTerms, createPitchedTerms } from './projection.js';
import { DrawList } from '../mesh/DrawList.js';
import { addVoxelInstances, VoxelMeshCache, sharedVoxelMeshCache } from '../mesh/voxelMesh.js';
import { rasterDrawList, createRasterTarget, clearRasterDepth } from '../mesh/rasterJS.js';
import { makeOk } from '../test/assert.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/sword.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const A = globalThis.ASSETS;
// a 3.2 x 0.2 x 3.2 m stone plate (the "wall")
const WALL_LAYERS = [];
for (let z = 0; z < 32; z++) WALL_LAYERS.push(['w'.repeat(32), 'w'.repeat(32)]);
const wallVoxel = {
  version: 1, meshOnly: true, cellM: 0.1, size: [32, 2, 32], anchor: [16, 1, 16], mats: { w: 'stone' }, layers: WALL_LAYERS,
  parts: { wall: { box: [0, 0, 0, 32, 2, 32], pivot: [16, 1, 16] } },
};
const MODELS = { swordHeld: { voxel: A.voxelModels.swordHeld.voxel }, wall: { voxel: wallVoxel } };
const registry = { keys(kind) { return kind === 'model' ? Object.keys(MODELS) : []; }, model(k) { return MODELS[k]; } };
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
pool.bind(registry, table);

const def = A.viewModels.sword;
const vm = createViewModelLayer();
const h = vm.load('sword', def, pool);
const swingLR = vm.clipId(h, 'swingLR'), idle = vm.clipId(h, 'idle');
const tip = vm.mountId(h, 'tip');

// ---- load validation -------------------------------------------------------------------------------------------
{
  const bad = (mut) => { const d = JSON.parse(JSON.stringify(def)); mut(d); try { vm.load('bad', d, pool); return false; } catch (e) { return true; } };
  ok('load throws on an unknown model', bad((d) => { d.model = 'nope'; }));
  ok('load throws on depth.near < PROJ_NEAR', bad((d) => { d.depth.near = 0.01; }));
  ok('load throws on non-increasing key times', bad((d) => { d.clips.swingLR.keys[2].t = 10; }));
  ok('load throws on a bad rot', bad((d) => { d.clips.idle.keys[0].rot = [1, 2]; }));
  ok('load throws on no clips', bad((d) => { d.clips = {}; }));
}

// ---- sampling --------------------------------------------------------------------------------------------------
const P = vm._defs[h].last;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
{
  vm.show(h, swingLR, 80, false);
  ok('key time 80 = key 1 pos/rot', near(P[0], 0.10) && near(P[1], -0.32) && near(P[2], -0.10) && near(P[3], 70) && near(P[4], 0) && near(P[5], 80), Array.from(P).join(','));
  vm.show(h, swingLR, 100, false);
  ok('mid time 100 = linear mid of keys 80/120', near(P[0], 0.09) && near(P[1], -0.36) && near(P[2], -0.14) && near(P[3], 74) && near(P[5], 62.5), Array.from(P).join(','));
  vm.show(h, swingLR, 9999, false);
  ok('non-loop clip clamps to its last key', near(P[0], -0.27) && near(P[5], -5));
  vm.show(h, idle, 1100, false);
  ok('loop idle key 1', near(P[2], -0.212) && near(P[3], 66.5));
  vm.show(h, idle, 2200 + 1100, false);
  ok('loop wraps (t mod 2200)', near(P[2], -0.212) && near(P[3], 66.5));
}
{ // blend: key 0 replaced by the captured pose, only in the first segment
  vm.show(h, swingLR, 40, false); vm.capture(h);               // some mid-windup pose
  const cap = Array.from(P);
  vm.show(h, swingLR, 0, true);
  ok('blend t=0 = captured pose', cap.every((v, i) => near(P[i], v)));
  vm.show(h, swingLR, 40, true);
  ok('blend t=40 = halfway captured -> key 1', near(P[0], (cap[0] + 0.10) / 2) && near(P[5], (cap[5] + 80) / 2));
  vm.show(h, swingLR, 100, true);
  ok('blend leaves later segments alone', near(P[0], 0.09) && near(P[5], 62.5));
}

// ---- eye -> world ----------------------------------------------------------------------------------------------
const COLS = 160, ROWS = 60;
const grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 };
const terms = {}, M = new Float64Array(16), out4 = new Float64Array(4), w3 = new Float64Array(3), pe = new Float64Array(3);
function cellOf(cam, p) { projTerms(cam, grid, terms); shearProjection(terms, M); projectPoint(M, COLS, ROWS, p[0], p[1], p[2], out4); return [out4[0], out4[1], out4[3]]; }
{
  const rest = [0.27, -0.42, -0.22];
  let maxDev = 0, ref = null;
  for (const yaw of [0, 90, 225]) for (const pitch of [-30, 0, 30]) {
    const cam = { x: 12.3, y: -4.1, z: 1.6, yawDeg: yaw, pitchDeg: pitch };
    pe.set(rest);
    vm.eyeToWorld(cam, pe, w3);
    const c = cellOf(cam, w3);
    if (!ref) ref = c;
    maxDev = Math.max(maxDev, Math.abs(c[0] - ref[0]), Math.abs(c[1] - ref[1]), Math.abs(c[2] - ref[2]));
  }
  ok('eyeToWorld: rest anchor projects to one screen point at yaw 0/90/225, pitch -30/0/30', maxDev < 1e-9, `maxDev=${maxDev}`);
  ok('eyeToWorld: depth = -pe.y', near(ref[2], 0.42, 1e-9), String(ref[2]));
}

// ---- buildList consistency with mountEye + the raster ----------------------------------------------------------
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
function worldTipFromList(list) {
  const it = list.items[0], pm = it.partMatrices, at = pool.models.get('swordHeld').mounts.tip.at;
  return [pm[0] * at[0] + pm[1] * at[1] + pm[2] * at[2] + pm[9], pm[3] * at[0] + pm[4] * at[1] + pm[5] * at[2] + pm[10], pm[6] * at[0] + pm[7] * at[1] + pm[8] * at[2] + pm[11]];
}
{
  vm.setBob(0, 0);
  let maxErr = 0;
  for (const [yaw, pitch, t] of [[0, 0, 0], [37, 20, 100], [225, -30, 160], [90, 30, 250]]) {
    const c = { x: 5, y: -3, z: 1.7, yawDeg: yaw, pitchDeg: pitch };
    vm.show(h, swingLR, t, false);
    const list = vm.buildList(c, false);
    const a = worldTipFromList(list);
    vm.mountEye(h, swingLR, t, tip, pe);
    vm.eyeToWorld(c, pe, w3);
    maxErr = Math.max(maxErr, Math.hypot(a[0] - w3[0], a[1] - w3[1], a[2] - w3[2]));
  }
  ok('buildList part matrices carry the tip mount to eyeToWorld(mountEye(tip)) within 1e-5 m (float32 matrices)', maxErr < 1e-5, `maxErr=${maxErr}`);
  vm.show(h, idle, 0, false);
  // BUG-VM-001: the pitched camera is the mesh renderer's own default first-person mode (RE-02b/D-029) - the
  // view model must still draw under it, not just under the old shear/RTS camera.
  const pitchedList = vm.buildList(cam, true);
  ok('buildList: pitched frame -> non-null with items (BUG-VM-001)', pitchedList !== null && pitchedList.count === 1 && vm.stats.items === 1);
  const unpitchedList = vm.buildList({ ...cam, projection: 'pitched' }, false);
  ok('buildList: cam.projection alone no longer gates - only `pitched` arg / no model bound matter', unpitchedList !== null && unpitchedList.count === 1);
  vm.hide();
  ok('buildList: hidden -> null, stats.visible false', vm.buildList(cam, false) === null && vm.stats.visible === false);
  ok('buildList: hidden + pitched -> still null (no model bound is the only gate)', vm.buildList(cam, true) === null);
}

// ---- pitched rotation invariants + screen lock (BUG-VM-001 re-review) -------------------------------------------
{
  const Aw = new Float64Array(9), pt = createPitchedTerms();
  vm.setBob(0, 0);
  vm.show(h, idle, 0, false);
  vm.mountEye(h, idle, 0, tip, pe);
  for (const yawDeg of [0, 37, 225]) {
    let ref = null;
    for (const pitchDeg of [0, -20, 20]) {
      const c = { x: 12.3, y: -4.1, z: 1.6, yawDeg, pitchDeg };
      vm._eyeMap(c, Aw, true);
      let error = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += Aw[k * 3 + i] * Aw[k * 3 + j];
        error = Math.max(error, Math.abs(dot - (i === j ? 1 : 0)));
      }
      const det = Aw[0] * (Aw[4] * Aw[8] - Aw[5] * Aw[7])
        - Aw[1] * (Aw[3] * Aw[8] - Aw[5] * Aw[6])
        + Aw[2] * (Aw[3] * Aw[7] - Aw[4] * Aw[6]);
      ok(`pitched map orthonormal, yaw ${yawDeg} pitch ${pitchDeg}`, error < 1e-9, String(error));
      ok(`pitched map determinant +1, yaw ${yawDeg} pitch ${pitchDeg}`, Math.abs(det - 1) < 1e-9, String(det));
      vm.buildList(c, true); // latch the same map used by the model and trail
      vm.eyeToWorld(c, pe, w3);
      pitchedTerms(c, grid, pt);
      projectPoint(pt.M, COLS, ROWS, w3[0], w3[1], w3[2], out4);
      if (!ref) ref = [out4[0], out4[1]];
      const dev = Math.max(Math.abs(out4[0] - ref[0]), Math.abs(out4[1] - ref[1]));
      ok(`pitched tip screen-lock, yaw ${yawDeg} pitch ${pitchDeg}`, Number.isFinite(dev) && dev <= 0.5, String(dev));
    }
  }
  vm.buildList(cam, false); // restore shear mode for the raster fixture below
}

// raster: tip lands within 1 cell of the projected mount; the blade overdraws a wall 0.2 m ahead
{
  vm.show(h, idle, 0, false);
  const list = vm.buildList(cam, false);
  const item = list.items[0];
  ok('item: DRAW_VOXEL, objectId VM_OBJECT_ID, not culled/aabb free', item.objectId === VM_OBJECT_ID && list.count === 1);
  projTerms(cam, grid, terms); shearProjection(terms, M);
  const target = createRasterTarget(COLS, ROWS, 1, {});
  const ctx = { M, kind7Mat: null, structFoot: null, structCount: 0, team: null };
  rasterDrawList(list, target, ctx);
  let cells = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (target.objectId[i] === VM_OBJECT_ID && target.kind[i] !== 0) cells++;
  ok('sword rasterises to a plausible number of cells', cells > 30 && cells < 800, String(cells));
  // tip mount -> screen cell; nearest sword cell
  vm.mountEye(h, idle, 0, tip, pe); vm.eyeToWorld(cam, pe, w3);
  const c = cellOf(cam, w3);
  let best = 1e9;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = y * COLS + x;
    if (target.objectId[i] !== VM_OBJECT_ID || target.kind[i] === 0) continue;
    best = Math.min(best, Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]));
  }
  ok('mountEye(tip) through the eye map lands on a rastered sword cell (<= 1.5 cells)', best <= 1.5, `dist=${best.toFixed(2)} at (${c[0].toFixed(1)}, ${c[1].toFixed(1)})`);

  // wall 0.2 m ahead of the eye, 3.2 m wide: the sword (0.42 m deep) is BEHIND it without the depth clear
  const wallPm = pool.models.get('wall');
  const wallList = new DrawList(4);
  wallList.begin();
  const fakePool = { list: [{ model: wallPm, modelKey: 'wall', x: 0, y: -0.2, z: 0.1, yawDeg: 0, clip: -1, frame: 0, tMs: 0, rect: { minX: -1.6, minY: -0.3, minZ: 0.1, maxX: 1.6, maxY: -0.1, maxZ: 3.3 } }] };
  addVoxelInstances(wallList, fakePool, new VoxelMeshCache(), pool.partNamesFor);
  const t2 = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(wallList, t2, ctx);
  let wallCells = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (t2.kind[i] !== 0) wallCells++;
  ok('wall fixture covers the view', wallCells > COLS * ROWS * 0.5, String(wallCells));
  const countVm = (t) => { let n = 0; for (let i = 0; i < COLS * ROWS; i++) if (t.objectId[i] === VM_OBJECT_ID && t.kind[i] !== 0) n++; return n; };
  rasterDrawList(list, t2, ctx);
  const without = countVm(t2);
  const t3 = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(wallList, t3, ctx);
  clearRasterDepth(t3);
  rasterDrawList(list, t3, ctx);
  const withClear = countVm(t3);
  ok('JS twin, wall 0.2 m ahead: sword cells win after clearRasterDepth, hidden without it', withClear === cells && without === 0, `with=${withClear} without=${without} cells=${cells}`);
  // true view distance in the sword cells (depth plane), not the wall's
  let dOk = true;
  for (let i = 0; i < COLS * ROWS; i++) if (t3.objectId[i] === VM_OBJECT_ID && !(t3.depth[i] > 0.3 && t3.depth[i] < 1.2)) dOk = false;
  ok('sword cells carry true view distance (0.3..1.2 m)', dOk);
}

// ---- single-handle output baseline (pre TORCH-01a) ----------------------------------------------------------
{
  const hash = createHash('sha256');
  let vaoNeutral = true;
  const target = createRasterTarget(COLS, ROWS, 1, {});
  const pt = createPitchedTerms();
  for (const pitched of [false, true]) for (const tMs of [0, 40, 100, 160]) for (const amount of [0, 0.7]) {
    const c = { x: 2, y: -3, z: 1.7, yawDeg: 37, pitchDeg: 20 };
    vm.show(h, swingLR, 80, false); vm.capture(h);
    vm.show(h, swingLR, tMs, true); vm.setBob(1.3, amount);
    const list = vm.buildList(c, pitched);
    hash.update(new Uint8Array(list.items[0].partMatrices.buffer));
    hash.update(new Uint8Array(list.items[0].partFlags.buffer));
    if (pitched) { pitchedTerms(c, grid, pt); M.set(pt.M); }
    else { projTerms(c, grid, terms); shearProjection(terms, M); }
    target.kind.fill(0); clearRasterDepth(target);
    rasterDrawList(list, target, { M, kind7Mat: null, structFoot: null, structCount: 0, team: null });
    // ME-20c: the new vao plane is excluded from the legacy hash; asserted neutral (1) on every written cell below
    for (let i = 0; i < target.kind.length; i++) if (target.kind[i] !== 0 && target.vao[i] !== 1) vaoNeutral = false;
    for (const key of Object.keys(target)) {
      if (key === 'vao') continue;
      const a = target[key];
      if (ArrayBuffer.isView(a)) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
  }
  ok('AO-less view-model draws write the neutral vao (1.0) on every written cell', vaoNeutral);
  ok('one-handle matrices and raster remain byte-identical across 16 poses', hash.digest('hex') === 'b16abe27bfe1d16803e12d7d91ef9bf66bdec1982d7e94e733355cb6d0e20d1f');
}

// ---- independent handles (TORCH-01a, 37.8) ------------------------------------------------------------------
{
  const multi = createViewModelLayer();
  const secondDef = JSON.parse(JSON.stringify(def));
  secondDef.rest.pos[0] += 0.54;
  for (const c of Object.values(secondDef.clips)) for (const k of c.keys) k.pos[0] += 0.54;
  const a = multi.load('left-item', def, pool), b = multi.load('right-item', secondDef, pool);
  const ac = multi.clipId(a, 'swingLR'), bc = multi.clipId(b, 'swingLR');
  const ai = multi.clipId(a, 'idle'), bi = multi.clipId(b, 'idle');
  const only = createViewModelLayer(), oh = only.load('right-item', secondDef, pool);
  const oc = only.clipId(oh, 'swingLR');
  multi.show(b, bc, 140, false); multi.show(a, ac, 40, false);
  const both = multi.buildList(cam, false);
  only.show(oh, oc, 140, false);
  const expectedB = only.buildList(cam, false).items[0].partMatrices;
  vm.setBob(0, 0); vm.show(h, swingLR, 40, false);
  const expectedA = vm.buildList(cam, false).items[0].partMatrices;
  ok('two shown handles draw in handle order with distinct objectIds', both.count === 2 && both.items[0].objectId === VM_OBJECT_ID - a && both.items[1].objectId === VM_OBJECT_ID - b);
  ok('two handles retain their independently sampled poses', both.items[0].partMatrices.every((v, i) => v === expectedA[i]) && both.items[1].partMatrices.every((v, i) => v === expectedB[i]));
  ok('stats.items totals the shown items', multi.stats.visible && multi.stats.items === 2);
  multi.hide(a);
  const remaining = multi.buildList(cam, false);
  ok('hide(handle) leaves the other handle visible', remaining.count === 1 && remaining.items[0].objectId === VM_OBJECT_ID - b && multi.stats.items === 1);
  multi.hide();
  ok('hide() hides all handles', multi.buildList(cam, true) === null && !multi.stats.visible && multi.stats.items === 0);
  multi.show(a, ac, 40, false); multi.capture(a);
  multi.show(b, bc, 140, false); multi.capture(b);
  const ca = Array.from(multi._defs[a].cap), cb = Array.from(multi._defs[b].cap);
  multi.show(a, ac, 0, true); multi.show(b, bc, 0, true);
  ok('capture and blend use each handle own pose', multi._defs[a].last.every((v, i) => v === ca[i]) && multi._defs[b].last.every((v, i) => v === cb[i]));
  multi.show(b, bc, 20, false); multi.capture(b); multi.show(a, ac, 40, true);
  ok('capturing the second item does not replace the first blend source', near(multi._defs[a].last[0], (ca[0] + 0.10) / 2) && multi._defs[a].cap.every((v, i) => v === ca[i]));
  const beforeMount = Array.from(multi._defs[a].last);
  multi.mountEye(a, ac, 160, multi.mountId(a, 'tip'), pe);
  ok('mount sampling leaves both handle pose/capture states intact', multi._defs[a].last.every((v, i) => v === beforeMount[i]) && multi._defs[a].cap.every((v, i) => v === ca[i]));
  multi.show(a, ai, 0, false); multi.show(b, bi, 0, false);
  multi.setBob(1.3, 0);
  const noBobB = Array.from(multi.buildList(cam, false).items[1].partMatrices);
  const noBobA = Array.from(multi.list.items[0].partMatrices);
  multi.setBob(1.3, 1, a);
  multi.buildList(cam, false);
  ok('per-handle bob changes only that item', multi.list.items[1].partMatrices.every((v, i) => v === noBobB[i]) && multi.list.items[0].partMatrices.some((v, i) => v !== noBobA[i]));
  multi.setBob(1.3, 0.5);
  multi.buildList(cam, false);
  ok('setBob without handle updates both amounts on a shared phase', multi._defs[a].bobAmount === 0.5 && multi._defs[b].bobAmount === 0.5 && multi._bobPhase === 1.3 && multi.list.items[1].partMatrices.some((v, i) => v !== noBobB[i]));

  // Both held items win the same depth-clear overlay against a wall 0.2 m ahead.
  multi.setBob(0, 0); multi.show(a, ai, 0, false); multi.show(b, bi, 0, false);
  const list = multi.buildList(cam, false);
  projTerms(cam, grid, terms); shearProjection(terms, M);
  const ctx = { M, kind7Mat: null, structFoot: null, structCount: 0, team: null };
  const wallList = new DrawList(4);
  addVoxelInstances(wallList, { list: [{ model: pool.models.get('wall'), modelKey: 'wall', x: 0, y: -0.2, z: 0.1, yawDeg: 0, clip: -1, frame: 0, tMs: 0, rect: { minX: -1.6, minY: -0.3, minZ: 0.1, maxX: 1.6, maxY: -0.1, maxZ: 3.3 } }] }, new VoxelMeshCache(), pool.partNamesFor);
  const bare = createRasterTarget(COLS, ROWS, 1, {}), behind = createRasterTarget(COLS, ROWS, 1, {}), overlay = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, bare, ctx);
  rasterDrawList(wallList, behind, ctx); rasterDrawList(list, behind, ctx);
  rasterDrawList(wallList, overlay, ctx); clearRasterDepth(overlay); rasterDrawList(list, overlay, ctx);
  for (const handle of [a, b]) {
    const id = VM_OBJECT_ID - handle;
    let n = 0, blocked = 0, drawn = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (bare.kind[i] && bare.objectId[i] === id) n++;
      if (behind.kind[i] && behind.objectId[i] === id) blocked++;
      if (overlay.kind[i] && overlay.objectId[i] === id) drawn++;
    }
    ok(`two-handle JS raster: handle ${handle} wins wall after depth clear`, n > 30 && blocked === 0 && drawn === n, `bare=${n} blocked=${blocked} overlay=${drawn}`);
  }

  const lastA = multi._defs[a].last, lastB = multi._defs[b].last, capA = multi._defs[a].cap, capB = multi._defs[b].cap;
  const item0 = multi.list.items[0], item1 = multi.list.items[1], mats0 = item0.partMatrices, mats1 = item1.partMatrices;
  function frame(f) {
    multi.show(a, ac, f % 350, f % 7 === 0); multi.capture(b);
    multi.show(b, bc, (f + 50) % 350, f % 3 === 0);
    multi.setBob(f * 0.1, 1, a); multi.setBob(f * 0.1, 0.2, b);
    multi.buildList(cam, false);
  }
  for (let f = 0; f < 2000; f++) frame(f);
  let growth = Infinity;
  for (let round = 0; round < 3; round++) {
    global.gc(); global.gc(); const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 1000; f++) frame(f);
    global.gc(); global.gc(); growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  ok('zero-alloc: 1000 two-handle frames grow the heap < 64 KB', growth < 65536, `growth=${growth}`);
  ok('two-handle frame loop keeps all pose/capture/item buffers', multi._defs[a].last === lastA && multi._defs[b].last === lastB && multi._defs[a].cap === capA && multi._defs[b].cap === capB && multi.list.items[0] === item0 && multi.list.items[1] === item1 && item0.partMatrices === mats0 && item1.partMatrices === mats1);
  multi.load('third', def, pool); multi.load('fourth', def, pool);
  let overflow = false;
  try { multi.load('fifth', def, pool); } catch (e) { overflow = /at most 4 handles/.test(e.message); }
  ok('load enforces VM_MAX_HANDLES = 4', VM_MAX_HANDLES === 4 && multi._defs.length === 4 && overflow);
  multi.setBob(0, 0);
  for (let handle = 0; handle < VM_MAX_HANDLES; handle++) multi.show(handle, multi.clipId(handle, 'idle'), 0, false);
  const full = multi.buildList(cam, true);
  ok('all four preallocated handles draw and report total stats', full.count === VM_MAX_HANDLES && multi.stats.items === VM_MAX_HANDLES && full.items.slice(0, full.count).every((it, i) => it.objectId === VM_OBJECT_ID - i));
}

// ---- HANDS-01a: hand mirror (37.8a) -------------------------------------------------------------------------------
{
  const mv = createViewModelLayer();
  const m0 = mv.load('sword', def, pool);
  const authored = def.hand || (def.rest.pos[0] < 0 ? 'left' : 'right');
  const other = authored === 'left' ? 'right' : 'left';
  ok('authored hand = def.hand else rest.pos sign; handOf defaults to it', mv.handOf(m0) === authored);
  const noHand = JSON.parse(JSON.stringify(def)); delete noHand.hand;
  for (const sx of [-0.3, 0.3]) {
    noHand.rest.pos[0] = sx;
    const hh = createViewModelLayer().load('probe', noHand, pool);
    const l = createViewModelLayer(); const h2 = l.load('probe', noHand, pool);
    ok(`no def.hand: rest.pos.x ${sx} -> ${sx < 0 ? 'left' : 'right'}`, hh === 0 && l.handOf(h2) === (sx < 0 ? 'left' : 'right'));
  }
  const explicit = { ...noHand, hand: 'left', rest: { ...noHand.rest, pos: [0.3, noHand.rest.pos[1], noHand.rest.pos[2]] } };
  const mv2 = createViewModelLayer(); const e0 = mv2.load('x', explicit, pool);
  ok('def.hand wins over the rest sign (geometry hand, erratum)', mv2.handOf(e0) === 'left');
  let bad = false; try { createViewModelLayer().load('bad', { ...def, hand: 'up' }, pool); } catch (e) { bad = /def\.hand/.test(e.message); }
  ok('load rejects an invalid def.hand', bad);

  const c0 = { x: 0, y: 0, z: 1.6, yawDeg: 25, pitchDeg: 10 };
  const clip = mv.clipId(m0, 'swingLR'), tipM = mv.mountId(m0, 'tip');
  const det3 = (m, o) => m[o] * (m[o + 4] * m[o + 8] - m[o + 5] * m[o + 7]) - m[o + 1] * (m[o + 3] * m[o + 8] - m[o + 5] * m[o + 6]) + m[o + 2] * (m[o + 3] * m[o + 7] - m[o + 4] * m[o + 6]);
  const pn = mv._defs[m0].partCount;
  for (const pitched of [false, true]) {
    for (const tMs of [0, 90, 200]) {
      mv.setHand(m0, authored); mv.setBob(0.9, 0.8); mv.show(m0, clip, tMs, false);
      const base = Float64Array.from(mv.buildList(c0, pitched).items[0].partMatrices);
      ok('unmirrored item: mirror 0, det > 0', mv.list.items[0].mirror === 0 && det3(base, 0) > 0);
      mv.setHand(m0, other);
      const it = mv.buildList(c0, pitched).items[0], pm = it.partMatrices;
      let allNeg = true; for (let q = 0; q < pn; q++) if (!(det3(pm, q * 12) < 0)) allNeg = false;
      ok(`mirrored (pitched ${pitched}, t ${tMs}): item.mirror 1 and det < 0 for every part`, it.mirror === 1 && allNeg);
      // mirrored = S in eye space. Map both through eyeToWorld's inverse is awkward; instead check the world matrices
      // satisfy Aw^-1 * M' * (S) == Aw^-1 * M for the linear part and the eye-x flip of the translation.
      const Aw = mv._Aw;
      const det = det3(Aw, 0);
      const inv = (b0, b1, b2) => [ // Aw^-1 * b by Cramer
        (b0 * (Aw[4] * Aw[8] - Aw[5] * Aw[7]) - Aw[1] * (b1 * Aw[8] - Aw[5] * b2) + Aw[2] * (b1 * Aw[7] - Aw[4] * b2)) / det,
        (Aw[0] * (b1 * Aw[8] - Aw[5] * b2) - b0 * (Aw[3] * Aw[8] - Aw[5] * Aw[6]) + Aw[2] * (Aw[3] * b2 - b1 * Aw[6])) / det,
        (Aw[0] * (Aw[4] * b2 - b1 * Aw[7]) - Aw[1] * (Aw[3] * b2 - b1 * Aw[6]) + b0 * (Aw[3] * Aw[7] - Aw[4] * Aw[6])) / det];
      let worst = 0;
      for (let q = 0; q < pn; q++) {
        const tb = inv(base[q * 12 + 9] - c0.x, base[q * 12 + 10] - c0.y, base[q * 12 + 11] - c0.z);
        const tm = inv(pm[q * 12 + 9] - c0.x, pm[q * 12 + 10] - c0.y, pm[q * 12 + 11] - c0.z);
        worst = Math.max(worst, Math.abs(tm[0] + tb[0]), Math.abs(tm[1] - tb[1]), Math.abs(tm[2] - tb[2]));
        for (let col = 0; col < 3; col++) { // linear part: columns of Aw^-1*M, row 0 negated
          const cb = inv(base[q * 12 + col], base[q * 12 + 3 + col], base[q * 12 + 6 + col]);
          const cm = inv(pm[q * 12 + col], pm[q * 12 + 3 + col], pm[q * 12 + 6 + col]);
          worst = Math.max(worst, Math.abs(cm[0] + cb[0]), Math.abs(cm[1] - cb[1]), Math.abs(cm[2] - cb[2]));
        }
      }
      ok(`mirrored matrices = S * unmirrored in eye space (pitched ${pitched}, t ${tMs}; f32-rounded, < 1e-6)`, worst < 1e-6, `worst=${worst}`);
    }
  }
  mv.setHand(m0, authored); const mA = mv.mountEye(m0, clip, 120, tipM, new Float64Array(3)).slice();
  mv.setHand(m0, other); const mB = mv.mountEye(m0, clip, 120, tipM, new Float64Array(3)).slice();
  ok('mountEye x is negated when mirrored, y/z unchanged', mB[0] === -mA[0] && mB[1] === mA[1] && mB[2] === mA[2]);
  mv.setHand(m0, authored);
  const mC = mv.mountEye(m0, clip, 120, tipM, new Float64Array(3));
  ok('mirror twice = identity (mountEye)', mC[0] === mA[0] && mC[1] === mA[1] && mC[2] === mA[2] && mv.handOf(m0) === authored);
  mv.show(m0, clip, 70, false); mv.setBob(0.9, 0.8);
  const l1 = Float64Array.from(mv.buildList(c0, true).items[0].partMatrices);
  mv.setHand(m0, other); mv.buildList(c0, true); mv.setHand(m0, authored);
  const l2b = mv.buildList(c0, true).items[0];
  ok('mirror there and back gives a bit-identical item', l2b.mirror === 0 && l2b.partMatrices.every((v, i) => v === l1[i]));

  // JS twin: winding. A mirrored closed model must still show its front faces.
  const cam0 = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
  projTerms(cam0, grid, terms); shearProjection(terms, M);
  const cx = { M, kind7Mat: null, structFoot: null, structCount: 0, team: null };
  const idleM = mv.clipId(m0, 'idle');
  const render = (hand, forceMirror) => {
    mv.setHand(m0, hand); mv.setBob(0, 0); mv.show(m0, idleM, 0, false);
    const li = mv.buildList(cam0, false); if (forceMirror !== undefined) li.items[0].mirror = forceMirror;
    const t = createRasterTarget(COLS, ROWS, 1, {}); rasterDrawList(li, t, cx); return t;
  };
  const cells = (t) => { let n = 0; for (let i = 0; i < COLS * ROWS; i++) if (t.kind[i]) n++; return n; };
  const tA = render(authored), tB = render(other), tBadFlip = render(other, 0);
  ok('mirrored sword draws cells (> 30) with cull on', cells(tB) > 30 && cells(tA) > 30, `${cells(tA)}/${cells(tB)}`);
  let same = 0, tot = 0, diffBad = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = y * COLS + x, j = y * COLS + (COLS - 1 - x);
    if (tA.kind[i] || tB.kind[j]) { tot++; if (!!tA.kind[i] === !!tB.kind[j]) same++; }
    if (!!tB.kind[i] !== !!tBadFlip.kind[i] || tB.zbuf[i] !== tBadFlip.zbuf[i]) diffBad++;
  }
  ok('mirrored render covers the reflected unmirrored cells (> 90%)', tot > 0 && same / tot > 0.9, `${same}/${tot}`);
  ok('without the winding flip (mirror forced 0) the render differs (back faces would win)', diffBad > 10, `diff=${diffBad}`);

  const two = createViewModelLayer();
  const ta = two.load('a', def, pool), tb = two.load('b', def, pool);
  two.setHand(tb, other); two.show(ta, clip, 0, false); two.show(tb, clip, 0, false);
  const tl = two.buildList(cam0, true);
  ok('two handles, one mirrored: 2 items, distinct objectIds, mirror 0/1', tl.count === 2 && tl.items[0].objectId !== tl.items[1].objectId && tl.items[0].mirror === 0 && tl.items[1].mirror === 1);
  const dl = new DrawList(2); dl.push(null, 1).mirror = 1; dl.begin();
  ok('DrawList.push resets item.mirror to 0', dl.push(null, 1).mirror === 0);
  for (let i = 0; i < 300; i++) { two.setHand(tb, i & 1 ? 'left' : 'right'); two.buildList(cam0, true); two.mountEye(tb, clip, i, 0, pe); }
  let growth = Infinity;
  for (let round = 0; round < 3; round++) {
    global.gc(); global.gc(); const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 1000; f++) { two.setHand(tb, f & 1 ? 'left' : 'right'); two.show(tb, clip, f, false); two.buildList(cam0, true); two.mountEye(tb, clip, f, 0, pe); two.handOf(tb); }
    global.gc(); global.gc(); growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  ok('zero-alloc: 1000 mirrored frames with setHand toggling grow the heap < 64 KB', growth < 65536, `growth=${growth}`);
}

// ---- perf + zero allocation --------------------------------------------------------------------------------------
{
  vm.setBob(1.3, 0.7);
  for (let i = 0; i < 200; i++) { vm.show(h, swingLR, i, i % 3 === 0); vm.buildList(cam, false); vm.mountEye(h, swingLR, i, tip, pe); vm.eyeToWorld(cam, pe, w3); }
  let dt = 0, growth = Infinity;
  for (let round = 0; round < 3; round++) { // min over rounds: heapUsed also moves with JIT / GC bookkeeping
    global.gc(); global.gc();
    const before = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    const N = 20000;
    for (let f = 0; f < N; f++) { vm.show(h, swingLR, f % 350, f % 7 === 0); vm.setBob(f * 0.1, 1); vm.buildList(cam, false); }
    dt = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    global.gc(); global.gc();
    growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  console.log(`  pose + buildList: ${(dt * 1000).toFixed(2)} us/frame`);
  ok('zero-alloc: 20000 show+buildList frames grow the heap < 64 KB', growth < 65536, `growth=${growth}`);
  ok('perf: show + buildList <= 0.02 ms', dt <= 0.02, `${dt} ms`);
  // JS twin extra (warn-only): the sword raster at 240x90
  const g2 = { cols: 240, rows: 90, pxCellW: 1, pxCellH: 1 };
  const t = {}, M2 = new Float64Array(16);
  projTerms(cam, g2, t); shearProjection(t, M2);
  const tgt = createRasterTarget(240, 90, 1, {});
  const ctx2 = { M: M2, kind7Mat: null, structFoot: null, structCount: 0, team: null };
  vm.show(h, swingLR, 160, false);
  const l2 = vm.buildList(cam, false);
  for (let i = 0; i < 20; i++) { clearRasterDepth(tgt); rasterDrawList(l2, tgt, ctx2); }
  const r0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) { clearRasterDepth(tgt); rasterDrawList(l2, tgt, ctx2); }
  const rms = Number(process.hrtime.bigint() - r0) / 1e6 / 200;
  console.log(`  JS twin extra at 240x90: ${rms.toFixed(3)} ms (budget 0.4, warn-only)`);
  if (rms > 0.4) console.warn('  WARN: JS twin view-model raster over 0.4 ms');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
