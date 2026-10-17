// M1-RETIRE (OB-224): m1 "Beyond the Wall" is an internal chapter tracker only. A fresh game plays the opening chain wreck -> Rook
// on the small giver quests alone (giver '!', accept, 1-3 objectives, '?' + hand-in, reward, next offered), and the journal / HUD /
// marks never show m1. Old saves with m1 progress (no small-quest entries) migrate to the matching small-quest states.
// Run: node game/js/quest/m1Retire.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestRelay } from '../questRelay.js';
import { createQuestLogScreen } from '../ui/questLog.js';
import { AVAILABLE, ACTIVE, READY, DONE } from './sim/questBook.js';

const rd = (n) => JSON.parse(readFileSync(new URL('../../../content/quests/' + n + '.quest.json', import.meta.url), 'utf8'));
const m1 = rd('m1');
const CHAIN = ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone', 'burl.road', 'mq.bend.call'];
const defs = CHAIN.map(rd);
assert.equal(m1.internal, true, 'm1 is flagged internal');

// m1 strings the player must never see: its title, section titles and its objective texts
const HIDDEN = new Set([m1.title, ...m1.sections.map((s) => s.title), ...m1.objectives.map((o) => o.text)]);
const ownTexts = new Set(defs.flatMap((d) => [d.title, ...d.objectives.map((o) => o.text)])); // a small quest may share wording (e.g. "Wake the waystone")
for (const t of ownTexts) HIDDEN.delete(t);

const flag = (key) => ({ type: 'flag:set', key, value: true });
const STEPS = {
  'tower.blade': [{ type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }],
  'burl.boars': ['boar1', 'boar2', 'boar3', 'boar4', 'boar5'].map((id) => ({ type: 'beast:died', id })),
  'burl.follow': [flag('burl.arrived')],
  'burl.stone': [flag('waystone.waystone.woken')],
  'burl.road': [{ type: 'area:entered', id: 'roadWest' }, { type: 'area:entered', id: 'bendRelay' }, flag('waystone.ws_roadBend.woken')],
  'mq.bend.call': [flag('relay.bend.pulseSeen'), flag('lore.knot.read')],
};

const relay = createQuestRelay(m1, null, defs, null);
const book = relay.book;
const sections = []; relay.onSection = (t) => sections.push(t);
const ui = createUiLayer({ cols: 160 }), log = createQuestLogScreen(book);
const gA = [], gR = [], sA = [], sR = [];
function noM1(where) {
  const hud = relay.objectiveText();
  assert.ok(!HIDDEN.has(hud), `${where}: HUD shows m1 text "${hud}"`);
  log.open(); log.draw(ui); const s = log.snapshot(); log.close();
  for (const l of s.lines) for (const h of HIDDEN) assert.ok(!String(l).includes(h), `${where}: journal shows m1 "${h}" in "${l}"`);
}

noM1('fresh game');
assert.equal(relay.objectiveText(), '', 'fresh game: no m1 objective on the HUD (wake is the tutorial beat, not a quest)');
relay.feed(flag('wake'));
noM1('after wake');

for (let k = 0; k < CHAIN.length; k++) {
  const id = CHAIN[k], i = defs.findIndex((d) => d.id === id), def = defs[i];
  // rule: giver, 1-3 objectives, a reward
  assert.ok(def.giver && def.giver.npc, id + ': has a giver');
  assert.ok(def.objectives.length >= 1 && def.objectives.length <= 3, id + ': 1-3 objectives');
  assert.ok(def.reward && def.reward.items && def.reward.items.length, id + ': rewards something');
  for (const o of def.objectives) assert.ok(o.text.length <= 38, id + ': R19 objective <= 38 chars');
  // offered, never auto-started: '!' at the giver
  assert.equal(book.statusOf(id), AVAILABLE, id + ': offered (not auto-started)');
  book.markLists(gA, gR, sA, sR);
  assert.ok(gA.includes(book.giverOf(book.count - CHAIN.length + i)) || gA.includes(def.giver.npc), id + ': gold ! at the giver ' + JSON.stringify(gA));
  if (k > 0) assert.ok(book.nextOffers().some((o) => o.id === id), id + ': offered after the previous hand-in');
  noM1(id + ' offered');
  assert.ok(book.accept(id), id + ': accept');
  assert.equal(book.statusOf(id), ACTIVE);
  assert.ok(relay.objectiveText().startsWith(def.objectives[0].text), id + ': the tracked quest drives the HUD line'); // counted steps add " n/m"
  for (const e of STEPS[id]) { relay.feed(e); noM1(id + ' step'); }
  assert.equal(book.statusOf(id), READY, id + ': ready for hand-in');
  book.markLists(gA, gR, sA, sR);
  assert.ok(gR.includes(def.giver.turnIn || def.giver.npc), id + ': gold ? at the hand-in ' + JSON.stringify(gR));
  const reward = book.handIn(id);
  assert.ok(reward && reward.items.length, id + ': reward granted at hand-in');
  relay.questFlag('quest.' + id + '.done'); // the game sets the done flag on hand-in (saveRelay)
  assert.equal(book.statusOf(id), DONE);
  noM1(id + ' handed in');
}
assert.ok(relay.done, 'the internal chapter tracker finished with the chain');
assert.deepEqual(sections, [''], 'no m1 section toasts; one silent end call (chapter card)');
assert.ok(!relay.objectiveText().includes(m1.title));

// ---- save migration: an old save with m1 progress up to the road step and no small-quest entries
const old = { questVersion: 1, questId: 'm1', items: ['sword'], deadBeasts: [], areas: ['breach', 'towerDoor', 'roadWest'],
  flags: { wake: true, 'quest.tower.blade.done': true, 'quest.burl.boars.done': true, 'quest.burl.follow.done': true, 'waystone.waystone.woken': true, 'quest.burl.stone.done': true, 'burl.departing': true },
  completed: ['wake', 'breach', 'sword', 'leave', 'bladeDone', 'beasts', 'follow', 'waystone', 'stoneDone', 'road'] };
const mig = createQuestRelay(m1, old, defs, null), mb = mig.book;
for (const id of ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone']) assert.equal(mb.statusOf(id), DONE, 'migrated: ' + id + ' done');
assert.equal(mb.statusOf('burl.road'), ACTIVE, 'migrated: burl.road accepted, on its 2nd step');
assert.equal(mig.objectiveText(), 'Find the cold waystone at the bend', 'migrated HUD = the small quest step');
assert.equal(mb.statusOf('mq.bend.call'), 0, 'migrated: mq.bend.call not offered yet');
// an old save mid-follow: follow accepted is not derivable -> simply offered again at Burl (never lost, never auto-started)
const old2 = { ...old, flags: { wake: true, 'quest.tower.blade.done': true, 'quest.burl.boars.done': true }, completed: ['wake', 'breach', 'sword', 'leave', 'bladeDone', 'beasts'], areas: ['breach', 'towerDoor'] };
const mb2 = createQuestRelay(m1, old2, defs, null).book;
assert.equal(mb2.statusOf('burl.boars'), DONE, 'migrated mid: boars done');
assert.equal(mb2.statusOf('burl.follow'), AVAILABLE, 'migrated mid: follow offered at Burl');
console.log('m1Retire: opening chain on small quests only, m1 never shown, old saves migrate - OK');
