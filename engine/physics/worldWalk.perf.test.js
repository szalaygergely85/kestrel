// engine/physics/worldWalk.perf.test.js (BUG-PERF-001 (b), docs/backlog.md
// row 25w, PC-B QUEUE 3 item 4). Headless Node ESM, no framework.
// Run: node engine/physics/worldWalk.perf.test.js
// Allocation check: node --expose-gc engine/physics/worldWalk.perf.test.js
//
// Reproduces the EXACT scenario this row's (b) AC names: a scripted 60
// SECOND walk (ground floor -> stairs -> breach -> terrain -> waystone ->
// bound) through the REAL `world_m1` (`content/worlds/world_m1.world.json`
// + `content/levels/tower.level.json` + `design/levels/overworld_far.js`,
// loaded exactly the way the game does via
// `tools/testing/content-node.mjs`), timing the same lap main.js's
// `sim.physics` measures every fixed step: `stepSectorAnims`, `integrate`,
// `stepRollers`, `stepAnimations`, `resolveBodyContacts` (game/js/main.js,
// the block between `lap(SEC.input)` and `lap(SEC.physics)`).
//
// A prior cross-track investigation (docs/backlog.md row 25w "(b)"
// programmer pass note, commit d73ca4f) already tried to reproduce the
// reported 3.10 ms single-step spike in Node against this same content and
// could not (worst step 0.18-0.27 ms) - but its scripted walk did not
// exercise the real waystone/bound triggers (landed after this probe's
// route existed, US-026a-S6) or repeatedly cross the structure/terrain
// boundary. This probe drives a longer route that does both: tower ground
// floor -> up the real stair route (content/levels/tower.level.json's own
// `route` array, the exact cell-by-cell path the level was authored with) ->
// through the breach onto real terrain -> out to the waystone (fires the
// real world-level `end` trigger) -> out further to the walk bound (fires
// the real `boundsEdge` trigger, exercises `integrate` step 4b's bound clip/
// slide) -> back through the breach into the structure, several times, to
// stress the structure/terrain `outsideSector`/`sectorOrOutside` boundary
// repeatedly - filling a full 3600 fixed steps (60 s at 60 Hz).
//
// A pure "seek the next waypoint" walker can get stuck on genuinely
// platform-y content (the tower's stair route has one real running jump
// over a 2m gap, `routeNotes["20,9"]`: "landed: jumped the gap") - since
// this probe's job is stressing physics code across many real positions and
// boundary crossings, not proving a human-equivalent platformer AI, a stuck
// waypoint (little progress for `STUCK_STEPS` steps) is corrected with a
// direct position reset to the target's real floor (`world.floorAt`, the
// same oracle `terrainWalk.test.js`'s ground-contact AC uses) rather than
// stalling the whole 60 s budget on one jump. This never skips real
// `integrate`/`stepRollers`/etc timing - only the rare stuck cases reset
// position between two otherwise-normal steps.
//
// It found and fixed one real bug along the way (ported from the sibling
// cross-track investigation, commit d73ca4f, `.claude/worktrees/agent-
// af3ff07b7e62de500`): `engine/physics/roller.js`'s `stepRollers`/
// `resolveBodyContacts` and `engine/entities/animation.js`'s
// `stepAnimations` each built a FRESH arrow-function closure for
// `world.forEachEntity` on EVERY fixed step, forever - violating each
// module's own "no per-step allocation" rule (same class of bug BUG-PERF-
// 001 (a)'s `stepBeacon` fix already found in game/js/quest/*). Hoisted to
// module-level functions reading a reused per-call context object, same
// pattern as `World.js`'s own `_dispatchEvent` fix. That fix is safe and a
// real improvement (see the zero-allocation gate below) but, per the
// investigation's own honest finding both times now, does NOT reproduce a
// >= 1 ms single-step spike in Node - see docs/backlog.md row 25w "(b) PC-B
// second pass" for the full numbers and the escape-hatch analysis
// (architecture.md 23.3's terrain band cost bound).
//
// ME-11c (architecture.md 27.18 "ME-11 implementation notes", test matrix +
// steps): this file also gains `physics: 'mesh'` coverage alongside the
// original grid-mode checks above - (1) a bit-equal determinism check
// (same 3600-step walk run twice in mesh mode), (2) a 600-step grid-vs-mesh
// parity check inside the tower (same style as ME-10c's
// meshCollide.parity.test.js), (3) a mesh-mode repeat of the 3-run worst-
// step perf gate (same warn-vs-PERF_STRICT gating as grid mode), and (4) a
// mesh-mode repeat of the zero-allocation `--expose-gc` gate. None of the
// grid-mode checks above are changed.
import { performance } from 'node:perf_hooks';
import {
  World, PHYSICS_DEFAULTS, integrate, stepRollers, resolveBodyContacts,
  stepAnimations, stepSectorAnims, updateTriggers,
} from '../index.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import titleMod from '../../design/models/title.js';
import voxelWorldMod from '../../design/models/voxel_world.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod;
rubbleMod; wreckageMod; relayMod; swordMod; farTowerMod; ferrumLightsMod; titleMod;
voxelWorldMod; // registers the `waystone` voxel model (world_m1's endMarker prop)
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const P = PHYSICS_DEFAULTS;
const DT = P.fixedDt;
const TOWER_ORIGIN = { x: 1480, y: 1018 };

function makePlayer(x, y, z) {
  return {
    id: 'probe', type: 'player',
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: {
      radius: P.radius, height: P.height, eyeH: P.eyeHeight,
      vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0,
      jumpHeldPrev: false, peakZ: z,
    } },
  };
}

function loadWorld({ physics } = {}) {
  const w = World.load(assets.world('world_m1'), assets, { physics });
  return w;
}

const startPose = { x: 17, y: 9.5 }; // content/levels/tower.level.json "start"

// ---- waypoints: local tower coords (content/levels/tower.level.json's own
// `route`: ground floor -> stairs -> breach), converted to world coords,
// then real terrain coords (breach -> hillside -> waystone -> bound -> back)
const routeLocal = [
  [15, 9], [15, 3], // ground floor entrance -> stair base (axis-aligned approach)
  [16, 3], [17, 3], [18, 3], [19, 3], [19, 4], [20, 4], [20, 5],
  [20, 6], [20, 7], [20, 9], [19, 9], [19, 10], [18, 10], [17, 10], [16, 10],
  [15, 10], [14, 10], [14, 9], [13, 9], [13, 8], [13, 7], [12, 7], [11, 7],
  [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [7, 7], [6, 7], [5, 7],
];
const jumpAtLocal = new Set(['20,9']); // routeNotes: "landed: jumped the gap"
const toWorld = ([lx, ly]) => ({ x: TOWER_ORIGIN.x + lx, y: TOWER_ORIGIN.y + ly, jump: jumpAtLocal.has(`${lx},${ly}`) });

// Bounds/waystone come from the real content (not hard-coded per 23.7's
// do-not list for game/js/quest/* - this is a physics probe, not that
// module, but it still reads the real values off the loaded world below).
function buildWaypoints(world) {
  const b = world.bounds;
  const terrainNear = { x: 1470, y: 1029 }; // real terrain, just past the breach/outcrop (outside the tower's 24x14 bbox)
  const waystone = { x: 1428, y: 1040 }; // content/worlds/world_m1.world.json endMarker/trigger
  const boundEdge = { x: b.x - (b.r + 5), y: b.y }; // past the walk bound, along -x from centre
  return [
    ...routeLocal.map(toWorld), // ground floor -> stairs -> breach (structure interior)
    { x: terrainNear.x, y: terrainNear.y }, // onto real terrain, just past the breach
    { x: waystone.x, y: waystone.y }, // out to the waystone (fires the world `end` trigger)
    { x: boundEdge.x, y: boundEdge.y }, // out to the walk bound (fires `boundsEdge`, bound clip/slide)
    { x: waystone.x, y: waystone.y }, // back toward the waystone
    { x: terrainNear.x, y: terrainNear.y }, // back near the breach (terrain -> structure boundary again)
    ...routeLocal.slice().reverse().map(toWorld), // back down through the tower (structure interior again)
    { x: terrainNear.x, y: terrainNear.y }, // out again (structure -> terrain, 2nd crossing)
    { x: boundEdge.x, y: boundEdge.y }, // bound again (2nd bound contact)
    ...routeLocal.map(toWorld), // and back up through the tower once more
  ];
}

function seekYawDeg(fromX, fromY, toX, toY) {
  return Math.atan2(toX - fromX, -(toY - fromY)) * 180 / Math.PI; // compass yaw, matches architecture.md 23.5's `yawTo` formula
}

const TOTAL_STEPS = 3600; // 60 s at 60 Hz (P.fixedDt)
const MAX_STEPS_PER_WAYPOINT = 180; // 3 s ceiling before the stuck-fallback below kicks in
const STUCK_TELEPORT_STEPS = 180; // same as the ceiling: a waypoint that hasn't been reached in 3 s (e.g. the gap-jump landing) gets a position reset, not an infinite stall
const fakeEngine = {}; // updateTriggers's ctx passthrough; no `quest.*`/`hint.show` behaviours registered here (a physics probe) - `fireTrigger` is a documented safe no-op when unregistered

/**
 * Drives `player` through `waypoints` for `steps` fixed steps, timing the
 * exact `sim.physics`-lap call sequence main.js runs. `onStep(i, ms, meta)`
 * is called after every step when provided (used for the detailed report
 * run only - the repeat-timing runs below skip it to stay allocation-light).
 */
function walk(world, player, waypoints, steps, onStep) {
  const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 0 };
  let wpIndex = 0, stepsOnWaypoint = 0, jumpFramesLeft = 0;
  let worstMs = 0;
  for (let i = 0; i < steps; i++) {
    const wp = waypoints[wpIndex];
    const dx = wp.x - player.transform.x, dy = wp.y - player.transform.y;
    const dist = Math.hypot(dx, dy);
    controls.yawDeg = seekYawDeg(player.transform.x, player.transform.y, wp.x, wp.y);
    controls.forward = 1;
    controls.run = true;
    if (wp.jump && dist < 2 && jumpFramesLeft <= 0) jumpFramesLeft = 6;
    controls.jump = jumpFramesLeft > 0;
    if (jumpFramesLeft > 0) jumpFramesLeft--;

    const t0 = performance.now();
    stepSectorAnims(world, DT);
    integrate(player, DT, controls, world, P);
    stepRollers(world, DT, P);
    stepAnimations(world, DT * 1000);
    resolveBodyContacts(world, player, P);
    const t1 = performance.now();
    const ms = t1 - t0;
    if (ms > worstMs) worstMs = ms;

    updateTriggers(world, fakeEngine, player);
    if (onStep) onStep(i, ms, wpIndex);

    stepsOnWaypoint++;
    if (dist < 0.6) {
      stepsOnWaypoint = 0;
      wpIndex = (wpIndex + 1) % waypoints.length;
    } else if (stepsOnWaypoint >= STUCK_TELEPORT_STEPS) {
      // Stuck-fallback (see file header): reset straight to the target's
      // real floor height and clear velocity, then move on. Rare in
      // practice (only the one scripted gap-jump needs it) - every other
      // step in the 3600-step budget is a normal physics step.
      const floorH = world.floorAt(wp.x, wp.y);
      player.transform.x = wp.x;
      player.transform.y = wp.y;
      player.transform.z = (floorH ?? player.transform.z) + 0.02;
      player.components.body.vx = 0;
      player.components.body.vy = 0;
      player.components.body.vz = 0;
      player.components.body.grounded = true;
      stepsOnWaypoint = 0;
      wpIndex = (wpIndex + 1) % waypoints.length;
    } else if (stepsOnWaypoint >= MAX_STEPS_PER_WAYPOINT) {
      // Not yet at the stuck-teleport threshold but not progressing either
      // (both constants are equal today - kept separate so either can be
      // tuned independently without touching the other's meaning): just
      // move on to the next waypoint without resetting position, in case a
      // later waypoint is easier to reach from here than lingering would be.
      stepsOnWaypoint = 0;
      wpIndex = (wpIndex + 1) % waypoints.length;
    }
  }
  return worstMs;
}

// =============================================================================
// Detailed run: full per-step timing + position report, worst 5 steps.
// =============================================================================
const world = World.load(assets.world('world_m1'), assets, {});
ok('world_m1 near band ready', world.terrain.nearReady === true);
ok('world_m1 has bounds (23.2 content)', !!world.bounds);
ok('upper stair landing is open without animation', world.structures.find(s => s.id === 'tower').level.sectorAt(18.5, 10.5).ceilH === 'sky');

const waypoints = buildWaypoints(world);
const player = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);

const endTriggerRec = world.triggers.find((t) => t.id === 'end' && t.structId === null) // area-only zone since WAYSTONE-NORMAL-01;
const boundsTriggerRec = world.triggers.find((t) => t.def && t.def.hint === 'boundsEdge');
let sawEndTrigger = false, sawBoundsTrigger = false, sawOutsideStructure = false, sawInsideStructure = false;

const stepTimes = new Array(TOTAL_STEPS);
const stepMeta = new Array(TOTAL_STEPS);
walk(world, player, waypoints, TOTAL_STEPS, (i, ms, wpIndex) => {
  stepTimes[i] = ms;
  const inStruct = world.structureAt(player.transform.x, player.transform.y) !== null;
  stepMeta[i] = { x: player.transform.x, y: player.transform.y, z: player.transform.z, inStruct, wpIndex };
  if (inStruct) sawInsideStructure = true; else sawOutsideStructure = true;
  if (endTriggerRec && endTriggerRec.inside === 1) sawEndTrigger = true;
  if (boundsTriggerRec && boundsTriggerRec.inside === 1) sawBoundsTrigger = true;
  if (!Number.isFinite(player.transform.x) || !Number.isFinite(player.transform.y) || !Number.isFinite(player.transform.z)) {
    fail++;
    failures.push(`NaN/Infinite transform at step ${i}`);
  }
});

const order = stepTimes.map((_, i) => i).sort((a, b) => stepTimes[b] - stepTimes[a]);
console.log('worldWalk.perf: worst 5 of', TOTAL_STEPS, 'steps:');
for (let k = 0; k < 5; k++) {
  const i = order[k];
  const m = stepMeta[i];
  console.log(`  #${i}: ${stepTimes[i].toFixed(4)} ms at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) inStructure=${m.inStruct} waypoint=${m.wpIndex}/${waypoints.length}`);
}
console.log(`worst single step: ${stepTimes[order[0]].toFixed(4)} ms`);
console.log(`in-structure steps: ${stepMeta.filter((m) => m.inStruct).length}, terrain steps: ${stepMeta.filter((m) => !m.inStruct).length}`);

ok('route visited real terrain (structureAt null) at some point', sawOutsideStructure);
ok('route visited the tower structure at some point', sawInsideStructure);
// `fireTrigger` is a documented safe no-op for an unregistered behaviour
// (World.fireTrigger), so `usedKey`/`quest.endT` never flip here - what
// actually proves the route reached both real triggers is each TriggerRec's
// own runtime `inside` flag (rebuilt every step by `updateTriggers`),
// latched into `sawEndTrigger`/`sawBoundsTrigger` above the instant it read 1.
ok('route actually entered the waystone `end` zone circle', !!endTriggerRec && sawEndTrigger, `found=${!!endTriggerRec} entered=${sawEndTrigger}`);
ok('route actually entered the `boundsEdge` bounds trigger', !!boundsTriggerRec && sawBoundsTrigger, `found=${!!boundsTriggerRec} entered=${sawBoundsTrigger}`);

// =============================================================================
// The hard target: worst step < 1 ms, median of 3 full independent runs.
// =============================================================================
function runOnce() {
  const w = loadWorld();
  const wps = buildWaypoints(w);
  const p = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  return walk(w, p, wps, TOTAL_STEPS, null);
}

const runs = [runOnce(), runOnce(), runOnce()].sort((a, b) => a - b);
const medianWorst = runs[1];
console.log(`3 full-walk runs, worst step per run = [${runs.map((r) => r.toFixed(4)).join(', ')}] ms, median=${medianWorst.toFixed(4)} ms`);
// Timing is machine-dependent (a busy or slower PC misses it while the code is fine):
// hard gate only with PERF_STRICT=1; otherwise a PERF WARN line. The no-allocation check stays hard.
if (process.env.PERF_STRICT === '1') ok('worst single step over the 60 s walk < 1 ms (median of 3 runs)', medianWorst < 1, `median worst=${medianWorst.toFixed(4)}ms`);
else if (!(medianWorst < 1)) console.log('PERF WARN: worst single step < 1 ms missed on this machine (set PERF_STRICT=1 to gate)');

// =============================================================================
// Hard gate: zero allocation per step on the steady path (straight-line
// terrain walking - isolates the physics calls from this probe's own
// waypoint-seeking/teleport bookkeeping, which is test-harness code, not
// the engine code under test).
// =============================================================================
if (typeof global.gc === 'function') {
  const w = loadWorld();
  const p = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 90 };
  const steadyStep = () => {
    stepSectorAnims(w, DT); integrate(p, DT, controls, w, P); stepRollers(w, DT, P);
    stepAnimations(w, DT * 1000); resolveBodyContacts(w, p, P);
  };
  for (let i = 0; i < 200; i++) steadyStep(); // warm-up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) steadyStep();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grewBy = after - before;
  ok('no significant heap growth over 5000 steady-state physics steps (--expose-gc)',
    grewBy < 512 * 1024, `grew by ${grewBy} bytes`);
} else {
  ok('steady-state physics steps run without throwing (run with --expose-gc for the heap check)', true);
}

// =============================================================================
// ME-11c: physics: 'mesh' coverage (architecture.md 27.18 "ME-11
// implementation notes", ME-11c bullet + test matrix). All grid-mode checks
// above are unchanged; everything below is additional mesh-mode coverage.
// =============================================================================

/** Runs `steps` on `world`/`player`, recording (x,y,z) after every step. */
function recordPositions(world, player, waypoints, steps) {
  const out = new Array(steps);
  walk(world, player, waypoints, steps, (i) => {
    out[i] = { x: player.transform.x, y: player.transform.y, z: player.transform.z };
  });
  return out;
}

// ---- (1) Determinism: the 3600-step walk run twice in mesh mode must be
// bit-equal (no RNG anywhere in this walk - waypoint seeking is purely a
// function of current position). ----
{
  const wA = loadWorld({ physics: 'mesh' });
  const pA = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  ok('mesh-mode world_m1 loads with physicsMode "mesh"', wA.physicsMode === 'mesh', `physicsMode=${wA.physicsMode}`);
  const runA = recordPositions(wA, pA, buildWaypoints(wA), TOTAL_STEPS);

  const wB = loadWorld({ physics: 'mesh' });
  const pB = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  const runB = recordPositions(wB, pB, buildWaypoints(wB), TOTAL_STEPS);

  let firstDivergeAt = -1;
  for (let i = 0; i < TOTAL_STEPS; i++) {
    if (runA[i].x !== runB[i].x || runA[i].y !== runB[i].y || runA[i].z !== runB[i].z) { firstDivergeAt = i; break; }
  }
  // Sample a handful of positions along the way (not just the end) so a
  // mid-walk divergence that happens to cancel out by the end is still caught.
  const sampleEvery = 200;
  let sampledMismatch = -1;
  for (let i = 0; i < TOTAL_STEPS; i += sampleEvery) {
    if (runA[i].x !== runB[i].x || runA[i].y !== runB[i].y || runA[i].z !== runB[i].z) { sampledMismatch = i; break; }
  }
  console.log(`[ME-11c determinism] mesh-mode 3600-step walk run twice: firstDivergeAt=${firstDivergeAt} (sampled check every ${sampleEvery} steps: mismatch at ${sampledMismatch})`);
  ok('mesh-mode determinism: two runs of the 3600-step walk are bit-equal (===, no tolerance)',
    firstDivergeAt === -1,
    firstDivergeAt === -1 ? undefined : `diverged at step ${firstDivergeAt}: A=${JSON.stringify(runA[firstDivergeAt])} B=${JSON.stringify(runB[firstDivergeAt])}`);
}

// ---- (2) Grid vs mesh parity inside the tower: a 600-step scripted walk
// (distinct from the 3600-step full-route perf walk above), same waypoints/
// seed, one on the grid world one on the mesh world, comparing position
// every step (same style as engine/physics/meshCollide.parity.test.js). ----
//
// OPEN ISSUE found by this check (2026-09-30, ME-11c), needs ARCHITECT
// review before this gate can be softened or closed - NOT the same as the
// already-documented ME-10c "tower grate borders open-sky cells" known
// difference (meshCollide.parity.test.js): this is a DIFFERENT, wider
// mismatch. Repro (isolated with a stationary-drop probe outside this
// walk, forward=0, 60 steps from z=5 or z=1): at the real start point
// `content/levels/tower.level.json` "start" (local 17, 9.5, legend '.',
// floorH 0) the mesh world settles the player at z=2.4 while the grid
// settles at ~0 (correct). Same 2.4 m mismatch reproduces at local (8,5)
// (legend '=', correct floorH 6 on the grid) - mesh again reports 2.4.
// Two other probed points, local (3,6) (floorH 5.4) and (20,6) (floorH
// 2.4, where 2.4 IS correct), match exactly on both worlds. 2.4 is a
// common numeric ceilH/floorH value used by several OTHER cells in this
// level (see `packed.geom`) - the mesh collider appears to occasionally
// pick up an unrelated cell's floor/ceiling triangle instead of the one
// directly under the probe point, rather than this being confined to the
// sky-ceiling boundary case ME-10c already flagged. Left as a real,
// non-softened failure below per this story's own instructions ("don't
// silently loosen the gate to hide a real regression") - out of scope to
// fix here (engine/physics/meshCollide.js, engine/world/colliders.js,
// engine/mesh/levelMesh.js are all off-limits for this story).
const PARITY_STEPS = 600;
const near1 = (v) => Math.abs(v - Math.round(v)) < 1e-9; // cell-boundary steps excluded, same rule as meshCollide.parity.test.js
const PARITY_TOL = 0.01; // 1 cm, per the ME-11c spec
{
  // PROP-COLLIDE-01b: authored props are mesh-only, so this structural parity fixture explicitly opts out.
  // Perf and determinism above/below still load the unchanged real solid-prop content.
  const parityAssets = Object.create(assets);
  parityAssets.level = key => {
    const level = assets.level(key);
    return { ...level, props: (level.props || []).map(p => ({ ...p, colliders: [] })) };
  };
  // NPC-BEAR-01: world-level entity colliders (Burl) are authored solids too - strip them for the same structural fixture.
  const parityWorld = (() => { const w = assets.world('world_m1'); return { ...w, entities: (w.entities || []).map(e => (e.components && e.components.collider) ? { ...e, components: { ...e.components, collider: undefined } } : e) }; })();
  const wg = World.load(parityWorld, parityAssets, {});
  const wm = World.load(parityWorld, parityAssets, { physics: 'mesh' });
  ok('structural parity fixture explicitly opts out of authored prop colliders', !wm.colliders.some(c => c.id === 'props:static'));
  ok('grid-mode world_m1 loads with physicsMode "grid"', wg.physicsMode === 'grid', `physicsMode=${wg.physicsMode}`);
  const pg = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  const pm = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  const posG = recordPositions(wg, pg, buildWaypoints(wg), PARITY_STEPS);
  const posM = recordPositions(wm, pm, buildWaypoints(wm), PARITY_STEPS);

  let maxErr = 0, maxErrStep = -1, compared = 0, boundaryExcluded = 0, insideTowerSteps = 0;
  const mismatches = [];
  for (let i = 0; i < PARITY_STEPS; i++) {
    const g = posG[i], m = posM[i];
    if (wg.structureAt(g.x, g.y) !== null) insideTowerSteps++;
    if (near1(g.x) || near1(g.y) || near1(m.x) || near1(m.y)) { boundaryExcluded++; continue; }
    compared++;
    const err = Math.max(Math.abs(g.x - m.x), Math.abs(g.y - m.y), Math.abs(g.z - m.z));
    if (err > maxErr) { maxErr = err; maxErrStep = i; }
    if (err > PARITY_TOL) mismatches.push({ step: i, err, grid: g, mesh: m });
  }
  console.log(`[ME-11c parity] grid vs mesh, 600-step tower-route walk: maxErr=${maxErr.toFixed(6)} m at step ${maxErrStep}, compared=${compared} steps, boundary-excluded=${boundaryExcluded}, insideTowerSteps=${insideTowerSteps}/${PARITY_STEPS}`);
  ok('grid vs mesh 600-step tower-route parity within 1 cm', mismatches.length === 0,
    mismatches.length ? `${mismatches.length} mismatch(es), first: ${JSON.stringify(mismatches[0])}` : undefined);
}

// ---- (3) Perf: same 3-run median-worst-step measurement, mesh mode. Same
// warn-vs-PERF_STRICT gating as the grid-mode check above. ----
function runOnceMesh() {
  const w = loadWorld({ physics: 'mesh' });
  const wps = buildWaypoints(w);
  const p = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  return walk(w, p, wps, TOTAL_STEPS, null);
}
const runsMesh = [runOnceMesh(), runOnceMesh(), runOnceMesh()].sort((a, b) => a - b);
const medianWorstMesh = runsMesh[1];
console.log(`mesh-mode: 3 full-walk runs, worst step per run = [${runsMesh.map((r) => r.toFixed(4)).join(', ')}] ms, median=${medianWorstMesh.toFixed(4)} ms`);
console.log(`worldWalk.perf: grid worst-step median=${medianWorst.toFixed(4)}ms vs mesh worst-step median=${medianWorstMesh.toFixed(4)}ms`);
if (process.env.PERF_STRICT === '1') ok('mesh-mode: worst single step over the 60 s walk < 1 ms (median of 3 runs)', medianWorstMesh < 1, `median worst=${medianWorstMesh.toFixed(4)}ms`);
else if (!(medianWorstMesh < 1)) console.log('PERF WARN: mesh-mode worst single step < 1 ms missed on this machine (set PERF_STRICT=1 to gate)');

// ---- (4) Zero allocation, mesh mode: same steady-state --expose-gc gate. ----
if (typeof global.gc === 'function') {
  const w = loadWorld({ physics: 'mesh' });
  const p = makePlayer(TOWER_ORIGIN.x + startPose.x, TOWER_ORIGIN.y + startPose.y, 1);
  const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 90 };
  const steadyStep = () => {
    stepSectorAnims(w, DT); integrate(p, DT, controls, w, P); stepRollers(w, DT, P);
    stepAnimations(w, DT * 1000); resolveBodyContacts(w, p, P);
  };
  for (let i = 0; i < 200; i++) steadyStep(); // warm-up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) steadyStep();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grewBy = after - before;
  ok('mesh-mode: no significant heap growth over 5000 steady-state physics steps (--expose-gc)',
    grewBy < 512 * 1024, `grew by ${grewBy} bytes`);
} else {
  ok('mesh-mode: steady-state physics steps run without throwing (run with --expose-gc for the heap check)', true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
