import assert from 'node:assert/strict';
import { applyQuestMessage } from './questPatchRecv.js';
import { createQuestBook } from './sim/questBook.js';
import { readFileSync } from 'node:fs';

const rd = (f) => JSON.parse(readFileSync(new URL('../../../content/quests/' + f, import.meta.url), 'utf8'));
const side = (() => { const d = rd('burl.boars.quest.json'); delete d.requires; return d; })();
const mk = () => createQuestBook(rd('m1.quest.json'), [JSON.parse(JSON.stringify(side))]);

// patch applies title / returnText / objective text; structure and state untouched
{
  const book = mk(); const before = JSON.stringify(book.toSave());
  const o0 = side.objectives[0];
  const r = applyQuestMessage({ getBook: () => book, getDialogues: () => ({}), compile: (x) => x }, { type: 'quest-patch', id: side.id, def: { title: 'NEW T', returnText: 'NEW R', objectives: [{ id: o0.id, text: 'NEW O', journal: 'NEW J' }] } });
  assert.equal(r.ok, true);
  const d = book.def(1);
  assert.equal(d.title, 'NEW T'); assert.equal(d.returnText, 'NEW R'); assert.equal(d.objectives[0].text, 'NEW O'); assert.equal(d.objectives[0].journal, 'NEW J');
  assert.deepEqual(d.objectives[0].when, o0.when); assert.deepEqual(d.giver, side.giver);
  // no-save-leak: the save after a patch equals the save without it
  assert.equal(JSON.stringify(book.toSave()), before);
  assert.ok(!JSON.stringify(book.toSave()).includes('NEW T'));
}
// unknown quest / bad input
{
  const book = mk(); const env = { getBook: () => book, getDialogues: () => ({}), compile: (x) => x };
  assert.equal(applyQuestMessage(env, { type: 'quest-patch', id: 'nope', def: {} }).ok, false);
  assert.equal(applyQuestMessage(env, { type: 'other' }), null);
  assert.equal(applyQuestMessage({ ...env, getBook: () => null }, { type: 'quest-patch', id: 'x', def: {} }).ok, false);
}
// dialogue patch replaces only an existing table, through regen + compile
{
  const dl = { bear: { c: 'old' } }, env = { getBook: () => null, getDialogues: () => dl, compile: (x) => ({ c: x.tag }), regen: (id, raw) => ({ ...raw, tag: raw.tag + '+gen' }) };
  assert.equal(applyQuestMessage(env, { type: 'dialogue-patch', id: 'bear', raw: { tag: 'new' } }).ok, true);
  assert.equal(dl.bear.c, 'new+gen');
  assert.equal(applyQuestMessage(env, { type: 'dialogue-patch', id: 'ghost', raw: { tag: 'x' } }).ok, false);
  assert.ok(!dl.ghost);
}
console.log('questPatchRecv ok');
