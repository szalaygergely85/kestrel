// OB-124/125/126/133: marker colour classes, offer-only relay touch, packet inspect feedback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook, ACTIVE, READY } from './sim/questBook.js';
import { createErrands } from './errands.js';
import { addSideMarks, SIDE_MATS } from './markSide.js';

const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const m1 = JSON.parse(fs.readFileSync(dir + '/m1.quest.json', 'utf8'));
const mk = (id, npc, extra = {}) => ({ version: 1, id, title: id, giver: { npc, text: 'hi' }, objectives: [{ id: 'o', text: 'do', when: { type: 'flag', id: id + '.f', equals: true } }], ...extra });
const gold = mk('burl.boars', 'bear'); gold.objectives[0].when.id = 'x.gold'; // m1 waits on quest.burl.boars.done -> main chain
const mainDef = JSON.parse(JSON.stringify(m1));
mainDef.objectives = [...mainDef.objectives]; // m1 already has the flag objective quest.burl.boars.done
const side = mk('sq.t.side', 'relayX'), pk = mk('sq.t.packet', 'packet');
const book = createQuestBook(mainDef, [gold, side, pk]);
assert.equal(book.isMain(book.index('burl.boars')), true, 'chain quest = main (m1 waits on its done flag)');
assert.equal(book.isMain(book.index('sq.t.side')), false, 'errand = side');

// marks: Burl gold '!', relay/packet blue '!'; '?' follows the quest class
const a = [], r = [], sa = [], sr = [];
book.giverMarks(a, r, sa, sr);
assert.deepEqual([a, r, sa.slice().sort(), sr], [['bear'], [], ['packet', 'relayX'], []], JSON.stringify([a, sa]));
book.accept('burl.boars'); book.accept('sq.t.side');
book.feed({ type: 'flag:set', key: 'x.gold', value: true }); book.feed({ type: 'flag:set', key: 'sq.t.side.f', value: true });
book.giverMarks(a, r, sa, sr);
assert.equal(book.statusOf('burl.boars'), READY); assert.deepEqual([r, sr], [['bear'], ['relayX']], 'gold ? / blue ?');
book.giverMarks(a, r); assert.deepEqual(r.slice().sort(), ['bear', 'relayX'], 'without side arrays: old single-colour behaviour');

// packet: E accepts with feedback; second E gives feedback, no double accept
const notes = [];
let result = null;
const er = createErrands({ getBook: () => book, questFlag: (k, v = true) => book.feed({ type: 'flag:set', key: k, value: v }), inspect: (id) => { result = book.inspect(id); if (result) notes.push('inspect:' + result.action); return result; }, note: (t, l) => notes.push(t) });
er.inspected('packet');
assert.equal(book.statusOf('sq.t.packet'), ACTIVE); assert.deepEqual(notes, ['inspect:accept']);
notes.length = 0; er.inspected('packet');
assert.deepEqual(notes, ['inspect:refuse'], 'accepted: E still answers, no double accept');
const locked = createQuestBook(mainDef, [mk('sq.t.late', 'packet', { requires: [{ quest: 'burl.boars', done: true }] }), gold]);
const n2 = []; const er2 = createErrands({ getBook: () => locked, questFlag() {}, inspect: (id) => locked.inspect(id), note: (t, l) => n2.push(t + '|' + l) });
er2.inspected('packet'); assert.equal(n2.length, 1, 'unavailable giver object: feedback line, not silence'); assert.match(n2[0], /packet/i);

// side marker models: cloned with the blue materials, gold pair untouched
const A = { voxelModels: { questMark: { name: 'questMark', voxel: { mats: { O: 'brass_dark', C: 'mark_gold', S: 'mark_shine' } } }, questMarkReady: { name: 'questMarkReady', voxel: { mats: { O: 'brass_dark', C: 'mark_gold', S: 'mark_shine' } } } } };
assert.equal(addSideMarks(A), 2);
assert.equal(A.voxelModels.questMarkSide.voxel.mats.C, SIDE_MATS.C); assert.equal(A.voxelModels.questMark.voxel.mats.C, 'mark_gold'); assert.equal(A.models.questMarkReadySide.voxel.mats.O, 'brass_dark');
console.log('offerMarks OK');
