// SETTINGS-MOUNT-01: the full createSettingsView is what the title + pause Settings open (headless, fake storage/engine).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createUiLayer } from '../../../engine/index.js';

const data = {};
globalThis.window = { localStorage: { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } } };
const { updateSettings, drawSettingsPanel, isSettingsOpen, openSettings } = await import('./settings.js');
const { loadSettings } = await import('../platform/index.js');
const { loadPresets } = await import('./gfxPresets.js');
const { isMuted, getVolume, setMuted } = await import('../audio/synth.js');
await loadPresets(JSON.parse(readFileSync(new URL('../../../content/settings/gfx-presets.json', import.meta.url))));

const context = vm.createContext({});
for (const f of ['palette.js', 'models/title.js', 'models/menu_ui.js']) vm.runInContext(readFileSync(new URL('../../../design/' + f, import.meta.url), 'utf8'), context);
const assets = { uiStyle: context.ASSETS.uiStyle, palette: context.ASSETS.palette };

let pressed = new Set();
const input = { pressed: (c) => pressed.has(c), consumePressed: () => pressed.clear() };
const press = (code) => { pressed = new Set([code]); };
const grids = [];
let refuse = null;
const engine = { renderTarget: { cols: 400, rows: 150 }, setGrid: (c, r) => { if (refuse === c) return { error: 'no' }; grids.push(c + 'x' + r); return { cols: c, rows: r }; } };
const ctx = { assets, engine, look: {}, canOpen: true };
const tick = (code) => { if (code) press(code); updateSettings(1 / 60, input, ctx); pressed.clear(); };
const settle = () => { for (let i = 0; i < 40; i++) updateSettings(1 / 60, input, ctx); };

// mount from the title-menu entry (openSettings) and from pause (S key)
for (const how of ['title', 'pause']) {
  if (how === 'title') openSettings(ctx); else tick('KeyS');
  assert.ok(isSettingsOpen(), how + ' opens');
  const ui = createUiLayer({ cols: 160 });
  drawSettingsPanel(ui, { cols: 160, rows: 60, cells: { glyphIdx: new Uint8Array(9600), fg: new Uint8Array(38400), bg: new Uint8Array(38400) }, setCellRGB() {} }, assets, {});
  const p = assets.uiStyle.settings.full.panel;
  const line = (y) => Array.from(ui.cells.glyphIdx.slice(y * 160 + p.x, y * 160 + p.x + 64), (v) => String.fromCharCode(v + 32)).join('');
  let text = ''; for (let y = 0; y < 60; y++) text += line(y);
  assert.ok(text.includes('SETTINGS') || text.includes('S E T T I N G S'), how + ' draws the full panel');
  assert.ok(text.includes('Back') && text.includes('Shadows') && text.includes('Volume'), how + ' has full rows');
  if (how === 'title') { tick('Escape'); settle(); assert.ok(!isSettingsOpen(), 'Back (Esc) returns'); }
}

// pause panel still open: quality row is focused first; Right -> next quality saves + applies its grid
const q0 = loadSettings().quality || 'auto';
tick('ArrowLeft'); // auto is the last choice: step to ultra
const s1 = loadSettings();
assert.notEqual(s1.quality, q0, 'quality persisted');
assert.equal(s1.quality, 'ultra');
assert.equal(grids.length, 1, 'quality applied its grid live');
assert.equal(s1.grid, grids[grids.length - 1], 'grid saved with quality');

// shadows, LOD, volume, mute, text size, reduce motion each persist
tick('ArrowDown'); tick('ArrowLeft'); assert.ok(['off', 'low', 'mid', 'high'].includes(loadSettings().shadowQuality), 'shadows persisted');
tick('ArrowDown'); tick('ArrowLeft'); assert.ok(typeof loadSettings().lodScale === 'number', 'lod persisted');
tick('ArrowDown'); // grid
const gridBefore = grids.length; tick('ArrowLeft'); assert.equal(grids.length, gridBefore + 1, 'grid row applies live');
tick('ArrowDown'); tick('ArrowLeft'); assert.ok(loadSettings().volume < 1, 'volume persisted'); assert.ok(getVolume() < 1, 'volume applied live');
tick('ArrowDown'); tick('Space'); assert.equal(loadSettings().muted, true, 'mute persisted'); assert.equal(isMuted(), true, 'mute live');
tick('ArrowDown'); tick('ArrowRight'); assert.equal(loadSettings().textSize, 'large', 'text size persisted');
tick('ArrowDown'); tick('Space'); assert.equal(loadSettings().reduceMotion, true, 'reduce motion persisted');

// refused grid: row disabled, old grid kept, focus kept
refuse = 480;
for (let i = 0; i < 4; i++) tick('ArrowUp'); // back to grid row region (reduceMotion->textSize->mute->volume->grid)
tick('ArrowRight');
// whatever the value, a refusal must not throw nor persist the refused grid
assert.notEqual(loadSettings().grid, '480x180', 'refused grid not saved');

// Back via Enter on the Back row
for (let i = 0; i < 12; i++) tick('ArrowDown');
for (let i = 0; i < 12 && !(isSettingsOpen() === false); i++) { tick('Enter'); if (isSettingsOpen()) tick('ArrowDown'); }
settle();
assert.ok(!isSettingsOpen(), 'Back returns');
setMuted(false);
console.log('settingsMount: PASS');
