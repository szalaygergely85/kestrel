// game/js/quest/sim/beastSim.a1.test.js (scripted transitions). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ---------------------------------------------------------------------------------------------------------------
// 0. createBeastSim returns null with no beast entities.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([]);
  const nav = buildBeastNav(world, NAV_CFG);
  const sim = createBeastSim(world, { nav, rng: createRng(1), events: { emit() {} } });
  ok('createBeastSim returns null with no components.brain entities', sim === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 0b. Q9 item 4: beast entities present but no `nav` block (main.js only builds one from `worldDef.nav`) -> warns
//     and returns null instead of throwing on `nav.grid`.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([beastEntity('boar1', 1500, 1050)]);
  const origWarn = console.warn; let warned = false;
  console.warn = () => { warned = true; };
  let threw = false;
  let sim;
  try { sim = createBeastSim(world, { nav: undefined, rng: createRng(1), events: { emit() {} } }); } catch { threw = true; }
  console.warn = origWarn;
  ok('no nav block: does not throw', !threw);
  ok('no nav block: returns null', sim === null);
  ok('no nav block: warns once', warned);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Scripted transitions.
// ---------------------------------------------------------------------------------------------------------------
{
  // 1a. In cone: beast facing north (default), player 10 m north, inside the 120 deg cone and noticeR -> notice.
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const px = 1461, py = 1021, pz = groundZ(world, px, py);
  sim.step(px, py, pz);
  ok('in cone + in range + LOS -> notice on the first sampled step', sim.state[0] === STATE_NOTICE, `state=${sim.state[0]}`);
}
{
  // 1b. Out of cone: player 10 m SOUTH of a north-facing beast (outside the 120 deg cone, outside nearR) -> no notice.
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const px = 1461, py = 1041, pz = groundZ(world, px, py);
  for (let i = 0; i < 30; i++) sim.step(px, py, pz);
  ok('out of cone, beyond nearR -> stays wander', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}
{
  // 1c. Behind the tower: the player's goal point is INSIDE the tower footprint (a cost-0 cell - genuinely
  // unreachable, not just far) so the chase's A* path gets the beast only as close as the wall allows and it
  // stalls there, within loseR (12 m) but never with line of sight (solid structure in the way): the only way out
  // is the loseSightSec timer (toSteps(5) = 300 steps) -> return. This also covers "hidden 5 s" (29.1's two
  // bullets collapse into one scenario here: the tower footprint is wider (24 m) and deeper (14 m) than noticeR
  // (12 m), so no pair of points on opposite sides of it can ever be within NOTICE range in the first place -
  // only a stuck chase, gated by the larger loseR=20 m, can ever exercise this occlusion end to end).
  const bx = 1481, by = 1017, px = 1490, py = 1025; // px,py inside the tower bbox (1480..1504, 1018..1032)
  ok('sanity: the chosen player point is LOS-blocked by the tower, within loseR, and NOT inside windupR',
    !hasLineOfSight(buildWorld([]), bx, by, 2.5, px, py, 2.5)
    && Math.hypot(px - bx, py - by) <= 20 && Math.hypot(px - bx, py - by) > 5);

  const { world, sim } = freshSim([beastEntity('b1', bx, by)]);
  sim.state[0] = STATE_CHASE;
  sim.goalX[0] = px; sim.goalY[0] = py;
  const pz = groundZ(world, bx, by); // the player's z is irrelevant here (inside the tower, off the hillside terrain)
  let returnedAtStep = -1;
  for (let i = 1; i <= 310; i++) {
    sim.step(px, py, pz);
    if (sim.state[0] === STATE_RETURN) { returnedAtStep = i; break; }
    if (i === 290) ok('still chasing well before 5 s unseen', sim.state[0] === STATE_CHASE, `state=${sim.state[0]} at step ${i}`);
  }
  ok('LOS blocked by the tower, stuck at the wall, for 5 s (300 steps) -> return', returnedAtStep > 0 && returnedAtStep <= 301, `returnedAtStep=${returnedAtStep}`);
}
{
  // 1d. > 20 m: chasing beast, player suddenly > loseR away -> return immediately (next step).
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  sim.state[0] = STATE_CHASE;
  const px = 1461, py = 1031 - 25, pz = groundZ(world, px, py); // 25 m away, open field (well beyond loseR)
  sim.step(px, py, pz);
  ok('> 20 m away -> return', sim.state[0] === STATE_RETURN, `state=${sim.state[0]}`);
}
{
  // 1e. Wall hit: forced charge straight into the tower's west wall from just outside it - steering cannot enter
  // the structure's cost-0 cells, so the beast stalls and, from charge step 4 on, two slow steps in a row -> recover
  // (2.0 s, longer than a normal charge-end recover).
  const bx = 1476, by = 1025;
  const { sim } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 1; sim.cdy[0] = 0; // straight east, into the tower (west wall at x=1480)
  let recoveredAt = -1, recoverTimerAtEntry = 0;
  for (let i = 1; i <= 60; i++) {
    sim.step(1e6, 1e6, 0); // player far away and irrelevant to this scenario
    if (sim.state[0] === STATE_RECOVER) { recoveredAt = i; recoverTimerAtEntry = sim.timer[0]; break; }
  }
  ok('charging into the tower wall -> recover', recoveredAt > 0, `recoveredAt=${recoveredAt}`);
  ok('a wall-hit recover uses recoverWallSec (2.0 s), not the shorter normal recoverSec',
    recoverTimerAtEntry === sim.cfgSteps.recoverWall, `timer=${recoverTimerAtEntry} wall=${sim.cfgSteps.recoverWall} normal=${sim.cfgSteps.recover}`);
}
{
  // 1f. Contact: forced charge straight at a player standing within contact range -> exactly one combat:hit, then
  // recover (the shorter, non-wall recoverSec).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5; // 0.5 m north, inside radius(0.45)+PHYSICS.radius(0.3)+0.1
  const { sim, hits } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight toward the player
  for (let i = 0; i < 10; i++) sim.step(px, py, 0);
  ok('contact sends exactly one combat:hit', hits.length === 1, `hits=${JSON.stringify(hits)}`);
  ok('the hit payload shape matches {source, target:"player", damage:1}',
    hits[0] && hits[0].source === 'b1' && hits[0].target === 'player' && hits[0].damage === 1);
  ok('contact -> recover (normal recoverSec, not the wall one)', sim.state[0] === STATE_RECOVER && sim.timer[0] <= sim.cfgSteps.recover);
}

// ---------------------------------------------------------------------------------------------------------------

finish();
