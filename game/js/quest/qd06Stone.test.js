// QD-06: "The Humming Stone" (merge of sq.burl.stone + sq.burl.hint). 2 objectives: touch the waystone, read the knot (note.stoneKnot).
// Run: node game/js/quest/qd06Stone.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE } from './sim/questBook.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';
import { gateOnMeet } from './errands.js';

const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => rd('game/' + u), { items, log: () => {} });
assert.deepEqual(files.errors, []);
const defs = gateOnMeet(files.giverDefs);
assert.ok(!defs.some((d) => d.id === 'sq.burl.hint'), 'sq.burl.hint is cut');
assert.ok(!defs.some((d) => (d.requires || []).some((r) => r.quest === 'sq.burl.hint')), 'nothing requires the cut quest');
const def = defs.find((d) => d.id === 'sq.burl.stone');
assert.equal(def.title, 'The Humming Stone');
assert.equal(def.objectives.length, 2, '2 objectives');
for (const o of def.objectives) assert.ok((o.journal || o.text).length <= 38, 'short line: ' + (o.journal || o.text));
const texts = rd('content/dialogue/inspect.json').texts;
assert.ok(texts['note.stoneKnot'] && !/maren/i.test(JSON.stringify(texts['note.stoneKnot'])), 'neutral knot note');
const w = rd('content/worlds/world_m1.world.json');
assert.ok(w.entities.some((e) => e.id === 'qd06_stoneKnot' && e.components.inspect.text === 'note.stoneKnot'), 'knot anchor placed');

const pack = new Map();
const book = createQuestBook(files.questDef, defs, null);
book.packOps = { count: (id) => pack.get(id) || 0, remove: () => {}, add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => false };
const feed = (e) => book.feed(e), flag = (key) => feed({ type: 'flag:set', key, value: true });
for (const o of files.questDef.objectives) { const t = o.when; if (t.type === 'flag') flag(t.id); else if (t.type === 'area') feed({ type: 'area:entered', id: t.id }); else if (t.type === 'beasts') for (const id of t.ids) feed({ type: 'beast:died', id }); }
flag('burl.home');
for (const id of ['tower.blade', 'burl.boars']) { book.accept(id); for (const o of book.def(book.index(id)).objectives) { const w = o.when; if (w.type === 'beasts') for (const b of w.ids) feed({ type: 'beast:died', id: b }); else if (w.type === 'item') feed({ type: 'item:got', id: w.id }); else if (w.type === 'area') feed({ type: 'area:entered', id: w.id }); else if (w.type === 'flag') flag(w.id); } book.handIn(id); }
for (const [id, f] of [['burl.follow', 'burl.arrived'], ['burl.stone', 'waystone.waystone.woken']]) { book.accept(id); flag(f); book.handIn(id); }
flag('burl.home.met');
flag('talk.qd06_stoneKnot'); // before accepting: must not count (OB-115)
assert.equal(book.statusOf('sq.burl.stone'), AVAILABLE, 'offered at Burl');
book.accept('sq.burl.stone');
assert.equal(book.statusOf('sq.burl.stone'), ACTIVE, 'active; early knot read did not count');
feed({ type: 'area:entered', id: 'waystone' });
assert.equal(book.statusOf('sq.burl.stone'), ACTIVE, 'touch alone is not enough');
flag('talk.qd06_stoneKnot');
assert.equal(book.statusOf('sq.burl.stone'), READY, 'knot read -> ? at Burl');
const rw = book.handIn('sq.burl.stone');
assert.equal(book.statusOf('sq.burl.stone'), DONE);
assert.deepEqual(rw.items.map((i) => i.id + 'x' + i.n), ['potion.hpx1', 'arrowx10']);
console.log('qd06Stone: 2 objectives -> ? -> hand-in -> Health Potion + 10 arrows PASS');
