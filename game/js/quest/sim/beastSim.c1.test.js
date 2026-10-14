// game/js/quest/sim/beastSim.c1.test.js (hp/death 1). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ===============================================================================================================
// US-079b (37.16.2): HP, hurt, death, corpse.
// ===============================================================================================================

{
  // Fresh health component on create (overwrites any serialized one).
  const { sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const health = sim.entities[0].components.health;
  ok('fresh components.health = {hp:4, max:4, invuln:0}', health.hp === 4 && health.max === 4 && health.invuln === 0, JSON.stringify(health));
}

{
  // 4 light hits >= 12 steps apart -> hp 0 and DYING on the 4th (cooldown cleared each time).
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('1st light hit: hp 3, alive', hpOf(sim, 0) === 3 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('2nd light hit (12 steps later): hp 2, alive', hpOf(sim, 0) === 2 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('3rd light hit: hp 1, alive', hpOf(sim, 0) === 1 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('4th light hit: hp 0 and DYING', hpOf(sim, 0) === 0 && sim.state[0] === STATE_DYING, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
}

{
  // Two hits 5 steps apart -> only the first damages (the second is inside the 12-step cooldown).
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  for (let k = 0; k < 5; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('two hits 5 steps apart -> 1 damage (hp 3, not 2)', hpOf(sim, 0) === 3, `hp=${hpOf(sim, 0)}`);
}

{
  // hard 3 + light 1 (after the cooldown) kills.
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', HEAVY_HIT('b1'));
  ok('hard 3: hp 1, staggered (alive)', hpOf(sim, 0) === 1 && sim.state[0] === STATE_STAGGER, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('then light 1 kills (hp 0, DYING)', hpOf(sim, 0) === 0 && sim.state[0] === STATE_DYING, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
}

{
  // flinch 15 then chase (aggro on the hit makes it chase, not return).
  const bx = 1461, by = 1031, px = bx + 2, py = by;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('light hit -> FLINCH 15', sim.state[0] === STATE_FLINCH && sim.timer[0] === sim.cfgSteps.flinch, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  for (let k = 0; k < sim.cfgSteps.flinch; k++) sim.step(px, py, groundZ(world, px, py));
  ok('flinch 15 -> chase', sim.state[0] === STATE_CHASE, `state=${sim.state[0]}`);
}

{
  // A light hit during CHARGE only flashes (still charging, still took the damage).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax; sim.cdx[0] = 1; sim.cdy[0] = 0;
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('a light hit during charge: still charging (flash only)', sim.state[0] === STATE_CHARGE, `state=${sim.state[0]}`);
  ok('...but it still took 1 damage and flashed', hpOf(sim, 0) === 3 && sim.hurtT[0] === 0);
}

{
  // Heavy knock 6 slides ~1.5 m (knockV 6 decaying by accel 12; ~29 moving steps).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 1, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', knock: 6 });
  ok('heavy knock 6 -> stagger with knockV 6', sim.state[0] === STATE_STAGGER && sim.knockV[0] === 6, `knockV=${sim.knockV[0]}`);
  const startX = sim.steer.x[0];
  for (let k = 0; k < sim.cfgSteps.stagger; k++) sim.step(1e6, 1e6, 0);
  const dx = sim.steer.x[0] - startX;
  ok('stagger knock 6 slides ~1.5 m', dx > 1.3 && dx < 1.6, `dx=${dx.toFixed(3)}`);
}

{
  // beast:died exactly once, one step after the kill, with the right cause.
  const { sim, events, died } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('no beast:died inside the listener (pendingDied set)', died.length === 0 && sim.state[0] === STATE_DYING && sim.pendingDied[0] === 1);
  sim.step(1e6, 1e6, 0);
  ok('beast:died exactly once, one step after the kill, cause sword', died.length === 1 && died[0].id === 'b1' && died[0].cause === 'sword', JSON.stringify(died));
  sim.step(1e6, 1e6, 0);
  ok('beast:died not emitted again', died.length === 1);
}

{
  // A fire kill reports cause 'fire'.
  const { sim, events, died } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'fire', knock: 0.5 });
  sim.step(1e6, 1e6, 0);
  ok('a fire kill reports cause "fire"', died.length === 1 && died[0].cause === 'fire', JSON.stringify(died));
}

{
  // API: slotOf / isDead / despawnCorpse edge cases.
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  ok('slotOf resolves the slot and -1 for an unknown id', sim.slotOf('b1') === 0 && sim.slotOf('nope') === -1);
  ok('isDead false while alive', sim.isDead(0) === false);
  ok('despawnCorpse false while alive', sim.despawnCorpse('b1') === false);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('isDead true while DYING; despawnCorpse true during DYING (sets despawnReq)', sim.isDead(0) === true
    && sim.despawnCorpse('b1') === true && sim.despawnReq[0] === 1);
}


finish();
