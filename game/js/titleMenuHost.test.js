import assert from 'node:assert/strict';
import { createTitleMenuHost } from './titleMenuHost.js';
import { createMemoryAdapter } from './quest/save/saveState.js';

const log = [];
const mk = (adapter) => createTitleMenuHost({ adapter, onNewGame: (s) => log.push(['new', s]), onContinue: (s, v) => log.push(['cont', s, !!v]), onSettings: () => log.push(['set']) });
const keys = (...codes) => { const q = new Set(codes); return (c) => q.has(c); };

// empty storage: Continue is greyed; Enter on "New game" -> slot list -> Enter on the first empty slot starts a new game
let h = mk(createMemoryAdapter());
assert.equal(h.active, true);
h.step(keys('ArrowDown')); // New game -> next enabled row (Continue is disabled, skipped)
h.step(keys('ArrowUp'));
h.step(keys('Enter')); // opens the slot list
assert.equal(log.length, 0);
h.step(keys('Enter')); // empty slot 1
assert.deepEqual(log, [['new', 0]]);
assert.equal(h.active, false);

// settings keeps the menu active
log.length = 0;
h = mk(createMemoryAdapter());
while (h.menu.snapshot().rows[h.menu.snapshot().selected].id !== 'settings') h.step(keys('ArrowDown'));
h.step(keys('Enter'));
assert.deepEqual(log, [['set']]);
assert.equal(h.active, true);

// a stored save: Continue loads it (slot 0)
log.length = 0;
const ad = createMemoryAdapter();
ad.writeSlot(1, { saveVersion: 1, world: { version: 2, entities: [], structures: [] }, game: { quest: null, openedChests: [], deadBeasts: [] },
  meta: { playerName: 'Wick', place: 'Tower', playTimeSec: 60 } });
h = mk(ad);
h.step(keys('ArrowDown')); // Continue is enabled now
h.step(keys('Enter'));
assert.deepEqual(log, [['cont', 1, true]]);
assert.equal(h.active, false);
console.log('titleMenuHost.test: ok');
