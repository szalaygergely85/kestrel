// game/js/quest/sim/vitals.test.js (US-080a1, architecture.md 30.2). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/vitals.test.js
//
// Same pattern as beastSim.test.js/tower.test.js: a real engine `World` (no terrain/structures needed here - just
// an inline-xyz `player` entity and, for knockback-direction tests, a second inline-xyz "source" entity), driven
// through the real `createVitals`. Events are a tiny local `on`/`emit` stub (same shape as `engine/core/events.js`'s
// `Events`, which `vitals.js` only ever calls through that interface).
import { World, createHasher, serialize, deserialize } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as CFG } from './vitalsConfig.js';

const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function playerEntity(x = 0, y = 0, z = 0) {
  return {
    id: 'player', type: 'player', x, y, z,
    components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } },
  };
}
function sourceEntity(id, x, y) {
  return { id, type: 'beast', x, y, z: 0, components: {} };
}
function buildWorld(entities) {
  return World.load({ name: 'vitalsTest', terrain: null, structures: [], entities, state: {} }, assets, {});
}
function makeEvents() {
  const listeners = new Map();
  return {
    on(name, fn) {
      let s = listeners.get(name);
      if (!s) { s = new Set(); listeners.set(name, s); }
      s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, payload) {
      const s = listeners.get(name);
      if (!s) return;
      for (const fn of Array.from(s)) fn(payload);
    },
  };
}
const DEATH_TOTAL = CFG.sinkSteps + CFG.fadeSteps;

/** Kills the player (via a big fall) and runs the death timeline to completion, then respawns ([E] pressed). */
function killAndRespawn(vitals, player) {
  player.components.health.hp = 1;
  player.components.body.landed = true;
  player.components.body.fallDistance = CFG.fallThreshold10m + 1;
  vitals.step(player, false); // fall damage clips hp to 0 -> dead this same step
  player.components.body.landed = false;
  for (let i = 0; i < DEATH_TOTAL; i++) vitals.step(player, false);
  vitals.step(player, true); // [E] pressed once cardReady -> respawn
}

// ---------------------------------------------------------------------------------------------------------------
// 1. One beast hit = -5 hp (damage 1 * beastDamageScale 5); a second hit mid-invuln is ignored; once invuln has
//    run its full 60 steps, a new hit lands.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity(), sourceEntity('b1', 5, 0)]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;

  vitals.step(player, false); // tick 1: lazily creates components.health
  ok('starts at full hp', vitals.hp === CFG.maxHp, `hp=${vitals.hp}`);

  events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 });
  ok('one beast hit (damage 1 * damageScale 5) = -5 hp', vitals.hp === 25, `hp=${vitals.hp}`);
  ok('invuln set to cfg.invulnSteps (60)', vitals.invuln === CFG.invulnSteps, `invuln=${vitals.invuln}`);

  for (let i = 0; i < CFG.invulnSteps; i++) {
    vitals.step(player, false);
    if (i === Math.floor(CFG.invulnSteps / 2)) events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 });
  }
  ok('a second hit mid-invuln-window is ignored', vitals.hp === 25, `hp=${vitals.hp}`);
  ok('invuln has reached 0 after a full 60 steps', vitals.invuln === 0, `invuln=${vitals.invuln}`);

  events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 });
  ok('a hit once invuln has expired (60 steps later) is applied', vitals.hp === 20, `hp=${vitals.hp}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Falls: strictly-greater-than thresholds at 6 m and 10 m.
// ---------------------------------------------------------------------------------------------------------------
function fallCase(dist) {
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);
  player.components.body.landed = true;
  player.components.body.fallDistance = dist;
  vitals.step(player, false);
  return vitals.hp;
}
ok('5.9 m fall: no damage', fallCase(5.9) === CFG.maxHp, `hp=${fallCase(5.9)}`);
ok('exactly 6.0 m fall: no damage (threshold is strictly >)', fallCase(6.0) === CFG.maxHp, `hp=${fallCase(6.0)}`);
ok('6.1 m fall: 5 damage', fallCase(6.1) === CFG.maxHp - 5, `hp=${fallCase(6.1)}`);
ok('exactly 10.0 m fall: still only the 5-damage tier', fallCase(10.0) === CFG.maxHp - 5, `hp=${fallCase(10.0)}`);
ok('10.1 m fall: 10 damage', fallCase(10.1) === CFG.maxHp - 10, `hp=${fallCase(10.1)}`);

// ---------------------------------------------------------------------------------------------------------------
// 3. Death timeline: sink (48) -> fade (90) -> cardReady, exact step numbers from vitalsConfig.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);

  player.components.health.hp = 1;
  player.components.body.landed = true;
  player.components.body.fallDistance = CFG.fallThreshold10m + 1; // 10 dmg, clips 1 -> 0
  vitals.step(player, false);
  ok('hp clips to 0 (not negative)', vitals.hp === 0, `hp=${vitals.hp}`);
  ok('dead becomes true the same step hp reaches 0', vitals.dead === true);
  ok('deathStep starts at 0', vitals.deathStep === 0, `deathStep=${vitals.deathStep}`);
  player.components.body.landed = false;

  for (let i = 0; i < CFG.sinkSteps - 1; i++) vitals.step(player, false);
  ok('deathStep == sinkSteps-1 just before the sink phase ends', vitals.deathStep === CFG.sinkSteps - 1, `deathStep=${vitals.deathStep}`);
  ok('cardReady still false during the sink phase', vitals.cardReady === false);

  vitals.step(player, false);
  ok('deathStep == sinkSteps once the sink phase ends', vitals.deathStep === CFG.sinkSteps, `deathStep=${vitals.deathStep}`);
  ok('cardReady still false as the fade phase begins', vitals.cardReady === false);

  for (let i = 0; i < CFG.fadeSteps - 1; i++) vitals.step(player, false);
  ok('deathStep == sinkSteps+fadeSteps-1 just before the fade ends', vitals.deathStep === CFG.sinkSteps + CFG.fadeSteps - 1, `deathStep=${vitals.deathStep}`);
  ok('cardReady still false one step before the fade completes', vitals.cardReady === false);

  vitals.step(player, false);
  ok('cardReady becomes true exactly when deathStep reaches sinkSteps+fadeSteps', vitals.cardReady === true && vitals.deathStep === CFG.sinkSteps + CFG.fadeSteps,
    `cardReady=${vitals.cardReady} deathStep=${vitals.deathStep}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Respawn: flags untouched, hp full, beasts.resetAll() called, targeting.clear() called when present,
//    position = the save point when set, else the entity's original spawn transform.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity(1, 2, 3)]);
  world.state['quest.swordTaken'] = true; // arbitrary saved flag - must survive respawn untouched (no deserialize)
  const events = makeEvents();
  let resetAllCalls = 0, clearCalls = 0;
  const vitals = createVitals(world, events, CFG, {
    beasts: { resetAll() { resetAllCalls++; } },
    targeting: { clear() { clearCalls++; } },
  });
  const player = world.get('player').data;
  vitals.step(player, false); // tick 1: captures the default spawn transform (1,2,3)
  player.components.body.vx = 7; player.components.body.vy = -3; player.components.body.vz = 2;

  killAndRespawn(vitals, player);

  ok('respawn without a save point returns to the entity\'s own spawn transform',
    player.transform.x === 1 && player.transform.y === 2 && player.transform.z === 3,
    JSON.stringify(player.transform));
  ok('respawn restores full hp', vitals.hp === CFG.maxHp, `hp=${vitals.hp}`);
  ok('respawn clears dead/deathStep/cardReady', vitals.dead === false && vitals.deathStep === 0 && vitals.cardReady === false);
  ok('respawn zeroes body velocity', player.components.body.vx === 0 && player.components.body.vy === 0 && player.components.body.vz === 0);
  ok('respawn calls hooks.beasts.resetAll() exactly once', resetAllCalls === 1, `calls=${resetAllCalls}`);
  ok('respawn calls hooks.targeting.clear() exactly once (present hook)', clearCalls === 1, `calls=${clearCalls}`);
  ok('world.state flags are untouched by respawn (no deserialize)', world.state['quest.swordTaken'] === true);
}
{
  // Save point set: world.state['save.x'/'y'/'z'/'yaw'] wins over the entity's own spawn transform.
  const world = buildWorld([playerEntity(1, 2, 3)]);
  world.state['save.x'] = 10; world.state['save.y'] = 20; world.state['save.z'] = 0.5; world.state['save.yaw'] = 90;
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, { beasts: { resetAll() {} } }); // no targeting hook: must not crash
  const player = world.get('player').data;
  vitals.step(player, false);

  killAndRespawn(vitals, player);

  ok('respawn with a save point uses world.state[save.*], not the entity\'s own spawn',
    player.transform.x === 10 && player.transform.y === 20 && player.transform.z === 0.5 && player.transform.yawDeg === 90,
    JSON.stringify(player.transform));
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Serialize/deserialize round trip of `components.health {hp, max, invuln}`.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);
  player.components.health.hp = 17;
  player.components.health.invuln = 23;

  const saved = JSON.parse(JSON.stringify(serialize(world)));
  const world2 = deserialize(saved, assets, {});
  const health2 = world2.get('player').data.components.health;
  ok('serialize/deserialize round-trips components.health {hp, max, invuln}',
    !!health2 && health2.hp === 17 && health2.max === CFG.maxHp && health2.invuln === 23,
    JSON.stringify(health2));
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Deterministic replay: identical scripted hits/falls/[E]-presses on two fresh runs -> identical hashInto() at
//    every checkpoint.
// ---------------------------------------------------------------------------------------------------------------
function scriptedRun() {
  const world = buildWorld([playerEntity(), sourceEntity('b1', 5, 0)]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, { beasts: { resetAll() {} } });
  const player = world.get('player').data;
  const checkpoints = [];
  for (let i = 1; i <= 400; i++) {
    if (i % 37 === 0) events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 });
    player.components.body.landed = (i % 101 === 0);
    player.components.body.fallDistance = 7; // > 6 m threshold whenever `landed` fires above
    vitals.step(player, i % 251 === 0);
    if (i % 50 === 0) {
      const h = createHasher();
      h.u32(i);
      vitals.hashInto(h);
      checkpoints.push(h.value());
    }
  }
  return checkpoints;
}
{
  const a = scriptedRun();
  const b = scriptedRun();
  ok('deterministic replay: identical scripted input -> identical hashInto() at every 50-step checkpoint',
    a.length === b.length && a.every((v, i) => v === b[i]), JSON.stringify({ a, b }));
}

// ---------------------------------------------------------------------------------------------------------------
// 7. US-080b mana: starts 20/20; regen +1 per 120 steps; spendMana pauses regen 180 steps; a short spend returns
//    false, sets manaFlashTick, and changes neither mp nor pause; respawn gives full mp; serialize round trip.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;

  vitals.step(player, false); // tick 1: lazily creates components.mana (this step's own regen++ counts too)
  ok('mana starts at 20/20', vitals.mp === CFG.startMp && vitals.mpMax === CFG.maxMp, `mp=${vitals.mp}/${vitals.mpMax}`);

  player.components.mana.mp = 10;   // drop below max so regen has somewhere to go
  player.components.mana.regen = 0; // clean baseline (tick 1 above already bumped it once)
  for (let i = 0; i < CFG.manaRegenSteps - 1; i++) vitals.step(player, false);
  ok('no regen tick yet, 1 step before manaRegenSteps', vitals.mp === 10, `mp=${vitals.mp}`);
  vitals.step(player, false);
  ok('regen +1 exactly at manaRegenSteps (120)', vitals.mp === 11, `mp=${vitals.mp}`);
}
{
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);

  const ok1 = vitals.spendMana(5);
  ok('spendMana(5) succeeds when mp (20) >= 5', ok1 === true && vitals.mp === 15, `ok=${ok1} mp=${vitals.mp}`);

  // During the 180-step pause, no regen tick happens even after manaRegenSteps (120) more steps.
  for (let i = 0; i < CFG.manaPauseSteps - 1; i++) vitals.step(player, false);
  ok('mp unchanged 1 step before the 180-step pause ends (no regen during pause)', vitals.mp === 15, `mp=${vitals.mp}`);
  vitals.step(player, false); // pause reaches 0 this step
  player.components.mana.regen = 0; // clean baseline (regen keeps counting underneath a pause - zero it here)
  for (let i = 0; i < CFG.manaRegenSteps - 1; i++) vitals.step(player, false);
  ok('still 15 one step before a full manaRegenSteps after the pause ended', vitals.mp === 15, `mp=${vitals.mp}`);
  vitals.step(player, false);
  ok('regen +1 once manaRegenSteps have elapsed after the pause ended', vitals.mp === 16, `mp=${vitals.mp}`);
}
{
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);

  const before = { mp: vitals.mp, pause: player.components.mana.pause };
  const okSpend = vitals.spendMana(25); // > 20 available
  ok('spendMana returns false when short', okSpend === false, `ok=${okSpend}`);
  ok('a short spendMana changes neither mp nor pause', vitals.mp === before.mp && player.components.mana.pause === before.pause,
    `mp=${vitals.mp} pause=${player.components.mana.pause}`);
  ok('a short spendMana sets manaFlashTick', vitals.manaFlashTick > 0, `manaFlashTick=${vitals.manaFlashTick}`);
}
{
  // Respawn gives full mp (same killAndRespawn helper as the hp respawn tests above).
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, { beasts: { resetAll() {} } });
  const player = world.get('player').data;
  vitals.step(player, false);
  vitals.spendMana(15);
  ok('mp is 5 right before death', vitals.mp === 5, `mp=${vitals.mp}`);

  killAndRespawn(vitals, player);
  ok('respawn restores full mp', vitals.mp === CFG.maxMp, `mp=${vitals.mp}`);
}
{
  // Serialize/deserialize round trip of components.mana {mp, max, regen, pause}.
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false);
  player.components.mana.mp = 7;
  player.components.mana.pause = 42;
  player.components.mana.regen = 3;

  const saved = JSON.parse(JSON.stringify(serialize(world)));
  const world2 = deserialize(saved, assets, {});
  const mana2 = world2.get('player').data.components.mana;
  ok('serialize/deserialize round-trips components.mana {mp, max, regen, pause}',
    !!mana2 && mana2.mp === 7 && mana2.max === CFG.maxMp && mana2.pause === 42 && mana2.regen === 3,
    JSON.stringify(mana2));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
