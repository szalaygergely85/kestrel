// EP-SPELLS SPELL-01: spellDefs lint + spell book.
import assert from 'node:assert/strict';
import { SPELL_DEFS, SPELL_IDS } from '../spellDefs.js';
import { createSpellBook } from './spellBook.js';

// AC3 lint
assert.deepEqual([...SPELL_IDS], ['fireball', 'freeze', 'telekinesis', 'teleport']); assert.deepEqual(Object.keys(SPELL_DEFS), [...SPELL_IDS]);
for (const id of SPELL_IDS) assert.ok(!('branch' in SPELL_DEFS[id]) && !('root' in SPELL_DEFS[id]), 'no branch/root ' + id);
for (const id of SPELL_IDS) {
  const d = SPELL_DEFS[id];
  assert.ok(/^[A-Z][A-Za-z ]+$/.test(d.name) && d.name !== id, 'plain name ' + id);
  assert.ok(d.glyph.length === 1 && d.color); assert.equal(d.tiers.length, 3);
  for (const r of d.tiers) { assert.ok(r.mana > 0 && r.cd > 0, id); }
}
// AC1
const st = {}, b = createSpellBook(st);
assert.equal(b.tier('freeze'), 0); assert.equal(b.canRaise('freeze'), false); assert.equal(b.raise('freeze'), 0);
assert.equal(b.learn('freeze'), true); assert.equal(b.learn('freeze'), false); assert.equal(st['spell.freeze'], 1);
assert.equal(b.raise('freeze'), 2); assert.equal(b.raise('freeze'), 3); assert.equal(b.raise('freeze'), 0); assert.equal(b.canRaise('freeze'), false);
assert.equal(b.learn('nope'), false); assert.equal(b.tier('nope'), 0); assert.equal(b.raise('nope'), 0); assert.equal(b.canRaise('toString'), false);
assert.deepEqual(b.learned(), ['freeze']);
// stale keys of retired spells (D-115) are ignored on load: no throw, tiers() has exactly the 4 D-021 keys
{ const old = createSpellBook({ 'spell.spark': 3, 'spell.ward': 2, 'spell.gust': 1, 'spell.updraft': 1, 'spell.lightOrb': 1, 'spell.fireRing': 1, 'spell.freeze': 2 }); assert.deepEqual(Object.keys(old.tiers()), [...SPELL_IDS]); assert.equal(old.tier('freeze'), 2); assert.equal(old.tier('spark'), 0); assert.deepEqual(old.learned(), ['freeze']); }
// AC2 migration, both old shapes
const a = createSpellBook({ 'magic.fireball': true }); assert.equal(a.tier('fireball'), 1);
const s2 = { 'magic.fireball': true, 'spells.fireball.level': 3 }; assert.equal(createSpellBook(s2).tier('fireball'), 3); assert.equal(s2['magic.fireball'], true);
assert.equal(createSpellBook({}).tier('fireball'), 0, 'not unlocked = not learned');
const s3 = {}; const b3 = createSpellBook(s3); s3['magic.fireball'] = true; assert.equal(b3.tier('fireball'), 1, 'live unlock after creation');
const s4 = {}; createSpellBook(s4).learn('fireball'); assert.equal(s4['magic.fireball'], true);
// AC4
const t0 = b.tiers(); assert.equal(b.tiers(), t0); for (let i = 0; i < 10000; i++) b.tiers();
assert.equal(createSpellBook(JSON.parse(JSON.stringify(st))).tier('freeze'), 3);
console.log('spellBook.test ok');
