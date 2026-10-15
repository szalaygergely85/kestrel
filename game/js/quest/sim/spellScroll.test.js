// EP-SPELLS SPELL-02: Spell Scroll (player-chosen) + crypt chest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../../../../design/palette.js';
import '../../../../design/items.js';
import { createChests } from './chest.js';
import { CHEST_TABLES } from './chestDefs.js';
import { ensureInventory, countOf, addItem } from './inventory.js';
import { createSpellBook } from './spellBook.js';
import { useScroll, raisable, SCROLL_ID } from './spellScroll.js';

const items = globalThis.ASSETS.items.defs;
assert.ok(items[SCROLL_ID] && items[SCROLL_ID].name === 'Spell Scroll' && items[SCROLL_ID].stackMax === 9);
const t = CHEST_TABLES.chestCrypt;
assert.deepEqual(t.fixed.map((f) => f.item).sort(), ['potion.hp', 'scroll.spell']);
const player = { transform: {}, components: {} };
const inv = ensureInventory(player, { pack: [], left: null, right: null });
const d = { id: 'c', x: 0, y: 0, z: 0, frontX: 0, frontY: 1, propId: 'c', interact: { radius: 2, facingDeg: 70, facingCos: 0.342 }, table: t };
const sim = createChests([d], { items, inventoryOf: () => inv, events: { emit() {} }, seed: 1 });
assert.equal(sim.open('c', { x: 0, y: 1, z: 0, forwardX: 0, forwardY: -1, onBottom: true }), true); sim.step(1);
assert.equal(countOf(inv, SCROLL_ID), 1); assert.equal(countOf(inv, 'potion.hp'), 1);

const st = {}, book = createSpellBook(st);
assert.deepEqual(raisable(book), []);
assert.deepEqual(useScroll(inv, book, 'fireball'), { ok: false, reason: 'notLearned' }); assert.equal(countOf(inv, SCROLL_ID), 1);
book.learn('freeze'); book.learn('fireball');
assert.deepEqual(raisable(book).map((q) => q.id), ['fireball', 'freeze'], 'tree order');
assert.deepEqual(useScroll(inv, book, 'freeze'), { ok: true, level: 2 });
assert.equal(countOf(inv, SCROLL_ID), 0); assert.equal(book.tier('fireball'), 1); assert.equal(book.tier('freeze'), 2);
assert.deepEqual(useScroll(inv, book, 'freeze'), { ok: false, reason: 'none' });
addItem(inv, items, SCROLL_ID, 3);
assert.equal(useScroll(inv, book, 'freeze').level, 3);
assert.deepEqual(useScroll(inv, book, 'freeze'), { ok: false, reason: 'max' }); assert.equal(countOf(inv, SCROLL_ID), 2);
assert.equal(useScroll(inv, book, 'fireball').level, 2);
assert.deepEqual(useScroll(inv, book, 'nope'), { ok: false, reason: 'notLearned' });
// AC4 no random in the scroll path
const src = fs.readFileSync(new URL('./spellScroll.js', import.meta.url), 'utf8');
assert.ok(!/Math\.random|rng|seed/i.test(src));
console.log('spellScroll.test ok');

// SPELL-ARCH7: one per-world book. Tab, pack overlay and fireball tier hook all read `current`; after a world reload (new state, new book) they all see the new tiers.
{
  const { createSpellBook: mk } = await import('./spellBook.js');
  let current = mk({ 'spell.fireball': 2 });
  const tab = { tier: (id) => current.tier(id) }, pack = { options: () => raisable(current) }, hook = () => current.tier('fireball') || 1;
  assert.equal(tab.tier('fireball'), 2); assert.equal(hook(), 2); assert.deepEqual(pack.options(), raisable(current));
  current = mk({}); // reload: fresh world state
  assert.equal(tab.tier('fireball'), 0); assert.equal(hook(), 1); assert.deepEqual(pack.options(), []);
}
