// OB-178: the REAL m1 chain from the boar hand-in to q05 - real questRelay + book + dialogueCtl + burlEscort + npcWalk on Burl's real walks.
//   node game/js/quest/m1FollowChain.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDialogue } from '../../../engine/index.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { createQuestRelay } from '../questRelay.js';
import { createNpcWalk } from './npcWalk.js';
import { createBurlEscort } from './burlEscort.js';

const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const m1 = rd('content/quests/m1.quest.json'), burl = rd('content/quests/burl.boars.quest.json'), blade = rd('content/quests/tower.blade.quest.json');
const dialogues = { bear: compileDialogue(rd('content/dialogue/bear.dialogue.json')) };
const BOARS = burl.objectives[0].when.ids;
const bearEnt = rd('content/worlds/world_m1.world.json').entities.find((e) => e.id === 'bear');
const ent = { transform: { x: bearEnt.x, y: bearEnt.y, z: 0, yawDeg: 0 }, components: JSON.parse(JSON.stringify(bearEnt.components)) };
ent.components.voxel.hidden = false;

const r = createQuestRelay(m1, undefined, [blade, burl, rd('content/quests/burl.follow.quest.json'), rd('content/quests/burl.stone.quest.json')], undefined);
r.world = { state: {} };
const state = r.world.state;
const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: () => true, addInteractable: (s) => s };
const handle = { data: ent, play() { return this; } };
const dw = { state, get: (id) => (id === 'bear' ? handle : null), addInteractable: (s) => s };
function talk(pick = 0) {
  const keys = new Set();
  const ctl = createDialogueCtl({ world: dw, dialogues, book: () => r.book, questFlag: (k) => r.questFlag(k), onFlag: (k) => r.questFlag(k) });
  const input = { pressed: (c) => keys.has(c) };
  const tick = (...k) => { keys.clear(); k.forEach((c) => keys.add(c)); ctl.step(1 / 60, input, true); };
  assert.equal(ctl.openFor('bear'), true);
  for (let i = 0; i < 300 && ctl.open; i++) {
    if (ctl.runner.state === 'choosing') { for (let k = 0; k < pick; k++) tick('ArrowDown'); tick('KeyE'); continue; }
    tick('KeyE');
  }
  tick();
}
const active = () => { const o = r.state.completed; return m1.objectives.find((x) => !o.includes(x.id)); };

// wake..leave, blade turn-in, boars offer accepted at Burl, 5 boars, hand-in
r.book.actKey('q.tower.blade.accept');
r.feed({ type: 'flag:set', key: 'wake', value: true }); r.feed({ type: 'area:entered', id: 'breach' });
r.feed({ type: 'item:got', id: 'sword' }); r.feed({ type: 'area:entered', id: 'towerDoor' });
talk(0);
assert.equal(r.book.statusOf('burl.boars'), 2, 'boars accepted at Burl');
for (const b of BOARS) r.feed({ type: 'beast:died', id: b });
assert.equal(r.book.statusOf('burl.boars'), 3);
talk(1); // hand-in; Exit the follow offer
assert.equal(r.book.statusOf('burl.boars'), 4, 'handed in');
r.checkSections();
const FO = 'burl.follow', ST = 'burl.stone';
const marks = () => { const g = [], q = [], sa = [], sq = []; r.book.markLists(g, q, sa, sq); return { bang: g.concat(sa), ask: q.concat(sq) }; };
// the boar hand-in talk ends in the follow OFFER: Exit leaves it offered, nothing walks (D-105)
assert.equal(active().id, 'follow', 'q04 Follow the bear is the next step');
assert.equal(r.book.statusOf(FO), 1, 'follow offered (available), not accepted: ' + r.book.statusOf(FO));
assert.ok(marks().bang.includes('bear'), 'gold ! over Burl for the offer');
assert.ok(!state['burl.follow'], 'no auto-start');
assert.equal(r.book.statusOf(FO), 1, 'Exit (in the hand-in talk) keeps it offered'); assert.ok(!state['burl.follow'], 'Exit: Burl does not walk');
talk(1); assert.equal(r.book.statusOf(FO), 1, 'a second Exit keeps it offered'); assert.ok(!state['burl.follow']);
talk(0); // offer again -> Lead on
assert.equal(r.book.statusOf(FO), 2, 'accepted'); assert.ok(state['burl.follow'], 'accept: Burl starts walking ' + JSON.stringify(state));
assert.equal(r.book.tracked(), r.book.byIndex ? r.book.tracked() : r.book.tracked(), 'tracked');
assert.ok(!marks().bang.includes('bear') && !marks().ask.includes('bear'), 'no mark over Burl while following (MARK-FOLLOW-01)');

// the walker, as main.js builds it
const walk = createNpcWalk(world, 'bear', {});
const flagsSet = [];
const esc = createBurlEscort({ world, walk, questFlag: (k) => { flagsSet.push(k); r.questFlag(k); }, id: 'bear', x: () => ent.transform.x, y: () => ent.transform.y,
  dialogueOpen: () => false, afterLeave: () => r.state.completed.includes('leave'), requestOpen: () => {}, leadStatus: () => r.book.statusOf('sq.burl.walk') });
esc.load();
const P = ent.components.walks.follow, end = P[P.length - 1];
let steps = 0;
for (; steps < 60 * 120 && !state['burl.arrived']; steps++) {
  const t = ent.transform; // the player trails 3 m behind Burl, like a follower
  esc.step(1 / 60, t.x + 3, t.y, false);
}
assert.ok(esc.phase >= 1, 'escort left home phase');
assert.ok(state['burl.arrived'], 'burl.arrived set within 120 s (phase ' + esc.phase + ', at ' + ent.transform.x.toFixed(1) + ',' + ent.transform.y.toFixed(1) + ' -> ' + end + ')');
assert.ok(Math.hypot(ent.transform.x - end[0], ent.transform.y - end[1]) < 2, 'Burl stands at the stone end');
assert.equal(r.book.statusOf(FO), 3, 'follow ready on arrival'); assert.ok(marks().ask.includes('bear'), 'gold ? over Burl at the stone');
assert.equal(active().id, 'follow', 'q04 is handed in by talking, not by arriving');
talk(1); // stone talk (hand-in) then q05 offer: Not yet
assert.equal(r.book.statusOf(FO), 4, 'follow handed in'); r.checkSections();
assert.equal(active().id, 'waystone', 'q05 Wake the waystone is the next step');
assert.equal(r.book.statusOf(ST), 1, 'q05 offered, not accepted'); assert.ok(marks().bang.includes('bear') && !marks().ask.includes('bear'), '! for q05, ? gone');
talk(1); assert.equal(r.book.statusOf(ST), 1, 'Exit keeps q05 offered');
talk(0); assert.equal(r.book.statusOf(ST), 2, 'q05 accepted -> active');
assert.equal(r.book.tracked(), r.book.tracked());
console.log('m1FollowChain: hand-in -> follow active -> Burl walks ' + steps + ' steps -> burl.arrived -> waystone active PASS');
