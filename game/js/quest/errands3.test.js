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
const IDS = ['sq.ow.wolves', 'sq.ow.boars', 'sq.ow.parcel', 'sq.ow.ford'];
const gate = { ...get('mq.ford.mirror') }; delete gate.requires; // stub the earlier chapters: the gate quest opens at once
const mk = () => {
  const b = createQuestBook(get('m1'), [gate, ...IDS.map(get)]);
  const inv = new Map(); // mock pack
  b.packOps = { count: (id) => inv.get(id) || 0, remove: (id, n) => inv.set(id, (inv.get(id) || 0) - n), add: (id, n) => { inv.set(id, (inv.get(id) || 0) + n); return n; }, equipped: () => true };
  return { b, inv };
};
const done = (b, id) => b.statusOf(id) === DONE;

ok(IDS.every(id => get(id)), 'all 4 quests are in the pack');
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
  ok((inv.get('packet') || 0) === 1, 'accept gives the packet');
  b.feed({ type: 'item:count', id: 'packet', n: 1 });
  const g = get('sq.ow.parcel').giver;
  ok(g.npc === 'owBoard' && g.turnIn === 'owForge', 'board -> forge');
  ok(b.statusOf('sq.ow.parcel') === READY, 'ready once the packet is in hand');
  ok(!!b.handIn('sq.ow.parcel') && done(b, 'sq.ow.parcel') && (inv.get('packet') || 0) === 0, 'delivered, packet left the pack');
}
{ // explore the far bank
  const { b } = mk();
  ok(b.accept('sq.ow.ford'), 'ford quest accepted');
  b.feed({ type: 'area:entered', id: 'fordWest' });
  ok(b.statusOf('sq.ow.ford') === READY, 'ready on the west bank');
  ok(!!b.handIn('sq.ow.ford') && done(b, 'sq.ow.ford'), 'handed in at the stone');
}
console.log(`errands3: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
