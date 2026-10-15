// OB-187: no side-quest '!' (blue) while the opening chain (burl.follow / burl.stone) is unfinished; it appears once burl.stone is done.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { applyQuestPreset } from './statePreset.js';
import { createQuestBook } from './sim/questBook.js';
import { gateOnMeet } from './errands.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';

const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => JSON.parse(readFileSync(new URL('../../../' + u.replace(/^\.\.\//, ''), import.meta.url), 'utf8')), { items, log() {} });
assert.deepEqual(files.errors, []);
const defs = gateOnMeet(files.giverDefs);
const marks = (qid, preset) => {
  const r = applyQuestPreset({ main: files.questDef, givers: defs }, qid, preset);
  const book = createQuestBook(files.questDef, defs, r.save);
  const gA = [], gR = [], sA = [], sR = [];
  book.markLists(gA, gR, sA, sR);
  return { sA, book };
};
// burl.stone accepted, waystone not woken: no blue offers anywhere (the gondola's sq.wreck.plate used to show one)
const mid = marks('burl.stone', 'accepted');
assert.deepEqual(mid.sA, [], 'no blue ! before the waystone quest is done: ' + mid.sA);
assert.equal(mid.book.statusOf('sq.wreck.plate'), 0, 'gondola quest still unavailable');
// once the waystone quest is done the gondola offer is allowed (frozen defs untouched)
const after = marks('sq.wreck.plate', 'notStarted');
assert.ok(after.sA.includes('gondola'), 'gondola ! after burl.stone done');
assert.ok(files.giverDefs.find((d) => d.id === 'sq.wreck.plate').requires.length === 1, 'input defs not mutated');
console.log('ob187 OK');
