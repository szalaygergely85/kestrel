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
// LEFT = names, main first; RIGHT = title, summary from `journal`, objectives with counts
assert.ok(s.right[0].length > 0, 'title');
assert.ok(s.right.some(l => l.startsWith('You came to')), 'summary = active step journal: ' + s.right);
assert.ok(s.right.includes('Objectives'));
assert.ok(s.right.some(l => /^\[>\] Get up from the wreck\s+0\/1$/.test(l)), 'active step with count: ' + s.right);
// summary follows the active step
book.feed({ type: 'flag:set', key: 'wake', value: true });
log.draw(ui); s = log.snapshot();
assert.ok(s.right.some(l => /^\[x\] Get up from the wreck\s+1\/1$/.test(l)), 'done step checked');
assert.ok(!s.right.some(l => l.startsWith('You came to')), 'old summary gone');
assert.ok(s.right.some(l => l.startsWith('You found a note')), 'summary moved to next step: ' + s.right);
for (const e of [{ type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) book.feed(e);
log.draw(ui); s = log.snapshot();
assert.ok(s.right.some(l => l.startsWith('You have the sword. Meet the bear')), 'sword done -> meet the bear: ' + s.right);
// layout bounds
for (const l of s.right) assert.ok(l.length <= 40, 'right fits: ' + l);
for (const l of s.left) assert.ok(l.length <= 22, 'left fits: ' + l);
const b = log.draw(ui); assert.equal(log.draw(ui), b, 'bounds reused'); assert.ok(b.w === 72 && b.h === 24);
// active giver quests + selection
book.feed({ type: 'area:entered', id: 'towerDoor' });
assert.equal(book.accept('tower.blade'), true); assert.ok(book.handIn('tower.blade'));
assert.equal(book.accept('burl.boars'), true);
log.draw(ui); s = log.snapshot();
assert.equal(s.sel, 0); assert.equal(s.left.length, 3); assert.equal(s.doneFrom, 2, 'main + boars active, blade done last');
assert.equal(s.left[1], 'Boars in the Woods');
assert.ok(log.handleKey('KeyS')); s = log.snapshot(); assert.equal(s.sel, 1);
assert.ok(s.right[0].startsWith('Boars in the Woods') && s.right.some(l => l.startsWith('Given by: ')), 'details follow selection: ' + s.right);
assert.ok(s.right.some(l => l.startsWith('Burl wants the five boars')), 'journal text');
assert.ok(s.right.some(l => /^\[>\] Bring down the five wild boars\s+0\/5$/.test(l)));
for (const id of ['boar1', 'boar2', 'boar3']) book.feed({ type: 'beast:died', id });
log.draw(ui); assert.ok(log.snapshot().right.some(l => /Bring down the five wild boars\s+3\/5$/.test(l)), 'kill counts');
// W/S wraps, A/D consumed (no tabs), unknown keys pass through
assert.ok(log.handleKey('KeyS') && log.handleKey('KeyS') && log.snapshot().sel === 0, 'wraps');
assert.ok(log.handleKey('KeyW') && log.snapshot().sel === 2); log.handleKey('ArrowDown'); assert.equal(log.snapshot().sel, 0);
assert.equal(log.handleKey('KeyD'), true); assert.equal(log.handleKey('KeyZ'), false);
// mouse: click the second name row
const bb = log.draw(ui); assert.equal(log.handleClick(bb.x + 6, bb.y + 6 + 1), true); assert.equal(log.snapshot().sel, 1);
assert.equal(log.handleClick(bb.x + 40, bb.y + 7), false, 'right pane click ignored');
// ready -> returnText summary; done -> listed after active
for (const id of ['boar4', 'boar5']) book.feed({ type: 'beast:died', id });
log.draw(ui); s = log.snapshot();
assert.ok(s.right.some(l => l.includes('Tell Burl the slope is quiet')), 'returnText when ready');
assert.ok(s.right.some(l => /^\[x\] Bring down.*5\/5$/.test(l)));
assert.ok(book.handIn('burl.boars')); log.draw(ui); s = log.snapshot();
assert.equal(s.doneFrom, 1, 'only main still active'); assert.equal(s.left.length, 3);
assert.ok(log.handleKey('KeyS')); s = log.snapshot(); assert.ok(s.sel >= s.doneFrom); assert.ok(s.right.some(l => l.startsWith('All done')));
// empty book
const empty = createQuestLogScreen({ version: 0, count: 0, status: () => 0, def: () => ({}), objectives: () => [] });
empty.open(); assert.equal(empty.snapshot().left.length, 0); empty.draw(ui);
// fallback: no `journal` -> objective text
const fb = createQuestLogScreen({ version: 1, count: 1, status: () => 2, def: () => ({ id: 'q', title: 'Q' }), objectives: () => [{ id: 'a', text: 'Do the thing', status: 'active', progress: 0, target: 1 }, { id: 'b', text: 'Then more', status: 'locked', progress: 0, target: 3 }] });
fb.open(); const f = fb.snapshot(); assert.ok(f.right.includes('Do the thing'), 'fallback summary'); assert.ok(f.right.some(l => /^\[ \] Then more\s+0\/3$/.test(l)));
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
console.log('questLogScreen: two panes, selection, counts, journal summary follows step, fallback, click, 0-alloc draw (' + grown + ' B / 1e4) PASS');
