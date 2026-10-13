// QL-23: second west-bank errand batch (content/quests/ch3b/pack.json): accept -> fed events -> done on the real pack defs.
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
const IDS = ['sq.ow.night', 'sq.ow.bears', 'sq.ow.letters', 'sq.ow.song', 'sq.ow.trail', 'sq.ow.news'];
// requires chain: stub every earlier gate (wolves, names, board, mirror, relay) as open
const GATES = ['sq.ow.wolves', 'mq.ow.names', 'mq.ow.board', 'mq.ford.mirror', 'mq.ow.relay'];
const mk = () => {
  const gates = GATES.map(g => { const d = { ...get(g) }; delete d.requires; return d; });
  const b = createQuestBook(get('m1'), [...gates, ...IDS.map(get)]);
  const inv = new Map();
  b.packOps = { count: (id) => inv.get(id) || 0, remove: (id, n) => inv.set(id, (inv.get(id) || 0) - n), add: (id, n) => { inv.set(id, (inv.get(id) || 0) + n); return n; }, equipped: () => true };
  return { b, inv };
};
const done = (b, id) => b.statusOf(id) === DONE;

ok(IDS.every(id => get(id)), 'all 6 quests are in the ch3b pack');
for (const id of IDS) {
  const d = get(id);
  for (const o of d.objectives) ok(o.text.length <= 38, id + ' objective <= 38 chars');
  ok(!!d.giver, id + ' has a giver');
  ok((d.opensAfter || d.requires || []).length > 0, id + ' is gated');
}
ok(get('sq.ow.night').giver.npc === 'hesk', 'Night Fence is Hesk\'s (D-071 farm defence)');
{ // Night Fence: all 5 wolves
  const { b } = mk();
  ok(b.accept('sq.ow.night'), 'night accepted');
  for (const w of ['wolf1', 'wolf2', 'wolf3', 'wolf4']) b.feed({ type: 'beast:died', id: w });
  ok(b.statusOf('sq.ow.night') === ACTIVE, '4 wolves are not enough');
  b.feed({ type: 'beast:died', id: 'wolf5' });
  ok(b.statusOf('sq.ow.night') === READY, 'ready after 5 wolves');
  ok(!!b.handIn('sq.ow.night') && done(b, 'sq.ow.night'), 'night handed in');
}
{ // Black bears: 2 of 3, and it opens only after the Night Fence
  const { b } = mk();
  ok(b.statusOf('sq.ow.bears') !== ACTIVE && !b.accept('sq.ow.bears'), 'bears locked before the Night Fence');
  b.accept('sq.ow.night'); for (const w of ['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5']) b.feed({ type: 'beast:died', id: w }); b.handIn('sq.ow.night');
  ok(b.accept('sq.ow.bears'), 'bears accepted after it');
  b.feed({ type: 'beast:died', id: 'blackBear1' });
  ok(b.statusOf('sq.ow.bears') === ACTIVE, 'one bear is not enough');
  b.feed({ type: 'beast:died', id: 'blackBear3' });
  ok(b.statusOf('sq.ow.bears') === READY, 'ready after 2 bears');
  ok(!!b.handIn('sq.ow.bears') && done(b, 'sq.ow.bears'), 'bears handed in');
}
{ // Letters: Hesk -> Dorrin
  const { b, inv } = mk();
  ok(b.accept('sq.ow.letters'), 'letters accepted');
  ok((inv.get('arrow') || 0) === 5, 'accept gives 5 arrows');
  b.feed({ type: 'item:count', id: 'arrow', n: 5 });
  ok(get('sq.ow.letters').giver.turnIn === 'dorrin', 'hand-in at Dorrin');
  ok(b.statusOf('sq.ow.letters') === READY, 'ready with the arrows in hand');
  ok(!!b.handIn('sq.ow.letters') && done(b, 'sq.ow.letters'), 'letters delivered');
}
for (const [id, flag] of [['sq.ow.song', 'talk.dorrin'], ['sq.ow.news', 'talk.rook']]) {
  const { b } = mk();
  ok(b.accept(id), id + ' accepted');
  ok(b.statusOf(id) === ACTIVE, id + ' active before the talk');
  b.feed({ type: 'flag:set', key: flag, value: true });
  ok(b.statusOf(id) === READY, id + ' ready after ' + flag);
  ok(!!b.handIn(id) && done(b, id), id + ' handed in');
}
{ // Walk the track: two areas, any order
  const { b } = mk();
  ok(b.accept('sq.ow.trail'), 'trail accepted');
  b.feed({ type: 'area:entered', id: 'crossroads' });
  ok(b.statusOf('sq.ow.trail') === ACTIVE, 'one area is not enough');
  b.feed({ type: 'area:entered', id: 'owPath' });
  ok(b.statusOf('sq.ow.trail') === READY, 'ready after both');
  ok(!!b.handIn('sq.ow.trail') && done(b, 'sq.ow.trail'), 'trail handed in');
}
console.log(`errands2: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
