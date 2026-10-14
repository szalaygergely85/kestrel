// game/js/quest/sim/beastSim.e2.test.js (goals). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

function wolfEnt(id, x, y) { const e = beastEntity(id, x, y); e.components.brain.species = 'wolf'; return e; }

// ---- LIFE-08 (38.56 d): setGoal / clearGoal / setAltTargets ----------------------------------------------------
function goalSim() {
  const world = buildWorld([wolfEnt('w1', 1461, 1031)]);
  const nav = buildBeastNav(world, NAV_CFG);
  const ev = makeEvents();
  const sim = createBeastSim(world, { nav, rng: createRng(3), events: ev.events });
  return { sim, ev };
}
{
  const far = [1461, 1100];
  const { sim } = goalSim();
  sim.setGoal(0, 1473, 1033);
  let arrived = -1;
  for (let n = 0; n < 1200 && arrived < 0; n++) { sim.step(far[0], far[1], 0); if (sim.atGoal(0)) arrived = n; }
  ok('LIFE-08 setGoal: wolf travels to the goal and holds', arrived >= 0 && sim.hasGoal(0), 'arrived=' + arrived);
  for (let n = 0; n < 300; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 setGoal: still at the goal after 5 s (no wander)', sim.atGoal(0) && sim.state[0] === STATE_WANDER);
  // alt target: nearer than the player -> chase, altHit event, then cooldown
  const hits = [];
  sim.events.on('beast:altHit', (p) => hits.push(p.alt + ':' + p.id));
  const ax = [1476], ay = [1033];
  sim.setAltTargets(1, ax, ay);
  for (let n = 0; n < 300; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 alt target hit emits beast:altHit once per cooldown', hits.length === 1 && hits[0] === '0:w1', JSON.stringify(hits));
  for (let n = 0; n < 6 * 60; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 alt target hit again after the 6 s cooldown', hits.length >= 2, 'hits=' + hits.length);
  sim.setAltTargets(0, ax, ay);
  const nh = hits.length;
  for (let n = 0; n < 900; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 setAltTargets(0) stops the hits', hits.length === nh);
  sim.clearGoal(0);
  ok('LIFE-08 clearGoal: flag off, wolf returns home', !sim.hasGoal(0) && sim.state[0] === STATE_RETURN, 'st=' + sim.state[0]);
  // player nearer than the alt: no altHit, normal notice
  const g2 = goalSim();
  g2.sim.setGoal(0, 1473, 1033);
  const hits2 = [];
  g2.sim.events.on('beast:altHit', (p) => hits2.push(p.alt));
  g2.sim.setAltTargets(1, [1465], [1031]);
  for (let n = 0; n < 240; n++) g2.sim.step(1462, 1031, 0); // player 1 m away, alt 4 m
  ok('LIFE-08 player nearer than the alt: no altHit', hits2.length === 0 && g2.sim.state[0] !== STATE_WANDER, 'st=' + g2.sim.state[0]);
  if (global.gc) {
    const g3 = goalSim(); g3.sim.setGoal(0, 1473, 1033); g3.sim.setAltTargets(1, ax, ay);
    for (let n = 0; n < 600; n++) g3.sim.step(far[0], far[1], 0);
    global.gc(); const b = process.memoryUsage().heapUsed;
    for (let n = 0; n < 10000; n++) g3.sim.step(far[0], far[1], 0);
    global.gc(); const a = process.memoryUsage().heapUsed;
    ok('LIFE-08 zero allocation per step with goal + alt', a <= b + 1e6, 'b=' + b + ' a=' + a);
  }
}

finish();
