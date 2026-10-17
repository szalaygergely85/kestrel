// QL-21 AC2: Ch3 opening chain on the real pack defs: mq.smoke done -> mq.ow.path -> mq.ow.fence (5 wolf kills; kills made before the quest opens still count).
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, DONE, ACTIVE, UNAVAILABLE } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const get = id => all.find(d => d.id === id);
const smoke = { ...get('mq.smoke') }; delete smoke.requires; // stub the earlier chapters: start the chain at mq.smoke
const defs = [get('m1'), smoke, get('mq.ow.path'), get('mq.ow.fence')];
const mk = () => createQuestBook(defs[0], defs.slice(1));
const wolves = ['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5'];

{
  const b = mk();
  ok(b.statusOf('mq.ow.path') === UNAVAILABLE, 'path closed before mq.smoke');
  b.feed({ type: 'flag:set', key: 'lore.fordMark.read', value: true });
  b.feed({ type: 'area:entered', id: 'northLook' });
  ok(b.statusOf('mq.smoke') === DONE, 'smoke done');
  ok(b.statusOf('mq.ow.path') === ACTIVE, 'path opens after smoke');
  ok(b.statusOf('mq.ow.fence') === UNAVAILABLE, 'fence closed before path');
  for (const id of wolves.slice(0, 2)) b.feed({ type: 'beast:died', id }); // kills before the quest opens still count
  b.feed({ type: 'area:entered', id: 'owPath' });
  ok(b.statusOf('mq.ow.path') === DONE, 'path done at owPath');
  ok(b.statusOf('mq.ow.fence') === ACTIVE, 'fence opens after path');
  for (const id of wolves.slice(2, 4)) b.feed({ type: 'beast:died', id });
  ok(b.statusOf('mq.ow.fence') === ACTIVE, 'fence needs all 5 (4 killed)');
  b.feed({ type: 'beast:died', id: 'wolf5' });
  ok(b.statusOf('mq.ow.fence') === DONE, 'fence done after 5 wolves');
}
for (const id of ['mq.ow.path', 'mq.ow.fence']) for (const o of get(id).objectives) ok(o.text.length <= 38, id + ' objective <= 38 chars');
console.log(`ch3 chain: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
