// QG-03 (38.35): Burl's boar quest end to end in Node: real book + real dialogueCtl + compiled bear dialogue + m1 chain.
//   node game/js/quest/questGiverFlow.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDialogue, World, AssetRegistry } from '../../../engine/index.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { createQuestRelay } from '../questRelay.js';
import { applySave, collectSave } from './save/saveState.js';

const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const m1 = rd('content/quests/m1.quest.json'), burl = rd('content/quests/burl.boars.quest.json'), blade = rd('content/quests/tower.blade.quest.json');
const dialogues = { bear: compileDialogue(rd('content/dialogue/bear.dialogue.json')) };
const BOARS = burl.objectives[0].when.ids;
const assets = new AssetRegistry({ palette: {} });
const world0 = World.load({ name: 'qg', terrain: null, structures: [], entities: [] }, assets, {});

function setup(relay) {
  const state = {}, keys = new Set();
  const comp = { model: 'bear', anim: 'idle', playing: false, loop: true };
  const handle = { data: { transform: { x: 0, y: 0, z: 0 }, components: { voxel: comp, dialogue: 'bear' } }, play() { return this; } };
  const world = { state, get: (id) => (id === 'bear' ? handle : null), addInteractable: (s) => s };
  const flagsOut = [];
  const ctl = createDialogueCtl({ world, dialogues, book: () => relay.book, onFlag: (k) => flagsOut.push(k) });
  const input = { pressed: (c) => keys.has(c) };
  const tick = (...k) => { keys.clear(); k.forEach((c) => keys.add(c)); ctl.step(1 / 60, input, true); };
  // Talk: confirm every line; at a choice move down `pick` times, then confirm. `esc` = Escape at that step. Returns the spoken lines.
  function talk(pick = 0, esc = -1) {
    const said = [];
    assert.equal(ctl.openFor('bear'), true);
    for (let i = 0; i < 300 && ctl.open; i++) {
      if (i === esc) { tick('Escape'); break; }
      if (ctl.runner.state === 'choosing') { for (let k = 0; k < pick; k++) tick('KeyS'); tick('KeyE'); continue; }
      if (ctl.runner.state === 'typing' && said.at(-1) !== ctl.runner.line) said.push(ctl.runner.line);
      tick('KeyE');
    }
    tick();
    return said;
  }
  return { ctl, state, flagsOut, talk };
}
const mkRelay = (saved, sq) => createQuestRelay(m1, saved, [blade, burl], sq);
const toSword = (r) => { for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }]) r.feed(e);  r.book.accept('tower.blade'); r.book.handIn('tower.blade'); }; // note read + turned in: Burl's boar quest is on offer
const kill = (r, n) => { for (let i = 0; i < n; i++) r.feed({ type: 'beast:died', id: BOARS[i] }); };

// ---- accept -> kill 5 -> ready -> hand in -> done -> m1 beasts completes ----
{
  const r = mkRelay(), t = setup(r), ev = [];
  r.book.onChange = (n, id) => ev.push(n + ':' + id);
  toSword(r);
  assert.equal(r.book.statusOf('burl.boars'), 1);
  assert.equal(r.objectiveText(), 'Find the old bear on the hillside');
  const offer = t.talk(0);
  assert.equal(offer[0], "If you're heading west, mind the woods.");
  assert.equal(offer.at(-1), 'Mind their tusks, sky-cub.');
  assert.equal(r.book.statusOf('burl.boars'), 2, 'Accept -> active');
  assert.deepEqual(ev.filter((e) => e.endsWith('burl.boars')), ['quest:accepted:burl.boars']);
  assert.equal(r.objectiveText(), 'Bring down the five wild boars', 'HUD follows the tracked quest');
  assert.deepEqual(t.talk(), ['Still hearing those greedy snouts.', 'Five boars. No need to chase the whole herd.'], 'active -> reminder');
  kill(r, 4); assert.equal(r.book.statusOf('burl.boars'), 2);
  kill(r, 5); assert.equal(r.book.statusOf('burl.boars'), 3);
  assert.equal(r.objectiveText(), 'Tell Burl the slope is quiet');
  assert.ok(ev.includes('quest:ready:burl.boars'));
  assert.equal(r.state.completed.length, 4, 'm1 beasts still open before the hand-in');
  const handIn = t.talk(); // CH1-05: after-five lines, thanks (hand-in), then flows into the follow offer
  assert.equal(handIn[0], 'Ah! I can smell the berries again!'); assert.equal(handIn[7], "You've done an old bear a kindness."); assert.equal(handIn[8], 'Come along, sky-cub.');
  assert.equal(r.book.statusOf('burl.boars'), 4);
  assert.ok(ev.includes('quest:done:burl.boars'));
  assert.ok(r.state.completed.includes('beasts'), 'm1 beasts completed by the done flag');
  assert.equal(r.objectiveText(), m1.objectives[5].text, 'HUD back to m1 (waystone)');
  assert.equal(t.talk()[0], 'Come along, sky-cub.', 'done -> follow offer (entry 4) comes before bear.talked');
  assert.equal(Object.keys(t.state).filter((k) => k.includes('q.')).length, 0, 'q.* never stored in world.state');
}
// ---- chain: note '!' -> climb, sword, leave -> '?' over Burl -> first talk turns in -> Burl '!' -> accept ----
{
  const r = mkRelay(), t = setup(r), A = [], R = [], ev = [];
  r.book.onChange = (n, id) => ev.push(n + ':' + id);
  r.book.giverMarks(A, R); assert.deepEqual([A, R], [['noteKeepLight'], []], "start: '!' over the note, nothing over Burl");
  assert.equal(r.book.statusOf('burl.boars'), 0);
  assert.deepEqual(t.talk(), ['Out of the tower already, sky-cub? Empty-pawed?', 'Climb back up. The top holds more than a view.'], 'pre-quest line, no offer');
  assert.equal(r.book.statusOf('burl.boars'), 0);
  assert.equal(r.book.actKey('q.tower.blade.accept'), true); // reading the note
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) r.feed(e);
  r.book.giverMarks(A, R); assert.deepEqual([A, R], [[], []], 'sword taken, still in the tower: no marks');
  assert.deepEqual(t.talk(), ["The tower's not done with you yet, sky-cub.", "Finish up there. I'll be here. Bears keep."], 'PO-CH1-01: blade active, not ready: its own node, never "Empty-pawed?"');
  r.feed({ type: 'area:entered', id: 'towerDoor' });
  r.book.giverMarks(A, R); assert.deepEqual([A, R], [[], ['bear']], "left the tower: '?' over Burl");
  const meet = t.talk(1, -1); // choice 1 = 'I'm going west' -> flows into the boar offer, then 'Not yet'
  assert.equal(meet[0], 'Quite a fall you took, sky-cub.');
  assert.equal(r.book.statusOf('tower.blade'), 4, 'the meet turned the blade quest in');
  assert.ok(ev.includes('quest:done:tower.blade'));
  assert.equal(r.book.statusOf('burl.boars'), 1);
  r.book.giverMarks(A, R); assert.deepEqual([A, R], [['bear'], []], "turned in: Burl shows '!' for the boars");
}
// ---- Later keeps it available; boars before accept count; Esc on the ready line hands in nothing ----
{
  const r = mkRelay(), t = setup(r); toSword(r);
  assert.equal(t.talk(1).at(-1), 'Then sit a while. The boars will still be rude.');
  assert.equal(r.book.statusOf('burl.boars'), 1, 'Later keeps it available');
  kill(r, 5);
  assert.equal(r.book.statusOf('burl.boars'), 1, 'boars killed before accept: still needs Accept');
  t.talk(0); assert.equal(r.book.statusOf('burl.boars'), 3, 'accept with 5 dead -> ready');
  t.talk(0, 1); assert.equal(r.book.statusOf('burl.boars'), 3, 'Esc on the first ready line: nothing handed in');
  assert.equal(r.state.completed.includes('beasts'), false);
  t.talk(); assert.equal(r.book.statusOf('burl.boars'), 4);
}
// ---- save/load mid-quest ----
{
  const r = mkRelay(), t = setup(r); toSword(r); t.talk(0); kill(r, 2);
  const sv = r.book.toSave();
  assert.equal(sv.quests['burl.boars'].accepted, true);
  const save = collectSave(world0, { quest: r.state, questDef: m1, quests: sv.quests, giverDefs: [blade, burl], deadBeasts: BOARS.slice(0, 2) });
  const a = applySave(save, assets, { questDef: m1, giverDefs: [blade, burl] });
  const r2 = mkRelay(a.quest, a.quests);
  assert.equal(r2.book.statusOf('burl.boars'), 2);
  assert.equal(r2.book.questState(2).deadBeasts.length, 2);
  kill(r2, 5); assert.equal(r2.book.statusOf('burl.boars'), 3);
}
// ---- old save (no game.quests, pre-QG-03 m1 shape) migrates through applySave ----
{
  const oldM1 = JSON.parse(readFileSync(new URL('./sim/fixtures/m1.legacy.quest.json', import.meta.url))); oldM1.objectives[4].when = { type: 'beasts', ids: BOARS, count: 5 };
  const rOld = createQuestRelay(oldM1, null, []);
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'item:got', id: 'lantern' }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) rOld.feed(e); for (let i = 0; i < 3; i++) rOld.feed({ type: 'beast:died', id: BOARS[i] });
  const migrate = () => {
    const save = collectSave(world0, { quest: rOld.state, questDef: oldM1, deadBeasts: BOARS.slice(0, rOld.state.deadBeasts.length) });
    return applySave(save, assets, { questDef: oldM1, giverDefs: [blade, burl] });
  };
  const mid = migrate();
  assert.equal(mid.quests['burl.boars'].accepted, true, 'mid-fight old save -> accepted');
  const r3 = createQuestRelay(oldM1, rOld.state && mid.quest, [blade, burl], mid.quests);
  assert.equal(r3.book.statusOf('burl.boars'), 2); assert.equal(r3.book.questState(2).deadBeasts.length, 3);
  for (let i = 3; i < 5; i++) rOld.feed({ type: 'beast:died', id: BOARS[i] });
  const fin = migrate();
  assert.deepEqual([fin.quests['burl.boars'].accepted, fin.quests['burl.boars'].handedIn], [true, true]);
  const r4 = createQuestRelay(oldM1, fin.quest, [blade, burl], fin.quests);
  assert.equal(r4.book.statusOf('burl.boars'), 4);
  assert.equal(r4.book.handIn('burl.boars'), null, 'no retroactive reward');
}
// PO-CH1-01: note skipped, sword taken: accepting at the sword (main.js safety net) keeps the chain alive
{
  const r = mkRelay(), t = setup(r), A = [], R = [];
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) r.feed(e);
  assert.equal(r.book.actKey('q.tower.blade.accept'), true, 'sword pickup accepts the available blade quest');
  assert.equal(r.book.statusOf('tower.blade'), 2);
  assert.notDeepEqual(t.talk(), ['Out of the tower already, sky-cub? Empty-pawed?', 'Climb back up. The top holds more than a view.'], 'never Empty-pawed with the sword in hand');
  r.feed({ type: 'area:entered', id: 'towerDoor' });
  r.book.giverMarks(A, R); assert.deepEqual([A, R], [[], ['bear']], "left the tower: '?' over Burl");
}
// PO-CH1-07: boars dead before accepting -> accept makes the quest READY at once and the dialogue then lands on the hand-in
{
  const r = mkRelay(), t = setup(r), ev = [];
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }]) r.feed(e);
  r.book.actKey('q.tower.blade.accept'); r.book.actKey('q.tower.blade.handin');
  for (const b of BOARS) r.feed({ type: 'beast:died', id: b });
  r.book.onChange = (n, id) => ev.push(n + ':' + id);
  assert.equal(r.book.actKey('q.burl.boars.accept'), true);
  assert.deepEqual(ev, ['quest:accepted:burl.boars', 'quest:ready:burl.boars'], 'accept -> ready in one go (main.js re-opens Burl on this)');
  assert.equal(r.book.statusOf('burl.boars'), 3);
  const lines = t.talk(); assert.ok(lines[0].startsWith('Ah! I can smell the berries'), 'the re-opened talk lands on the hand-in: ' + lines[0]);
}
console.log('questGiverFlow: accept/kill/ready/hand-in/done, Later, Esc, boars-before-accept, save/load, old-save migration PASS');
