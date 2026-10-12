// OB-097: two-pane journal. Run: node game/js/ui/questLogScreen.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestBook } from '../quest/sim/questBook.js';
import { createQuestLogScreen, QUEST_LOG_KEYS } from './questLog.js';

const rd = n => JSON.parse(readFileSync(new URL('../../../content/quests/' + n, import.meta.url)));
const main = rd('m1.quest.json'), blade = rd('tower.blade.quest.json'), boars = rd('burl.boars.quest.json');
const ui = createUiLayer({ cols: 160 });
const book = createQuestBook(main, [blade, boars]);
const log = createQuestLogScreen(book);
log.open();
let s = log.snapshot();
const has = (re) => s.right.some(l => re.test(l)), upd = () => { log.draw(ui); s = log.snapshot(); };
// OB-099: m1 is NOT a quest of its own. Its steps 1-4 are covered by the giver quests (silent sections) -> nothing listed yet
assert.deepEqual(s.left, [], 'wake step: nothing listed - m1 is covered and Not Safe is only offered until the note is read (OB-100): ' + s.left);
assert.ok(!has(/Objectives|Go up the tower/), 'offered: no objectives yet: ' + s.right);
book.feed({ type: 'flag:set', key: 'wake', value: true });
// quest 1 "Not Safe": offered -> accepted (pick up the note)
assert.equal(book.accept('tower.blade'), true); upd();
assert.deepEqual(s.left, ['Not Safe'], 'only the giver quest is listed');
assert.equal(s.right[0], 'Not Safe');
assert.ok(s.right.join(' ').includes('A note pinned to the wall: it is not safe here. Find a blade.'), 'short description: ' + s.right);
assert.ok(has(/^\[>\] Go up the tower$/), 'go step has no count: ' + s.right);
assert.ok(!has(/Sword|safe to go outside/), 'no future objectives: ' + s.right);
book.feed({ type: 'area:entered', id: 'breach' }); upd();
assert.ok(has(/^\[x\] Go up the tower$/) && has(/^\[>\] Sword\s+0\/1$/), 'item step counted 0/1: ' + s.right);
assert.ok(!has(/safe to go outside/), 'leave step still hidden');
book.feed({ type: 'item:got', id: 'sword' }); upd();
assert.ok(has(/^\[x\] Sword\s+1\/1$/) && has(/^\[>\] Now it is safe to go outside$/), 'safe to go outside appears after pick up: ' + s.right);
book.feed({ type: 'area:entered', id: 'towerDoor' }); upd();
assert.ok(s.right.some(l => l.includes('Talk to the bear')), 'ready -> return objective: ' + s.right);
assert.ok(book.handIn('tower.blade')); upd();
assert.ok(!s.left.includes('Not Safe') || s.left.indexOf('Not Safe') >= s.doneFrom, 'handed in: not in the active list');
assert.deepEqual(s.left, [], 'handed-in quest disappears; the boar quest is only offered, so not listed yet (OB-100): ' + s.left);
// quest 2: "Boars in the Woods" - listed once picked up
assert.equal(book.accept('burl.boars'), true); upd();
assert.deepEqual(s.left, ['Boars in the Woods'], 'accepted -> listed: ' + s.left);
assert.ok(has(/^\[>\] Kill boars\s+0\/5$/), 'kill count: ' + s.right);
for (const id of ['boar1', 'boar2', 'boar3']) book.feed({ type: 'beast:died', id });
upd(); assert.ok(has(/^\[>\] Kill boars\s+3\/5$/), 'kills counted: ' + s.right);
for (const l of s.right) assert.ok(l.length <= 40, 'right fits: ' + l);
for (const l of s.left) assert.ok(l.length <= 22, 'left fits: ' + l);
const b = log.draw(ui); assert.equal(log.draw(ui), b, 'bounds reused'); assert.ok(b.w === 72 && b.h === 24);
for (const id of ['boar4', 'boar5']) book.feed({ type: 'beast:died', id });
upd(); assert.ok(s.right.some(l => l.includes('Return to the bear')), 'returnText when ready');
assert.ok(book.handIn('burl.boars')); upd();
assert.equal(s.left.length, 1, 'boars handed in -> disappears; m1 small entry appears: ' + s.left);
assert.equal(s.left[0], 'Follow the Bear', 'm1 shows only the current uncovered step');
assert.ok(s.right[0].startsWith('Follow the Bear'));
assert.ok(has(/^\[>\] Follow the bear$/) && !has(/Wake the waystone/), 'one objective, no count, no future: ' + s.right);
book.feed({ type: 'flag:set', key: 'burl.arrived', value: true }); upd();
assert.equal(s.left[0], 'Awaken the Stone', 'title follows the step');
assert.ok(!has(/Follow the bear/), 'previous section steps not repeated');
// two giver quests at once + selection + mouse
const two = createQuestBook(main, [blade, boars]);
two.accept('tower.blade');
const l2 = createQuestLogScreen(two); l2.open(); l2.draw(ui);
assert.equal(l2.snapshot().left.length, 1);
// mouse: first row
const bb = log.draw(ui); assert.equal(log.handleClick(bb.x + 6, bb.y + 6), true);
assert.equal(log.handleClick(bb.x + 40, bb.y + 7), false, 'right pane click ignored');
// fallback: no `journal` -> objective text; locked rows hidden; counts only when counted
const fb = createQuestLogScreen({ version: 1, count: 1, status: () => 2, def: () => ({ id: 'q', title: 'Q' }), objectives: () => [{ id: 'a', text: 'Do the thing', status: 'active', progress: 0, target: 1 }, { id: 'b', text: 'Then more', status: 'locked', progress: 0, target: 3, counted: true }] });
fb.open(); const f = fb.snapshot(); assert.ok(f.right.includes('Do the thing'), 'fallback summary'); assert.ok(!f.right.some(l => l.includes('Then more')), 'locked hidden');
// close keys
for (const k of ['KeyJ', 'Escape']) { log.open(); assert.ok(log.isOpen()); assert.equal(log.handleKey(k), true); assert.ok(!log.isOpen()); }
assert.equal(log.handleKey('KeyS'), false, 'closed log ignores keys');
assert.ok(QUEST_LOG_KEYS.includes('KeyJ'));
// zero alloc draw
log.open();
const heap = () => process.memoryUsage().heapUsed;
for (let i = 0; i < 2000; i++) log.draw(ui);
globalThis.gc?.(); const h0 = heap();
for (let i = 0; i < 1e4; i++) log.draw(ui);
const grown = heap() - h0;
assert.ok(grown < 512 * 1024, 'draw alloc ' + grown);
console.log('questLogScreen: m1 not listed, no future objectives, counts only item/kill, done disappears, quest 1 -> 2 -> m1 entry, 0-alloc draw (' + grown + ' B / 1e4) PASS');
