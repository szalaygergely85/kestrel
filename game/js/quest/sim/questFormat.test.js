// QUEST-FORMAT (D-106). Run: node game/js/quest/sim/questFormat.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeQuestDef, formatView, formatProblems, isFormatDef } from './questFormat.js';
import * as mirror from '../../../../tools/editor/quest/format.js';
import { createQuestBook, validateGiverQuest, AVAILABLE, ACTIVE, READY, DONE, UNAVAILABLE } from './questBook.js';
import { createQuestLogScreen } from '../../ui/questLog.js';
import { createUiLayer } from '../../../../engine/index.js';

const mainDef = JSON.parse(readFileSync(new URL('./fixtures/m1.legacy.quest.json', import.meta.url)));
const obj = (id, flag) => ({ id, text: 'Do ' + id, when: { type: 'flag', id: flag, equals: true } });
const A = { version: 1, id: 'q.a', title: 'First', begin: { npc: 'burl' }, end: { npc: 'burl' }, requires: { quests: [] }, objectives: [obj('a1', 'fa')], rewards: { items: [{ id: 'potion.health', n: 1 }], coin: 5 }, next: 'q.b', nextHint: 'Rook waits at the ford' };
const B = { version: 1, id: 'q.b', title: 'Second', begin: { npc: 'rook' }, end: { npc: 'rook' }, requires: { quests: ['q.a'] }, objectives: [obj('b1', 'fb')], rewards: { heartPiece: 1 }, next: null };
const OBJ = { version: 1, id: 'q.o', title: 'Note', begin: { object: 'noteX' }, end: { npc: 'burl' }, objectives: [obj('o1', 'fo')], rewards: { items: [{ id: 'sword', n: 1 }] } };

// 1. normalize: new format -> legacy shape; legacy untouched
const nA = normalizeQuestDef(A), nB = normalizeQuestDef(B), nO = normalizeQuestDef(OBJ);
assert.deepEqual(nA.giver, { npc: 'burl' }); assert.deepEqual(nA.reward, { items: [{ id: 'potion.health', n: 1 }], coin: 5 }); assert.deepEqual(nA.requires, []);
assert.deepEqual(nB.requires, [{ quest: 'q.a', done: true }]); assert.deepEqual(nB.reward.items, [{ id: 'heart.piece', n: 1 }]); assert.equal(nB.giver.npc, 'rook');
assert.equal(nO.objectGiver, true); assert.deepEqual(nO.giver, { npc: 'noteX', turnIn: 'burl' }); assert.equal(nA.begin, undefined);
const legacy = JSON.parse(readFileSync(new URL('../../../../content/quests/burl.boars.quest.json', import.meta.url)));
assert.equal(isFormatDef(legacy), false); assert.equal(normalizeQuestDef(legacy), legacy, 'legacy returned as is');
assert.doesNotThrow(() => validateGiverQuest(A)); assert.doesNotThrow(() => validateGiverQuest(OBJ));

// 2. formatView of legacy + new, and the editor mirror agrees
const lv = formatView(legacy);
assert.deepEqual(lv.begin, { npc: legacy.giver.npc }); assert.deepEqual(lv.end, { npc: legacy.giver.turnIn || legacy.giver.npc });
assert.deepEqual(formatView(nB).requires.quests, ['q.a']); assert.deepEqual(formatView(B).requires.quests, ['q.a']); assert.deepEqual(formatView(nO).begin, { object: 'noteX' });
const ids = new Set(['q.a', 'q.b', 'q.o', legacy.id]);
for (const d of [A, B, OBJ, legacy, nA, { ...A, xp: 5 }, { ...A, objectives: [1, 2, 3, 4].map((i) => obj('x' + i, 'f')) }])
  { assert.deepEqual(mirror.formatView(d), formatView(d)); assert.deepEqual(mirror.formatProblems(d, ids), formatProblems(d, ids)); }
assert.deepEqual(normalizeQuestDef(A), mirror.normalizeQuestDef ? mirror.normalizeQuestDef(A) : normalizeQuestDef(A));

// 3. problems
assert.deepEqual(formatProblems(A, ids), []); assert.deepEqual(formatProblems(B, ids), []); assert.deepEqual(formatProblems(OBJ, ids), []);
const has = (d, re) => formatProblems(d, ids).some((p) => re.test(p));
assert.ok(has({ ...A, begin: undefined }, /no begin/)); assert.ok(has({ ...A, end: undefined }, /no end/)); assert.ok(has({ ...A, rewards: { items: [] } }, /empty rewards/));
assert.ok(has({ ...A, rewards: undefined }, /empty rewards/)); assert.ok(has({ ...A, objectives: [1, 2, 3, 4].map((i) => obj('x' + i, 'f')) }, /4 objectives/));
assert.ok(has({ ...A, next: 'q.zzz' }, /next "q.zzz"/)); assert.ok(has({ ...A, requires: { quests: ['q.zzz'] } }, /requires unknown/)); assert.ok(has({ ...A, xp: 3 }, /xp/)); assert.ok(has({ ...A, rewards: { items: [{ id: 'a', n: 1 }], xp: 3 } }, /xp/));

// 4. book: A -> hand-in -> next offered at Rook ('!' on rook, nextOffers, journal 'Next: ...'); nothing auto-starts
const b = createQuestBook(mainDef, [A, B]);
assert.equal(b.status(1), AVAILABLE); assert.equal(b.status(2), UNAVAILABLE, 'B waits for A');
assert.equal(b.nextOf(1), 2); assert.equal(b.nextOf(2), -1); assert.deepEqual(b.nextOffers(), []);
assert.ok(b.accept('q.a')); b.feed({ type: 'flag:set', key: 'fa', value: true }); assert.equal(b.status(1), READY);
const jr = createQuestLogScreen(b, { giverName: (id) => id.toUpperCase(), itemName: (id) => id }); jr.open();
const mark = () => { const g = [[], [], [], []]; b.markLists(...g); return g; };
assert.ok([...mark()[1], ...mark()[3]].includes('burl'), '? at the end npc'); assert.ok(![...mark()[0], ...mark()[2]].includes('rook'));
jr.handleKey('KeyS'); let snap = jr.snapshot();
assert.ok(snap.right.some((l) => l === 'Return to BURL'), 'journal: Return to <name>: ' + snap.right);
const rw = b.handIn('q.a'); assert.deepEqual(rw.items, [{ id: 'potion.health', n: 1 }]);
assert.equal(b.status(1), DONE); assert.equal(b.status(2), AVAILABLE, 'next offered, not started');
assert.deepEqual(b.nextOffers().map((o) => [o.from, o.id, o.giver, o.hint]), [['q.a', 'q.b', 'rook', 'Rook waits at the ford']]);
assert.ok([...mark()[0], ...mark()[2]].includes('rook'), '! on the next giver (compass uses markLists)');
const jn = createQuestLogScreen(b, { giverName: (id) => id.toUpperCase(), itemName: (id) => id }); jn.open(); createUiLayer({ cols: 160 });
jn.handleKey('KeyS'); snap = jn.snapshot(); assert.ok(snap.left.indexOf('First') >= snap.doneFrom, 'done format quest listed below the active ones: ' + snap.left);
assert.ok(snap.right.some((l) => l === 'Next: ROOK - Rook waits at the ford'), 'journal Next line: ' + snap.right);
// unknown next -> book refuses
assert.throws(() => createQuestBook(mainDef, [{ ...A, next: 'q.nope' }]), /next unknown/);
console.log('questFormat: normalize, view, problems, next offer, journal PASS');
