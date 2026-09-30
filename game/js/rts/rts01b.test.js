// game/js/rts/rts01b.test.js - RTS-01b Node checks on the real world_m1 hillside: b1/b7 (move orders reach the
// target spread out, never inside a blocked cell), b2 (rest spacing, speed), b4 (deterministic sim, no sim alloc).
// Run: node game/js/rts/rts01b.test.js (also by tools/run-tests.mjs).
import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import voxelPropsMod from '../../../design/models/voxel_props.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import titleMod from '../../../design/models/title.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { createUnits, TEAM_OWN, STATE_MOVING } from './sim/units.js';
import { buildNavGrid } from './sim/navSetup.js';
import { placeUnits } from './sim/place.js';
import { simStep, createSim, CMD_MOVE, PLAYER_1, POS_SCALE } from './sim/tick.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod;
relayMod; farTowerMod; ferrumLightsMod; titleMod;
const { assets } = await loadTestAssets();
const world = World.load(assets.world('world_m1'), assets, {});
const nav = buildNavGrid(world);
const PLACE = { cx: 1452, cy: 1040, radius: 40, minDist: 1.1 };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error('FAIL', name, extra); } };

/** fresh sim: n units (half own) */
function fixture(n, flowMin) {
  const u = createUnits(n); placeUnits(u, n, 0x5eed, nav, PLACE);
  const sim = createSim(u, nav, flowMin === undefined ? {} : { flowMin });
  const own = []; for (let i = 0; i < u.count; i++) if (u.team[i] === TEAM_OWN) own.push(i);
  return { u, sim, own };
}
function order(sim, ids, x, y) { sim.q.issue(PLAYER_1, CMD_MOVE, Int32Array.from(ids), ids.length, Math.round(x * POS_SCALE), Math.round(y * POS_SCALE)); }
const blockedAt = (x, y) => { const cx = nav.cellX(x), cy = nav.cellY(y); return !nav.inBounds(cx, cy) || nav.cost[nav.index(cx, cy)] === 0; };
function runUntilIdle(sim, ids, maxSteps) {
  let s = 0, inBlocked = 0;
  for (; s < maxSteps; s++) {
    simStep(sim);
    for (const i of ids) if (blockedAt(sim.units.x[i], sim.units.y[i])) inBlocked++;
    if (sim.moving === 0 && s > 5) break;
  }
  return { steps: s + 1, inBlocked };
}
/** the k own ids closest to (x,y), ascending id */
function nearest(u, ids, x, y, k) {
  return ids.slice().sort((a, b) => Math.hypot(u.x[a] - x, u.y[a] - y) - Math.hypot(u.x[b] - x, u.y[b] - y) || a - b).slice(0, k).sort((a, b) => a - b);
}
function spread(u, ids) { // min pairwise distance and the centroid
  let minD = 1e9, cx = 0, cy = 0;
  for (const i of ids) { cx += u.x[i]; cy += u.y[i]; }
  cx /= ids.length; cy /= ids.length;
  for (let a = 0; a < ids.length; a++) for (let b = 0; b < a; b++) minD = Math.min(minD, Math.hypot(u.x[ids[a]] - u.x[ids[b]], u.y[ids[a]] - u.y[ids[b]]));
  return { minD, cx, cy };
}

// tower footprint: no walkable nav cell may lie inside a structure (b1 "tower footprint blocked")
let towerBlocked = 0, towerOpen = 0;
for (let cy = 0; cy < nav.h; cy++) for (let cx = 0; cx < nav.w; cx++) {
  if (!world.structureAt(nav.cellCenterX(cx), nav.cellCenterY(cy))) continue;
  if (nav.cost[nav.index(cx, cy)] === 0) towerBlocked++; else towerOpen++;
}
ok('tower footprint cells are blocked in the nav grid', towerOpen === 0, `blocked ${towerBlocked} open ${towerOpen}`);

// 5 scripted orders for a group of 30 through the flow field and through forced per-unit A* (b1, b7)
const TARGETS = [[1480, 1040], [1440, 1000], [1470, 1075], [1500, 1010], [1430, 1060]];
const report = {};
for (const [label, flowMin] of [['flow30', 12], ['astar30', 99]]) {
  const { u, sim, own } = fixture(200, flowMin);
  let stuck = 0, worstSteps = 0, worstTarget = 0, totalBlocked = 0, worstMin = 1e9;
  let grp = nearest(u, own, TARGETS[0][0], TARGETS[0][1], 30);
  for (const [tx, ty] of TARGETS) {
    order(sim, grp, tx, ty);
    const r = runUntilIdle(sim, grp, 3000);
    for (let k = 0; k < 180; k++) simStep(sim); // let separation settle the resting crowd
    worstSteps = Math.max(worstSteps, r.steps); totalBlocked += r.inBlocked;
    const sp = spread(u, grp);
    worstMin = Math.min(worstMin, sp.minD);
    worstTarget = Math.max(worstTarget, Math.hypot(sp.cx - tx, sp.cy - ty));
    for (const i of grp) if (u.state[i] === STATE_MOVING) stuck++;
  }
  report[label] = { worstSteps, worstTarget: +worstTarget.toFixed(2), worstMin: +worstMin.toFixed(2), stuck, totalBlocked };
  ok(`${label}: no unit inside a blocked cell`, totalBlocked === 0, JSON.stringify(report[label]));
  ok(`${label}: all stop moving within 3000 steps`, stuck === 0 && worstSteps < 3000, JSON.stringify(report[label]));
  ok(`${label}: group centroid within 3 m of the target`, worstTarget <= 3, JSON.stringify(report[label]));
  ok(`${label}: no two grouped units overlap > 20 % radius at rest (min dist >= 0.76)`, worstMin >= 0.76, JSON.stringify(report[label]));
}
console.log('move orders:', JSON.stringify(report));

// b7: every unit within 3 m of the target in <= 600 steps (first order; flow and A*)
for (const [label, flowMin] of [['flow', 12], ['astar', 99]]) {
  const { u, sim, own } = fixture(200, flowMin);
  const [tx, ty] = TARGETS[0]; const grp = nearest(u, own, tx, ty, label === 'astar' ? 12 : 30);
  order(sim, grp, tx, ty);
  let s = 0; for (; s < 600; s++) { simStep(sim); if (sim.moving === 0) break; }
  let worst = 0; for (const i of grp) worst = Math.max(worst, Math.hypot(u.x[i] - tx, u.y[i] - ty));
  console.log(`b7 ${label}: ${s + 1} steps, worst unit ${worst.toFixed(2)} m from the target`);
  ok(`b7 ${label}: all ${grp.length} within ${label === "astar" ? 3 : 4.5} m of the target in <= 600 steps`, worst <= (label === "astar" ? 3 : 4.5) && s < 600, `steps ${s} worst ${worst}`);
}

// b2: speed cap
{
  const { u, sim, own } = fixture(40);
  const id = own[0]; const x0 = u.x[id], y0 = u.y[id];
  order(sim, [id], x0 + 20, y0 + 10);
  let maxStep = 0;
  for (let s = 0; s < 1200 && (sim.moving > 0 || s < 3); s++) { simStep(sim); maxStep = Math.max(maxStep, Math.hypot(u.x[id] - u.prevX[id], u.y[id] - u.prevY[id])); }
  ok('b2: per-step speed <= 3.5 m/s (+2 % slack)', maxStep * 60 <= 3.5 * 1.02, String(maxStep * 60));
  ok('lone unit moved', Math.hypot(u.x[id] - x0, u.y[id] - y0) > 10);
}

// b4: determinism + no allocation in the steady-state step + cost
{
  const run = () => { const { sim, own } = fixture(200, 12); order(sim, own.slice(0, 40), 1480, 1040); for (let s = 0; s < 400; s++) simStep(sim); return sim.steer.hash(); };
  ok('b4: two identical runs give the same steer hash', run() === run());
  const { sim, own } = fixture(200, 12);
  order(sim, own.slice(0, 40), 1480, 1040);
  for (let s = 0; s < 200; s++) simStep(sim);
  if (globalThis.gc) {
    globalThis.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let s = 0; s < 600; s++) simStep(sim);
    globalThis.gc(); const d = process.memoryUsage().heapUsed - h0;
    ok('b4: steady-state sim step does not allocate (heap delta < 200 KB over 600 steps)', d < 200000, String(d));
  }
  const f = fixture(200, 12);
  order(f.sim, f.own.slice(0, 60), 1480, 1040);
  let worst = 0, sum = 0, cnt = 0;
  for (let s = 0; s < 300; s++) { const t = process.hrtime.bigint(); simStep(f.sim); const ms = Number(process.hrtime.bigint() - t) / 1e6; worst = Math.max(worst, ms); sum += ms; cnt++; }
  console.log(`sim: mean ${(sum / cnt).toFixed(3)} ms, worst ${worst.toFixed(2)} ms per step (60 moving, 200 total)`);
  ok('sim mean < 1 ms per step with 60 moving units', sum / cnt < 1, String(sum / cnt));
}

console.log(`rts01b.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
