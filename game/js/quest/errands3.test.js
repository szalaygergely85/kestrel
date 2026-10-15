// QL-22: west-bank errand batch (content/quests/ch3/pack.json sq.ow.*): accept -> fed events -> done on the real pack defs.
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, DONE, ACTIVE, READY } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const get = id => all.find(d => d.id === id);
const IDS = ['sq.ow.wolves', 'sq.ow.boars', 'sq.ow.parcel', 'sq.ow.ford', 'sq.ow.barley', 'sq.ow.range'];
const gate = { ...get('mq.ford.mirror') }; delete gate.requires; // stub the earlier chapters: the gate quest opens at once
const mk = () => {
  const b = createQuestBook(get('m1'), [gate, ...IDS.map(get)]);
  const inv = new Map(); // mock pack
  b.packOps = { count: (id) => inv.get(id) || 0, remove: (id, n) => inv.set(id, (inv.get(id) || 0) - n), add: (id, n) => { inv.set(id, (inv.get(id) || 0) + n); return n; }, equipped: () => true };
  return { b, inv };
};
const done = (b, id) => b.statusOf(id) === DONE;

ok(IDS.every(id => get(id)), 'all 6 quests are in the pack');
for (const id of IDS) {
  const d = get(id);
  for (const o of d.objectives) ok(o.text.length <= 38, id + ' objective <= 38 chars');
  ok(d.giver && !/[A-Z][a-z]+ [A-Z]/.test(d.giver.text || ''), id + ' has a giver');
}
{ // wolves: 3 of 5; kills before the accept count
  const { b } = mk();
  b.feed({ type: 'beast:died', id: 'wolf1' });
  ok(b.accept('sq.ow.wolves'), 'wolf quest accepted');
  b.feed({ type: 'beast:died', id: 'wolf2' }); b.feed({ type: 'beast:died', id: 'wolf2' });
  ok(b.statusOf('sq.ow.wolves') === ACTIVE, 'a repeated kill id counts once');
  b.feed({ type: 'beast:died', id: 'boarF1' });
  ok(b.statusOf('sq.ow.wolves') === ACTIVE, 'a boar is not a wolf');
  b.feed({ type: 'beast:died', id: 'wolf5' });
  ok(b.statusOf('sq.ow.wolves') === READY, 'ready after 3 wolves');
  ok(!!b.handIn('sq.ow.wolves') && done(b, 'sq.ow.wolves'), 'wolves handed in at the board');
}
{ // SOFTLOCK-01: all 5 wolves dead BEFORE the accept -> completable at once, no respawn wait
  const { b } = mk(); b.livingOfKind = () => 0; // game hook: no wolf alive
  for (const id of ['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5']) b.feed({ type: 'beast:died', id });
  ok(b.accept('sq.ow.wolves'), 'wolf quest accepted after the pack is dead');
  ok(b.statusOf('sq.ow.wolves') === READY, 'pre-accept kills make it ready without new kills');
  ok(!!b.handIn('sq.ow.wolves') && done(b, 'sq.ow.wolves'), 'handed in with no respawn');
}
{ // R6-FIX C: kill the pack -> save -> reload -> accept: the kill record survives and the hook is on the freshly loaded book (no sync needed)
  const { createQuestRelay } = await import('../questRelay.js');
  const defs = [gate, ...IDS.map(get)], m1 = get('m1');
  const rel = createQuestRelay(m1, null, defs, null);
  rel.setLivingOfKind(() => 0); // the authored pack stays dead after a load (saveRelay.applyDeadToBeasts): nothing living of any kind
  const deadIds = ['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5'];
  for (const id of deadIds) rel.book.feed({ type: 'beast:died', id });
  const sv = rel.book.toSave();
  rel.reset(sv.quest, sv.quests); rel.seedDead(deadIds); // what saveRelay.onWorldLoaded does on Continue
  const inv = new Map(); rel.book.packOps = { count: (id) => inv.get(id) || 0, remove: () => 0, add: (id, n) => n, equipped: () => true };
  ok(typeof rel.book.livingOfKind === 'function', 'hook installed on the reloaded book without questPickups.sync');
  ok(rel.book.accept('sq.ow.wolves'), 'wolf quest accepted after load');
  ok(rel.book.statusOf('sq.ow.wolves') === READY, 'kills made before the save still count after load (no soft-lock)');
}
{ // SOFTLOCK-01: another kind-kill quest (regions boars, 3 needed), kills made earlier
  const def = [...files.quests, ...packs.quests].map(q => q.def).find(d => d.objectives.some(o => o.when.type === 'beasts' && o.when.kind === 'boar' && o.when.count === 3));
  ok(!!def, 'a 3-boar kind quest exists');
  const b = createQuestBook(get('m1'), [{ ...def, requires: undefined }]); b.livingOfKind = (k) => 0;
  for (const id of ['boarX1', 'boarX2', 'boarX3']) b.feed({ type: 'beast:died', id });
  ok(b.accept(def.id), 'boar quest accepted');
  ok(b.statusOf(def.id) === READY, 'earlier boar kills count');
}
{ // boars: both west-bank boars
  const { b } = mk();
  ok(b.accept('sq.ow.boars'), 'boar quest accepted');
  b.feed({ type: 'beast:died', id: 'boarF1' });
  ok(b.statusOf('sq.ow.boars') === ACTIVE, 'one boar is not enough');
  b.feed({ type: 'beast:died', id: 'boarF2' });
  ok(b.statusOf('sq.ow.boars') === READY, 'ready after 2 boars');
  const r = b.handIn('sq.ow.boars');
  ok(!!r, 'boars reward granted');
}
{ // parcel: owBoard -> owForge
  const { b, inv } = mk();
  ok(b.accept('sq.ow.parcel'), 'parcel accepted');
  ok((inv.get('parcel') || 0) === 1, 'accept gives the parcel');
  b.feed({ type: 'item:count', id: 'parcel', n: 1 });
  const g = get('sq.ow.parcel').giver;
  ok(g.npc === 'owBoard' && g.turnIn === 'owForge', 'board -> forge');
  ok(b.statusOf('sq.ow.parcel') === READY, 'ready once the parcel is in hand');
  ok(!!b.handIn('sq.ow.parcel') && done(b, 'sq.ow.parcel') && (inv.get('parcel') || 0) === 0, 'delivered, parcel left the pack');
}
{ // explore the far bank
  const { b } = mk();
  ok(b.accept('sq.ow.ford'), 'ford quest accepted');
  b.feed({ type: 'area:entered', id: 'fordWest' });
  ok(b.statusOf('sq.ow.ford') === READY, 'ready on the west bank');
  ok(!!b.handIn('sq.ow.ford') && done(b, 'sq.ow.ford'), 'handed in at the stone');
}
{ // fetch the sheaf at the barley gate, hand in at the board
  const { b } = mk();
  ok(b.accept('sq.ow.barley'), 'barley accepted');
  b.packOps.add('barleySheaf', 1); b.feed({ type: 'item:count', id: 'barleySheaf', n: 1 });
  ok(b.statusOf('sq.ow.barley') === READY, 'ready with the sheaf');
  ok(!!b.handIn('sq.ow.barley') && done(b, 'sq.ow.barley'), 'barley handed in');
}
{ // practice targets near owPathPost: flags owTarget1-3.hit
  const { b } = mk();
  ok(b.accept('sq.ow.range'), 'range accepted');
  for (const i of [1, 2, 3]) { ok(b.statusOf('sq.ow.range') === ACTIVE, 'active before target ' + i); b.feed({ type: 'flag:set', key: 'owTarget' + i + '.hit', value: true }); }
  ok(b.statusOf('sq.ow.range') === READY, 'ready after 3 targets');
  ok(!!b.handIn('sq.ow.range') && done(b, 'sq.ow.range'), 'range handed in');
}
console.log(`errands3: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
