// PAUSE-MENU-01 tests: item order, Load submenu slots, Save path, main-menu confirm, Resume, no Esc text, draw works with the real skin.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../../design/palette.js';
import '../../../design/models/title.js';
import '../../../design/models/menu_ui.js';
import { createPauseMenu, PAUSE_ITEMS } from './pauseMenu.js';
import { createMemoryAdapter } from '../quest/save/saveState.js';

const save = (name, t) => ({ saveVersion: 1, world: { version: 2, entities: [], structures: [] }, game: { quest: null, openedChests: [], deadBeasts: [] },
  meta: { playerName: name, place: 'Tower', playTimeSec: 60, savedAt: t } });
function mk(over = {}) {
  const log = [], ad = createMemoryAdapter();
  ad.writeSlot(1, save('Wick', Date.UTC(2026, 9, 9, 12, 0)));
  const m = createPauseMenu({ adapter: ad, style: globalThis.ASSETS.uiStyle.menu,
    onResume: () => log.push('resume'), onSettings: () => log.push('settings'), onSave: () => (log.push('save'), true),
    onLoad: (s, v) => log.push(['load', s, !!v]), onMainMenu: () => log.push('menu'), isDirty: () => !!over.dirty });
  return { m, log };
}
const down = (m, n) => { for (let i = 0; i < n; i++) m.handleKey('KeyS'); };

test('item order and no slot list on the main view', () => {
  const { m } = mk();
  assert.deepEqual(m.snapshot().rows.map(r => r.text), ['Resume', 'Settings', 'Save', 'Load', 'Back to main menu']);
  assert.deepEqual(PAUSE_ITEMS, ['Resume', 'Settings', 'Save', 'Load', 'Back to main menu']);
  assert.ok(!m.snapshot().rows.some(r => /Slot/.test(r.text)));
});

test('Resume and Settings fire their callbacks', () => {
  const { m, log } = mk();
  m.handleKey('Enter'); down(m, 1); m.handleKey('Enter');
  assert.deepEqual(log, ['resume', 'settings']);
});

test('Save calls the save path once and toasts', () => {
  const { m, log } = mk();
  down(m, 2); m.handleKey('Enter');
  assert.deepEqual(log, ['save']);
  assert.equal(m.snapshot().message, 'Saved.');
});

test('Load submenu lists the slots with dates; empty slots are skipped; selecting loads', () => {
  const { m, log } = mk();
  down(m, 3); m.handleKey('Enter');
  const s = m.snapshot();
  assert.equal(s.mode, 'load');
  assert.equal(s.rows.filter(r => r.id === 'slot').length, 3);
  assert.match(s.rows[1].text, /Slot 2: Wick - Tower - 0:01 - 2026-10-\d\d \d\d:\d\d/);
  assert.equal(s.rows[1].enabled, true);
  assert.equal(s.rows[0].enabled, false);
  assert.equal(s.selected, 1); // starts on the first filled slot
  m.handleKey('Enter');
  assert.deepEqual(log, [['load', 1, true]]);
  m.handleKey('Escape'); assert.equal(m.snapshot().mode, 'main');
});

test('Back to main menu: direct when clean, asks "Save first?" when dirty', () => {
  let t = mk();
  down(t.m, 4); t.m.handleKey('Enter');
  assert.deepEqual(t.log, ['menu']);
  t = mk({ dirty: true });
  down(t.m, 4); t.m.handleKey('Enter');
  assert.equal(t.m.snapshot().mode, 'confirm');
  assert.deepEqual(t.m.snapshot().rows.map(r => r.text), ['Yes', 'No']);
  assert.deepEqual(t.log, []);
  t.m.handleKey('Enter'); // Yes: save then leave
  assert.deepEqual(t.log, ['save', 'menu']);
  t = mk({ dirty: true });
  down(t.m, 4); t.m.handleKey('Enter'); down(t.m, 1); t.m.handleKey('Enter'); // No: leave without saving
  assert.deepEqual(t.log, ['menu']);
});

test('pointer: hover selects, click activates', () => {
  const { m, log } = mk();
  const ui = { cols: 160, rows: 60, setCell() {} }; m.draw(ui);
  const y = Math.floor((60 - 24) / 2);
  assert.equal(m.handlePointer(80, y + 9, false), true); assert.equal(m.snapshot().selected, 1);
  assert.equal(m.handlePointer(80, y + 7, true), true);
  assert.deepEqual(log, ['resume']);
  assert.equal(m.handlePointer(80, y + 1, true), false);
});

test('draw: real skin, no Esc text, no allocation-free surprises', () => {
  const { m } = mk(); const text = [];
  const ui = { cols: 160, rows: 60, setCell(x, y, g) { text.push(g); } };
  for (const key of [null, 'Enter']) { if (key) { down(m, 3); m.handleKey(key); } m.draw(ui); }
  assert.ok(text.length > 1000);
  assert.doesNotMatch(text.join(''), /esc/i);
});
