// game/js/quest/sim/beastSim.b2.test.js (sword hits, body impulses). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// Q16 US-078d: drive real sword hits through mesh World queries and the beast's listener/steering.

for (const hand of ['left', 'right']) for (const initialState of [STATE_WINDUP, STATE_CHARGE]) {
  const { world, sim, hits, events } = freshSim([beastEntity('b1', 1461, 1031)], 71, 'mesh');
  const fx = 0.6, fy = 0.8;
  const p = swordPlayer(world, 1461 - fx * 0.9, 1031 - fy * 0.9);
  world.state['tower.sword.taken'] = true;
  let manaCalls = 0;
  const sword = createSwordSim(world, events, { ...SWORD_CFG, hand }, {
    spendMana(n) { manaCalls++; return n === 4; },
  });
  sword.step(p, fx, fy, true);
  for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, fx, fy, true);
  sword.step(p, fx, fy, false);
  const label = `${hand} hard from state ${initialState}`;
  ok(`${label}: release enters hard and spends mana once`, sword.state === ST_HARD && manaCalls === 1);
  sim.state[0] = initialState;
  sim.timer[0] = initialState === STATE_CHARGE ? sim.cfgSteps.chargeMax : sim.cfgSteps.windup;
  sim.cdx[0] = fx; sim.cdy[0] = fy; // charge away from the player until the sword interrupts it
  let facingX = 0, facingY = 0, hitX = 0, hitY = 0;
  for (let i = 0; i < 16 && sim.state[0] !== STATE_STAGGER; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z); // actual main.js order
    facingX = sim.fx[0]; facingY = sim.fy[0];
    hitX = sim.steer.x[0]; hitY = sim.steer.y[0];
    sword.step(p, fx, fy, false);
  }
  const hit = hits.find(h => h.source === 'player');
  ok(`${label}: real arc/LOS hit enters stagger synchronously`, !!hit && sim.state[0] === STATE_STAGGER);
  ok(`${label}: payload is heavy damage 3 with a unit direction away from the player`, !!hit
    && hit.target === 'b1' && hit.damage === 3 && hit.heavy === 1
    && Math.abs(hit.dirX * hit.dirX + hit.dirY * hit.dirY - 1) < 1e-12
    && hit.dirX > 0 && hit.dirY > 0);
  ok(`${label}: timer 36, accel 12, no same-step displacement`, sim.timer[0] === 36
    && sim.steer.accel[0] === 12 && sim.steer.x[0] === hitX && sim.steer.y[0] === hitY);
  ok(`${label}: assigns 4 m/s rather than adding prior charge velocity`, !!hit
    && Math.abs(sim.steer.vx[0] - hit.dirX * 4) < 1e-12
    && Math.abs(sim.steer.vy[0] - hit.dirY * 4) < 1e-12);
  let frozenFacing = true;
  for (let i = 1; i <= 35; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z);
    sword.step(p, fx, fy, false);
    if (sim.fx[0] !== facingX || sim.fy[0] !== facingY) frozenFacing = false;
  }
  const distance = Math.hypot(sim.steer.x[0] - hitX, sim.steer.y[0] - hitY);
  // Euler deceleration: speeds 3.8, 3.6, ... 0.2 m/s over 19 moving steps; sum / 60 = 19/30 m.
  ok(`${label}: open-ground shove is 19/30 m and stops`, Math.abs(distance - 19 / 30) < 1e-9
    && Math.hypot(sim.steer.vx[0], sim.steer.vy[0]) < 1e-12, `distance=${distance}`);
  ok(`${label}: frozen facing and exactly 35 stagger steps so far`, frozenFacing
    && sim.state[0] === STATE_STAGGER && sim.timer[0] === 1);
  ok(`${label}: own-position waypoint, arrive 0, maxSpeed 4`, sim.steer.tx[0] === sim.steer.x[0]
    && sim.steer.ty[0] === sim.steer.y[0] && sim.steer.arriveR[0] === 0 && sim.steer.maxSpeed[0] === 4);
  ok(`${label}: one player hit, no charge contact, no repeat impulse during hit-stop`, hits.length === 1 && manaCalls === 1);
  sim.step(p.transform.x, p.transform.y, p.transform.z);
  ok(`${label}: seen target resumes chase on step 36`, sim.state[0] === STATE_CHASE);
  sword.dispose(); sim.dispose();
}

for (const manaShort of [false, true]) {
  const { world, sim, hits, events } = freshSim([beastEntity('b1', 1461, 1031)], 74, 'mesh');
  const p = swordPlayer(world, 1460.1, 1031);
  world.state['tower.sword.taken'] = true;
  let manaCalls = 0;
  const sword = createSwordSim(world, events, SWORD_CFG, { spendMana() { manaCalls++; return false; } });
  sword.step(p, 1, 0, true);
  if (manaShort) for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, 1, 0, true);
  sword.step(p, 1, 0, false);
  sim.state[0] = STATE_WINDUP; sim.timer[0] = sim.cfgSteps.windup;
  for (let i = 0; i < 16 && hits.length === 0; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z);
    sword.step(p, 1, 0, false);
  }
  const label = manaShort ? 'mana-short charged release' : 'tap';
  // US-079b: a light hit during WINDUP cancels the charge (enterRecover) rather than leaving the brain untouched.
  ok(`${label}: real sword hit is light damage 1 and cancels the windup (-> recover)`, hits.length === 1
    && hits[0].heavy === 0 && hits[0].damage === 1 && sim.state[0] === STATE_RECOVER);
  ok(`${label}: mana hook called only for charged release, no hard hit-stop`, manaCalls === (manaShort ? 1 : 0)
    && sword.frozen === 0);
  sword.dispose(); sim.dispose();
}

// Every prior alive state, including an already-staggered beast: heavy replaces velocity and resets the full timer.
// (The light-hit behaviour per state is US-079b now and covered by its own tests below; heavy knocks back from any
// state regardless.)
{
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)], 81, 'mesh');
  for (let state = STATE_WANDER; state <= STATE_STAGGER; state++) {
    sim.state[0] = state; sim.timer[0] = 7; sim.unseen[0] = 1;
    sim.steer.vx[0] = -7; sim.steer.vy[0] = 5; sim.steer.accel[0] = 70;
    emitHeavyHit(events, 'b1', 0.6, 0.8);
    ok(`state ${state}: heavy restarts stagger and clears charge wall counter`, sim.state[0] === STATE_STAGGER
      && sim.timer[0] === 36 && sim.unseen[0] === 0 && sim.steer.vx[0] === 2.4
      && sim.steer.vy[0] === 3.2 && sim.steer.accel[0] === 12);
  }
  for (let i = 0; i < 35; i++) sim.step(1e6, 1e6, 0);
  ok('unseen stagger remains active through step 35', sim.state[0] === STATE_STAGGER && sim.timer[0] === 1);
  sim.step(1e6, 1e6, 0);
  ok('unseen stagger resumes return on step 36', sim.state[0] === STATE_RETURN);
  sim.dispose();
}

{
  const a = freshSim([beastEntity('b1', 1461, 1031)], 82, 'mesh');
  emitHeavyHit(a.events, 'b1', 0.6, 0.8);
  for (let i = 0; i < 7; i++) a.sim.step(1460, 1030, groundZ(a.world, 1460, 1030));
  const b = freshSim([beastEntity('b1', 1461, 1031)], 82, 'mesh');
  b.rng.load(a.rng.save());
  b.sim.load(a.sim.save());
  ok('save/load mid-slide preserves stagger timer and current shove velocity', b.sim.state[0] === STATE_STAGGER
    && b.sim.timer[0] === 29 && b.sim.steer.vx[0] === a.sim.steer.vx[0] && b.sim.steer.vy[0] === a.sim.steer.vy[0]);
  let replayEqual = true;
  for (let i = 0; i < 29; i++) {
    a.sim.step(1460, 1030, groundZ(a.world, 1460, 1030));
    b.sim.step(1460, 1030, groundZ(b.world, 1460, 1030));
    if (hashAt(a.sim, a.sim.steer, a.sim.tick, a.rng) !== hashAt(b.sim, b.sim.steer, b.sim.tick, b.rng)) replayEqual = false;
  }
  ok('save/load mid-slide remains hash-identical through stagger end', replayEqual && b.sim.state[0] === STATE_CHASE);
  a.sim.dispose(); b.sim.dispose();
}

// Body targets use the generic 3 m/s impulse, then collide through the actual mesh capsule integrator.
{
  const def = { id: 'bodyTarget', type: 'npc', x: 1479.62, y: 1025, z: 'ground',
    components: { targetable: { radius: 0.3, height: 1.7 },
      body: { radius: PHYSICS.radius, height: PHYSICS.height, eyeH: PHYSICS.eyeHeight } } };
  const world = buildWorld([def], 'mesh');
  const target = world.get('bodyTarget').data;
  integrate(target, SIM_STEP, null, world, PHYSICS);
  const p = swordPlayer(world, target.transform.x - 0.9, target.transform.y);
  p.transform.z = target.transform.z;
  const { events, hits } = makeEvents();
  world.state['tower.sword.taken'] = true;
  const sword = createSwordSim(world, events, SWORD_CFG);
  sword.step(p, 1, 0, true);
  for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, 1, 0, true);
  sword.step(p, 1, 0, false);
  for (let i = 0; i < 16 && hits.length === 0; i++) sword.step(p, 1, 0, false);
  ok('generic mesh body receives exact 3 m/s horizontal impulse without lift', hits.length === 1
    && target.components.body.vx === 3 && target.components.body.vy === 0
    && target.components.body.vz === 0 && target.components.body.grounded);
  const startX = target.transform.x;
  let maxX = startX;
  for (let i = 0; i < 60; i++) {
    integrate(target, SIM_STEP, null, world, PHYSICS);
    maxX = Math.max(maxX, target.transform.x);
  }
  ok('generic heavy shove moves the body but cannot cross the tower mesh wall', maxX > startX
    && maxX < 1480 - PHYSICS.radius + 1e-4, `startX=${startX}, maxX=${maxX}`);
  sword.dispose();
}


finish();
