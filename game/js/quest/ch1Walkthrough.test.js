// CH1-10 part B: scripted Chapter 1 walkthrough through the real questRelay + book + dialogueCtl + save round trip.
//   node game/js/quest/ch1Walkthrough.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDialogue, World, AssetRegistry } from '../../../engine/index.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { createQuestRelay } from '../questRelay.js';
import { applySave, collectSave } from './save/saveState.js';

const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const m1 = rd('content/quests/m1.quest.json'), burl = rd('content/quests/burl.boars.quest.json');
const dialogues = { bear: compileDialogue(rd('content/dialogue/bear.dialogue.json')) };
const BOARS = burl.objectives[0].when.ids;
const assets = new AssetRegistry({ palette: {} });
const world0 = World.load({ name: 'walk', terrain: null, structures: [], entities: [] }, assets, {});
const TITLES = m1.sections.map((s) => s.title);

const toasts = [];
const mkRelay = (saved, sq) => {
  const r = createQuestRelay(m1, saved, [burl], sq);
  r.world = { state: {} };
  r.onSection = (t) => toasts.push(t);
  return r;
};

// Real Burl dialogue on the real book; confirms every line (pick = choice index).
function talk(relay, pick = 0) {
  const keys = new Set();
  const comp = { model: 'bear', anim: 'idle', playing: false, loop: true };
  const handle = { data: { transform: { x: 0, y: 0, z: 0 }, components: { voxel: comp, dialogue: 'bear' } }, play() { return this; } };
  const world = { state: relay.world.state, get: (id) => (id === 'bear' ? handle : null), addInteractable: (s) => s };
  const ctl = createDialogueCtl({ world, dialogues, book: () => relay.book, onFlag: (k) => relay.questFlag(k) });
  const input = { pressed: (c) => keys.has(c) };
  const tick = (...k) => { keys.clear(); k.forEach((c) => keys.add(c)); ctl.step(1 / 60, input, true); };
  assert.equal(ctl.openFor('bear'), true);
  for (let i = 0; i < 300 && ctl.open; i++) {
    if (ctl.runner.state === 'choosing') { for (let k = 0; k < pick; k++) tick('KeyS'); tick('KeyE'); continue; }
    tick('KeyE');
  }
  tick();
}
const done = (r) => r.state.completed.slice();
const expectToasts = (n, msg) => assert.deepEqual(toasts, TITLES.slice(0, n), msg);

let r = mkRelay();
assert.equal(toasts.length, 0);

// q01: wake -> breach -> sword
r.feed({ type: 'flag:set', key: 'wake', value: true }); expectToasts(0, 'wake alone: no toast');
r.feed({ type: 'area:entered', id: 'breach' }); expectToasts(0);
r.feed({ type: 'item:got', id: 'sword' }); expectToasts(1, 'q01 toast after sword');
// q02: door
r.feed({ type: 'area:entered', id: 'towerDoor' }); expectToasts(2, 'q02 toast after door');
// q03: accept, 5 boars, hand in
talk(r, 0);
assert.equal(r.book.statusOf('burl.boars'), 2, 'accepted');
for (let i = 0; i < 4; i++) r.feed({ type: 'beast:died', id: BOARS[i] });
expectToasts(2, 'no toast before the 5th boar');
r.feed({ type: 'beast:died', id: BOARS[4] });
assert.equal(r.book.statusOf('burl.boars'), 3, 'ready');
expectToasts(2, 'no toast at ready (needs the hand-in)');
talk(r);
assert.equal(r.book.statusOf('burl.boars'), 4, 'handed in');
r.checkSections(); // saveRelay.stepGame does this each step for hand-ins that bypass feed
expectToasts(3, 'q03 toast after hand-in');
r.checkSections(); r.feed({ type: 'item:got', id: 'sword' }); expectToasts(3, 'no replay on repeated checks/events');

// ---- save/load round trip midway (between q03 and q04) ----
{
  const save = collectSave(world0, { quest: r.state, questDef: m1, quests: r.book.toSave().quests, giverDefs: [burl], deadBeasts: BOARS });
  const a = applySave(JSON.parse(JSON.stringify(save)), assets, { questDef: m1, giverDefs: [burl] });
  const before = toasts.length, w = r.world;
  r = mkRelay(a.quest, a.quests); r.world = w;
  r.checkSections();
  assert.equal(toasts.length, before, 'restore never toasts');
  assert.deepEqual(done(r), ['wake', 'breach', 'sword', 'leave', 'beasts'], 'restored progress');
  assert.equal(r.book.statusOf('burl.boars'), 4);
}

// q04 follow -> arrive
r.questFlag('burl.arrived'); expectToasts(4, 'q04 toast on arrival');
// q05: wake stone
r.questFlag('waystone.waystone.woken'); expectToasts(5, 'q05 toast after stone wake');
assert.equal(r.world.state['waystone.waystone.woken'], true, 'questFlag writes world.state');
// q06: road -> relay found -> relay woken
r.feed({ type: 'area:entered', id: 'roadWest' }); expectToasts(5);
r.feed({ type: 'area:entered', id: 'bendRelay' }); expectToasts(5, 'q06 not before the relay wakes');
r.questFlag('waystone.ws_roadBend.woken'); expectToasts(6, 'q06 toast after relay wake');
assert.equal(r.done, false);
// q07: Fen end node
r.questFlag('fen.met'); expectToasts(7, 'q07 toast at the Fen end node');
assert.equal(r.done, true, 'chain complete');
assert.deepEqual(done(r).length, m1.objectives.length);
assert.deepEqual(toasts, TITLES, 'every section toast exactly once, in order');
r.checkSections(); r.questFlag('fen.met'); assert.equal(toasts.length, TITLES.length, 'no extra toast at the end');
console.log('ch1Walkthrough: wake..Fen, 7 section toasts once in order, save/load no replay PASS');
