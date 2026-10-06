// game/js/quest/sim/inventory.test.js (US-091a1, architecture.md 37.16.4). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/inventory.test.js
//
// Pure-function cases (stacking / full pack / hand rules / hashInto) run against plain inventory objects -
// no World needed. The save round trip, death-keeps-items and old-save migration cases use a real engine
// `World` with an inline-xyz `player` entity (the pickups.test.js / vitals.test.js pattern). Item defs come
// from the REAL designer `design/items.js` (side-effect import -> globalThis.ASSETS.items), not a hand-rolled
// fixture, so the stacking numbers (meat 10 / hide 20 / tusk 20 / sword 1) are the shipped ones.
import { World, serialize, deserialize, createHasher } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import {
  ensureInventory, addItem, removeItem, countOf, assignHand, swapHands, hashInto,
  validateItemDefs, migrateSword, SLOTS,
} from './inventory.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as CFG } from './vitalsConfig.js';
import itemsMod from '../../../../design/items.js'; // classic script: side effects on globalThis.ASSETS (ASSETS.items)

const { assets } = await loadTestAssets();
itemsMod; // classic script: side effect on globalThis.ASSETS (ASSETS.items)

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const defs = globalThis.ASSETS.items.defs;
const DEMO_START = { pack: [{ id: 'spell.fireball', n: 1 }], left: null, right: 'spell.fireball' };
const EMPTY_START = { pack: [], left: null, right: null };

function freshInv(start = EMPTY_START) {
  return ensureInventory({ components: {} }, start);
}

function playerEntity(x = 0, y = 0, z = 0) {
  return {
    id: 'player', type: 'player', x, y, z,
    components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } },
  };
}
function buildWorld(entities) {
  return World.load({ name: 'inventoryTest', terrain: null, structures: [], entities, state: {} }, assets, {});
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

// -----------------------------------------------------------------------------------------------------------
// 1. addItem stacks first in slot order, then the first empty slot; full pack + 24-slot capacity.
// -----------------------------------------------------------------------------------------------------------
{
  const inv = freshInv();
  ok('addItem stacks 3 meat into slot 0', addItem(inv, defs, 'boar.meat', 3) === 3 && inv.slots[0].id === 'boar.meat' && inv.slots[0].n === 3);
  ok('addItem tops up the same stack', addItem(inv, defs, 'boar.meat', 4) === 4 && inv.slots[0].n === 7);
  ok('addItem overflows into a second slot at stackMax 10', addItem(inv, defs, 'boar.meat', 5) === 5 && inv.slots[0].n === 10 && inv.slots[1].n === 2);
  ok('countOf sums across slots', countOf(inv, 'boar.meat') === 12);
}
{
  const inv = freshInv();
  for (let i = 0; i < SLOTS; i++) addItem(inv, defs, 'boar.meat', 10); // 24 slots * 10 = 240
  ok('24 slots hold 240 meat (full capacity)', countOf(inv, 'boar.meat') === 240);
  ok('a full pack adds nothing', addItem(inv, defs, 'boar.meat', 1) === 0);
  ok('addItem with n <= 0 adds nothing', addItem(inv, defs, 'boar.meat', 0) === 0 && addItem(inv, defs, 'boar.meat', -1) === 0);
}
{
  const inv = freshInv();
  ok('an unknown id adds nothing', addItem(inv, defs, 'nope.item', 5) === 0);
  ok('a non-stackable def (orb.hp stackMax 0) adds nothing', addItem(inv, defs, 'orb.hp', 1) === 0 && countOf(inv, 'orb.hp') === 0);
}

// -----------------------------------------------------------------------------------------------------------
// 2. removeItem drains the last (partial) slot first; count 0 empties the hand that referenced the item.
// -----------------------------------------------------------------------------------------------------------
{
  const inv = freshInv();
  addItem(inv, defs, 'boar.meat', 12); // slot0 = 10, slot1 = 2
  addItem(inv, defs, 'sword', 1);      // slot2 = 1
  assignHand(inv, 'left', 'sword');
  ok('removeItem drains the last (partial) slot first', removeItem(inv, 'boar.meat', 3) === 3 && inv.slots[0].n === 9 && inv.slots[1].id === null);
  ok('removeItem removes only what exists', removeItem(inv, 'boar.meat', 999) === 9 && countOf(inv, 'boar.meat') === 0);
  ok('count 0 empties the hand that referenced the item', removeItem(inv, 'sword', 1) === 1 && inv.left === null);
  ok('removeItem of an absent id returns 0', removeItem(inv, 'boar.tusk', 1) === 0);
}

// -----------------------------------------------------------------------------------------------------------
// 3. assignHand: pack membership, never in both hands, null empties; swapHands.
// -----------------------------------------------------------------------------------------------------------
{
  const inv = freshInv();
  addItem(inv, defs, 'sword', 1);
  addItem(inv, defs, 'spell.fireball', 1);
  ok('assignHand fails for an item not in the pack', assignHand(inv, 'left', 'torch') === false && inv.left === null);
  ok('assignHand fails for a bad hand name', assignHand(inv, 'both', 'sword') === false);
  ok('assignHand puts sword in the left hand', assignHand(inv, 'left', 'sword') === true && inv.left === 'sword');
  ok('assignHand moves the sword to the right (empties left - never in both)', assignHand(inv, 'right', 'sword') === true && inv.right === 'sword' && inv.left === null);
  ok('assignHand null empties a hand', assignHand(inv, 'right', null) === true && inv.right === null);
  assignHand(inv, 'left', 'sword');
  assignHand(inv, 'right', 'spell.fireball');
  swapHands(inv);
  ok('swapHands swaps the two hands', inv.left === 'spell.fireball' && inv.right === 'sword');
}

// -----------------------------------------------------------------------------------------------------------
// 4. ensureInventory creates only when missing; demo start = fireball in pack + right hand.
// -----------------------------------------------------------------------------------------------------------
{
  const player = { components: {} };
  const inv = ensureInventory(player, DEMO_START);
  ok('ensureInventory creates 24 slots', inv.slots.length === SLOTS);
  ok('demo start: fireball in the pack, right hand, left empty', inv.slots[0].id === 'spell.fireball' && inv.slots[0].n === 1 && inv.left === null && inv.right === 'spell.fireball');
  const same = ensureInventory(player, EMPTY_START);
  ok('ensureInventory is a no-op when the component exists', same === inv && inv.slots[0].id === 'spell.fireball' && inv.right === 'spell.fireball');
}

// -----------------------------------------------------------------------------------------------------------
// 5. Save round trip: slots + hands survive serialize/deserialize.
// -----------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity()]);
  const player = world.get('player').data;
  const inv = ensureInventory(player, EMPTY_START);
  addItem(inv, defs, 'spell.fireball', 1);
  addItem(inv, defs, 'boar.meat', 5);
  addItem(inv, defs, 'sword', 1);
  assignHand(inv, 'left', 'sword');
  assignHand(inv, 'right', 'spell.fireball');
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  const inv2 = loaded.get('player').data.components.inventory;
  ok('round trip keeps the slots', inv2.slots.length === SLOTS && countOf(inv2, 'boar.meat') === 5 && countOf(inv2, 'sword') === 1 && countOf(inv2, 'spell.fireball') === 1);
  ok('round trip keeps the hands', inv2.left === 'sword' && inv2.right === 'spell.fireball');
}

// -----------------------------------------------------------------------------------------------------------
// 6. Death respawn keeps the pack and hands (vitals.respawn never touches the inventory component).
// -----------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([playerEntity()]);
  const events = makeEvents();
  const vitals = createVitals(world, events, CFG, {});
  const player = world.get('player').data;
  vitals.step(player, false); // lazily creates components.health/mana
  const inv = ensureInventory(player, DEMO_START);
  addItem(inv, defs, 'boar.meat', 3);
  killAndRespawn(vitals, player);
  ok('death keeps the pack', countOf(inv, 'boar.meat') === 3 && countOf(inv, 'spell.fireball') === 1);
  ok('death keeps the hands', inv.left === null && inv.right === 'spell.fireball');
}

// -----------------------------------------------------------------------------------------------------------
// 7. Old save with the sword taken migrates: sword in the pack + left hand (pure + full-flow over a World).
// -----------------------------------------------------------------------------------------------------------
{
  const inv = freshInv();
  ok('migrateSword on a sword-less pack adds sword + left', migrateSword(inv, defs) === true && countOf(inv, 'sword') === 1 && inv.left === 'sword');
  ok('migrateSword is idempotent (sword already present)', migrateSword(inv, defs) === false && countOf(inv, 'sword') === 1);
}
{
  const world = buildWorld([playerEntity()]);
  world.state['tower.sword.taken'] = true;
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  const player = loaded.get('player').data;
  ensureInventory(player, DEMO_START);
  migrateSword(player.components.inventory, defs);
  ok('old save migrates: sword in pack + left, fireball right', countOf(player.components.inventory, 'sword') === 1 && player.components.inventory.left === 'sword' && player.components.inventory.right === 'spell.fireball');
}

// -----------------------------------------------------------------------------------------------------------
// 8. hashInto: stable, changes with state, and alloc-free.
// -----------------------------------------------------------------------------------------------------------
{
  const inv = freshInv();
  addItem(inv, defs, 'boar.meat', 5);
  addItem(inv, defs, 'sword', 1);
  assignHand(inv, 'left', 'sword');
  const h = createHasher();
  hashInto(inv, h);
  const v1 = h.value();
  h.reset();
  hashInto(inv, h);
  ok('hashInto is stable for identical state', v1 === h.value());
  addItem(inv, defs, 'boar.hide', 1);
  h.reset();
  hashInto(inv, h);
  ok('hashInto changes when the pack changes', h.value() !== v1);
  if (typeof global.gc === 'function') {
    for (let i = 0; i < 1000; i++) { h.reset(); hashInto(inv, h); } // JIT warmup
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) { h.reset(); hashInto(inv, h); }
    global.gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok('hashInto allocates nothing (200k calls)', grew < 65536, `grew ${grew} bytes`);
  } else {
    for (let i = 0; i < 200000; i++) { h.reset(); hashInto(inv, h); }
    ok('hashInto runs 200k calls without throwing (run with --expose-gc for the strict gate)', true);
  }
}

// -----------------------------------------------------------------------------------------------------------
// 9. validateItemDefs: the real designer defs pass; a bad def throws naming the id.
// -----------------------------------------------------------------------------------------------------------
{
  ok('real designer defs validate', (() => { validateItemDefs(defs); return true; })());
  const bad = { ...defs, 'bad.item': { id: 'bad.item', name: '', kind: 'weapon', stackMax: 1, icon: { glyphs: ['   ', '   ', '   '], fg: ['   ', '   ', '   '] } } };
  let threw = null;
  try { validateItemDefs(bad); } catch (e) { threw = e; }
  ok('a bad def throws naming its id', !!threw && /bad\.item/.test(threw.message), threw && threw.message);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
