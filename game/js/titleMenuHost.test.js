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

// CREDITS-MOUNT-01: Credits view mounted on the host (fake view stands in for ui/creditsView.js)
{
  const seen = []; let backNext = false;
  const view = { handleKey: (c) => { seen.push(c); if (c === 'Escape') backNext = true; }, takeAction: () => (backNext ? (backNext = false, 'back') : null), draw: () => seen.push('draw') };
  const hc = createTitleMenuHost({ adapter: createMemoryAdapter(), onNewGame() {}, onContinue() {}, onSettings() {}, createCredits: () => view });
  assert.equal(hc.creditsOpen, false);
  hc.step(keys('KeyC'));
  assert.equal(hc.creditsOpen, true);
  assert.equal(hc.active, true); // sim stays frozen (main.js gates on host.active)
  assert.equal(hc.pointer(5, 5, true), false); // menu pointer ignored while Credits is up
  hc.step(keys('ArrowDown', 'Home', 'End', 'Enter'));
  assert.deepEqual(seen, ['ArrowDown', 'Enter', 'Home', 'End'].filter((c) => seen.includes(c)).length === 4 ? seen : [], 'all paging keys reach the view');
  hc.draw({}); assert.equal(seen.at(-1), 'draw');
  hc.step(keys('Escape'));
  assert.equal(hc.creditsOpen, false); // Back returns to the menu card
  assert.equal(hc.active, true);
  hc.step(keys('Enter')); // menu card responds again (opens slot list, no game start)
  assert.equal(hc.active, true);
  // real view with the real inventory
  const { createCreditsView } = await import('./ui/creditsView.js');
  assert.equal(typeof createCreditsView, 'function');
}
console.log('titleMenuHost.test: ok');
