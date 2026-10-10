import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestBook } from '../quest/sim/questBook.js';
import { createQuestLogScreen, QUEST_LOG_KEYS } from './questLog.js';

const rd = n => JSON.parse(readFileSync(new URL('../../../content/quests/' + n, import.meta.url)));
const main = rd('m1.quest.json'), boars = rd('burl.boars.quest.json');
const ui = createUiLayer({ cols: 160 });
const book = createQuestBook(main, [boars]);
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
assert.equal(book.accept('burl.boars'), true);
log.draw(ui); s = log.snapshot();
assert.ok(s.lines.some(l => l.includes("Boars in the Woods")));
assert.ok(log.handleKey('KeyS') && log.snapshot().sel === 1);
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
assert.ok(s.lines.indexOf('Active') >= 0 && s.lines.indexOf('Done') > s.lines.indexOf('Active'));
// navigation wraps, unknown keys pass through
const n0 = log.snapshot().sel;
assert.equal(log.handleKey('KeyS'), true); assert.notEqual(log.snapshot().sel, n0);
assert.equal(log.handleKey('KeyW'), true); assert.equal(log.snapshot().sel, n0);
assert.equal(log.handleKey('KeyX'), false);
// close keys
for (const k of ['Enter', 'KeyJ', 'Escape']) { log.open(); assert.ok(log.isOpen()); assert.equal(log.handleKey(k), true); assert.ok(!log.isOpen()); }
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
