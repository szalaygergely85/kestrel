// OB-115: kind kill objectives count ANY beast of the kind killed after accept; save/load keeps the count; old saves seed once.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, ACTIVE, READY } from './questBook.js';
import { toQuestSaveV2, fromQuestSaveV2 } from './questSaveV2.js';
const main = { version: 1, id: 'm1', objectives: [{ id: 'wake', text: 'Wake', when: { type: 'flag', id: 'wake', equals: true } }] };
const def = JSON.parse(readFileSync(new URL('../../../../content/quests/burl.boars.quest.json', import.meta.url)));
def.requires = undefined;
assert.equal(def.objectives[0].when.kind, 'boar');
const die = (b, id) => b.feed({ type: 'beast:died', id });
const prog = b => b.objectives(1, [])[0].progress;

let b = createQuestBook(main, [def]);
die(b, 'boarN1'); die(b, 'boar1'); // before accept: not counted
assert.ok(b.accept(def.id)); assert.equal(prog(b), 0);
die(b, 'boar1'); die(b, 'boar2'); die(b, 'boar3'); die(b, 'boarN1'); die(b, 'wolf1'); // wolf ignored
assert.equal(prog(b), 4); assert.equal(b.statusOf(def.id), ACTIVE);

// save/load mid-count (v1 map and v2 compact)
const v1 = JSON.parse(JSON.stringify(b.toSave()));
let b2 = createQuestBook(main, [def], v1); assert.equal(prog(b2), 4);
const v2 = JSON.parse(JSON.stringify(toQuestSaveV2(v1.quests, [def])));
const back = fromQuestSaveV2(v2, [def], ['boar1', 'boarN1', 'boarN2', 'boarN3']); // dead set must NOT re-add kills
let b3 = createQuestBook(main, [def], { quest: v1.quest, quests: back }); assert.equal(prog(b3), 4);
die(b3, 'boarW1'); assert.equal(prog(b3), 5); assert.equal(b3.statusOf(def.id), READY);
die(b3, 'boarW2'); assert.equal(prog(b3), 5);

// old save: accepted, no kk flag, dead set seeds the count once
const old = { v: 2, done: [], active: { [def.id]: { c: 0, a: 1, s: 1 } }, tracked: null };
const oq = fromQuestSaveV2(old, [def], ['boar1', 'boar2', 'boar3', 'wolf1']);
let b4 = createQuestBook(main, [def], { quest: null, quests: oq }); assert.equal(prog(b4), 3);
// not accepted: dead set does not count
const nq = fromQuestSaveV2({ v: 2, done: [], active: {}, tracked: null }, [def], ['boar1', 'boar2']);
let b5 = createQuestBook(main, [def], { quest: null, quests: nq }); assert.equal(prog(b5), 0);
// brute feed agrees with the indexed feed
let b6 = createQuestBook(main, [def]); b6.accept(def.id); b6.feedBrute({ type: 'beast:died', id: 'boarX1' }); assert.equal(prog(b6), 1);
console.log('questKindKill ok');
