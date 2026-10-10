import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, validateGiverQuest, validateSections, migrateM1Ch1, migrateQuestSave, STATUS_NAMES, UNAVAILABLE, AVAILABLE, ACTIVE, READY, DONE } from './questBook.js';
import { questObjectives } from './quest.js';
const rd = p => JSON.parse(readFileSync(new URL('../../../../content/quests/' + p, import.meta.url)));
const burlReal = rd('burl.boars.quest.json'), blade = rd('tower.blade.quest.json');
// generic step-requirement fixture: the real quest used to require m1 step `sword` (kept to cover the {quest, step} form)
const burl = { ...burlReal, requires: [{ quest: 'm1', step: 'sword' }] };
// QG-03 repoints m1 `beasts` at the hand-in flag; the test builds that variant itself.
const mainDef = structuredClone(JSON.parse(readFileSync(new URL('./fixtures/m1.legacy.quest.json', import.meta.url)))); // legacy 6-step chain; the CH1 chain is tested below
mainDef.objectives.find(o => o.id === 'beasts').when = { type: 'flag', id: 'quest.burl.boars.done', equals: true };
const boars = ['boar1', 'boar2', 'boar3', 'boar4', 'boar5'];
const ev = {
  wake: { type: 'flag:set', key: 'wake', value: true }, lantern: { type: 'item:got', id: 'lantern' }, breach: { type: 'area:entered', id: 'breach' },
  sword: { type: 'item:got', id: 'sword' },
};
const toSword = b => { for (const e of [ev.wake, ev.lantern, ev.breach, ev.sword]) b.feed(e); };
const kill = (b, k = 5) => { for (let i = 0; i < k; i++) b.feed({ type: 'beast:died', id: boars[i] }); };

assert.deepEqual([...STATUS_NAMES], ['unavailable', 'available', 'active', 'ready', 'done']);
assert.equal(validateGiverQuest(burl), burl);
for (const bad of [{ ...burl, giver: {} }, { ...burl, id: 'Burl' }, { ...burl, requires: [{ quest: 'm1' }] }, { ...burl, requires: [{ quest: 'm1', done: 1 }] }, { ...burl, reward: { items: [{ id: 'coin', n: 0 }] } }])
  assert.throws(() => validateGiverQuest(bad));
assert.equal(burl.reward, undefined, 'owner pick: no item reward');

// walk unavailable -> available -> active -> ready -> done
const log = [];
let b = createQuestBook(mainDef, [burl]);
b.onChange = (n, id) => log.push(n + ':' + id);
assert.equal(b.status(1), UNAVAILABLE);
assert.equal(b.hasKey('q.burl.boars.available'), false);
toSword(b);
assert.equal(b.status(1), AVAILABLE);
assert.equal(b.hasKey('q.burl.boars.available'), true);
const v0 = b.version;
assert.equal(b.actKey('q.burl.boars.accept'), true);
assert.equal(b.actKey('q.burl.boars.accept'), false, 'accept twice');
assert.ok(b.version > v0);
assert.equal(b.status(1), ACTIVE);
assert.equal(b.handIn('burl.boars'), null, 'not ready');
kill(b, 4); assert.equal(b.status(1), ACTIVE);
kill(b); assert.equal(b.status(1), READY);
assert.equal(b.main.completed.includes('beasts'), false, 'main waits for hand-in flag');
const marksA = ['x'], marksR = [];
b.giverMarks(marksA, marksR); assert.deepEqual([marksA, marksR], [[], ['bear']]);
assert.equal(b.tracked(), 1);
const reward = b.handIn('burl.boars');
assert.deepEqual(reward.items, []); assert.ok(Object.isFrozen(reward));
assert.equal(b.handIn('burl.boars'), null, 'twice = null');
assert.equal(b.status(1), DONE);
assert.ok(b.main.completed.includes('beasts'), 'done flag advances m1 beasts');
b.giverMarks(marksA, marksR); assert.deepEqual([marksA.length, marksR.length], [0, 0]);
assert.equal(b.tracked(), -1);
assert.deepEqual(log, ['quest:accepted:burl.boars', 'quest:ready:burl.boars', 'quest:done:burl.boars']);

// facts before accept; accept when complete -> ready at once
b = createQuestBook(mainDef, [burl]); log.length = 0; b.onChange = (n) => log.push(n);
kill(b); toSword(b);
assert.equal(b.status(1), AVAILABLE);
b.giverMarks(marksA, marksR); assert.deepEqual(marksA, ['bear']);
assert.equal(b.accept('burl.boars'), true);
assert.equal(b.status(1), READY, 'boars killed before accept still count');
assert.deepEqual(log, ['quest:accepted', 'quest:ready']);
assert.equal(createQuestBook(mainDef, [burl]).accept('burl.boars'), false, 'unavailable before sword');

// key table: unknown keys false, no throw
for (const k of ['', 'q.', 'q.nope.ready', 'q.burl.boars.bogus', 'wake', 'q.burl.boars.accept.x', '__proto__', 'constructor'])
  assert.equal(b.hasKey(k) || b.actKey(k), false, k);
assert.equal(b.hasKey('q.burl.boars.accept'), false, 'act keys are not has keys');
assert.equal(b.actKey('q.burl.boars.available'), false);
assert.equal(b.hasKey('q.burl.boars.ready'), true);
assert.equal(b.actKey('q.burl.boars.handin'), true);
assert.equal(b.lastReward.items.length, 0);
assert.equal(b.hasKey('q.burl.boars.done'), true);
assert.equal(b.statusOf('nope'), -1);
assert.equal(b.objectives(1, [])[0].progress, 5);
assert.equal(questObjectives(b.main, mainDef)[4].status, 'complete');

// save / load round trip, hash stable
b = createQuestBook(mainDef, [burl]); toSword(b); b.accept('burl.boars'); kill(b, 3);
const saved = JSON.parse(JSON.stringify(b.toSave()));
const r = createQuestBook(mainDef, [burl], saved);
assert.equal(r.status(1), ACTIVE);
assert.deepEqual(r.toSave(), b.toSave());
const hash = bk => { let x = 2166136261; const h = { u32: v => { x = Math.imul(x ^ v, 16777619) >>> 0; } }; bk.hashInto(h); return x; };
assert.equal(hash(r), hash(b));
kill(r); assert.notEqual(hash(r), hash(b));
assert.equal(createQuestBook(mainDef, [burl], JSON.parse(JSON.stringify(r.toSave()))).status(1), READY);
assert.throws(() => createQuestBook(mainDef, [burl, burl]), /duplicate/);
assert.throws(() => createQuestBook(mainDef, [{ ...burl, requires: [{ quest: 'm1', step: 'zz' }] }]), /unknown step/);

// 10k-step heap check: steady-state calls allocate (almost) nothing
b = createQuestBook(mainDef, [burl]); toSword(b); b.accept('burl.boars');
const a1 = [], a2 = [], evs = [{ type: 'beast:died', id: 'boar1' }, { type: 'area:entered', id: 'breach' }];
const step = i => { b.feed(evs[i & 1]); b.status(1); b.hasKey('q.burl.boars.active'); b.giverMarks(a1, a2); b.tracked(); };
for (let i = 0; i < 2000; i++) step(i);
if (global.gc) {
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) step(i);
  global.gc(); assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'steady-state heap growth');
} else for (let i = 0; i < 10000; i++) step(i);
// ---- CH1-01: the real m1 chain, sections, migration ----
{
  const ch1 = rd('m1.quest.json');
  assert.deepEqual(ch1.objectives.map(o => o.id), ['wake', 'breach', 'sword', 'leave', 'beasts', 'follow', 'waystone', 'road', 'relayFound', 'relay1', 'fen']);
  assert.equal(ch1.sections.length, 7); assert.equal(validateSections(ch1), ch1);
  assert.equal(rd('burl.boars.quest.json').title, 'Boars in the Woods');
  const o = structuredClone(ch1); o.objectives[1].section = 'q02';
  assert.throws(() => validateSections(o), /contiguous/);
  o.objectives[1].section = 'zz'; assert.throws(() => validateSections(o), /unknown section/);
  const q = (completed, extra = {}) => ({ quest: { questVersion: 1, questId: 'm1', flags: {}, items: [], deadBeasts: [], areas: [], completed }, ...extra });
  const mig = c => migrateM1Ch1(q(c)).quest.completed;
  assert.deepEqual(mig(['wake', 'lantern']), ['wake']);
  assert.deepEqual(mig(['wake', 'lantern', 'breach', 'sword']), ['wake', 'breach', 'sword']);
  assert.deepEqual(mig(['wake', 'lantern', 'breach', 'sword', 'beasts']), ['wake', 'breach', 'sword', 'leave', 'beasts']);
  const six = migrateM1Ch1(q(['wake', 'lantern', 'breach', 'sword', 'beasts', 'waystone']));
  assert.deepEqual(six.quest.completed, ['wake', 'breach', 'sword', 'leave', 'beasts', 'follow', 'waystone']);
  assert.deepEqual(six.world.state, { 'waystone.waystone.woken': true, 'burl.phase': 4, 'aether.attuned': true });
  for (const c of [[], ['wake'], ['wake', 'breach', 'sword', 'leave', 'beasts', 'follow', 'waystone', 'road']]) { const g = q(c); assert.equal(migrateM1Ch1(g), g, 'already-new save untouched'); }
  assert.equal(migrateM1Ch1(six), six, 'idempotent');
  const book = createQuestBook(ch1, [blade, burlReal], { quest: six.quest, quests: null });
  assert.equal(book.main.completed.length, 7); // round trip: restore + toSave keeps the prefix
  assert.deepEqual(book.toSave().quest.completed, six.quest.completed);
  const sv = book.toSave(); assert.equal(migrateM1Ch1(sv), sv, 'round trip: saved new chain is not migrated again');
}
// ---- chain: tower.blade (giver = the wake-spot note) -> turned in at Burl -> burl.boars ----
{
  const bk = createQuestBook(mainDef, [blade, burlReal]), A = [], R = [];
  assert.equal(bk.statusOf('burl.boars'), UNAVAILABLE); assert.equal(bk.statusOf('tower.blade'), AVAILABLE);
  bk.giverMarks(A, R); assert.deepEqual([A, R], [['noteKeepLight'], []], "'!' over the note only, nothing over Burl");
  assert.equal(bk.hasKey('q.burl.boars.available'), false);
  assert.equal(bk.actKey('q.tower.blade.accept'), true);
  bk.giverMarks(A, R); assert.deepEqual([A, R], [[], []], 'accepted: no mark while active');
  toSword(bk); assert.equal(bk.statusOf('tower.blade'), ACTIVE, 'sword taken but not out of the tower');
  assert.equal(bk.statusOf('burl.boars'), UNAVAILABLE);
  bk.feed({ type: 'area:entered', id: 'towerDoor' });
  assert.equal(bk.statusOf('tower.blade'), READY); bk.giverMarks(A, R); assert.deepEqual([A, R], [[], ['bear']], "ready: '?' over Burl (giver.turnIn), not the note");
  assert.equal(bk.statusOf('burl.boars'), UNAVAILABLE, 'not before the turn-in');
  assert.equal(bk.actKey('q.tower.blade.handin'), true);
  assert.equal(bk.statusOf('burl.boars'), AVAILABLE); bk.giverMarks(A, R); assert.deepEqual([A, R], [['bear'], []]);
  // an accepted boar quest stays as it is even when its requirement is not met (old saves)
  const sv = bk.toSave(); sv.quests['tower.blade'].handedIn = false; sv.quests['burl.boars'].accepted = true;
  assert.equal(createQuestBook(mainDef, [blade, burlReal], sv).statusOf('burl.boars'), ACTIVE);
  // migration: old saves derive the blade quest from m1 facts
  const mk = (items, areas, completed, quests) => ({ quest: { questVersion: 1, questId: 'm1', flags: {}, items, deadBeasts: [], areas, completed }, quests });
  const hist = (g) => migrateQuestSave(g, { main: rd('m1.quest.json'), givers: [blade, burlReal] });
  assert.equal(hist(mk([], ['breach'], ['wake', 'breach'], null)), null, 'no sword yet: nothing to derive');
  let mg = hist(mk(['sword'], ['breach', 'towerDoor'], ['wake', 'breach', 'sword', 'leave'], null));
  assert.deepEqual([mg['tower.blade'].accepted, mg['tower.blade'].handedIn, mg['burl.boars']], [true, false, undefined]);
  assert.equal(createQuestBook(mainDef, [blade, burlReal], { quest: mk([], [], [], null).quest, quests: mg }).statusOf('tower.blade'), READY);
  mg = hist(mk(['sword'], ['breach', 'towerDoor'], ['wake', 'breach', 'sword', 'leave'], { 'burl.boars': { quest: JSON.parse(JSON.stringify(bk.toSave().quests['burl.boars'].quest)), accepted: true, handedIn: false } }));
  assert.deepEqual([mg['tower.blade'].accepted, mg['tower.blade'].handedIn, mg['burl.boars'].accepted], [true, true, true], 'boars already active: blade counts as done');
}
console.log('questBook.test OK');
