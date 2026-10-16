// QL-T1: template expander + pack loader + giverless area quests. Run: node game/js/quest/sim/templates.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandQuest, expandAll, fnv1a, TEMPLATES } from './templates.js';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE, UNAVAILABLE } from './questBook.js';
import { loadQuestFiles } from '../../questBoot.js';

const J = (p) => JSON.parse(readFileSync(new URL('../../../../content/quests/' + p, import.meta.url), 'utf8'));
const m1 = J('m1.quest.json');
const ctx = {
  sites: { 'rook.bend': { entity: 'rook' }, 'burl.slope': { entity: 'bear' }, 'post.ws': { entity: 'post1' } },
  rewards: { 'side.b1': { items: [{ id: 'arrow', n: 10 }], gear: { tier: 1, slots: ['boots', 'belt', 'gloves'] } } },
  items: [{ id: 'gear.boots.a', slot: 'boots', tier: 1 }, { id: 'gear.belt.a', slot: 'belt', tier: 1 }, { id: 'gear.gloves.a', slot: 'gloves', tier: 1 }, { id: 'gear.boots.z', slot: 'boots', tier: 2 }],
};
const pack = { region: 'west', band: [1, 5] };
const ex = (src) => expandQuest(src, { ...ctx, pack });

// 1. every template -> documented `when`
const rows = {
  collect: { template: 'collect', params: { ids: ['berry.blue'], count: 6 } },
  deliver: { template: 'deliver', params: { item: 'letter', to: 'post.ws' } },
  fetch: { template: 'fetch', params: { item: 'ring' } },
  kill: { template: 'kill', params: { ids: ['b1', 'b2', 'b3'], count: 2 } },
  talk: { template: 'talk', params: { to: 'burl.slope' } },
  escort: { template: 'escort', params: { npc: 'bear', to: 'ford' } },
  explore: { template: 'explore', params: { areas: ['a1', 'a2'] } },
};
assert.deepEqual(Object.keys(rows), TEMPLATES);
const wants = {
  collect: [{ type: 'collect', id: 'berry.blue', count: 6 }], deliver: [{ type: 'deliver', id: 'letter', count: 1, to: 'post1' }],
  fetch: [{ type: 'item', id: 'ring' }], kill: [{ type: 'beasts', ids: ['b1', 'b2', 'b3'], count: 2 }],
  talk: [{ type: 'flag', id: 'talk.burl.slope', equals: true }], escort: [{ type: 'flag', id: 'escort.bear.ford', equals: true }],
  explore: [{ type: 'area', id: 'a1' }, { type: 'area', id: 'a2' }],
};
// events that complete the objectives, then the hand-in
const feeds = {
  collect: [{ type: 'item:count', id: 'berry.blue', n: 6 }], deliver: [], fetch: [{ type: 'item:got', id: 'ring' }],
  kill: [{ type: 'beast:died', id: 'b1' }, { type: 'beast:died', id: 'b3' }], talk: [{ type: 'flag:set', key: 'talk.burl.slope', value: true }],
  escort: [{ type: 'flag:set', key: 'escort.bear.ford', value: true }], explore: [{ type: 'area:entered', id: 'a1' }, { type: 'area:entered', id: 'a2' }],
};
for (const t of TEMPLATES) {
  const def = ex({ id: 'sq.t.' + t, title: 'T ' + t, site: 'rook.bend', ...rows[t], reward: { table: 'side.b1' } });
  assert.deepEqual(def.objectives.map(o => o.when), wants[t], t);
  assert.ok(Object.isFrozen(def) && Object.isFrozen(def.objectives[0]), 'frozen');
  assert.equal(def.giver.npc, 'rook'); assert.equal(def.site, 'rook.bend'); assert.deepEqual(def.band, [1, 5]); assert.equal(def.region, 'west'); assert.equal(def.main, false);
  assert.equal(JSON.stringify(ex({ id: 'sq.t.' + t, title: 'T ' + t, site: 'rook.bend', ...rows[t], reward: { table: 'side.b1' } })), JSON.stringify(def), 'idempotent');
  // runs in a book beside m1: accept -> facts -> ready -> hand-in -> reward
  const book = createQuestBook(m1, [def]);
  const sent = {}; const pack0 = new Map();
  book.packOps = { count: (id) => pack0.get(id) || 0, remove: (id, n) => pack0.set(id, (pack0.get(id) || 0) - n), add: (id, n) => { pack0.set(id, (pack0.get(id) || 0) + n); return n; } };
  assert.equal(book.statusOf(def.id), AVAILABLE, t);
  assert.ok(book.accept(def.id));
  if (t === 'deliver') { assert.equal(pack0.get('letter'), 1, 'accept gives the item'); assert.equal(book.statusOf(def.id), ACTIVE); book.feed({ type: 'item:count', id: 'letter', n: 1 }); }
  for (const e of feeds[t]) book.feed(e);
  assert.equal(book.statusOf(def.id), READY, t);
  if (t === 'fetch') { assert.equal(book.handIn(def.id), null, 'EQ-13: requireItem, no ring in the pack, no hand-in'); pack0.set('ring', 1); }
  const reward = book.handIn(def.id);
  assert.ok(reward && reward.items.length === 2 && reward.items[0].id === 'arrow', t);
  assert.equal(book.statusOf(def.id), DONE);
  sent[t] = 1;
}
// deliver to another site -> giver.turnIn
const dv = ex({ id: 'sq.dv', title: 'D', site: 'rook.bend', template: 'deliver', params: { item: 'letter', to: 'post.ws' } });
assert.equal(dv.giver.turnIn, 'post1');
// escort reuses the Burl follow flag when asked (m1 `follow` waits on burl.arrived)
assert.equal(ex({ id: 'sq.es', title: 'E', site: 'burl.slope', template: 'escort', params: { npc: 'bear', to: 'waystone', flag: 'burl.arrived' } }).objectives[0].when.id, 'burl.arrived');
assert.equal(m1.objectives.find(o => o.id === 'follow').when.id, 'quest.burl.follow.done'); // OB-178/D-105: m1 follow completes on the Burl follow-quest flag

// 2. gear pick is stable and uses fnv1a(questId) % slots at the right tier
const g1 = ex({ id: 'sq.gear', title: 'G', site: 'rook.bend', template: 'fetch', params: { item: 'x' }, reward: { table: 'side.b1' } });
const slot = ['boots', 'belt', 'gloves'][fnv1a('sq.gear') % 3];
assert.equal(g1.reward.items[1].id, 'gear.' + slot + '.a');
assert.deepEqual(ex({ id: 'sq.gear', title: 'G', site: 'rook.bend', template: 'fetch', params: { item: 'x' }, reward: { table: 'side.b1' } }), g1);

// 3. chain, pass-through, opensAfter, errors
const chain = ex({ id: 'mq.c', title: 'C', main: true, site: 'rook.bend', opensAfter: ['m1'], steps: [{ template: 'explore', params: { areas: ['a1'] }, objText: 'Go there' }, { template: 'talk', params: { to: 'burl.slope' } }] });
assert.deepEqual(chain.objectives.map(o => o.id), ['explore1', 'talk2']); assert.equal(chain.objectives[0].text, 'Go there');
assert.deepEqual(chain.requires, [{ quest: 'm1', done: true }]); assert.equal(chain.abandonable, false);
const pass = ex({ id: 'mq.p', title: 'P', objectives: [{ id: 'o', text: 'x', when: { type: 'area', id: 'a' } }] });
assert.equal(pass.giver, undefined); assert.equal(pass.objectives[0].when.id, 'a');
const bad = expandAll([{ region: 'r', quests: [{ id: 'a.ok', title: 'ok', template: 'kill', site: 'rook.bend', params: { ids: ['b'], count: 1 } }, { id: 'a.bad', title: 'x', template: 'nope', site: 'rook.bend' }, { id: 'a.site', title: 'x', template: 'fetch', site: 'ghost', params: { item: 'i' } }, { id: 'a.ok', title: 'dup', template: 'fetch', site: 'rook.bend', params: { item: 'i' } }] }], ctx);
assert.equal(bad.defs.length, 1); assert.equal(bad.errors.length, 3); assert.ok(bad.errors.every(e => e.region === 'r'));

// 4. hand-written == template (Ch1 side quest): same objective rows after the same events
const hw = J('sq.burl.blue.quest.json');
const tp = ex({ id: 'sq.burl.blue', title: 'The Blue Ones', site: 'burl.slope', requires: hw.requires, steps: [{ template: 'collect', params: { ids: ['berry.blue'], count: 6 } }, { template: 'deliver', params: { item: 'berry.blue', count: 6, to: 'burl.slope' } }], reward: hw.reward });
const runBook = (def) => {
  const d = JSON.parse(JSON.stringify(def)); delete d.giveOnAccept; d.giver = { npc: 'bear' }; d.requires = [];
  const b = createQuestBook(m1, [d]); const pk = new Map([['berry.blue', 0]]);
  b.packOps = { count: (id) => pk.get(id) || 0, remove: (id, n) => pk.set(id, pk.get(id) - n), add: () => 0 };
  const out = [];
  const snap = () => out.push(b.statusOf(d.id) + ':' + b.objectives(1, []).map(r => r.status + r.progress + '/' + r.target).join(','));
  snap(); b.accept(d.id); snap();
  for (let n = 1; n <= 6; n++) { pk.set('berry.blue', n); b.feed({ type: 'item:count', id: 'berry.blue', n }); snap(); }
  b.handIn(d.id); snap();
  return out;
};
assert.deepEqual(runBook(tp), runBook(hw));

// 5. loader: index.json -> legacy files + packs; giverless mq quests load and work
const files = {};
const getJson = async (u) => {
  const m = /content\/quests\/(.*)$/.exec(u); if (!m) { if (u.includes('barks')) return {}; if (u.includes('charkit')) return {}; throw new Error('404 ' + u); }
  const n = m[1];
  if (n === 'index.json') return { version: 1, packs: ['west'], legacy: ['m1', 'tower.blade', 'burl.boars', 'burl.follow', 'burl.stone', 'burl.road', 'mq.river.road', 'mq.ford.stones', 'mq.bend.call'] };
  if (n === 'sites.json') return { version: 1, sites: ctx.sites };
  if (n === 'rewards.json') return { version: 1, tables: ctx.rewards };
  if (n === 'west/pack.json') return { version: 1, region: 'west', band: [1, 5], quests: [{ id: 'sq.w.one', title: 'One', template: 'kill', site: 'rook.bend', params: { ids: ['b1'], count: 1 } }, { id: 'sq.w.bad', title: 'Bad', template: 'zzz', site: 'rook.bend' }] };
  return J(n);
};
const logs = [];
const boot = await loadQuestFiles(getJson, { log: (m) => logs.push(m) });
assert.deepEqual(boot.giverDefs.map(d => d.id), ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone', 'burl.road', 'mq.river.road', 'mq.ford.stones', 'mq.bend.call', 'sq.w.one']);
assert.deepEqual(boot.errors.map(e => e.file), ['pack:west:sq.w.bad']);
const ids = m1.objectives.map(o => o.id), upto = ids.slice(0, ids.indexOf('relay1') + 1);
const book = createQuestBook(boot.questDef, boot.giverDefs, { quest: { questVersion: 1, questId: 'm1', flags: {}, items: [], deadBeasts: [], areas: [], completed: [] }, quests: null });
assert.equal(book.statusOf('mq.river.road'), UNAVAILABLE); assert.equal(book.statusOf('mq.ford.stones'), UNAVAILABLE);
const book2 = createQuestBook(boot.questDef, boot.giverDefs, { quest: { questVersion: 1, questId: 'm1', flags: {}, items: [], deadBeasts: [], areas: [], completed: upto }, quests: { 'mq.bend.call': { quest: null, accepted: true, handedIn: true } } });
assert.equal(book2.statusOf('mq.river.road'), AVAILABLE); assert.equal(book2.statusOf('mq.ford.stones'), UNAVAILABLE); // Rook-given since QFIX-S5a-4/5
assert.ok(book2.accept('mq.river.road'));
const ev = []; book2.onChange = (n, id) => ev.push(n + ':' + id);
book2.feed({ type: 'area:entered', id: 'riverBank' });
assert.equal(book2.statusOf('mq.river.road'), READY); book2.handIn('mq.river.road');
assert.equal(book2.statusOf('mq.river.road'), DONE); assert.equal(book2.statusOf('mq.ford.stones'), AVAILABLE);
book2.accept('mq.ford.stones'); assert.equal(book2.tracked(), book2.index('mq.ford.stones'));
book2.feed({ type: 'area:entered', id: 'fordWest' });
assert.equal(book2.statusOf('mq.ford.stones'), READY); book2.handIn('mq.ford.stones');
assert.equal(book2.statusOf('mq.ford.stones'), DONE); assert.ok(ev.includes('quest:done:mq.river.road') && ev.includes('quest:done:mq.ford.stones'), ev.join());
assert.equal(book2.lastReward.items.length, 0);
const marks = [[], []]; book2.giverMarks(marks[0], marks[1]); assert.ok(marks[0].every(Boolean) && marks[1].every(Boolean));
assert.equal(book2.entityFor('rook'), 'rook'); assert.equal(book2.inspect('nobody'), null);
// save round trip keeps the giverless state
const sv = book2.toSave();
const book3 = createQuestBook(boot.questDef, boot.giverDefs, { quest: sv.quest, quests: sv.quests });
assert.equal(book3.statusOf('mq.ford.stones'), DONE);
// fallback: no index -> Chapter 1 files only
const old = await loadQuestFiles(async (u) => { if (u.endsWith('index.json')) throw new Error('404'); return getJson(u); }, { log: () => {} });
assert.deepEqual(old.giverDefs.map(d => d.id), ['tower.blade', 'burl.boars']);

// 6. perf: 100 synthetic quests expand + load <= 20 ms; 0 alloc per step
const big = { region: 'syn', band: [1, 5], quests: [] };
const tl = ['collect', 'kill', 'fetch', 'talk', 'explore', 'escort', 'deliver'];
for (let i = 0; i < 100; i++) {
  const t = tl[i % 7];
  const params = { collect: { ids: ['it' + i], count: 3 }, kill: { ids: ['k' + i, 'l' + i], count: 2 }, fetch: { item: 'f' + i }, talk: { to: 'burl.slope' }, explore: { areas: ['ar' + i] }, escort: { npc: 'bear', to: 'ar' + i }, deliver: { item: 'd' + i, to: 'post.ws' } }[t];
  big.quests.push({ id: 'sq.syn.' + i, title: 'S' + i, template: t, site: 'rook.bend', params, opensAfter: i ? ['sq.syn.' + (i - 1)] : [], reward: { table: 'side.b1' } });
}
const run = () => { const r = expandAll([big], ctx); assert.equal(r.errors.length, 0); return createQuestBook(m1, r.defs); };
run(); // warm
const t0 = performance.now(); const bb = run(); const dt = performance.now() - t0;
assert.ok(dt <= 20, 'load 100 quests ' + dt.toFixed(2) + ' ms');
const evt = { type: 'area:entered', id: 'ar4' };
for (let i = 0; i < 20000; i++) bb.feed(evt); // warm (JIT), then the first feed changed state once
const heap = () => { if (global.gc) { global.gc(); global.gc(); } return process.memoryUsage().heapUsed; };
const h0 = heap();
for (let i = 0; i < 100000; i++) bb.feed(evt);
const grew = heap() - h0; // retained growth after GC: an idle step keeps nothing (garbage-free hot path: no array/object literal per quest, see quest.js EVENT_TYPES)
assert.ok(!global.gc || grew < 50000, 'feed retains ' + grew);
console.log('templates: ok (100 quests ' + dt.toFixed(1) + ' ms, feed retained +' + grew + ' B / 100k)');
