// game/js/quest/sim/pickups.test.js (US-080b, docs/architecture.md 30.2). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/pickups.test.js
//
// Same pattern as vitals.test.js: a real engine World with an inline-xyz player entity, driven through the real
// `spawnDrop`/`stepPickups`. `resetPickups()` clears the module-level slot table between cases (same convention
// as `vitalsView.test.js`'s `resetVitalsView()`).
import { World, serialize, deserialize } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { spawnDrop, stepPickups, resetPickups, liveDropIds, PICKUP_LIFE, MAX_DROPS } from './pickups.js';

const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function playerEntity(x = 0, y = 0, z = 0) {
  return { id: 'player', type: 'player', x, y, z, components: { health: { hp: 20, max: 30, invuln: 0 }, mana: { mp: 10, max: 20, regen: 0, pause: 0 } } };
}
function buildWorld(entities) {
  return World.load({ name: 'pickupsTest', terrain: null, structures: [], entities, state: {} }, assets, {});
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Collect radius: 0.79 m collects, 0.81 m does not (3D distance, player at origin).
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  spawnDrop(world, 'hp', 0.79, 0, 0);
  stepPickups(world, player);
  ok('a drop 0.79 m away is collected (+10 hp)', player.components.health.hp === 30, `hp=${player.components.health.hp}`);
  ok('the collected drop is gone', liveDropIds().every((id) => id === null));
}
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  spawnDrop(world, 'hp', 0.81, 0, 0);
  stepPickups(world, player);
  ok('a drop 0.81 m away is NOT collected', player.components.health.hp === 20, `hp=${player.components.health.hp}`);
  ok('the drop is still live', liveDropIds().some((id) => id !== null));
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Despawn exactly at life 0 (step 1200): still live at step 1199, gone at step 1200.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]); // far from the drop: never collected
  const player = world.get('player').data;
  const id = spawnDrop(world, 'hp', 0, 0, 0);
  for (let i = 0; i < PICKUP_LIFE - 1; i++) stepPickups(world, player);
  ok('still live 1 step before life reaches 0', !!world.entity(id), `step=${PICKUP_LIFE - 1}`);
  stepPickups(world, player);
  ok('despawned exactly when life reaches 0 (step 1200)', !world.entity(id));
  ok('its slot is freed', liveDropIds().every((s) => s === null));
}

// ---------------------------------------------------------------------------------------------------------------
// 3. HP pickup only heals hp; MP pickup only heals mp; both clamp at max.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  spawnDrop(world, 'hp', 0, 0, 0);
  stepPickups(world, player);
  ok('hp pickup heals hp only', player.components.health.hp === 30 && player.components.mana.mp === 10,
    `hp=${player.components.health.hp} mp=${player.components.mana.mp}`);
}
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  spawnDrop(world, 'mp', 0, 0, 0);
  stepPickups(world, player);
  ok('mp pickup heals mp only', player.components.mana.mp === 20 && player.components.health.hp === 20,
    `mp=${player.components.mana.mp} hp=${player.components.health.hp}`);
}
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  player.components.health.hp = 25; // +10 would overshoot max (30)
  spawnDrop(world, 'hp', 0, 0, 0);
  stepPickups(world, player);
  ok('hp pickup clamps at max', player.components.health.hp === 30, `hp=${player.components.health.hp}`);
}
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const player = world.get('player').data;
  player.components.mana.mp = 15; // +10 would overshoot max (20)
  spawnDrop(world, 'mp', 0, 0, 0);
  stepPickups(world, player);
  ok('mp pickup clamps at max', player.components.mana.mp === 20, `mp=${player.components.mana.mp}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Full table (16 drops) + a 17th: the oldest (least life remaining) is evicted first.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]); // far away: never collected
  const player = world.get('player').data;
  const ids = [];
  for (let i = 0; i < MAX_DROPS; i++) {
    ids.push(spawnDrop(world, 'hp', i, 0, 0));
    stepPickups(world, player); // age each drop by a different amount so one is oldest
  }
  ok('16 drops all live', ids.every((id) => !!world.entity(id)));
  const extraId = spawnDrop(world, 'hp', 99, 0, 0);
  ok('the very first (oldest/least life) drop was evicted for the 17th', !world.entity(ids[0]));
  ok('the newest drops are still live', !!world.entity(ids[1]) && !!world.entity(extraId));
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Save round trip: a live drop's components.pickup {kind, amount, life, baseZ} survives serialize/deserialize.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]);
  const id = spawnDrop(world, 'mp', 3, 4, 0.2);
  const saved = JSON.parse(JSON.stringify(serialize(world)));
  const world2 = deserialize(saved, assets, {});
  const e2 = world2.entity(id);
  ok('a live pickup entity round-trips through save/load', !!e2 && !!e2.components.pickup,
    JSON.stringify(e2 && e2.components.pickup));
  if (e2) {
    const p2 = e2.components.pickup;
    ok('pickup component data is unchanged', p2.kind === 'mp' && p2.amount === 10 && p2.life === PICKUP_LIFE && p2.baseZ === 0.2,
      JSON.stringify(p2));
    ok('transform is unchanged', e2.transform.x === 3 && e2.transform.y === 4 && e2.transform.z === 0.2,
      JSON.stringify(e2.transform));
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
