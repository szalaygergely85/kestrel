// game/js/quest/sim/beastSim.c3.test.js (hp/death 2). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

{
  // Dead boar: steer agent inactive, and targeting breaks its lock (isAlive reads health.hp <= 0).
  const bx = 1461, by = 1031;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)], 90, 'mesh');
  const player = swordPlayer(world, bx, by + 2); // 2 m south of the beast, facing north
  const look = { yawDeg: 0, pitchDeg: 0, setLockPoint() {}, clearLock() {} };
  const targeting = createTargeting(world, events, { range: 15, losEvery: 1 });
  targeting.step(0, true, 0, player, look); // Q -> lock
  ok('targeting locks the alive beast', targeting.locked && targeting.targetId === 'b1', `targetId=${targeting.targetId}`);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(player.transform.x, player.transform.y, player.transform.z);
  ok('the steer agent is inactive once dead', sim.steer.active[0] === 0);
  targeting.step(0, false, 0, player, look);
  ok('the lock breaks on the kill step (isAlive reads health.hp <= 0)', !targeting.locked, `locked=${targeting.locked}`);
  targeting.dispose(); sim.dispose();
}

{
  // DYING 24 -> CORPSE -> despawnCorpse -> SINK 30 -> GONE.
  const { sim, events, sinks } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('kill -> DYING 24', sim.state[0] === STATE_DYING && sim.timer[0] === sim.cfgSteps.die, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  for (let k = 0; k < sim.cfgSteps.die; k++) sim.step(1e6, 1e6, 0);
  ok('DYING 24 -> CORPSE', sim.state[0] === STATE_CORPSE && sim.timer[0] === sim.cfgSteps.corpse, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  ok('despawnCorpse returns true for a corpse', sim.despawnCorpse('b1') === true);
  sim.step(1e6, 1e6, 0);
  ok('despawn -> SINK 30 and one beast:sink', sim.state[0] === STATE_SINK && sim.timer[0] === sim.cfgSteps.sink && sinks.length === 1, `state=${sim.state[0]} timer=${sim.timer[0]} sinks=${sinks.length}`);
  for (let k = 0; k < sim.cfgSteps.sink; k++) sim.step(1e6, 1e6, 0);
  ok('SINK 30 -> GONE', sim.state[0] === STATE_GONE, `state=${sim.state[0]}`);
}

{
  // timeout 3600 -> SINK (unlooted corpse sinks on its own).
  const { sim, events, sinks } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  for (let k = 0; k < sim.cfgSteps.die; k++) sim.step(1e6, 1e6, 0);
  ok('corpse reached', sim.state[0] === STATE_CORPSE);
  for (let k = 0; k < sim.cfgSteps.corpse; k++) sim.step(1e6, 1e6, 0);
  ok('3600-step timeout -> SINK', sim.state[0] === STATE_SINK && sinks.length === 1, `state=${sim.state[0]} sinks=${sinks.length}`);
}

{
  // resetAll restores slot id, hp, position and steer active.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(1e6, 1e6, 0);
  ok('dead: steer inactive and hp 0', sim.steer.active[0] === 0 && hpOf(sim, 0) === 0);
  sim.resetAll();
  ok('resetAll restores hp, active, position and state', sim.slotOf('b1') === 0 && hpOf(sim, 0) === 4
    && sim.steer.active[0] === 1 && sim.steer.x[0] === bx && sim.steer.y[0] === by && sim.state[0] === STATE_WANDER);
}

{
  // 600-step replay with a kill + save@300 / load: hash equal (the new SoA + steer.active + health.hp round-trip).
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA, events: evA } = freshSim(entities(), 7);
  for (let i = 1; i <= 300; i++) {
    const p = scriptedPlayer(i);
    if (i === 200) evA.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: p.x, py: p.y, pz: 0, cause: 'sword' });
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const savedSim = simA.save();
  const savedRng = rngA.save();
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const hashA600 = hashAt(simA, simA.steer, 600, rngA);

  const { world: wB, sim: simB, rng: rngB } = freshSim(entities(), 7);
  rngB.load(savedRng);
  simB.load(savedSim);
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simB.step(p.x, p.y, groundZ(wB, p.x, p.y));
  }
  const hashB600 = hashAt(simB, simB.steer, 600, rngB);
  ok('kill + save@300 / load: same hash at 600', hashA600 === hashB600, `A=${hashA600} B=${hashB600}`);
}


finish();
