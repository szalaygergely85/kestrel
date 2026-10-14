// game/js/quest/sim/beastSim.d1.test.js (de-overlap/charger 1). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ===============================================================================================================
// US-079c (backlog row US-079c + BUG-BOAR-OVERLAP): hard pairwise de-overlap, one charger at a time, 5 HP charge
// contact, windup scrape emit.
// ===============================================================================================================

{
  // BUG-BOAR-OVERLAP: two boars charging the same point never get closer than rA+rB-1e-3.
  const bx = 1461, by = 1031;
  const px = bx - 30, py = by; // open field west of the tower: neither reaches the player in one charge
  const { sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 0.2)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.steer.x[1] = bx; sim.steer.y[1] = by + 0.2;
  sim.state[0] = STATE_CHARGE; sim.state[1] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax; sim.timer[1] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = -1; sim.cdy[0] = 0;
  sim.cdx[1] = -1; sim.cdy[1] = 0;
  let minD = Infinity;
  for (let k = 0; k < 240; k++) {
    sim.step(px, py, 0);
    const d = Math.hypot(sim.steer.x[1] - sim.steer.x[0], sim.steer.y[1] - sim.steer.y[0]);
    if (d < minD) minD = d;
  }
  ok('two charging boars never closer than rA+rB-1e-3', minD >= 2 * BOAR_R - 1e-3, `minD=${minD.toFixed(6)}`);
}

{
  // BUG-BOAR-OVERLAP: two idle boars spawned overlapping separate within 30 ticks.
  const bx = 1461, by = 1031;
  const { sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)]);
  sim.timer[0] = 1000; sim.timer[1] = 1000; // keep them in the wander pause (no wander movement)
  let separatedAt = -1;
  for (let k = 1; k <= 30; k++) {
    sim.step(1e6, 1e6, 0);
    const d = Math.hypot(sim.steer.x[1] - sim.steer.x[0], sim.steer.y[1] - sim.steer.y[0]);
    if (d >= 2 * BOAR_R - 1e-3) { separatedAt = k; break; }
  }
  ok('two idle overlapping boars separate within 30 ticks', separatedAt > 0, `separatedAt=${separatedAt}`);
}

{
  // BUG-BOAR-OVERLAP: the de-overlap is deterministic (two fresh overlapping runs reach the same hash).
  const bx = 1461, by = 1031;
  const setup = (s) => {
    s.steer.x[0] = bx; s.steer.y[0] = by;
    s.steer.x[1] = bx; s.steer.y[1] = by + 0.2;
    s.state[0] = STATE_CHARGE; s.state[1] = STATE_CHARGE;
    s.timer[0] = s.cfgSteps.chargeMax; s.timer[1] = s.cfgSteps.chargeMax;
    s.cdx[0] = -1; s.cdy[0] = 0;
    s.cdx[1] = -1; s.cdy[1] = 0;
  };
  const a = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)], 77);
  const b = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)], 77);
  setup(a.sim); setup(b.sim);
  for (let k = 0; k < 120; k++) {
    a.sim.step(bx - 30, by, 0);
    b.sim.step(bx - 30, by, 0);
  }
  ok('de-overlap replay hash stable (two fresh overlapping runs identical)',
    hashAt(a.sim, a.sim.steer, a.sim.tick, a.rng) === hashAt(b.sim, b.sim.steer, b.sim.tick, b.rng));
}

{
  // BUG-BOAR-OVERLAP / 37.16.2: the de-overlap skips inactive (dead) steer slots.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 0.1)]);
  events.emit('combat:hit', { source: 'player', target: 'b2', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(1e6, 1e6, 0); // emit beast:died + stepDead; b2's steer agent is removed (active 0, x/y zeroed)
  ok('the killed slot is an inactive steer agent', sim.steer.active[1] === 0);
  const deadX = sim.entities[1].transform.x, deadY = sim.entities[1].transform.y;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = -1; sim.cdy[0] = 0; // charge west (open field)
  for (let k = 0; k < 60; k++) sim.step(1431, 1031, 0);
  ok('the dead slot is skipped by de-overlap (its transform stays at the death spot)',
    sim.entities[1].transform.x === deadX && sim.entities[1].transform.y === deadY,
    `moved to ${sim.entities[1].transform.x},${sim.entities[1].transform.y} from ${deadX},${deadY}`);
}


finish();
