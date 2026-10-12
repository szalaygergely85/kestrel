// QL-B1 + EQ-13: loads the REAL content/quests packs (index.json + sites + rewards) and completes every quest by fed events.
// Run: node game/js/quest/sim/questBatch1.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../../questBoot.js';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE } from './questBook.js';
import { loadDesignAssets } from '../../../../tools/validate-content.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const getJson = async (url) => JSON.parse(readFileSync(new URL(url, new URL('game/', ROOT)), 'utf8'));
const A = await loadDesignAssets();
const defsById = A.items.defs;
const items = Object.values(defsById).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(getJson, { items, log: () => {} });
assert.deepEqual(files.errors, [], 'no boot errors');
const packDefs = files.giverDefs.filter((d) => d.region === 'ch12');
assert.ok(packDefs.length >= 20, 'at least 20 pack quests, got ' + packDefs.length);
const world = JSON.parse(readFileSync(new URL('content/worlds/world_m1.world.json', ROOT), 'utf8'));
const actors = new Set(world.entities.map((e) => e.id));

// static rules: titles <= 28, objectives <= 38, givers exist, items exist, gear resolved to real ids
for (const d of packDefs) {
  assert.ok(d.title.length <= 28, d.id + ' title');
  for (const o of d.objectives) assert.ok(o.text.length <= 38, d.id + ' objective ' + o.text);
  assert.ok(actors.has(d.giver.npc) && actors.has(d.giver.turnIn || d.giver.npc), d.id + ' giver');
  for (const it of [...(d.reward ? d.reward.items : []), ...(d.giveOnTalk || []), ...(d.giveOnAccept || [])]) assert.ok(defsById[it.id], d.id + ' item ' + it.id);
}

const pack = new Map(), worn = new Set();
function newBook() {
  pack.clear(); worn.clear();
  const book = createQuestBook(files.questDef, files.giverDefs, null);
  book.packOps = { count: (id) => pack.get(id) || 0, remove: (id, n) => pack.set(id, (pack.get(id) || 0) - n), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: (id) => worn.has(id) };
  return book;
}
const book = newBook();
// The Chapter 1 gates: boars handed in, Burl home, relay 1 reached, river bank reached (flags go in as main quest facts).
book.feed({ type: 'flag:set', key: 'burl.home', value: true });
function forceMain(stepEvents) { for (const e of stepEvents) book.feed(e); }
assert.equal(book.statusOf('sq.tm.nub'), 0 /* UNAVAILABLE until burl.boars is handed in */);

function feedFor(def) { // events that complete every objective of a def
  const ev = [];
  for (const o of def.objectives) {
    const w = o.when;
    if (w.type === 'area') ev.push({ type: 'area:entered', id: w.id });
    else if (w.type === 'beasts') for (const id of w.ids.slice(0, w.count)) ev.push({ type: 'beast:died', id });
    else if (w.type === 'flag') ev.push({ type: 'flag:set', key: w.id, value: w.equals });
    else if (w.type === 'item') ev.push({ type: 'item:got', id: w.id });
    else if (w.type === 'deliver') ev.push({ type: 'item:count', id: w.id, n: w.count }); // given on accept, still in the pack
    else if (w.type === 'collect') ev.push({ type: 'item:count', id: w.id, n: w.count }); // QL-B2: pack-counted pickups
    else throw new Error('unhandled ' + w.type);
  }
  return ev;
}

// open the chapter gates through the REAL legacy quests: tower.blade/burl.boars handed in, m1 up to relay1, mq.river.road to riverBank
function openGates(b) {
  const gate = (id) => { const i = b.index(id); const defs = b.def(i); for (const e of feedFor(defs)) b.feed(e); };
  for (const o of files.questDef.objectives) { const w = o.when; if (w.type === 'flag') b.feed({ type: 'flag:set', key: w.id, value: w.equals }); else if (w.type === 'area') b.feed({ type: 'area:entered', id: w.id }); else if (w.type === 'item') b.feed({ type: 'item:got', id: w.id }); else if (w.type === 'beasts') for (const id of w.ids.slice(0, w.count)) b.feed({ type: 'beast:died', id }); }
  // FB-02: sq.burl.fire opens after the Ch2 end beat mq.ford.mirror (handed in below)
  for (const id of ['tower.blade', 'burl.boars', 'sq.burl.blue']) { b.accept(id); gate(id); if (id === 'sq.burl.blue') pack.set('berry.blue', 6); b.handIn(id); }
  gate('mq.river.road'); gate('mq.ford.stones');
  b.accept('mq.bend.call'); gate('mq.bend.call'); b.handIn('mq.bend.call'); // M4 story quests (sq.honey / rook.shiny / packet) open after mq.bend.call is DONE
  b.accept('mq.ford.mirror'); gate('mq.ford.mirror'); b.handIn('mq.ford.mirror'); // FB-02 prereq
}
openGates(book);
assert.ok(book.statusOf('mq.river.road') >= 0);

const done = new Set(), left = new Set(packDefs.map((d) => d.id));
let guard = 0;
while (left.size && guard++ < 100) {
  let progressed = false;
  for (const d of packDefs) {
    if (!left.has(d.id)) continue;
    if (book.statusOf(d.id) !== AVAILABLE) continue;
    assert.ok(book.accept(d.id), d.id + ' accept');
    if (d.giveOnTalk) for (const it of d.giveOnTalk) assert.ok(pack.get(it.id) >= it.n, d.id + ' giveOnTalk landed in the pack: ' + it.id);
    if (d.requireItem) pack.set(d.requireItem, 5);
    for (const o of d.objectives) if (o.when.type === 'deliver') assert.ok((pack.get(o.when.id) || 0) >= o.when.count, d.id + ' deliver item given on accept');
    assert.ok([ACTIVE, READY].includes(book.statusOf(d.id)), d.id + ' active'); // areas / kills done before accept still count
    if (d.requireEquipped) { // hand-in refused while the gear is not worn
      for (const e of feedFor(d)) book.feed(e);
      assert.equal(book.statusOf(d.id), READY, d.id + ' ready');
      assert.equal(book.handIn(d.id), null, d.id + ' refuses without gear worn');
      for (const id of d.requireEquipped) worn.add(id);
    } else for (const e of feedFor(d)) book.feed(e);
    assert.equal(book.statusOf(d.id), READY, d.id + ' ready');
    const r = book.handIn(d.id);
    assert.ok(r, d.id + ' hand-in');
    if (d.reward) assert.deepEqual(r.items, d.reward.items);
    worn.clear(); left.delete(d.id); done.add(d.id); progressed = true;
  }
  if (!progressed) break;
}
assert.deepEqual([...left], [], 'every pack quest completable, stuck: ' + [...left].join(','));

// EQ-13 acceptance: shield at relay 1; bow + 10 arrows from the first errand giver; requireItem refuses without the item
const nub = packDefs.find((d) => d.id === 'sq.tm.nub');
assert.deepEqual(nub.giveOnTalk, [{ id: 'bow', n: 1 }, { id: 'arrow', n: 10 }]);
assert.equal(nub.giver.npc, 'bear');
assert.equal(nub.abandonable, false);
const sh = packDefs.find((d) => d.id === 'sq.rb.shield');
assert.deepEqual(sh.giveOnTalk, [{ id: 'shield', n: 1 }]); assert.equal(sh.giver.npc, 'relayBend'); assert.deepEqual(sh.requireEquipped, ['shield']);
{
  const b = newBook(); openGates(b); b.feed({ type: 'flag:set', key: 'burl.home', value: true });
  assert.ok(b.accept('sq.burl.meat')); pack.clear();
  for (const e of feedFor(packDefs.find((d) => d.id === 'sq.burl.meat'))) b.feed(e);
  assert.equal(b.handIn('sq.burl.meat'), null, 'requireItem: no meat in the pack, no hand-in');
  pack.set('boar.meat', 1);
  assert.ok(b.handIn('sq.burl.meat'));
}
// gear rewards resolve to real wearable ids of the asked tier
for (const id of ['sq.burl.boars.s', 'sq.burl.scout', 'sq.fc.ford']) {
  const d = packDefs.find((x) => x.id === id), g = d.reward.items.find((i) => defsById[i.id].equip);
  assert.ok(g, id + ' gear reward');
}
console.log('questBatch1 OK: ' + done.size + ' quests completed');
