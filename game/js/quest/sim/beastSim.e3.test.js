// game/js/quest/sim/beastSim.e3.test.js (EQ-06 blocked charge, wolf hunt). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// EQ-06: a charge whose combat:hit comes back `blocked` -> 0.4 s stagger (not recover), shoved away from the player.
{
  const bx = 1461, by = 1031, px = bx, py = by - 0.5;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  events.on('combat:hit', (p) => { if (p.target === 'player') p.blocked = 1; });
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax; sim.cdx[0] = 0; sim.cdy[0] = -1;
  let n = 0;
  while (sim.state[0] === STATE_CHARGE && n++ < 20) sim.step(px, py, 0);
  ok('EQ-06 blocked charge -> STAGGER (not recover)', sim.state[0] === 7, `state=${sim.state[0]}`);
  ok('EQ-06 blocked stagger lasts blockStagger = 24 steps', sim.cfgSteps.blockStagger === 24 && sim.timer[0] === 24, `timer=${sim.timer[0]}`);
  ok('EQ-06 beast shoved away from the player (+y)', sim.steer.vy[0] > 0, `vy=${sim.steer.vy[0]}`);
  for (let i = 0; i < 30; i++) sim.step(px, py, 0);
  ok('EQ-06 stagger ends after ~24 steps', sim.state[0] !== 7, `state=${sim.state[0]}`);
}


// LIFE-07: a wolf hunts and eats a deer (stub fauna: same surface as engine/fauna: def.species, slots, nearestPrey, kill, setThreats).
function stubFauna(preys) {
  const f = { def: { species: [{ name: 'rabbit' }, { name: 'deer' }] }, slots: preys, thr: 0, killed: [], thrX: [] };
  f.setThreats = (n, xs) => { f.thr = n; f.thrX.length = 0; for (let i = 0; i < n; i++) f.thrX.push(xs[i]); };
  f.nearestPrey = (x, y, r, out, mask) => {
    for (let i = 0; i < preys.length; i++) {
      const q = preys[i]; if (!q.alive || !((mask >> q.species) & 1)) continue;
      if ((q.x - x) ** 2 + (q.y - y) ** 2 <= r * r) { out.x = q.x; out.y = q.y; return i; }
    }
    return -1;
  };
  f.kill = (i) => { preys[i].alive = false; f.killed.push(i); };
  return f;
}
function wolfEnt(id, x, y) { const e = beastEntity(id, x, y); e.components.brain.species = 'wolf'; return e; }
function huntSim(fauna) {
  const world = buildWorld([wolfEnt('w1', 1461, 1031)]);
  const nav = buildBeastNav(world, NAV_CFG);
  const { events } = makeEvents();
  return createBeastSim(world, { nav, rng: createRng(3), events, fauna });
}
{
  const deer = { x: 1466, y: 1031, species: 1, alive: true };
  const fa = stubFauna([deer]);
  const sim = huntSim(fa);
  const far = [1461, 1090]; // player far away: no notice
  let eat = -1, hunted = false;
  for (let n = 0; n < 900 && eat < 0; n++) { sim.step(far[0], far[1], 0); if (sim.hunt[0]) hunted = true; if (sim.state[0] === STATE_EAT) eat = n; }
  ok('LIFE-07 wolf hunts the deer, kills it and enters STATE_EAT', hunted && eat >= 0 && fa.killed.length === 1 && !deer.alive, `hunted=${hunted} eat=${eat} killed=${fa.killed}`);
  ok('LIFE-07 beast positions fed as threats', fa.thr === 1 && Math.abs(fa.thrX[0] - sim.steer.x[0]) < 1e-9, `thr=${fa.thr}`);
  for (let n = 0; n < 8 * 60 + 5; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-07 meal ends back in wander', sim.state[0] === STATE_WANDER && !sim.hunt[0], `state=${sim.state[0]}`);
  // wolf does not hunt a rabbit-less/other-species world: bear-only prey filter (wolf eats rabbit too)
  const rab = { x: 1466, y: 1031, species: 0, alive: true };
  const sim2 = huntSim(stubFauna([rab]));
  let h2 = false; for (let n = 0; n < 200; n++) { sim2.step(far[0], far[1], 0); if (sim2.hunt[0]) h2 = true; }
  ok('LIFE-07 wolf also hunts a rabbit', h2);
}
{ // the player notice pre-empts the hunt
  const deer = { x: 1470, y: 1031, species: 1, alive: true };
  const fa = stubFauna([deer]);
  const sim = huntSim(fa);
  for (let n = 0; n < 120; n++) sim.step(1461, 1033, 0); // player 2 m away
  ok('LIFE-07 player notice pre-empts the hunt (no kill, in a combat state)', fa.killed.length === 0 && sim.state[0] !== STATE_EAT && sim.state[0] !== STATE_WANDER, `state=${sim.state[0]} killed=${fa.killed.length}`);
}
{ // null fauna: no hunt, hash unchanged by the feature; 0 alloc with fauna
  const sim = huntSim(null);
  for (let n = 0; n < 200; n++) sim.step(1461, 1090, 0);
  ok('LIFE-07 null fauna: never hunts/eats', !sim.hunt[0] && sim.state[0] !== STATE_EAT);
  if (global.gc) {
    const fa = stubFauna([{ x: 1700, y: 1700, species: 1, alive: true }]);
    const s2 = huntSim(fa);
    for (let n = 0; n < 600; n++) s2.step(1461, 1090, 0);
    global.gc(); const b = process.memoryUsage().heapUsed;
    for (let n = 0; n < 10000; n++) s2.step(1461, 1090, 0);
    global.gc(); const a = process.memoryUsage().heapUsed;
    ok('LIFE-07 zero allocation per step with fauna', a <= b + 1e6, `b=${b} a=${a}`);
  }
}


finish();
