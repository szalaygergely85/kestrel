// engine/world/sectorAnim.test.js (US-014). Headless Node ESM, no framework.
// Run: node engine/world/sectorAnim.test.js
//
// Tests `World.animateSectorTo`/`stepSectorAnims` (docs/architecture.md 7.4
// "Sector animation") on the real tower grate, per the architect's tech
// notes (docs/backlog.md US-014, item 6): the ease-in-out curve over a
// delay + open time, the passability flip at 1.70 m clearance, in-place
// packed updates equal to a fresh `packLevel`, the GPU dirty-row upload plan
// (`planFrameUpdate`), no allocation in `stepSectorAnims`, and a save mid-
// open resuming bit-identical to an uninterrupted run.
import { AssetRegistry } from '../core/assets.js';
import { World, stepSectorAnims } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { packLevel } from './packed.js';
import { buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan } from '../render/gpu/WorldTextures.js';
import { isSectorPassable } from '../physics/capsule.js';
import { PHYSICS_DEFAULTS } from '../physics/config.js';
import paletteMod from '../../design/palette.js';
import towerDef from '../../design/levels/tower.js';
import testRoomDef from '../../design/levels/test_room.js';
import terrainDef from '../../design/levels/overworld_far.js';
import worldMod from '../../design/levels/world_m1.js';
// US-011 (7.5 item 1): World.load throws on an unregistered props[].model.
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef; testRoomDef; terrainDef; worldMod;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const easeInOut = (t) => t * t * (3 - 2 * t); // smoothstep - must match World.js's private `ease('inOut', t)`

function freshTowerWorld() {
  return World.load({
    name: 'sectorAnim_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
}
function grateCell(level) {
  for (let cy = 0; cy < level.height; cy++) {
    for (let cx = 0; cx < level.width; cx++) {
      const s = level.sectorAt(cx + 0.5, cy + 0.5);
      if (s && s.tag === 'grate') return [cx, cy];
    }
  }
  return null;
}
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const DT = 1 / 60;
const DELAY = 0.4, OPEN_TIME = 1.5; // matches tower.js's grate `dynamic: {ceilOpen: 5.4, openTime: 1.5, ease: 'inOut'}`
const DELAY_STEPS = 24, OPEN_STEPS = 90; // DELAY/DT, OPEN_TIME/DT - the tech note's own step counts

// ---------------------------------------------------------------------------
// 1. animateSectorTo: no dynamic sector with that tag -> false, no throw.
// ---------------------------------------------------------------------------
{
  const w = freshTowerWorld();
  ok('animateSectorTo: unknown tag returns false', w.animateSectorTo('no-such-tag', 1) === false);
  ok('animateSector: unknown tag returns false', w.animateSector('no-such-tag', 1) === false);
}

// ---------------------------------------------------------------------------
// 2. Ease curve + exact step counts: t reaches exactly 1 at step 24 + 90.
// ---------------------------------------------------------------------------
{
  const w = freshTowerWorld();
  const s = w.structures[0];
  const gc = grateCell(s.level);
  const sector = () => s.level.sectorAt(gc[0] + 0.5, gc[1] + 0.5);
  const floorH = sector().floorH, ceilOpen = sector().dynamic.ceilOpen;

  ok('animateSectorTo(grate, 1, {delay: 0.4}) returns true', w.animateSectorTo('grate', 1, { delay: DELAY }) === true);
  ok('dynamics.grate set, t unchanged (0), target 1, delay 0.4', s.dynamics.grate.t === 0 && s.dynamics.grate.target === 1 && near(s.dynamics.grate.delay, DELAY));
  ok('ceilH unmoved before any step', near(sector().ceilH, floorH));

  for (let i = 0; i < DELAY_STEPS; i++) stepSectorAnims(w, DT);
  ok('after exactly the delay-step count, t is still 0 (no movement during delay)', s.dynamics.grate.t === 0, s.dynamics.grate.t);

  let sawIntermediateEase = false;
  for (let i = 1; i <= OPEN_STEPS; i++) {
    stepSectorAnims(w, DT);
    const tExpect = Math.min(1, i / OPEN_STEPS);
    if (!near(s.dynamics.grate.t, tExpect, 1e-9)) failures.push(`open step ${i}: t=${s.dynamics.grate.t} expected ${tExpect}`);
    const expectCeil = floorH + (ceilOpen - floorH) * easeInOut(tExpect);
    if (!near(sector().ceilH, expectCeil, 1e-6)) failures.push(`open step ${i}: ceilH=${sector().ceilH} expected ${expectCeil}`);
    if (i > 1 && i < OPEN_STEPS && sector().ceilH > floorH + 1e-6 && sector().ceilH < ceilOpen - 1e-6) sawIntermediateEase = true;
  }
  ok('ease-in-out curve followed step by step (24 delay + 90 open)', failures.length === 0, failures.join('; '));
  ok('an intermediate step is strictly between closed and open (not a snap)', sawIntermediateEase);
  ok('t reaches EXACTLY 1 at step 24 + 90', s.dynamics.grate.t === 1 && s.dynamics.grate.target === 1);
  ok('ceilH reaches exactly ceilOpen', sector().ceilH === ceilOpen);

  // Further steps are a no-op (t === target already).
  const versionBefore = s.packed.version;
  stepSectorAnims(w, DT);
  ok('once t === target, stepSectorAnims does not touch the packed layout again', s.packed.version === versionBefore);
}

// ---------------------------------------------------------------------------
// 3. isSectorPassable flips exactly at 1.70 m clearance (physics/capsule.js).
// ---------------------------------------------------------------------------
{
  const OPTS = { height: PHYSICS_DEFAULTS.height, stepUpMax: PHYSICS_DEFAULTS.stepUpMax };
  const w = freshTowerWorld();
  const s = w.structures[0];
  const gc = grateCell(s.level);
  const sector = () => s.level.sectorAt(gc[0] + 0.5, gc[1] + 0.5);
  const floorH = sector().floorH;

  w.animateSectorTo('grate', 1, { delay: 0 });
  let flippedAt = -1;
  for (let i = 1; i <= OPEN_STEPS && flippedAt < 0; i++) {
    stepSectorAnims(w, DT);
    const clearance = sector().ceilH - floorH;
    const passable = isSectorPassable(sector(), floorH, true, OPTS);
    ok(`step ${i}: isSectorPassable matches the 1.70 m clearance rule`, passable === (clearance >= 1.70 - 1e-9), `clearance=${clearance} passable=${passable}`);
    if (passable) flippedAt = i;
  }
  ok('the grate does flip from impassable to passable somewhere in the tween', flippedAt > 0 && flippedAt < OPEN_STEPS);
}

// ---------------------------------------------------------------------------
// 4. In-place `updateAnimatedSector` result equals a fresh `packLevel` of the
//    same (mutated) level - the whole point of the in-place update.
// ---------------------------------------------------------------------------
{
  const w = freshTowerWorld();
  const s = w.structures[0];
  w.animateSectorTo('grate', 1, { delay: 0 });
  for (let i = 0; i < 37; i++) stepSectorAnims(w, DT); // an arbitrary mid-tween point
  const fresh = packLevel(s.level, null);
  ok('mid-tween: packed.geom equals a fresh packLevel', arraysEqual(s.packed.geom, fresh.geom));
  ok('mid-tween: packed.flags equals a fresh packLevel', arraysEqual(s.packed.flags, fresh.flags));
  ok('mid-tween: packed.relief equals a fresh packLevel', arraysEqual(s.packed.relief, fresh.relief));
}

// ---------------------------------------------------------------------------
// 5. GPU dirty-row plan: `planFrameUpdate` after one step lists exactly rows
//    [y0-1, y1+1], and after being consumed `dirtyY0 == -1` (no atlas rebuild
//    - `structVersion` untouched).
// ---------------------------------------------------------------------------
{
  const w = freshTowerWorld();
  const s = w.structures[0];
  const gc = grateCell(s.level);
  const structVersionBefore = w.structVersion;
  const atlas = buildWorldTextures(w);
  const planOut = makeFrameUpdatePlan();

  w.animateSectorTo('grate', 1, { delay: 0 });
  stepSectorAnims(w, DT); // exactly one step: touches the grate's row(s), plus 1 on each side for relief

  // Recompute the expected touched-row range the same way `updateAnimatedSector` does: every row containing the grate glyph, +-1.
  let y0 = Infinity, y1 = -1;
  for (let cy = 0; cy < s.level.height; cy++) {
    for (let cx = 0; cx < s.level.width; cx++) {
      if (s.level.rows[cy][cx] === s.level.rows[gc[1]][gc[0]]) { if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; }
    }
  }
  const expectY0 = Math.max(0, y0 - 1), expectY1 = Math.min(s.level.height - 1, y1 + 1);

  ok('structVersion is unchanged by a sector animation step (no atlas rebuild)', w.structVersion === structVersionBefore);
  const plan = planFrameUpdate(w, atlas, planOut);
  ok('planFrameUpdate: no rebuild needed', plan.rebuildNeeded === false);
  ok('planFrameUpdate: exactly one dirty range', plan.count === 1, plan.count);
  ok('planFrameUpdate: range is exactly [y0-1, y1+1]', plan.ranges[0] === expectY0 && plan.ranges[1] === expectY1,
    `[${plan.ranges[0]},${plan.ranges[1]}] vs [${expectY0},${expectY1}]`);
  ok('after planFrameUpdate consumes it, packed.dirtyY0/Y1 reset to -1', s.packed.dirtyY0 === -1 && s.packed.dirtyY1 === -1);

  // A second call with nothing new to report finds no dirty ranges.
  const plan2 = planFrameUpdate(w, atlas, planOut);
  ok('a second planFrameUpdate call (nothing changed) reports no ranges', plan2.count === 0);
}

// ---------------------------------------------------------------------------
// 6. `stepSectorAnims` does not allocate (rule 9): a large number of calls
//    against an ALREADY-CONVERGED world (t === target, the common per-frame
//    case once the grate is done) triggers no measurable heap growth. This
//    is a coarse smoke check (Node GC is not deterministic without
//    --expose-gc), not a byte-exact allocation count.
// ---------------------------------------------------------------------------
{
  const w = freshTowerWorld();
  w.animateSectorTo('grate', 1, { delay: 0 });
  for (let i = 0; i < OPEN_STEPS + 5; i++) stepSectorAnims(w, DT); // converge, then idle
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) stepSectorAnims(w, DT);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    ok('100k idle stepSectorAnims calls: no material heap growth (run with --expose-gc)', after - before < 1_000_000, `${before} -> ${after}`);
  } else {
    for (let i = 0; i < 100000; i++) stepSectorAnims(w, DT); // still exercises the idle path even without --expose-gc
    ok('100k idle stepSectorAnims calls complete without throwing (run with --expose-gc for the allocation check)', true);
  }
}

// ---------------------------------------------------------------------------
// 7. Save mid-open -> load -> finish is bit-identical to an uninterrupted run.
// ---------------------------------------------------------------------------
{
  const runA = freshTowerWorld();
  runA.animateSectorTo('grate', 1, { delay: DELAY });
  const MID_STEPS = 40; // 24 delay steps + 16 of the 90-step open tween
  for (let i = 0; i < MID_STEPS; i++) stepSectorAnims(runA, DT);

  const saved = JSON.parse(JSON.stringify(serialize(runA)));
  const runB = deserialize(saved, assets, {});
  const sA = runA.structures[0], sB = runB.structures[0];
  ok('save mid-open round-trips t/target/delay exactly',
    sB.dynamics.grate.t === sA.dynamics.grate.t && sB.dynamics.grate.target === sA.dynamics.grate.target && sB.dynamics.grate.delay === sA.dynamics.grate.delay,
    JSON.stringify(sB.dynamics.grate) + ' vs ' + JSON.stringify(sA.dynamics.grate));
  ok('save mid-open round-trips ceilH exactly (not just t)', sB.level.legend[Object.keys(sB.level.legend).find((ch) => sB.level.legend[ch].tag === 'grate')].ceilH ===
    sA.level.legend[Object.keys(sA.level.legend).find((ch) => sA.level.legend[ch].tag === 'grate')].ceilH);

  const runC = freshTowerWorld(); // uninterrupted reference
  runC.animateSectorTo('grate', 1, { delay: DELAY });
  const TOTAL_STEPS = DELAY_STEPS + OPEN_STEPS + 10; // finish + margin
  for (let i = 0; i < TOTAL_STEPS; i++) stepSectorAnims(runC, DT);
  for (let i = 0; i < TOTAL_STEPS - MID_STEPS; i++) { stepSectorAnims(runA, DT); stepSectorAnims(runB, DT); }

  const gcA = grateCell(runA.structures[0].level), gcB = grateCell(runB.structures[0].level), gcC = grateCell(runC.structures[0].level);
  const secA = runA.structures[0].level.sectorAt(gcA[0] + 0.5, gcA[1] + 0.5);
  const secB = runB.structures[0].level.sectorAt(gcB[0] + 0.5, gcB[1] + 0.5);
  const secC = runC.structures[0].level.sectorAt(gcC[0] + 0.5, gcC[1] + 0.5);
  ok('resumed run (A continued) finishes at ceilOpen', secA.ceilH === secC.ceilH, `${secA.ceilH} vs ${secC.ceilH}`);
  ok('resumed run (B, from the save) finishes bit-identical to the uninterrupted run', secB.ceilH === secC.ceilH, `${secB.ceilH} vs ${secC.ceilH}`);

  const freshB = packLevel(runB.structures[0].level, null);
  ok('resumed (B) packed geom/flags/relief equal a fresh packLevel of its own mutated level',
    arraysEqual(runB.structures[0].packed.geom, freshB.geom) && arraysEqual(runB.structures[0].packed.flags, freshB.flags) && arraysEqual(runB.structures[0].packed.relief, freshB.relief));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
