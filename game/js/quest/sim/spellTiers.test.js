// D-114: Spell Scroll + fireball level.
import assert from 'node:assert/strict';
import '../../../../design/palette.js';
import '../../../../design/items.js';
import { createChests } from './chest.js';
import { CHEST_TABLES } from './chestDefs.js';
import { ensureInventory, countOf, addItem } from './inventory.js';
import { spellLevel, spellDamageScale, upgradableSpells, upgradeSpell, useScroll, spellTiers, SCROLL_ID, SPELLS } from './spellTiers.js';

const items = globalThis.ASSETS.items.defs;
assert.ok(items[SCROLL_ID] && items[SCROLL_ID].name === 'Spell Scroll');
// chest contents
const t = CHEST_TABLES.chestCrypt;
assert.deepEqual(t.fixed.map((f) => f.item).sort(), ['potion.hp', 'scroll.spell']);
assert.equal(t.gear, undefined);
const player = { transform: {}, components: {} };
const inv = ensureInventory(player, { pack: [], left: null, right: null });
const d = { id: 'c', x: 0, y: 0, z: 0, frontX: 0, frontY: 1, propId: 'c', interact: { radius: 2, facingDeg: 70, facingCos: 0.342 }, table: t };
const sim = createChests([d], { items, inventoryOf: () => inv, events: { emit() {} }, seed: 1 });
assert.equal(sim.open('c', { x: 0, y: 1, z: 0, forwardX: 0, forwardY: -1, onBottom: true }), true); sim.step(1);
assert.equal(countOf(inv, SCROLL_ID), 1); assert.equal(countOf(inv, 'potion.hp'), 1); 

const on = (id) => id === 'fireball', off = () => false;
const state = {};
assert.equal(spellLevel({}, 'fireball'), 1, 'old save -> level 1'); assert.equal(spellLevel(undefined, 'fireball'), 1);
assert.deepEqual(SPELLS.fireball.damageScale.slice(1), [1, 1.75, 2.25]);
// no spell learned yet: nothing offered, scroll stays
assert.deepEqual(upgradableSpells(state, off), []);
assert.equal(useScroll(inv, state, 'fireball', off), 0); assert.equal(countOf(inv, SCROLL_ID), 1);
assert.deepEqual(spellTiers(state, off), {});
// cancel = no call: scroll kept, level unchanged
assert.equal(countOf(inv, SCROLL_ID), 1); assert.equal(spellLevel(state, 'fireball'), 1);
// choose
assert.deepEqual(upgradableSpells(state, on), [{ id: 'fireball', level: 1, max: 3 }]);
assert.equal(useScroll(inv, state, 'fireball', on), 2);
assert.equal(countOf(inv, SCROLL_ID), 0); assert.equal(spellDamageScale(state, 'fireball'), 1.75);
assert.equal(useScroll(inv, state, 'fireball', on), 0, 'no scroll left');
assert.deepEqual(spellTiers(state, on), { fireball: 2 });
// maxed spell not offered; scroll kept
addItem(inv, items, SCROLL_ID, 3);
assert.equal(useScroll(inv, state, 'fireball', on), 3); assert.equal(spellDamageScale(state, 'fireball'), 2.25);
assert.deepEqual(upgradableSpells(state, on), []);
assert.equal(useScroll(inv, state, 'fireball', on), 0); assert.equal(countOf(inv, SCROLL_ID), 2);
assert.equal(upgradeSpell(state, 'nope', () => true), 0);
// save/load (world.state is JSON)
assert.equal(spellLevel(JSON.parse(JSON.stringify(state)), 'fireball'), 3);
console.log('spellTiers.test ok');
