// game/js/quest/sim/beastSim.a2.test.js (scripted chases). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// 2. 5 scripted chases from the far side of the tower reach contact within 30 s; the beast is never in a cost-0
//    cell, and z stays within 0.1 m of supportAt.
// ---------------------------------------------------------------------------------------------------------------
{
  // Each pair is verified LOS-blocked by the tower (a corner or the full depth between them) and within loseR (20
  // m, so a forced CHASE start does not immediately exit via the "d > loseR" rule) - the beast must route around
  // the tower's footprint (never through it) to close the distance.
  const farSideRuns = [
    [1476, 1016, 1484, 1034],
    [1477, 1015, 1485, 1033],
    [1508, 1016, 1500, 1034],
    [1507, 1015, 1499, 1033],
    [1481, 1017, 1481, 1033],
  ];
  let allReached = true;
  for (let t = 0; t < farSideRuns.length; t++) {
    const [beastX, beastY, px, py] = farSideRuns[t];
    const { world, sim, nav } = freshSim([beastEntity('b1', beastX, beastY)], 10 + t);
    sim.state[0] = STATE_CHASE;
    const pz = groundZ(world, px, py);
    let hit = false, badCell = false, badZ = false;
    for (let i = 0; i < 1800 && !hit; i++) { // 30 s @ 60 Hz
      sim.step(px, py, pz);
      const cx = nav.grid.cellX(sim.steer.x[0]), cy = nav.grid.cellY(sim.steer.y[0]);
      if (nav.grid.inBounds(cx, cy) && nav.grid.cost[nav.grid.index(cx, cy)] === 0) badCell = true;
      const support = world.supportAt(sim.steer.x[0], sim.steer.y[0], sim.entities[0].transform.z + 0.6, true, { height: 0, stepUpMax: 1.0, walkCos: -1 });
      if (Math.abs(sim.entities[0].transform.z - support.floorH) > 0.1) badZ = true;
      hit = sim.state[0] === STATE_RECOVER; // contact (not timeout/wall - checked via distance below)
    }
    const d = Math.hypot(px - sim.steer.x[0], py - sim.steer.y[0]);
    const contactR = 0.45 + 0.3 + 0.1;
    const reachedByContact = hit && d <= contactR + 0.5; // small slop for the step the contact landed on
    if (!reachedByContact || badCell || badZ) {
      allReached = false;
      failures.push(`chase ${t} to (${px},${py}): reached=${reachedByContact} badCell=${badCell} badZ=${badZ} finalD=${d.toFixed(2)}`);
    }
  }
  ok('5 scripted chases from the far side of the tower reach contact within 30 s, never in a cost-0 cell, z within 0.1 m of supportAt', allReached);
}


finish();
