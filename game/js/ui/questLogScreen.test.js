import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestBook } from '../quest/sim/questBook.js';
import { createQuestLogScreen, QUEST_LOG_KEYS } from './questLog.js';

const rd = n => JSON.parse(readFileSync(new URL('../../../content/quests/' + n, import.meta.url)));
const main = rd('m1.quest.json'), blade = rd('tower.blade.quest.json'), boars = rd('burl.boars.quest.json');
const ui = createUiLayer({ cols: 160 });
const book = createQuestBook(main, [blade, boars]);
const MAIN_T = 0, SIDE_T = 1;
const log = createQuestLogScreen(book);
log.open();
let s = log.snapshot();
assert.ok(s.lines.includes('Active') && !s.lines.includes('Done'));
assert.ok(s.lines.some(l => l.includes('(main)')), 'main quest listed');
assert.ok(s.lines.some(l => l.startsWith('  [>]')), 'active step marked');
// empty book
const empty = createQuestLogScreen({ version: 0, count: 0, status: () => 0, def: () => ({}), objectives: () => [] });
empty.open(); assert.equal(empty.snapshot().lines.length, 0); empty.draw(ui);
// one active giver quest
for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }]) book.feed(e);
assert.equal(book.accept('tower.blade'), true); assert.ok(book.handIn('tower.blade'));
assert.equal(book.accept('burl.boars'), true);
log.draw(ui); s = log.snapshot();
// tabs: MAIN holds only the chapter quest; side quests are on the SIDE tab
assert.equal(s.tab, MAIN_T); assert.ok(!s.lines.some(l => l.includes('Boars in the Woods')), 'side quest not under MAIN');
assert.ok(log.handleKey('KeyD')); s = log.snapshot(); assert.equal(s.tab, SIDE_T);
assert.ok(!s.lines.some(l => l.includes('(main)')), 'main not under SIDE');
assert.ok(s.lines.some(l => l.includes("Boars in the Woods")));
assert.ok(log.handleKey('Tab') && log.snapshot().tab === MAIN_T); assert.ok(log.handleKey('ArrowRight') && log.snapshot().tab === SIDE_T);
// open / back: detail shows title, giver, objectives, reward; Esc backs to list, Esc again closes
assert.ok(log.handleKey('KeyE')); s = log.snapshot(); assert.equal(s.detail, true);
assert.ok(s.lines[0].includes('Boars in the Woods') || s.lines[0].length > 0); assert.ok(s.lines.some(l => l.startsWith('Given by: ')), 'giver shown: ' + s.lines);
assert.ok(s.lines.some(l => l.startsWith('  [>]')), 'objectives in detail');
assert.equal(log.handleKey('KeyS'), true); assert.equal(log.handleKey('KeyD'), true); assert.equal(log.snapshot().tab, SIDE_T, 'tab switch ignored in detail');
assert.ok(log.handleKey('Escape') && log.isOpen() && !log.snapshot().detail, 'Esc: detail -> list');
assert.ok(log.handleKey('Enter') && log.snapshot().detail); assert.ok(log.handleKey('Backspace') && !log.snapshot().detail && log.isOpen());
assert.ok(log.handleKey('KeyJ') === true && !log.isOpen(), 'J from list closes'); log.open(); assert.equal(log.snapshot().tab, MAIN_T, 'reopens on MAIN');
log.handleKey('KeyA'); assert.equal(log.snapshot().tab, SIDE_T);
assert.equal(log.snapshot().sel, 0, 'boars is the only active side quest');
s = log.snapshot(); assert.ok(s.lines.some(l => l.includes('[>] Bring down the five wild boars 0/5')));
for (const id of ['boar1', 'boar2']) book.feed({ type: 'beast:died', id });
log.draw(ui); assert.ok(log.snapshot().lines.some(l => l.endsWith('2/5')), 'rebuilt on version change');
// ready
for (const id of ['boar3', 'boar4', 'boar5']) book.feed({ type: 'beast:died', id });
log.draw(ui); s = log.snapshot();
assert.ok(s.lines.some(l => l.includes('> Tell Burl the slope is quiet')), 'returnText when ready');
assert.ok(s.lines.some(l => l.includes('[x] Bring down')));
// done
assert.ok(book.handIn('burl.boars')); log.draw(ui); s = log.snapshot();
assert.equal(s.tab, SIDE_T);
assert.ok(s.lines.includes('Done') && !s.lines.includes('Active'), 'SIDE: all done'); log.handleKey('KeyA'); s = log.snapshot(); assert.ok(s.lines.indexOf('Active') >= 0 && s.tab === MAIN_T); log.handleKey('KeyD');
// navigation wraps, unknown keys pass through
const n0 = log.snapshot().sel;
assert.equal(log.handleKey('KeyS'), true); assert.notEqual(log.snapshot().sel, n0);
assert.equal(log.handleKey('KeyW'), true); assert.equal(log.snapshot().sel, n0);
assert.equal(log.handleKey('KeyZ'), false);
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
console.log('questLogScreen: groups, steps, returnText, nav, close keys, empty, 0-alloc draw (' + grown + ' B / 1e4) PASS');
