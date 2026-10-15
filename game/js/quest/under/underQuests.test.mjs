// UNDER-07 (OB-191): Restless Graves -> The Sealed Crypt through the quest book (offer, accept, objectives, hand-in, Q2 offered not started).
//   node game/js/quest/under/underQuests.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE, UNAVAILABLE } from '../sim/questBook.js';
import { normalizeQuestDef, formatProblems } from '../sim/questFormat.js';
import { underQuestFlags, SEEN_FLAG, ROOM_FLAG } from './underQuestFlags.js';

const rd = (f) => JSON.parse(readFileSync(new URL('../../../../content/quests/' + f, import.meta.url)));
const mainDef = JSON.parse(readFileSync(new URL('../sim/fixtures/m1.legacy.quest.json', import.meta.url)));
const Q1 = rd('under.graves.quest.json'), Q2 = rd('under.crypt.quest.json');
const ids = new Set(['under.graves', 'under.crypt', 'burl.boars', 'burl.stone']);
assert.deepEqual(formatProblems(Q1, ids), []); assert.deepEqual(formatProblems(Q2, ids), []);
for (const q of [Q1, Q2]) for (const l of Object.values(q.lines).flat()) assert.ok(l.length <= 56, 'line <= 56: ' + l);
for (const q of [Q1, Q2]) for (const o of q.objectives) assert.ok(o.text.length <= 38, 'HUD <= 38: ' + o.text);

const stub = (id, flag) => ({ version: 1, id, title: id, giver: { npc: 'bear' }, objectives: [{ id: 'x', text: 'x', when: { type: 'flag', id: flag, equals: true } }], reward: { items: [{ id: 'arrow', n: 1 }] } });
const pack = new Map();
const ops = { count: (id) => pack.get(id) || 0, remove: (id, n) => pack.set(id, Math.max(0, (pack.get(id) || 0) - n)), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; } };
const b = createQuestBook(mainDef, [stub('burl.boars', 'f1'), stub('burl.stone', 'f2'), normalizeQuestDef(Q1), normalizeQuestDef(Q2)]); b.packOps = ops;
const i1 = 3, i2 = 4;
const marks = () => { const g = [[], [], [], []]; b.markLists(...g); return g; };

// early game is not spammed: no '!' at Bram until both Burl chapter-1 quests are done
assert.equal(b.status(i1), UNAVAILABLE); assert.ok(!marks().flat().includes('postkeeper'));
for (const [n, f] of [[1, 'f1'], [2, 'f2']]) { b.accept(b.statusOf ? ['burl.boars', 'burl.stone'][n - 1] : ''); b.feed({ type: 'flag:set', key: f, value: true }); b.handIn(['burl.boars', 'burl.stone'][n - 1]); }
assert.equal(b.status(i1), AVAILABLE); assert.equal(b.status(i2), UNAVAILABLE, 'Q2 waits for Q1');
const m = marks(); assert.deepEqual([m[0], m[1], m[2], m[3]].map((l) => l.filter((e) => e === 'postkeeper').length), [0, 0, 1, 0], 'one blue ! at Bram (side quest)');

// Q1: offer -> accept -> objectives -> ready -> hand-in
assert.equal(b.inspect('postkeeper').action, 'accept'); assert.equal(b.status(i1), ACTIVE);
b.feed({ type: 'flag:set', key: SEEN_FLAG, value: true });
b.feed({ type: 'beast:died', id: 'skelwar.cemetery.1' }); b.feed({ type: 'beast:died', id: 'skelwar.cemetery.2' }); assert.equal(b.status(i1), ACTIVE, '2/3 not done');
b.feed({ type: 'beast:died', id: 'skelwar.crypt.1' }); assert.equal(b.status(i1), READY);
const r = marks(); assert.ok([...r[1], ...r[3]].includes('postkeeper') && ![...r[0], ...r[2]].includes('postkeeper'), '? only, no ! on ready');
assert.equal(b.inspect('postkeeper').action, 'handin'); assert.equal(b.status(i1), DONE);

// Q2: offered (next), NOT auto-started; key only on accept
assert.equal(b.status(i2), AVAILABLE); assert.deepEqual(b.nextOffers().map((o) => [o.from, o.id]), [['under.graves', 'under.crypt']]); assert.equal(ops.count('key.crypt'), 0);
assert.equal(b.inspect('postkeeper').action, 'accept'); assert.equal(ops.count('key.crypt'), 1, 'Crypt Key on accept'); assert.equal(b.status(i2), ACTIVE);
for (const k of ['under.crypt.doorOpen', ROOM_FLAG]) b.feed({ type: 'flag:set', key: k, value: true });
assert.equal(b.status(i2), ACTIVE); b.feed({ type: 'flag:set', key: 'under.crypt.chest.chestCrypt', value: true }); assert.equal(b.status(i2), READY);
assert.equal(b.inspect('postkeeper').action, 'handin'); assert.equal(b.status(i2), DONE);

// flags helper
const st = {}, out = [], sim = { slotOf: (id) => (id.startsWith('skelwar.cemetery.1') ? 0 : -1), down: [0] };
assert.deepEqual(underQuestFlags(st, { x: 1644, y: 1372, z: 0 }, sim, out), [SEEN_FLAG], 'at the graves with a skeleton up');
sim.down[0] = 1; assert.deepEqual(underQuestFlags(st, { x: 1644, y: 1372, z: 0 }, sim, out), [], 'all down (day) -> not seen');
assert.deepEqual(underQuestFlags(st, { x: 1000, y: 1000, z: 0 }, sim, out), []);
assert.deepEqual(underQuestFlags(st, { x: 1674.5, y: 1352, z: -56.8 }, sim, out), [ROOM_FLAG]);
st['under.crypt.doorOpen'] = true; st['under.crypt.chest.chestCrypt'] = true;
assert.deepEqual(underQuestFlags(st, { x: 0, y: 0, z: 0 }, sim, out), ['under.crypt.doorOpen', 'under.crypt.chest.chestCrypt']);
console.log('underQuests: chain, marks, key on accept, flags PASS');
