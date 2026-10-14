// game/js/quest/sim/beastSim.d2.test.js (de-overlap/charger 2). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

{
  // Only one boar is in windup/charge at a time; the other waits (stays CHASE, holds position).
  const bx = 1461, by = 1031;
  const px = bx + 3, py = by; // 3 m east, within windupR (5 m), open field
  const { world, sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 1)]);
  sim.state[0] = STATE_CHASE; sim.state[1] = STATE_CHASE;
  sim.seen[0] = 1; sim.seen[1] = 1;
  let everTwo = false, sawOne = false;
  for (let k = 0; k < 300; k++) {
    sim.step(px, py, groundZ(world, px, py));
    let n = 0;
    for (let i = 0; i < 2; i++) if (sim.state[i] === STATE_WINDUP || sim.state[i] === STATE_CHARGE) n++;
    if (n > 1) everTwo = true;
    if (n === 1) sawOne = true;
  }
  ok('never two boars in windup/charge at once (300 steps)', !everTwo);
  ok('at least one boar winds up/charges (the fight actually runs)', sawOne);
}

{
  // A charge contact costs the player 5 HP (damage 1 * vitals beastDamageScale 5).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)]);
  const player = { id: 'player', transform: { x: px, y: py, z: groundZ(world, px, py) },
    components: { body: { grounded: true, speedScale: 1 } } };
  const vitals = createVitals(world, events, VITALS_DEFAULTS);
  vitals.step(player, false); // establish the player ref + health before the hit
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight north at the player
  for (let k = 0; k < 10; k++) {
    sim.step(px, py, groundZ(world, px, py));
    vitals.step(player, false);
  }
  ok('a charge contact costs 5 HP (30 -> 25)', vitals.hp === 25, `hp=${vitals.hp}`);
}

{
  // Windup emits beast:scrape at steps 9/18/27 (150/300/450 ms), thrown backward from the forefeet.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  const scrapes = [];
  events.on('beast:scrape', (p) => scrapes.push({ x: p.x, y: p.y, z: p.z, dirX: p.dirX, dirY: p.dirY, dirZ: p.dirZ, fx: sim.fx[0], fy: sim.fy[0] }));
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  for (let k = 0; k < sim.cfgSteps.windup; k++) sim.step(bx, by - 10, 0);
  ok('windup emits exactly 3 beast:scrape events (150/300/450 ms)', scrapes.length === 3, `n=${scrapes.length}`);
  const okScrape = scrapes.length === 3 && scrapes.every((s) =>
    Math.abs(s.x - (bx + s.fx * 0.45)) < 1e-9
    && Math.abs(s.y - (by + s.fy * 0.45)) < 1e-9
    && Math.abs(s.dirX - (-s.fx * 0.8)) < 1e-9
    && Math.abs(s.dirY - (-s.fy * 0.8)) < 1e-9
    && Math.abs(s.dirZ - 0.6) < 1e-9);
  ok('scrape is at the forefeet (0.45 m forward) thrown backward (-facing*0.8, z 0.6)', okScrape, JSON.stringify(scrapes));
}


finish();
