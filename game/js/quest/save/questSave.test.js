// QG-02: game.quests field + migrateQuestSave fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { createQuest, applyQuestEvent } from '../sim/quest.js';
import { migrateQuestSave, createQuestBook } from '../sim/questBook.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave, validateSave, SAVE_VERSION } from './saveState.js';
const rd = p => JSON.parse(readFileSync(new URL('../../../../content/quests/' + p, import.meta.url)));
const m1 = rd('m1.quest.json'), burl = rd('burl.boars.quest.json'), defs = { main: m1, givers: [burl] };
const assets = new AssetRegistry({ palette: {} }), world = World.load({ name: 'qs', terrain: null, structures: [], entities: [] }, assets, {});
const m1At = (n, dead = []) => {
  const q = createQuest(m1);
  const evs = [{ type: 'flag:set', key: 'wake', value: true }, { type: 'item:got', id: 'lantern' }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }];
  for (const e of evs.slice(0, Math.min(n, 4))) applyQuestEvent(q, e, m1);
  for (const id of dead) applyQuestEvent(q, { type: 'beast:died', id }, m1);
  return q;
};
assert.equal(SAVE_VERSION, 1);

// migration fixtures
const done = m1At(4, ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']); assert.ok(done.completed.includes('beasts'));
let m = migrateQuestSave({ quest: done, deadBeasts: [] }, defs);
assert.deepEqual([m['burl.boars'].accepted, m['burl.boars'].handedIn, m['burl.boars'].quest.completed], [true, true, ['beasts']]);
let book = createQuestBook(m1, [burl], { quest: done, quests: m });
assert.equal(book.status(1), 4, 'done');
assert.equal(book.handIn('burl.boars'), null, 'no retroactive reward');

const mid = m1At(4, ['boar1', 'boar2']); assert.equal(mid.completed.length, 4);
m = migrateQuestSave({ quest: mid, deadBeasts: ['boar2', 'boar3'] }, defs);
assert.deepEqual([m['burl.boars'].accepted, m['burl.boars'].handedIn], [true, false]);
assert.deepEqual(m['burl.boars'].quest.deadBeasts, ['boar1', 'boar2', 'boar3'], 'old m1 + game dead beasts');
assert.equal(createQuestBook(m1, [burl], { quest: mid, quests: m }).status(1), 2);
const ready = migrateQuestSave({ quest: mid, deadBeasts: ['boar3', 'boar4', 'boar5'] }, defs);
assert.equal(createQuestBook(m1, [burl], { quest: mid, quests: ready }).status(1), 3, 'all 5 dead -> ready (Burl shows ?)');

assert.equal(migrateQuestSave({ quest: m1At(3), deadBeasts: ['boar1'] }, defs), null, 'earlier -> nothing');
assert.equal(migrateQuestSave({ quest: null, deadBeasts: [] }, defs), null);
const existing = { 'burl.boars': { quest: createQuest(burl), accepted: false, handedIn: false } };
assert.equal(migrateQuestSave({ quest: done, quests: existing }, defs), existing, 'present field wins');

// round trip + old-save shape unchanged
const q1 = m1At(4); const bk = createQuestBook(m1, [burl], { quest: q1 }); bk.accept('burl.boars'); bk.feed({ type: 'beast:died', id: 'boar1' });
const s = bk.toSave();
const save = collectSave(world, { quest: bk.main, questDef: m1, quests: s.quests, giverDefs: [burl], deadBeasts: ['boar1'] });
assert.ok(save.game.quests['burl.boars'].accepted);
const text = stringifyGameSave(save);
const back = applySave(parseGameSave(text), assets, { questDef: m1, giverDefs: [burl] });
assert.deepEqual(back.quests, save.game.quests);
assert.equal(stringifyGameSave(collectSave(back.world, { quest: back.quest, questDef: m1, quests: back.quests, giverDefs: [burl], deadBeasts: back.deadBeasts })), text, 'byte-stable');
const old = collectSave(world, { quest: q1, questDef: m1, deadBeasts: ['boar1'] });
assert.equal('quests' in old.game, false, 'old shape: no quests key');
assert.equal(applySave(old, assets, { questDef: m1 }).quests, null);
assert.equal(applySave(old, assets, { questDef: m1, giverDefs: [burl] }).quests['burl.boars'].accepted, true, 'applySave migrates old saves when giver defs are given');
const badSave = structuredClone(save); badSave.game.quests['burl.boars'].accepted = 'yes';
assert.throws(() => validateSave(badSave));
const badId = structuredClone(save); badId.game.quests['burl.boars'].quest.questId = 'x';
assert.throws(() => validateSave(badId));
assert.throws(() => collectSave(world, { quest: q1, questDef: m1, quests: s.quests }), /giver quest definition/);
console.log('questSave.test OK');
