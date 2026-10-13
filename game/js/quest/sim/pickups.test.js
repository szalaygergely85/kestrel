// game/js/quest/sim/pickups.test.js (US-080b, docs/architecture.md 30.2). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/pickups.test.js
//
// Same pattern as vitals.test.js: a real engine World with an inline-xyz player entity, driven through the real
// `spawnDrop`/`stepPickups`. `resetPickups()` clears the module-level slot table between cases; on load,
// `resetPickups(world)` rebuilds that table from retained components (same convention
// as `vitalsView.test.js`'s `resetVitalsView()`).
import { World, serialize, deserialize } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { createQuestPickups } from '../../questPickups.js';
import { SLOTS, countOf } from './inventory.js';
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
// 2. Despawn exactly at life 0 (step PICKUP_LIFE): still live at step 1199, gone at step 1200.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]); // far from the drop: never collected
  const player = world.get('player').data;
  const id = spawnDrop(world, 'hp', 0, 0, 0);
  for (let i = 0; i < PICKUP_LIFE - 1; i++) stepPickups(world, player);
  ok('still live 1 step before life reaches 0', !!world.entity(id), `step=${PICKUP_LIFE - 1}`);
  stepPickups(world, player);
  ok('despawned exactly when life reaches 0 (step PICKUP_LIFE)', !world.entity(id));
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

// ---------------------------------------------------------------------------------------------------------------
// 6. The real load hook rebuilds slots after a JSON round trip: HP and MP still collect, using saved baseZ.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(0, 0, 0)]);
  const hpId = spawnDrop(world, 'hp', 0, 0, 0);
  const mpId = spawnDrop(world, 'mp', 3, 0, 0);
  world.entity(hpId).transform.z = -500; // view-only blink must not change collection after loading
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  resetPickups(loaded);
  const player = loaded.get('player').data;
  ok('load-time reset indexes both saved pickup components', liveDropIds().includes(hpId) && liveDropIds().includes(mpId));
  stepPickups(loaded, player);
  ok('loaded HP drop heals only health at its saved baseZ', player.components.health.hp === 30 && player.components.mana.mp === 10);
  ok('loaded HP drop is removed on collection', !loaded.entity(hpId) && !liveDropIds().includes(hpId));
  ok('distant loaded MP drop continues its life countdown', loaded.entity(mpId).components.pickup.life === PICKUP_LIFE - 1);
  player.transform.x = 3;
  stepPickups(loaded, player);
  ok('loaded MP drop restores mana only', player.components.mana.mp === 20 && player.components.health.hp === 30);
  ok('loaded MP drop and its slot are removed on collection', !loaded.entity(mpId) && liveDropIds().every((id) => id === null));
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Loaded full-life and partly-aged drops expire at their saved remaining-life boundary, without resetting it.
// ---------------------------------------------------------------------------------------------------------------
for (const remaining of [PICKUP_LIFE, 5]) {
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]);
  const id = spawnDrop(world, 'hp', 0, 0, 0);
  world.entity(id).components.pickup.life = remaining;
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  resetPickups(loaded);
  const player = loaded.get('player').data;
  ok(`load keeps saved remaining life ${remaining}`, loaded.entity(id).components.pickup.life === remaining);
  for (let i = 0; i < remaining - 1; i++) stepPickups(loaded, player);
  ok(`loaded life ${remaining} remains live until its final step`, loaded.entity(id).components.pickup.life === 1);
  stepPickups(loaded, player);
  ok(`loaded life ${remaining} expires exactly at its final step`, !loaded.entity(id) && liveDropIds().every((slot) => slot === null));
  stepPickups(loaded, player);
  ok(`expired loaded life ${remaining} does not heal on later steps`, player.components.health.hp === 20);
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Load enforces the same 16-slot cap by least remaining life, regardless of saved entity order.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]);
  const count = MAX_DROPS + 4;
  // Mix younger and older overflow drops, exercising both eviction and rejection of late saved entries.
  const order = Array.from({ length: count - 5 }, (_, i) => count - 1 - i).concat([0, 4, 3, 2, 1]);
  for (const i of order) {
    world.spawn('pickup', { x: i, y: 0, z: 0 }, { pickup: { kind: 'hp', amount: 10, life: 100 + i, baseZ: 0 } }, `saved_${i}`);
  }
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  resetPickups(loaded);
  ok('load caps the runtime pickup slots at 16', liveDropIds().filter((id) => id !== null).length === MAX_DROPS);
  ok('load removes the four oldest saved drops from the world', [0, 1, 2, 3].every((i) => !loaded.entity(`saved_${i}`)));
  ok('load keeps the sixteen youngest saved drops', Array.from({ length: MAX_DROPS }, (_, i) => i + 4).every((i) => !!loaded.entity(`saved_${i}`)));
  const extraId = spawnDrop(loaded, 'mp', 99, 0, 0);
  ok('a new drop after capped load evicts the least-life retained drop', !loaded.entity('saved_4') && !!loaded.entity(extraId));
  const player = loaded.get('player').data;
  stepPickups(loaded, player);
  ok('every retained loaded drop continues stepping', loaded.entity('saved_5').components.pickup.life === 104 && loaded.entity(extraId).components.pickup.life === PICKUP_LIFE - 1);
  resetPickups(loaded);
  ok('repeated load rebuild does not duplicate live slots', new Set(liveDropIds()).size === MAX_DROPS);
}
{
  resetPickups();
  const world = buildWorld([playerEntity(50, 50, 0)]);
  for (let i = 0; i <= MAX_DROPS; i++) {
    world.spawn('pickup', { x: i, y: 0, z: 0 }, { pickup: { kind: 'hp', amount: 10, life: 100, baseZ: 0 } }, `tied_${i}`);
  }
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  resetPickups(loaded);
  ok('equal-life cap evicts the first indexed drop, matching spawn order', !loaded.entity('tied_0') && !!loaded.entity(`tied_${MAX_DROPS}`));
  ok('equal-life load leaves exactly 16 indexed drops', liveDropIds().filter((id) => id !== null).length === MAX_DROPS);
}

// ---------------------------------------------------------------------------------------------------------------
// 9. A fresh module starts nextId at 1: spawning after load skips pickup AND unrelated entity ID collisions.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity(50, 50, 0)]);
  world.spawn('pickup', { x: 0, y: 0, z: 0 }, { pickup: { kind: 'hp', amount: 10, life: 50, baseZ: 0 } }, 'pickup_1');
  world.spawn('marker', { x: 0, y: 0, z: 0 }, {}, 'pickup_2');
  world.spawn('pickup', { x: 1, y: 0, z: 0 }, { pickup: { kind: 'mp', amount: 10, life: 60, baseZ: 0 } }, 'pickup_3');
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  const fresh = await import('./pickups.js?fresh-load');
  fresh.resetPickups(loaded);
  const id = fresh.spawnDrop(loaded, 'mp', 99, 0, 0);
  ok('fresh module skips the exact pickup_1 collision and subsequent occupied IDs', id === 'pickup_4');
  ok('existing pickup and unrelated entities survive the new spawn', !!loaded.entity('pickup_1') && loaded.entity('pickup_2').type === 'marker' && !!loaded.entity('pickup_3'));
  ok('fresh-module load indexes only pickup components', !fresh.liveDropIds().includes('pickup_2') && fresh.liveDropIds().filter((slot) => slot !== null).length === 3);
  const secondId = fresh.spawnDrop(loaded, 'hp', 98, 0, 0);
  ok('subsequent spawned IDs are unique', secondId === 'pickup_5' && secondId !== id && !!loaded.entity(id));
  fresh.stepPickups(loaded, loaded.get('player').data);
  ok('fresh-module loaded and new drops all continue their life countdown', loaded.entity('pickup_1').components.pickup.life === 49 && loaded.entity(id).components.pickup.life === PICKUP_LIFE - 1);
  fresh.resetPickups();
  ok('no-world reset still clears fixture state', fresh.liveDropIds().every((slot) => slot === null) && !!loaded.entity('pickup_1'));
}

// ---------------------------------------------------------------------------------------------------------------
// EQ-23. Leftover reward stack drops at the player's feet; re-collect; save round trip; questReward never despawns.
// ---------------------------------------------------------------------------------------------------------------
{
  resetPickups();
  const defs = { arrow: { stackMax: 99, name: 'Arrow' }, rock: { stackMax: 1, name: 'Rock' } };
  const world = buildWorld([playerEntity(5, 5, 0)]);
  const player = world.get('player').data;
  const mkInv = (free) => ({ slots: Array.from({ length: SLOTS }, (_, i) => (i < SLOTS - free ? { id: 'rock', n: 1 } : { id: null, n: 0 })), left: null, right: null });
  const inv = mkInv(0);
  const events = []; const bus = { emit: (n, p) => events.push([n, { ...p }]) };
  const hook = createQuestPickups({ getBook: () => null, feed() {}, defs, isWorn: null });
  hook.onBoot({ world, player, inventory: inv, events: bus, state: {} });
  hook.grantReward({ items: [{ id: 'arrow', n: 10 }] });
  let live = liveDropIds().filter((x) => x);
  ok('AC1 full pack: 0 lost, drop holds all 10', live.length === 1 && world.entity(live[0]).components.pickup.amount === 10 && world.entity(live[0]).components.pickup.itemId === 'arrow');
  const e = world.entity(live[0]); const d = Math.sqrt((e.transform.x - 5) ** 2 + (e.transform.y - 5) ** 2);
  ok('drop is on the 0.6 m ring', Math.abs(d - 0.6) < 0.01, String(d));
  ok('inventory:full carries dropped', events.some(([n, p]) => n === 'inventory:full' && p.n === 10 && p.dropped));
  // AC2 save round trip
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  const p2 = w2.entity(live[0]).components.pickup;
  ok('AC2 round trip keeps id/count/position/flag', p2.itemId === 'arrow' && p2.amount === 10 && p2.questReward === true && w2.entity(live[0]).transform.x === e.transform.x);
  // AC3 survives 10k ticks; full pack leaves it
  for (let i = 0; i < 10000; i++) stepPickups(world, player);
  ok('AC3 questReward survives 10k ticks', !!world.entity(live[0]));
  // second leftover must not overlap the first
  hook.grantReward({ items: [{ id: 'arrow', n: 3 }] });
  live = liveDropIds().filter((x) => x);
  const a = world.entity(live[0]).transform, b = world.entity(live[1]).transform;
  ok('second drop does not overlap', live.length === 2 && Math.hypot(a.x - b.x, a.y - b.y) > 0.3);
  // partial fit: room for 4 -> pack gets 4, drop 6 (separate world)
  resetPickups();
  const world3 = buildWorld([playerEntity(0, 0, 0)]);
  const pl3 = world3.get('player').data; const inv3 = mkInv(1);
  const h3 = createQuestPickups({ getBook: () => null, feed() {}, defs: { arrow: { stackMax: 4, name: 'Arrow' } }, isWorn: null });
  h3.onBoot({ world: world3, player: pl3, inventory: inv3, events: bus, state: {} });
  h3.grantReward({ items: [{ id: 'arrow', n: 10 }] });
  const dr = liveDropIds().filter((x) => x);
  ok('partial fit: 4 in pack, drop 6', countOf(inv3, 'arrow') === 4 && dr.length === 1 && world3.entity(dr[0]).components.pickup.amount === 6);
  // re-collect: free a slot, stand on it -> stack moves into the pack
  inv3.slots[0] = { id: null, n: 0 };
  stepPickups(world3, { transform: { ...world3.entity(dr[0]).transform, z: 0 }, components: {} });
  ok('re-collect with room: 4 more in pack, drop shrinks to 2', countOf(inv3, 'arrow') === 8 && world3.entity(dr[0]).components.pickup.amount === 2);
  inv3.slots[1] = { id: null, n: 0 };
  stepPickups(world3, { transform: { ...world3.entity(dr[0]).transform, z: 0 }, components: {} });
  ok('rest collected, drop gone', countOf(inv3, 'arrow') === 10 && !world3.entity(dr[0]));
}


// CH12-CONTENT-01: giveOnAccept (packOps.add) into a full pack drops the leftover at the feet instead of losing it (sq.fc.cog never completable).
{
  resetPickups();
  const defs = { cog: { stackMax: 99, name: 'Cog' }, rock: { stackMax: 1, name: 'Rock' } };
  const world = buildWorld([playerEntity(2, 2, 0)]);
  const inv = { slots: Array.from({ length: SLOTS }, () => ({ id: 'rock', n: 1 })), left: null, right: null };
  const events = []; const bus = { emit: (n, p) => events.push([n, { ...p }]) };
  const book = { packOps: null, countedItems: () => [] };
  const hook = createQuestPickups({ getBook: () => book, feed() {}, defs, isWorn: null });
  hook.onBoot({ world, player: world.get('player').data, inventory: inv, events: bus, state: {} });
  hook.sync();
  const k = book.packOps.add('cog', 1);
  const live = liveDropIds().filter((x) => x);
  ok('full pack: accept-give returns 0 but a cog drop lies at the feet', k === 0 && live.length === 1 && world.entity(live[0]).components.pickup.itemId === 'cog' && world.entity(live[0]).components.pickup.amount === 1);
  ok('inventory:full emitted for the cog', events.some(([n, p]) => n === 'inventory:full' && p.id === 'cog' && p.dropped));
  inv.slots[0] = { id: null, n: 0 };
  ok('room in pack: add goes in, no new drop', book.packOps.add('cog', 1) === 1 && liveDropIds().filter((x) => x).length === 1);
}

// EQ-23b: an item sink returning the stored count (partial add into a nearly full pack) never duplicates items.
{
  resetPickups();
  const { addItem } = await import('./inventory.js');
  const { setItemPickupSink, setStackPickupSink, spawnItemDrop } = await import('./pickups.js'); setStackPickupSink(null);
  const w = buildWorld([playerEntity(0, 0, 0)]);
  const inv = { slots: Array.from({ length: SLOTS }, () => ({ id: 'rock', n: 1 })) }; inv.slots[0] = { id: 'gem', n: 3 }; const defs = { gem: { stackMax: 4, name: 'Gem' } };

  setItemPickupSink((id, n) => addItem(inv, defs, id, n));
  const did = spawnItemDrop(w, 'gem', 0, 0, 0); w.entity(did).components.pickup.amount = 3;
  stepPickups(w, { transform: { x: 0, y: 0, z: 0 }, components: {} });
  ok('partial add: pack 4, drop keeps 2, total 6 (no duplicate)', countOf(inv, 'gem') === 4 && w.entity(did).components.pickup.amount === 2);
  setItemPickupSink(null);
  ok('PICKUP_LIFE is 60 s', PICKUP_LIFE === 3600);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
