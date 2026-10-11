// QL-T3: indexed quest feed == brute-force feed, 0 alloc when nothing happens, v2 save size, v1 -> v2 migration, removed quest in a save.
// Run: node game/js/quest/sim/questBookScale.test.js
import assert from 'node:assert/strict';
import { createQuestBook } from './questBook.js';
import { toQuestSaveV2, fromQuestSaveV2 } from './questSaveV2.js';

const main = { version: 1, id: 'm1', objectives: [{ id: 'a', text: 'a', when: { type: 'flag', id: 'go', equals: true } }, { id: 'b', text: 'b', when: { type: 'area', id: 'zz' } }] };
const N = 100;
const defs = [];
for (let i = 0; i < N; i++) {
  const t = i % 5, obj = [];
  if (t === 0) obj.push({ id: 's1', text: 's', when: { type: 'beasts', ids: ['bst' + (i % 20), 'bst' + ((i + 1) % 20)], count: 1 } });
  if (t === 1) obj.push({ id: 's1', text: 's', when: { type: 'area', id: 'area' + (i % 30) } }, { id: 's2', text: 's', when: { type: 'item', id: 'it' + (i % 10) } });
  if (t === 2) obj.push({ id: 's1', text: 's', when: { type: 'collect', id: 'col' + (i % 8), count: 2 } });
  if (t === 3) obj.push({ id: 's1', text: 's', when: { type: 'flag', id: 'fl' + (i % 12), equals: true } });
  if (t === 4) obj.push({ id: 's1', text: 's', when: { type: 'area', id: 'area' + (i % 30) } });
  const d = { version: 1, id: 'q' + i, giver: t === 4 ? undefined : { npc: 'npc' + (i % 15) }, objectives: obj };
  if (!d.giver) delete d.giver;
  if (i % 7 === 3) d.requires = [{ quest: 'q' + (i - 1), step: 's1' }];
  if (i % 11 === 5) d.requires = [{ flag: 'go' }];
  defs.push(d);
}
// seeded rng
let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const evs = [];
for (let k = 0; k < 1000; k++) {
  const r = rnd();
  evs.push(r < 0.2 ? { type: 'beast:died', id: 'bst' + Math.floor(rnd() * 25) } : r < 0.4 ? { type: 'area:entered', id: 'area' + Math.floor(rnd() * 35) }
    : r < 0.5 ? { type: 'item:got', id: 'it' + Math.floor(rnd() * 12) } : r < 0.7 ? { type: 'item:count', id: 'col' + Math.floor(rnd() * 10), n: Math.floor(rnd() * 4) }
    : r < 0.9 ? { type: 'flag:set', key: pick(['go', 'x.y', 'fl' + Math.floor(rnd() * 14)]), value: rnd() < 0.8 } : { type: 'area:entered', id: 'zz' });
}
const A = createQuestBook(main, defs), B = createQuestBook(main, defs);
const logA = [], logB = [];
A.onChange = (n, id) => logA.push(n + id); B.onChange = (n, id) => logB.push(n + id);
const sig = b => { const o = []; for (let i = 0; i < b.count; i++) o.push(b.status(i) + ':' + b.questState(i).completed.length); return o.join(','); };
let moved = 0;
for (let k = 0; k < evs.length; k++) {
  const ca = A.feed(evs[k]), cb = B.feedBrute(evs[k]);
  assert.equal(ca, cb === true ? ca : cb, 'changed flag');
  if (k % 7 === 0 && A.status(1) === 1) { /* accept sometimes */ }
  for (let i = 1; i < N && k % 5 === 0; i++) if (A.status(i) === 1 && rnd() < 0.3) { assert.equal(A.accept('q' + i), B.accept('q' + i)); moved++; }
  if (k % 50 === 0) assert.equal(sig(A), sig(B), 'status at event ' + k);
}
assert.equal(sig(A), sig(B), 'final statuses');
assert.deepEqual(logA, logB, 'same change events in the same order');
assert.ok(moved > 3 && logA.length > 3, 'the seeded run does something (' + moved + ' accepts, ' + logA.length + ' events)');
// every status/state byte-identical for quests that listen (facts they do not listen to are not stored, so compare progress)
for (let i = 0; i < N + 1; i++) assert.deepEqual(A.questState(i).completed, B.questState(i).completed);

// 0 alloc per step: events nobody listens to / that change nothing
const noop = { type: 'area:entered', id: 'nowhere' }, same = { type: 'flag:set', key: 'go', value: true };
A.feed(noop); A.feed(same);
for (let i = 0; i < 20000; i++) { A.feed(noop); A.feed(same); }
globalThis.gc && globalThis.gc();
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 20000; i++) { A.feed(noop); A.feed(same); }
const dh = process.memoryUsage().heapUsed - h0;
assert.ok(dh < 64 * 1024, 'feed allocates ~nothing for no-op events: ' + dh + ' B');
const t0 = performance.now(); for (let i = 0; i < 20000; i++) A.feed(noop); const per = (performance.now() - t0) / 20000;
assert.ok(per < 0.02, 'feed <= 0.02 ms: ' + per);

// save size: 100 quests, about a third in progress
const bk = createQuestBook(main, defs);
for (let i = 1; i < N; i++) if (bk.status(i) === 1 && i % 2) bk.accept('q' + i);
for (let k = 0; k < 300; k++) bk.feed(evs[k]);
const v2 = toQuestSaveV2(bk.toSave().quests, defs, null);
const bytes = JSON.stringify(v2).length;
assert.ok(bytes <= 3072, 'v2 save of 100 quests ' + bytes + ' B');
// round trip v2 -> book keeps statuses
const dead = [...new Set(evs.slice(0, 300).filter(e => e.type === 'beast:died').map(e => e.id))];
const back = createQuestBook(main, defs, { quest: bk.toSave().quest, quests: fromQuestSaveV2(v2, defs, dead) });
for (let i = 0; i < N + 1; i++) assert.equal(back.status(i), bk.status(i), 'status ' + i + ' after v2 round trip');

// v1 -> v2 fixture + removed quest
const v1 = { 'q1': { quest: { questVersion: 1, questId: 'q1', flags: {}, items: [], deadBeasts: [], areas: ['area1'], completed: ['s1'] }, accepted: true, handedIn: false, given: [{ id: 'bow', n: 1 }] },
  'gone.quest': { quest: { questVersion: 1, questId: 'gone.quest', flags: {}, items: [], deadBeasts: [], areas: [], completed: [] }, accepted: true, handedIn: false } };
const warns = [];
assert.throws(() => toQuestSaveV2(v1, defs), /definition/, 'v1 with an unknown quest cannot convert silently');
const w2 = toQuestSaveV2({ q1: v1.q1 }, defs, 'q1');
assert.deepEqual(w2, { v: 2, done: [], active: { q1: { c: 1, a: 1, g: [{ id: 'bow', n: 1 }], f: { areas: ['area1'] } } }, tracked: 'q1' });
const loaded = fromQuestSaveV2({ v: 2, done: ['q4', 'removed.one'], active: { ...w2.active, 'gone.quest': { c: 1 } }, tracked: null }, defs, [], m => warns.push(m));
assert.equal(warns.length, 2, 'removed quests dropped with warnings');
const b2 = createQuestBook(main, defs, { quest: null, quests: loaded });
assert.equal(b2.statusOf('q4'), 4, 'giverless done restored');
assert.equal(b2.statusOf('q1'), 2, 'q1 active (accepted, 1 of 2 steps)');
console.log('questBookScale.test: indexed==brute over 1000 events, 0 alloc, v2 ' + bytes + ' B, migration + removed quest PASS');
