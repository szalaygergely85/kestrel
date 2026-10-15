// SPELL-DEV-01. Run: node game/js/quest/sim/devSpells.test.js
import assert from 'node:assert/strict';
import { applyDevSpells } from './devSpells.js';
import { createSpellBook } from './spellBook.js';
import { SPELL_IDS } from '../spellDefs.js';
import { ensureInventory, countOf } from './inventory.js';
const defs = { 'scroll.spell': { id: 'scroll.spell', name: 'Spell Scroll', stackMax: 9 } };
const player = { components: {} }, inv = ensureInventory(player, { pack: [], left: null, right: null });
const st = { 'spell.freeze': 3 }, book = createSpellBook(st);
const r = applyDevSpells(book, inv, defs);
for (const id of SPELL_IDS) assert.equal(book.tier(id), id === 'freeze' ? 3 : 1, id);
assert.ok(!r.learned.includes('freeze') && r.learned.length === 3);
assert.equal(countOf(inv, 'scroll.spell'), 2);
applyDevSpells(book, inv, defs); assert.equal(countOf(inv, 'scroll.spell'), 2, 'idempotent: no scroll doubling');
console.log('devSpells.test.js OK');
