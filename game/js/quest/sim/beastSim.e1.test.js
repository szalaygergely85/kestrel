// game/js/quest/sim/beastSim.e1.test.js (perceive/leash). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ---------------------------------------------------------------------------------------------------------------
// BEAST-PERCEIVE-01w (taken from lane C, offline): engine/nav perceive + leash through the beastSim adapter.
// ---------------------------------------------------------------------------------------------------------------
{
  const mk = (ents, cfg) => {
    const world = buildWorld(ents);
    const nav = buildBeastNav(world, NAV_CFG);
    const { events } = makeEvents();
    const sim = createBeastSim(world, { nav, rng: createRng(5), events, cfg });
    return { world, sim };
  };
  const SIGHT_ID = (sim) => { sim.fx[0] = 0; sim.fy[0] = 1; }; // face +y (toward the tower-side player below)

  // P1. Perception gating: the wall blocks sight, the same distance in the open field is noticed.
  {
    const bx = 1481, by = 1017, px = 1489, py = 1024; // 10.6 m, inside the 12 m notice range, tower in between
    const { world, sim } = mk([beastEntity('b1', bx, by)]);
    ok('P1 sanity: LOS tower-blocked, d in (nearR, noticeR)',
      !hasLineOfSight(world, bx, by, 2.5, px, py, 2.5) && Math.hypot(px - bx, py - by) > 3 && Math.hypot(px - bx, py - by) < 12);
    SIGHT_ID(sim);
    let noticed = false;
    for (let i = 0; i < 90; i++) { sim.step(px, py, groundZ(world, px, py)); if (sim.state[0] === STATE_NOTICE || sim.state[0] === STATE_CHASE) noticed = true; }
    ok('P1 behind a wall (in range + in cone) = no aggro', !noticed, `state=${sim.state[0]}`);
    const f = mk([beastEntity('b1', 1461, 1031)]);
    f.sim.fx[0] = 0; f.sim.fy[0] = -1;
    let seen = false;
    for (let i = 0; i < 90; i++) { f.sim.step(1461, 1021, groundZ(f.world, 1461, 1021)); if (f.sim.state[0] === STATE_NOTICE || f.sim.state[0] === STATE_CHASE) seen = true; }
    ok('P1 control: same range in the open field = aggro', seen);
  }

  // P2. Hearing: noise scales the any-direction bubble (nearR 3 m): sprint x2 -> 6 m, swing x1.5 -> 4.5 m; no LOS or cone needed.
  {
    const bx = 1461, by = 1031;
    const run = (dist, noise) => {
      const { world, sim } = mk([beastEntity('b1', bx, by)]);
      sim.fx[0] = 0; sim.fy[0] = -1; sim.noise = noise;
      const py = by + dist; // behind the beast (facing north)
      for (let i = 0; i < 3; i++) sim.step(bx, py, groundZ(world, bx, py));
      return sim.state[0] === STATE_NOTICE;
    };
    ok('P2 walking 5 m behind: not heard', !run(5, 1));
    ok('P2 sprinting (x2) 5 m behind: heard', run(5, NOISE_SPRINT));
    ok('P2 swinging (x1.5) 4 m behind: heard, walking 4 m: not', run(4, NOISE_SWING) && !run(4, 1));
    ok('P2 sprint is heard from 2x the walking distance', run(5.9, NOISE_SPRINT) && !run(6.1, NOISE_SPRINT));
  }

  // P3. Leash return: a boar chasing past leashR (8 m) from home turns back and walks home.
  {
    const hx = 1461, hy = 1031;
    const { world, sim } = mk([beastEntity('b1', hx, hy)], { leashR: 8 });
    sim.state[0] = STATE_CHASE;
    let retAt = -1, d = 0;
    for (let i = 1; i <= 600 && retAt < 0; i++) {
      sim.step(hx, hy - 15, groundZ(world, hx, hy - 15)); // player 15 m north of home (inside loseR 20)
      if (sim.state[0] === STATE_RETURN) { retAt = i; d = Math.hypot(sim.steer.x[0] - hx, sim.steer.y[0] - hy); }
    }
    ok('P3 leash: returned once past leashR', retAt > 0 && d > 8 && d < 10, `retAt=${retAt} d=${d}`);
    let home = false;
    for (let i = 0; i < 2000 && !home; i++) { sim.step(hx, hy + 40, groundZ(world, hx, hy)); home = sim.state[0] === STATE_WANDER; }
    ok('P3 leash: back home in wander', home, `state=${sim.state[0]}`);
  }

  // P4. Give-up: engaged longer than giveUpSec -> walks home and ignores a player standing right there until home.
  {
    const hx = 1461, hy = 1031;
    const { world, sim } = mk([beastEntity('b1', hx, hy)], { giveUpSec: 1 });
    sim.state[0] = STATE_CHASE;
    const px = hx, py = hy - 8, pz = groundZ(world, px, py);
    let retAt = -1;
    for (let i = 1; i <= 900 && retAt < 0; i++) { sim.step(px, py, pz); if (sim.state[0] === STATE_RETURN) retAt = i; }
    ok('P4 give-up: boar quits the fight after ~1 s engaged (+ finishing its charge)', retAt > 55 && retAt < 400, `retAt=${retAt}`);
    let reaggro = false, home = false;
    for (let i = 0; i < 2000 && !home; i++) {
      sim.step(sim.steer.x[0], sim.steer.y[0] - 2, pz); // player glued 2 m in front of the boar the whole way home
      if (sim.state[0] === STATE_NOTICE || sim.state[0] === STATE_CHASE) reaggro = true;
      home = sim.state[0] === STATE_WANDER;
    }
    ok('P4 give-up: ignores the player on the way home, ends in wander', !reaggro && home, `reaggro=${reaggro} home=${home}`);
  }

  // P6. DRESS-01b: a `temperament:'wary'` (ambient) boar ignores a player 8 m away (a normal boar notices), and
  // a hit turns it into a normal fighter.
  {
    const wary = beastEntity('amb', 1455, 1028); wary.components.brain.temperament = 'wary';
    const { world, sim } = mk([wary, beastEntity('q', 1455, 1028)]);
    const pz = groundZ(world, 1455, 1038);
    sim.fx[0] = 0; sim.fy[0] = 1; sim.fx[1] = 0; sim.fy[1] = 1;
    let engW = false, engQ = false;
    for (let i = 0; i < 300; i++) {
      sim.step(1455, 1036, pz); // 8 m away: inside noticeR 12, outside calmNoticeR 5
      if (sim.state[0] === STATE_CHASE || sim.state[0] === STATE_NOTICE) engW = true;
      if (sim.state[1] === STATE_CHASE || sim.state[1] === STATE_NOTICE) engQ = true;
      sim.fx[0] = 0; sim.fy[0] = 1; sim.fx[1] = 0; sim.fy[1] = 1;
    }
    ok('P6 wary boar ignores a player at 8 m, plain boar notices', !engW && engQ, `wary=${engW} plain=${engQ}`);
  }

  // P5. Zero allocation with the adapter, noise and leash active.
  {
    const { world, sim } = mk([beastEntity('a', 1455, 1028), beastEntity('b', 1460, 1030)], { leashR: 12, giveUpSec: 4 });
    const pz = groundZ(world, 1465, 1025);
    for (let i = 0; i < 600; i++) sim.step(1465, 1025, pz);
    if (global.gc) {
      global.gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 10000; i++) { sim.noise = (i & 1) ? NOISE_SPRINT : 1; sim.step(1465 + (i % 7), 1025, pz); }
      global.gc();
      const after = process.memoryUsage().heapUsed;
      ok('P5 zero allocation over 10k steps (perceive + leash adapter)', after <= before + 1e6, `before=${before} after=${after}`);
    } else console.log('(skip) P5 alloc check needs --expose-gc');
  }
}


finish();
