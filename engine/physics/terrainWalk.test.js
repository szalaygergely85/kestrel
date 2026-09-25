// engine/physics/terrainWalk.test.js (US-026a step S3, docs/architecture.md
// 23.3/23.7 "S3 Physics"). Headless Node ESM, no framework - matches
// physics.test.js/jump.test.js. Run: node engine/physics/terrainWalk.test.js
//
// Covers 23.3's three S3 items:
//   1. decision 3 - terrain cells are always horizontally passable
//      (isSectorPassable), steepness decided at the actor's own position.
//   2. bounds step 4b - the walk bound projection + velocity clip.
//   3. the slope rule - on a SYNTHETIC `WorldQuery` stub (h = k*x, per
//      23.3's "30/49/51/60 deg" plan), plus the 1000-spawn ground-contact
//      AC against the real world_m1 near band.
//
// physics/jump/roller.test.js are untouched by this story and stay green
// (run separately by tools/run-tests.mjs).

import { World } from '../world/World.js';
import { integrate } from './integrate.js';
import { isSectorPassable, sectorOrOutside } from './capsule.js';
import { PHYSICS_DEFAULTS } from './config.js';
import paletteMod from '../../design/palette.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import titleMod from '../../design/models/title.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod;
rubbleMod; wreckageMod; relayMod; farTowerMod; ferrumLightsMod; titleMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const P = PHYSICS_DEFAULTS;
const DT = P.fixedDt;

function makeBody(x, y, z, grounded = true) {
  return {
    id: 'probe', type: 'player',
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: {
      radius: P.radius, height: P.height, eyeH: P.eyeHeight,
      vx: 0, vy: 0, vz: 0, grounded, coyote: 0, buffer: 0,
      jumpHeldPrev: false, peakZ: z,
    } },
  };
}
const finite = (t) => Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z);

// Deterministic PRNG (mulberry32) - seeded, reproducible across runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// 1. Decision 3: terrain cells are always horizontally passable.
// =============================================================================
{
  // A terrain sector with a floor far above/below footZ, both grounded and
  // airborne, must still be passable - steepness is not judged per-cell.
  const steepUp = { terrain: true, solid: false, ceilH: 'sky', floorH: 50 };
  const steepDown = { terrain: true, solid: false, ceilH: 'sky', floorH: -50 };
  const opts = { height: P.height, stepUpMax: P.stepUpMax };
  ok('terrain sector far above footZ passable while grounded (decision 3)',
    isSectorPassable(steepUp, 0, true, opts) === true);
  ok('terrain sector far above footZ passable while airborne (decision 3)',
    isSectorPassable(steepUp, 0, false, opts) === true);
  ok('terrain sector far below footZ passable while grounded (decision 3)',
    isSectorPassable(steepDown, 0, true, opts) === true);
  // A non-terrain (Level) sector with the same floor gap is NOT passable -
  // this story must not change ordinary Level/sector step-up behaviour.
  const levelSteep = { terrain: undefined, solid: false, ceilH: 'sky', floorH: 50 };
  ok('a non-terrain sector with the same gap is still blocked (unchanged Level rule)',
    isSectorPassable(levelSteep, 0, true, opts) === false);
}

// =============================================================================
// 2. Bounds step 4b, on a synthetic flat WorldQuery stub (isolates the bound
//    from the slope rule - flat ground, nz = 1, never slides).
// =============================================================================
{
  const bx = 0, by = 0, r = 20;
  const flatWorld = {
    sectorAt() { return null; },
    outsideSector() {
      return { terrain: true, solid: false, ceilH: 'sky', floorH: 0, floorMat: 'grass', nx: 0, ny: 0, nz: 1 };
    },
    bounds: { shape: 'circle', x: bx, y: by, r },
  };
  const lim = r - P.radius;

  // Walk straight out past the bound, from the centre, due north.
  {
    const ent = makeBody(0, 0, 0, true);
    const body = ent.components.body;
    const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 0 };
    let neverCrossed = true;
    for (let i = 0; i < 2000; i++) {
      integrate(ent, DT, controls, flatWorld, P);
      const d = Math.hypot(ent.transform.x - bx, ent.transform.y - by);
      if (d > lim + 1e-6) neverCrossed = false;
    }
    ok('walking straight out never crosses lim + 1e-6', neverCrossed);
    const dFinal = Math.hypot(ent.transform.x - bx, ent.transform.y - by);
    ok('walking straight out settles at the bound (within 0.05 m of lim)', Math.abs(dFinal - lim) < 0.05, `d=${dFinal} lim=${lim}`);
    ok('body.boundsHit true once pinned at the edge', body.boundsHit === true);
  }

  // Walk into the bound at 45 degrees (tangential slide, no bounce/stop):
  // start near the edge along +x (outward normal there ~= (1,0)), heading
  // straight at the same yaw the velocity is preset to (so step 3's
  // accel/decel leaves it unchanged - already at its own target), and check
  // a step that hits the bound keeps >= 0.7 of the speed and never crosses
  // lim + 1e-6.
  {
    // Close enough that the FIRST step's radial displacement (v*cos45*dt)
    // already crosses `lim` - keeps the contact normal at exactly (1,0)
    // (pure x-axis start), matching the intended 45 deg incidence exactly
    // (a multi-step approach would let y drift and rotate the true local
    // normal away from 45 deg by the time of contact).
    const startX = lim - 0.03, startY = 0;
    const ent = makeBody(startX, startY, 0, true);
    const body = ent.components.body;
    // yawDeg 135 -> fwd = (sin135, -cos135) = (0.7071, 0.7071): 45 deg
    // between the bound's outward normal (1,0) here and the travel
    // direction. forward = 1 keeps step 3's target equal to this velocity.
    const yawDeg = 135;
    body.vx = P.runSpeed * Math.SQRT1_2;
    body.vy = P.runSpeed * Math.SQRT1_2;
    const speedBefore = Math.hypot(body.vx, body.vy);
    const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg };
    let neverCrossed = true;
    let hitStep = -1;
    for (let i = 0; i < 10 && hitStep < 0; i++) {
      integrate(ent, DT, controls, flatWorld, P);
      const d = Math.hypot(ent.transform.x - bx, ent.transform.y - by);
      if (d > lim + 1e-6) neverCrossed = false;
      if (body.boundsHit) hitStep = i;
    }
    const speedAfter = Math.hypot(body.vx, body.vy);
    ok('45 deg bound contact never crosses lim + 1e-6', neverCrossed);
    ok('45 deg bound contact is actually reached within 10 steps', hitStep >= 0, `hitStep=${hitStep}`);
    ok('45 deg bound contact keeps >= 0.7 of the speed (tangential slide, no bounce/stop)',
      speedAfter >= 0.7 * speedBefore, `before=${speedBefore} after=${speedAfter}`);
  }

  // Unbounded world (world.bounds falsy) - never sets boundsHit, no clip.
  // yawDeg 180 -> fwd = (sin180, -cos180) = (0, 1): due +y.
  {
    const unboundedWorld = { sectorAt() { return null; }, outsideSector: flatWorld.outsideSector, bounds: null };
    const ent = makeBody(0, 0, 0, true);
    const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 180 };
    for (let i = 0; i < 300; i++) integrate(ent, DT, controls, unboundedWorld, P);
    ok('no world.bounds -> boundsHit stays false and position is unclamped',
      ent.components.body.boundsHit === false && ent.transform.y > 20, `y=${ent.transform.y}`);
  }
}

// =============================================================================
// 3. Slope rule, on a synthetic tilted-plane WorldQuery stub: h(x, y) = k*x,
//    uphill = +x, downhill = -x (23.3's own worked plan: k = tan(30/49/51/60
//    degrees)). No `world.bounds` here - isolates the slope rule.
// =============================================================================
function slopeWorld(deg) {
  const k = Math.tan(deg * Math.PI / 180);
  // Analytic unit normal of the plane z = k*x: (-k, 0, 1) / sqrt(1+k^2) -
  // matches Terrain.groundNormalAt's central-difference convention exactly
  // (nx, ny already point downhill - engine/world/Terrain.js groundNormalAt).
  const len = Math.sqrt(k * k + 1);
  const nx = -k / len, ny = 0, nz = 1 / len;
  return {
    sectorAt() { return null; },
    outsideSector(x) {
      return { terrain: true, solid: false, ceilH: 'sky', floorH: k * x, floorMat: 'rock', nx, ny, nz };
    },
    bounds: null,
    _k: k,
  };
}

function runSlope(deg, forwardSign, steps = 400) {
  const world = slopeWorld(deg);
  const ent = makeBody(0, 0, 0, true);
  const body = ent.components.body;
  // forwardSign = +1 drives due +x (uphill), -1 drives due -x (downhill).
  const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: forwardSign > 0 ? 90 : 270 };
  let maxHeightErr = 0;
  let flips = 0;
  let prevSliding = body.sliding;
  for (let i = 0; i < steps; i++) {
    integrate(ent, DT, controls, world, P);
    const h = world._k * ent.transform.x;
    maxHeightErr = Math.max(maxHeightErr, Math.abs(ent.transform.z - h));
    if (body.sliding !== prevSliding) { flips++; prevSliding = body.sliding; }
  }
  return { ent, body, maxHeightErr, flips };
}

{
  // 30 and 49 deg (both < 50 deg maxSlopeDeg, both above the 45 deg
  // slideStopCos threshold too - nz never drops under slideStartCos):
  // walk uphill at full speed, never slides.
  for (const deg of [30, 49]) {
    const { ent, body, maxHeightErr } = runSlope(deg, +1);
    ok(`${deg} deg: walks uphill (x advances)`, ent.transform.x > 5, `x=${ent.transform.x}`);
    ok(`${deg} deg: never starts sliding`, body.sliding === false);
    ok(`${deg} deg: z tracks h(x, y) exactly every step (grounded snap)`, maxHeightErr <= 1e-6, `err=${maxHeightErr}`);
  }

  // 51 and 60 deg (>= maxSlopeDeg): no uphill progress, downhill speed grows
  // and caps at slideMaxSpeed, z tracks h(x,y) every step.
  for (const deg of [51, 60]) {
    const { ent, body, maxHeightErr } = runSlope(deg, +1, 600);
    ok(`${deg} deg: no uphill progress (x stays <= start + 0.05 m)`, ent.transform.x <= 0.05, `x=${ent.transform.x}`);
    ok(`${deg} deg: ends up sliding`, body.sliding === true);
    const speed = Math.hypot(body.vx, body.vy);
    ok(`${deg} deg: downhill speed caps at slideMaxSpeed`, Math.abs(speed - P.slideMaxSpeed) < 1e-3, `speed=${speed}`);
    ok(`${deg} deg: sliding downhill (x decreases, negative)`, ent.transform.x < -1, `x=${ent.transform.x}`);
    ok(`${deg} deg: z tracks h(x, y) exactly every step (grounded snap)`, maxHeightErr <= 1e-6, `err=${maxHeightErr}`);
  }

  // Hysteresis: a body standing on an UNDECIDED slope (between 45 and 50
  // deg) with no horizontal input never starts sliding purely from nz - and
  // flipping the flag exactly once as the slope crosses 50 -> stays past 45
  // is exercised directly against the config thresholds (no per-frame
  // terrain regeneration needed - see the two fixed-angle runs above for
  // the "sets" and "never sets" cases; this checks the flag flips exactly
  // once within a single 51 deg run, never chattering back to false once
  // sliding, since nz for a fixed 51 deg slope (0.629) stays under BOTH
  // slideStartCos (0.643) and slideStopCos (0.707)).
  {
    const { flips } = runSlope(51, +1, 600);
    ok('51 deg run: sliding flips exactly once (false -> true, never chatters back)', flips === 1, `flips=${flips}`);
  }

  // Downhill drive at 60 deg: speed still caps at slideMaxSpeed (the slide
  // accel and the wish-driven accel share the same cap via clamp-to-speed).
  {
    const { ent, body } = runSlope(60, -1, 600);
    ok('60 deg downhill drive: x decreases', ent.transform.x < -1);
    const speed = Math.hypot(body.vx, body.vy);
    ok('60 deg downhill drive: speed caps at slideMaxSpeed', speed <= P.slideMaxSpeed + 1e-3, `speed=${speed}`);
  }
}

// =============================================================================
// 4. Ground-contact AC (23.3): 1000 seeded random spawns inside the real
//    world_m1 near band at groundAt + 1.5, each 600 steps of random wish
//    input incl. jumps. z >= groundAt(x, y) - 0.01 after every step, no NaN,
//    position stays within bounds.r.
// =============================================================================
{
  const world = World.load(assets.world('world_m1'), assets, {});
  ok('world_m1 near band ready before the spawn test', world.terrain.nearReady === true);
  const b = world.bounds;
  ok('world_m1 has bounds (23.2 content)', !!b);

  const rand = mulberry32(0xC0FFEE);
  const N_SPAWNS = 1000;
  const N_STEPS = 600;
  let worstBelow = 0;
  let sawNaN = false;
  let sawOutsideBounds = false;

  for (let s = 0; s < N_SPAWNS; s++) {
    // Uniform-ish random point inside the bound circle (rejection-free: polar
    // with sqrt for area-uniformity - fine for a coverage test, no bias risk),
    // resampled clear of any placed structure (the tower sits inside the
    // bound - AC 23.3's "ground test" is about terrain physics, and a spawn
    // inside the tower's own Level sectors has a wholly different floorH by
    // design, not a terrain violation).
    let x, y;
    for (let tries = 0; tries < 50; tries++) {
      const ang = rand() * 2 * Math.PI;
      const rr = Math.sqrt(rand()) * (b.r - PHYSICS_DEFAULTS.radius - 0.5); // keep clear of the very edge
      x = b.x + Math.cos(ang) * rr;
      y = b.y + Math.sin(ang) * rr;
      if (world.structureAt(x, y) === null) break;
    }
    const z0 = world.floorAt(x, y) + 1.5;
    const ent = makeBody(x, y, z0, false);
    const body = ent.components.body;
    body.peakZ = z0;

    const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0 };
    for (let i = 0; i < N_STEPS; i++) {
      controls.forward = rand() * 2 - 1;
      controls.strafe = rand() * 2 - 1;
      controls.run = rand() < 0.5;
      controls.jump = rand() < 0.05;
      controls.yawDeg = rand() * 360;
      integrate(ent, DT, controls, world, P);

      if (!finite(ent.transform) || !Number.isFinite(body.vx) || !Number.isFinite(body.vy) || !Number.isFinite(body.vz)) {
        sawNaN = true;
      }
      // AC wording is `groundAt` (terrain); a wandering spawn can cross into
      // the tower's own Level sectors mid-run, where `floorAt` (structure
      // floor) is the correct oracle instead - same substitution `outsideSector`
      // itself makes (23.1 decision 2).
      const g = world.floorAt(ent.transform.x, ent.transform.y);
      const below = g - 0.01 - ent.transform.z;
      if (below > worstBelow) worstBelow = below;
      const d = Math.hypot(ent.transform.x - b.x, ent.transform.y - b.y);
      if (d > b.r + 1e-6) sawOutsideBounds = true;
    }
  }

  ok('1000-spawn ground test: no NaN ever', !sawNaN);
  ok('1000-spawn ground test: z >= groundAt(x, y) - 0.01 every step', worstBelow <= 0, `worst violation ${worstBelow} m`);
  ok('1000-spawn ground test: position always within bounds.r', !sawOutsideBounds);
}

// =============================================================================
if (fail === 0) {
  console.log(`ALL PASS (${pass})`);
  process.exit(0);
} else {
  console.error(`${fail} FAILURES (of ${pass + fail}):`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
