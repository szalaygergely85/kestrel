// EP-SPELLS SPELL-01: spellDefs lint + spell book.
import assert from 'node:assert/strict';
import { SPELL_DEFS, SPELL_IDS, BRANCHES } from '../spellDefs.js';
import { createSpellBook } from './spellBook.js';

// AC3 lint
assert.equal(SPELL_IDS.length, 7); assert.equal(Object.keys(SPELL_DEFS).length, 7);
for (const b of BRANCHES) assert.equal(SPELL_IDS.filter((i) => SPELL_DEFS[i].branch === b && SPELL_DEFS[i].root).length, 1, 'one root per ' + b);
for (const id of SPELL_IDS) {
  const d = SPELL_DEFS[id];
  assert.ok(/^[A-Z][A-Za-z ]+$/.test(d.name) && d.name !== id, 'plain name ' + id);
  assert.ok(d.glyph.length === 1 && d.color); assert.equal(d.tiers.length, 3);
  for (const r of d.tiers) { assert.ok(r.mana > 0 && r.cd > 0, id); }
}
// AC1
const st = {}, b = createSpellBook(st);
assert.equal(b.tier('spark'), 0); assert.equal(b.canRaise('spark'), false); assert.equal(b.raise('spark'), 0);
assert.equal(b.learn('spark'), true); assert.equal(b.learn('spark'), false); assert.equal(st['spell.spark'], 1);
assert.equal(b.raise('spark'), 2); assert.equal(b.raise('spark'), 3); assert.equal(b.raise('spark'), 0); assert.equal(b.canRaise('spark'), false);
assert.equal(b.learn('nope'), false); assert.equal(b.tier('nope'), 0); assert.equal(b.raise('nope'), 0); assert.equal(b.canRaise('toString'), false);
assert.deepEqual(b.learned(), ['spark']);
// AC2 migration, both old shapes
const a = createSpellBook({ 'magic.fireball': true }); assert.equal(a.tier('fireball'), 1);
const s2 = { 'magic.fireball': true, 'spells.fireball.level': 3 }; assert.equal(createSpellBook(s2).tier('fireball'), 3); assert.equal(s2['magic.fireball'], true);
assert.equal(createSpellBook({}).tier('fireball'), 0, 'not unlocked = not learned');
const s3 = {}; const b3 = createSpellBook(s3); s3['magic.fireball'] = true; assert.equal(b3.tier('fireball'), 1, 'live unlock after creation');
const s4 = {}; createSpellBook(s4).learn('fireball'); assert.equal(s4['magic.fireball'], true);
// AC4
const t0 = b.tiers(); assert.equal(b.tiers(), t0); for (let i = 0; i < 10000; i++) b.tiers();
assert.equal(createSpellBook(JSON.parse(JSON.stringify(st))).tier('spark'), 3);
console.log('spellBook.test ok');
