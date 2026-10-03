// engine/render/viewModel.test.js - US-078a (docs/architecture.md 30.1).
// Run: node engine/render/viewModel.test.js  (re-spawns itself with --expose-gc)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VoxelPool } from './voxelPool.js';
import { createViewModelLayer, VM_OBJECT_ID } from './viewModel.js';
import { projTerms, shearProjection, projectPoint } from './projection.js';
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
const P = vm._last;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
{
  vm.show(h, swingLR, 80, false);
  ok('key time 80 = key 1 pos/rot', near(P[0], -0.10) && near(P[1], -0.32) && near(P[2], -0.10) && near(P[3], 70) && near(P[4], 0) && near(P[5], -80), Array.from(P).join(','));
  vm.show(h, swingLR, 100, false);
  ok('mid time 100 = linear mid of keys 80/120', near(P[0], -0.09) && near(P[1], -0.36) && near(P[2], -0.14) && near(P[3], 74) && near(P[5], -62.5), Array.from(P).join(','));
  vm.show(h, swingLR, 9999, false);
  ok('non-loop clip clamps to its last key', near(P[0], 0.27) && near(P[5], 5));
  vm.show(h, idle, 1100, false);
  ok('loop idle key 1', near(P[2], -0.212) && near(P[3], 66.5));
  vm.show(h, idle, 2200 + 1100, false);
  ok('loop wraps (t mod 2200)', near(P[2], -0.212) && near(P[3], 66.5));
}
{ // blend: key 0 replaced by the captured pose, only in the first segment
  vm.show(h, swingLR, 40, false); vm.capture();               // some mid-windup pose
  const cap = Array.from(P);
  vm.show(h, swingLR, 0, true);
  ok('blend t=0 = captured pose', cap.every((v, i) => near(P[i], v)));
  vm.show(h, swingLR, 40, true);
  ok('blend t=40 = halfway captured -> key 1', near(P[0], (cap[0] + -0.10) / 2) && near(P[5], (cap[5] + -80) / 2));
  vm.show(h, swingLR, 100, true);
  ok('blend leaves later segments alone', near(P[0], -0.09) && near(P[5], -62.5));
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

// ---- pitched rotation map vs the shear map (small-angle convergence) -------------------------------------------
// NOTE (flagged for architect re-review, BUG-VM-001 item 3): the architect's note asked for "the new pitched
// rotation matrix equals the old shear matrix within 1e-3" at pitchDeg 0 and +-5. At pitchDeg=0 the two maps are
// IDENTICAL (sp=0, cp=1, tp=0 - checked below, exact). At +-5 deg they are NOT within 1e-3 elementwise: the shear
// map has no y<->z coupling at all (Aw[5] == 0 always), while the true rotation's Aw[5] = c*sin(pitchRad) - a
// FIRST-order-in-pitch term (~0.087 at yaw=0, pitch=5deg), not a small-angle residual. That is expected/correct
// (it's exactly why the shear was wrong for a rotating camera - no amount of "small angle" shrinks a first-order
// difference to 1e-3 at 5 degrees). The two maps provably converge only as pitch -> 0 (checked below down to a
// tenth of a degree). Implemented here: (1) exact equality at pitch=0 (1e-9), (2) the +-5 deg case checked against
// an empirically-derived bound (~0.09, i.e. "same ballpark", not "1e-3") instead of the literal number, and (3) a
// convergence check at a much smaller pitch (0.1 deg) where the difference IS within 1e-3, demonstrating the two
// conventions agree in the small-angle limit as intended. Flagging the literal "1e-3 at +-5deg" instruction as
// unachievable by construction - needs an architect decision on the intended metric/tolerance.
{
  const Aw = new Float64Array(9);
  function eyeMapOf(pitched, pitchDeg, yawDeg) {
    const c2 = { x: 0, y: 0, z: 0, yawDeg, pitchDeg };
    vm._eyeMap(c2, Aw, pitched);
    return Array.from(Aw);
  }
  const maxAbsDiff = (a, b) => { let m = 0; for (let i = 0; i < 9; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
  {
    const shear = eyeMapOf(false, 0, 37), rot = eyeMapOf(true, 0, 37);
    const d = maxAbsDiff(shear, rot);
    ok('pitched rotation map == shear map at pitchDeg=0 (exact, any yaw)', d < 1e-9, `maxAbsDiff=${d}`);
  }
  for (const pitchDeg of [5, -5]) {
    const shear = eyeMapOf(false, pitchDeg, 0), rot = eyeMapOf(true, pitchDeg, 0);
    const d = maxAbsDiff(shear, rot);
    // see the NOTE above: 1e-3 is not achievable here by construction; 0.09 bounds the expected first-order gap.
    ok(`pitched rotation map stays in the same ballpark as the shear map at pitchDeg=${pitchDeg} (< 0.09, not the literal 1e-3 - see NOTE)`, d < 0.09, `maxAbsDiff=${d}`);
  }
  for (const pitchDeg of [0.05, -0.05]) {
    const shear = eyeMapOf(false, pitchDeg, 0), rot = eyeMapOf(true, pitchDeg, 0);
    const d = maxAbsDiff(shear, rot);
    ok(`small-angle convergence: rotation map -> shear map within 1e-3 at pitchDeg=${pitchDeg}`, d < 1e-3, `maxAbsDiff=${d}`);
  }
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
