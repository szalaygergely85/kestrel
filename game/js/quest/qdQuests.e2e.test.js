// QD-01/02/04 (OB-225, D-120): the three reworked side quests run end to end on the real content
// (accept at the giver -> every objective from its real event -> hand-in at the character -> reward) + their authored shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createQuestE2e } from './questE2eRun.js';
import { loadQuestE2eBundle } from '../../../tools/quest-e2e-content.mjs';

const bundle = await loadQuestE2eBundle();
const h = await createQuestE2e(bundle); // one shared run, like allQuests.e2e (Burl's offer order depends on the earlier quests)
const pack = JSON.parse(fs.readFileSync(new URL('../../../content/quests/ch12/pack.json', import.meta.url), 'utf8'));
const world = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const row = (id) => pack.quests.find((q) => q.id === id);
for (const id of ['sq.he.farm', 'sq.fc.well', 'sq.burl.tower']) {
  const r = h.runQuest(h.defs.find((d) => d.id === id));
  assert.ok(r.ok, id + ' e2e failed at ' + r.step + ': ' + r.msg);
  const q = row(id);
  assert.ok(q.steps.length >= 2 && q.steps.length <= 3, id + ' 1-3 objectives');
  for (const s of q.steps) { assert.ok(s.objText.length <= 38, id + ' objText ' + s.objText); assert.ok(s.journal.length <= 38, id + ' journal ' + s.journal); }
  for (const k of ['offer', 'active', 'ready', 'done']) for (const l of q.lines[k]) assert.ok(l.length <= 56, id + ' line ' + l);
}
// shape: kill ids exist as reserve beasts of the right group; talk sites resolve to world entities with an inspect text
const ent = (id) => world.entities.find((e) => e.id === id);
const sites = JSON.parse(fs.readFileSync(new URL('../../../content/quests/sites.json', import.meta.url), 'utf8')).sites;
for (const id of ['farmGob1', 'farmGob2', 'farmGob3']) assert.equal(ent(id).components.brain.group, 'farm.goblins');
for (const id of ['qd04_fox1', 'qd04_fox2']) { const b = ent(id).components.brain; assert.ok(b.reserve === true && b.group === 'qd04.foxes' && b.beastKind === 'fox_raider', id); }
for (const s of ['qd01_farmTable', 'rsInspectWell', 'qd04_towerScratch']) assert.ok(ent(sites[s].entity) && ent(sites[s].entity).components.inspect, 'site ' + s);
assert.deepEqual(row('sq.fc.well').reward.items, [{ id: 'potion.mp', n: 1 }], 'Cold Well reward = 1 mana potion');
assert.ok(ent('qd04_hood').components.questPickup.item === 'lamp.hood', 'hood pickup is the unique quest item');
assert.deepEqual(row('sq.burl.tower').steps[2].params, { item: 'lamp.hood', count: 1 }, 'step 3 needs the lamp hood, not any brass scrap');
assert.equal(ent('qd04_fox1').components.brain.beastKind, 'fox_raider');
// carrying plain brass scrap does NOT complete step 3; only the lamp hood does (pack-counted, so a pre-taken hood cannot soft-lock)
{
  const { createQuestBook } = await import('./sim/questBook.js');
  const def = h.defs.find((d) => d.id === 'sq.burl.tower');
  const bk = createQuestBook(h.m1, h.defs.map((d) => (d.id === def.id ? { ...d, requires: undefined } : d)));
  assert.ok(bk.accept('sq.burl.tower'), 'accept');
  const i = bk.index('sq.burl.tower'), out = [];
  const step3 = () => { out.length = 0; bk.objectives(i, out); return out[2]; };
  bk.feed({ type: 'flag:set', key: 'talk.qd04_towerScratch', value: true });
  bk.feed({ type: 'beast:died', id: 'qd04_fox1' }); bk.feed({ type: 'beast:died', id: 'qd04_fox2' });
  assert.equal(step3().status, 'active', 'steps 1-2 done, step 3 open');
  bk.feed({ type: 'item:count', id: 'brass.scrap', n: 3 }); bk.feed({ type: 'item:got', id: 'brass.scrap' });
  assert.equal(step3().status, 'active', 'brass scrap in the pack must not count');
  bk.feed({ type: 'item:count', id: 'lamp.hood', n: 1 });
  bk.feed({ type: 'item:got', id: 'lamp.hood' });
  assert.ok(step3().status !== 'active' && step3().progress === 1, 'the lamp hood completes step 3: ' + JSON.stringify(step3()));
}
console.log('qdQuests.e2e ok');
