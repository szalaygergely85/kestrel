// game/js/ui/settings.test.js (US-038b, docs/backlog.md row 30f). Headless
// Node ESM, no framework - same style as titleCard.test.js/mapCard.test.js.
// Run: node game/js/ui/settings.test.js
//
// settings.js reads `loadSettings()` once at import time (its module-level
// `values` initial state, via game/js/platform/index.js -> web.js, which
// reads the storage off `window`) - so the fake storage below must be
// installed BEFORE settings.js is imported. A static top-level `import`
// would run before this file's own code gets a chance to set
// `globalThis.window`, so both settings.js and platform/index.js are
// brought in with a dynamic `import()` after the fake window is in place
// (same reasoning as platform.test.js's `withStorage`, just done once here
// since settings.js's own state, not just the storage, needs to see it).

function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _raw: data,
  };
}
globalThis.window = { localStorage: makeFakeStorage() };

const { updateSettings, drawSettingsPanel, isSettingsOpen } = await import('./settings.js');
const { loadSettings } = await import('../platform/index.js');
const { setMuted } = await import('../audio/synth.js');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function fakeInput() {
  let pressedSet = new Set();
  return {
    _press(code) { pressedSet.add(code); },
    pressed(code) { return pressedSet.has(code); },
    consumePressed() { pressedSet.clear(); },
    _clearFrame() { pressedSet = new Set(); },
  };
}

// A stand-in for `ASSETS.uiStyle.settings` (design/models/title.js v1.16) -
// only the fields settings.js actually reads, but with EVERY options.js row
// in `rowOrder` (unlike the real v1.16 asset, which only lists grid/mute/
// back - see settings.js's header "Known gap" note) so this test can drive
// fullscreen/mouseSensitivity/invertY too.
const style = {
  panel: { x: 60, y: 24, w: 40, h: 12 },
  frame: { corner: '+', h: '-', v: '|', color: 'a', cornerColor: 'a' },
  title: { text: 'SETTINGS', row: 0, align: 'center', color: 'a' },
  plate: { pad: 1, bgMul: 0.18 },
  sceneDim: { bgMul: 0.35 },
  fadeIn: 0.05, fadeOut: 0.05,
  rowOrder: ['grid', 'fullscreen', 'mouseSensitivity', 'invertY', 'mute', 'back'],
  rows: { first: 2, gap: 1, markerCol: 2, labelCol: 4, valueCol: 17, noteOffset: 1 },
  labels: { back: 'Back' },
  valueText: { mute: { false: 'off', true: 'on' } },
  notes: {},
  marker: { glyph: '>', color: 'a' },
  label: { color: 'a' },
  value: { color: 'a', arrows: ['<', '>'], format: '< {text} >' },
  selected: { label: 'a', value: 'a', arrows: 'a' },
  disabled: { color: 'a', suffix: ' n/a', skip: true },
  note: { color: 'a', col: 6, show: 'selected' },
  separator: { row: 8, glyph: '-', color: 'a', inset: 2 },
  keyHints: { row: 9, align: 'center', color: 'a', key: 'a', text: 'hints', keys: [] },
  pauseEntry: { text: '[S] Settings', row: 32, align: 'center', color: 'a' },
};
const palette = { rgb: new Proxy({}, { get: () => [1, 2, 3] }) };
const assets = { uiStyle: { settings: style }, palette };

function fakeUi(cols = 160, rows = 60) {
  return { cols, rows, sx: 1, sy: 1, setCellRGB() {} };
}
function fakeRt(cols = 160, rows = 60) {
  const n = cols * rows;
  return {
    cols, rows,
    cells: { glyphIdx: new Uint8Array(n), fg: new Uint8Array(n * 4), bg: new Uint8Array(n * 4) },
    setCellRGB() {},
  };
}
function fakeEngine(setGridImpl) {
  return { setGrid: setGridImpl || ((c, r) => ({ cols: c, rows: r })), renderTarget: { cols: 240, rows: 90 } };
}

// ---- closed initially, showEntry draw is a no-op-safe path -------------
ok('closed initially', isSettingsOpen() === false);
drawSettingsPanel(fakeUi(), fakeRt(), assets, { showEntry: true });
ok('drawSettingsPanel while closed does not throw (checked by reaching here)', true);

// ---- Open/close (US-038 AC): S opens only when canOpen, Esc closes -----
{
  const input = fakeInput();
  input._press('KeyS');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: false });
  ok('S does nothing when canOpen is false', isSettingsOpen() === false);
}
{
  const input = fakeInput();
  input._press('KeyS');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  ok('S opens the panel when canOpen', isSettingsOpen() === true);
  ok('the S press was consumed', input.pressed('KeyS') === false);
}

// ---- Navigation + Grid (selected row 0 = grid): D steps to the next value, applies through engine.setGrid ----
{
  const input = fakeInput();
  input._press('KeyD');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  const saved = loadSettings();
  ok('D on the grid row steps 240x90 -> 320x120 via engine.setGrid, and persists it', saved.grid === '320x120', saved.grid);
}
{
  // grid step -1 back down, no wrap past the first value either way - sanity only
  const input = fakeInput();
  input._press('KeyA');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  const saved = loadSettings();
  ok('A on the grid row steps back down to 240x90', saved.grid === '240x90', saved.grid);
}

// ---- Grid refused by the device (US-038 AC "disabled"): value stays put, nothing saved as changed ----
{
  const before = loadSettings().grid;
  const input = fakeInput();
  input._press('KeyD');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(() => ({ error: true })), look: {}, canOpen: true });
  const after = loadSettings().grid;
  ok('grid stays unchanged when engine.setGrid refuses the new size', after === before, `${before} -> ${after}`);
}

// ---- move down to Fullscreen (row 1), toggle it -------------------------
{
  const input = fakeInput();
  input._press('KeyS'); // Down: grid -> fullscreen
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  input._press('KeyD'); // toggle off -> on
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  const saved = loadSettings();
  ok('moving down then D toggles fullscreen on', saved.fullscreen === true, JSON.stringify(saved));
}

// ---- move down to Mouse sensitivity (row 2): step applies to ctx.look.sensDegPerPx and persists ----
{
  const input = fakeInput();
  input._press('KeyS'); // fullscreen -> mouseSensitivity
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  input._press('KeyD'); // 0.15 -> 0.175
  const look = {};
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look, canOpen: true });
  const saved = loadSettings();
  ok('mouse sensitivity D step writes ctx.look.sensDegPerPx', Math.abs(look.sensDegPerPx - 0.175) < 1e-9, look.sensDegPerPx);
  ok('...and persists the same value', Math.abs(saved.mouseSensitivity - 0.175) < 1e-9, saved.mouseSensitivity);
}

// ---- move down to Invert Y (row 3): toggle applies to ctx.look.invertY and persists ----
{
  const input = fakeInput();
  input._press('KeyS'); // mouseSensitivity -> invertY
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  input._press('KeyD'); // off -> on
  const look = {};
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look, canOpen: true });
  const saved = loadSettings();
  ok('invert Y D step writes ctx.look.invertY', look.invertY === true);
  ok('...and persists it', saved.invertY === true);
}

// ---- move down to Mute (row 4): toggle persists as `muted` in the platform blob ----
{
  const input = fakeInput();
  input._press('KeyS'); // invertY -> mute
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  input._press('KeyD'); // off -> on
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  const saved = loadSettings();
  ok('mute D step persists as `muted` in the platform blob', saved.muted === true);
}

// ---- move down to Back (row 5), Enter/Space closes the panel same as Esc ----
{
  const input = fakeInput();
  input._press('KeyS'); // mute -> back
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  input._press('Enter');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  for (let i = 0; i < 20; i++) updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true }); // let fadeOut finish
  ok('Enter on Back closes the panel (fully closed once fadeOut completes)', isSettingsOpen() === false);
}

// ---- Esc also closes (reopen, then Esc) ---------------------------------
{
  const input = fakeInput();
  input._press('KeyS');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  ok('reopened', isSettingsOpen() === true);
  input._clearFrame();
  input._press('Escape');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  input._clearFrame();
  for (let i = 0; i < 20; i++) updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  ok('Escape closes the panel', isSettingsOpen() === false);
}

// ---- draw while open does not throw (smoke test) -------------------------
{
  const input = fakeInput();
  input._press('KeyS');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  drawSettingsPanel(fakeUi(), fakeRt(), assets, {});
  ok('drawSettingsPanel while open does not throw (checked by reaching here)', true);
  input._clearFrame();
  input._press('Escape');
  for (let i = 0; i < 20; i++) updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
}

// ---- PC-A PO REJECT fix 1 (backlog row 30f): mute row must not go stale --
// A `fakeUi` that records every `setCellRGB` glyph write so we can read back
// the rendered text of a row without peeking at settings.js's internal
// `values` (same black-box approach the rest of this file already uses).
function recordingUi(cols = 160, rows = 60) {
  const cells = new Map(); // "x,y" -> char
  return {
    cols, rows, sx: 1, sy: 1,
    setCellRGB(x, y, gi) { cells.set(`${x},${y}`, gi === 0 ? ' ' : String.fromCharCode(gi + 32)); },
    rowText(y, x0, len) {
      let s = '';
      for (let x = x0; x < x0 + len; x++) s += cells.get(`${x},${y}`) || ' ';
      return s;
    },
  };
}
{
  // mute row = index 4 in rowOrder -> y = panel.y + rows.first + 4*rows.gap
  const muteY = style.panel.y + style.rows.first + 4 * style.rows.gap;
  const valueX = style.panel.x + style.rows.valueCol;

  setMuted(true); // toggle from OUTSIDE the panel (like the `N` key does mid-play)
  {
    const input = fakeInput();
    input._press('KeyS');
    updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
    const ui = recordingUi();
    drawSettingsPanel(ui, fakeRt(), assets, {});
    ok('reopening after an external setMuted(true) shows "on", not a stale value',
      ui.rowText(muteY, valueX, 8).includes('on'), ui.rowText(muteY, valueX, 8));
    input._clearFrame();
    input._press('Escape');
    for (let i = 0; i < 20; i++) updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  }

  setMuted(false); // and the other direction
  {
    const input = fakeInput();
    input._press('KeyS');
    updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
    const ui = recordingUi();
    drawSettingsPanel(ui, fakeRt(), assets, {});
    ok('reopening after an external setMuted(false) shows "off", not a stale value',
      ui.rowText(muteY, valueX, 8).includes('off'), ui.rowText(muteY, valueX, 8));
    input._clearFrame();
    input._press('Escape');
    for (let i = 0; i < 20; i++) updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  }
}

// ---- PC-A PO REJECT fix 2 (backlog row 30f): click-to-resume (look.locked) closes the panel ----
{
  const input = fakeInput();
  input._press('KeyS');
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look: {}, canOpen: true });
  ok('panel open before the click-to-resume lock', isSettingsOpen() === true);
  input._clearFrame();
  const look = { locked: true };
  updateSettings(1 / 60, input, { assets, engine: fakeEngine(), look, canOpen: true });
  ok('look.locked becoming true closes the panel immediately (no fade wait)', isSettingsOpen() === false);
}

if (failures.length) {
  console.error(`FAIL (${fail} of ${pass + fail}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
} else {
  console.log(`ALL PASS (${pass} checks)`);
  process.exit(0);
}
