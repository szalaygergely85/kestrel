// BEND-NPC-01: an OLD save (made when Bram was the hand-in) with sq.rb.parcel READY -> after the move it is handed in at Joss.
// Run: node game/js/quest/sim/jossOldSave.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../../questBoot.js';
import { createQuestBook, READY, DONE } from './questBook.js';
import { loadDesignAssets } from '../../../../tools/validate-content.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const getJson = async (url) => JSON.parse(readFileSync(new URL(url, new URL('game/', ROOT)), 'utf8'));
const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(getJson, { items, log: () => {} });
const ID = 'sq.rb.parcel';
const real = files.giverDefs.find((d) => d.id === ID);
assert.equal(real.giver.npc, 'joss'); assert.equal(real.giver.turnIn || real.giver.npc, 'joss');

const pack = new Map();
const ops = { count: (id) => pack.get(id) || 0, remove: (id, n) => pack.set(id, (pack.get(id) || 0) - n), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => true };

// 1) the old save: the quest as Bram's book saved it (giver postkeeper, requires stripped so it can be driven alone)
const old = structuredClone(real); old.requires = []; old.giver = { ...old.giver, npc: 'postkeeper', turnIn: 'postkeeper' };
for (const o of old.objectives) if (o.when.type === 'deliver') o.when.to = 'postkeeper';
const b0 = createQuestBook(files.questDef, [old], null); b0.packOps = ops;
assert.ok(b0.accept(ID), 'accepted in the old book');
b0.feed({ type: 'item:count', id: 'brass.scrap', n: 1 });
assert.equal(b0.statusOf(ID), READY, 'old save has the parcel READY');
const save = JSON.parse(JSON.stringify(b0.toSave()));
assert.equal(save.quests[ID].accepted, true);

// 2) load it into the NEW book (real defs): same status, hand-in moved to Joss
const book = createQuestBook(files.questDef, files.giverDefs, save); book.packOps = ops;
const i = book.index(ID);
assert.equal(book.statusOf(ID), READY, 'still READY after load');
assert.equal(book.giverOf(i), 'joss'); assert.equal(book.turnInOf(i), 'joss');
const r = book.handIn(ID);
assert.ok(r && r.items && r.items.length, 'hand-in at Joss pays the reward');
assert.equal(book.statusOf(ID), DONE); assert.equal(pack.get('brass.scrap'), 0, 'brass consumed at Joss');
console.log('jossOldSave.test.js: ok');
