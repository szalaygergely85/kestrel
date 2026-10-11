// CH1-09: the Done row "Beyond the Wall" re-opens the journal. Run: node game/js/ui/questLogJournal.test.js
import assert from 'node:assert/strict';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestLogScreen } from './questLog.js';

const mk = (status) => ({ version: 1, count: 2, status: i => (i === 0 ? status : 2), def: i => ({ id: 'q' + i, title: i === 0 ? 'A Blade in the Ashes' : 'Side' }), objectives: () => [] });
const calls = [];
const log = createQuestLogScreen(mk(4), { onJournal: i => calls.push(i) });
log.open(); const ui = createUiLayer({ cols: 160 }); log.draw(ui);
let s = log.snapshot();
assert.ok(s.lines.some(l => l.startsWith('Beyond the Wall')), 'done main listed as Beyond the Wall: ' + s.lines);
assert.ok(!s.lines.some(l => l.includes('A Blade')), 'old title replaced');
log.open(); // MAIN tab: the done main quest is the only row
assert.equal(log.snapshot().lines.filter(l => l.startsWith('Beyond')).length, 1);
assert.ok(log.handleKey('Enter')); assert.deepEqual(calls, [0], 'journal callback'); assert.equal(log.isOpen(), false);
// without callback / not done: Enter opens the detail view (no close, no journal)
const plain = createQuestLogScreen(mk(4)); plain.open(); plain.handleKey('Enter'); assert.equal(plain.isOpen(), true); assert.equal(plain.snapshot().detail, true);
const active = createQuestLogScreen(mk(2), { onJournal: i => calls.push(99) }); active.open(); active.handleKey('Enter'); assert.deepEqual(calls, [0]); active.handleKey('Escape'); assert.equal(active.snapshot().detail, false);
assert.ok(active.snapshot().lines.some(l => l.startsWith('A Blade in the Ashes')), 'active main keeps its title');
console.log('questLogJournal: Done row title, Enter hand-off, no hand-off when active/no callback PASS');
