// game/js/ui/settings.js (US-038b, docs/backlog.md row 30f). The Settings
// panel: same "pure state + draw" split as quest/mapCard.js / ui/endCard.js.
// Skinned entirely by `ASSETS.uiStyle.settings` (design/models/title.js
// v1.16) - no strings/layout numbers hard-coded here beyond the fallbacks
// used for an option `uiStyle.settings` doesn't (yet) have a row for (see
// the NEEDS PC-A note below and docs/backlog.md row 30f).
//
// Built on the existing generic primitives (US-038 AC "Data-driven"):
// `engine/ui/panel.js`'s `createPanel` supplies the open/closed/opening/
// closing state machine and its `a` (0..1) fade fraction - reused here for
// its STATE ONLY (a `{w,h}` stand-in "art", no baked frames: the panel's
// content is dynamic option values, so rows/frame/dim are drawn directly,
// the same way `endCard.js`/`pauseOverlay.js` draw dynamic UI text straight
// into the fixed UI layer rather than through `drawPanel`'s baked-glyph
// path). Row navigation/value-stepping is driven by
// `game/js/settings/options.js` (the data list) via `stepOptionValue`.
//
// Known gap (flagged in docs/backlog.md row 30f, NEEDS PC-A):
// 1. `uiStyle.settings.rowOrder` (design v1.16) only lists `grid`/`mute`/
//    `back` - `fullscreen`/`mouseSensitivity`/`invertY` exist in options.js
//    and are fully applied+persisted here, but aren't shown in the panel
//    until a design pass 2 adds their rows/labels/valueText (the panel's
//    ASCII-art fixed rows - separator at row 8, key hints at row 9 - only
//    have room for 3 option rows within the 40x12 AC budget as shipped).
// 2. `mouseSensitivity`/`invertY` are written onto the `PlayerLook` instance
//    as plain fields (`look.sensDegPerPx`, `look.invertY`) - `engine/core/
//    playerLook.js` has no such fields yet (hard-coded module constant, no
//    invert), so these are currently a no-op in play until the engine is
//    patched to read them (an engine file - not touched by this story).
// 3. "the mouse can click a value" / "S or a click opens Settings" - there
//    is no cursor-position tracking in `engine/core/input.js` (only
//    `movementX/Y` deltas + button down/up, no `clientX/clientY`), so a
//    click can't be mapped to a row/value here. Keyboard nav (W/S/A/D,
//    arrows, Esc) is fully implemented; mouse interaction needs an engine
//    change first.
import { createPanel } from '../../../engine/index.js';
import { OPTIONS, findOption, getDefaultValues, stepOptionValue } from '../settings/options.js';
import { loadSettings, saveSettings } from '../platform/index.js';
import { setMuted, isMuted } from '../audio/synth.js';

let panel = null;          // createPanel()'s fade/open-close state machine (fake `{w,h}` art - see header)
let values = { ...getDefaultValues(), ...toOptionValues(loadSettings()) };
let visibleRows = [];      // this session's `rowOrder` filtered to ids options.js/'back' actually has
let selected = 0;
const gridFailed = new Set(); // grid values `engine.setGrid` refused this session (drawn `disabled`)

/** Maps the platform's flat settings blob onto options.js ids (`muted` -> `mute`). */
function toOptionValues(saved) {
  return {
    grid: saved.grid, fullscreen: saved.fullscreen,
    mouseSensitivity: saved.mouseSensitivity, invertY: saved.invertY,
    mute: saved.muted,
  };
}

export function isSettingsOpen() {
  return !!panel && panel.state !== 'closed';
}

function openPanel(ctx) {
  const style = ctx.assets.uiStyle.settings;
  if (!panel) panel = createPanel({ w: style.panel.w, h: style.panel.h }, { fadeIn: style.fadeIn, fadeOut: style.fadeOut });
  visibleRows = (style.rowOrder || []).filter((id) => id === 'back' || !!findOption(id));
  if (!visibleRows.includes('back')) visibleRows.push('back');
  // Reflect the LIVE grid (covers a `?grid=` session override, US-038 AC
  // "?grid=WxH still overrides ... and is not saved" - the row shows what's
  // actually on screen, not necessarily the saved preference, until the
  // player picks a value here themselves).
  if (ctx.engine && ctx.engine.renderTarget) {
    values.grid = `${ctx.engine.renderTarget.cols}x${ctx.engine.renderTarget.rows}`;
  }
  // PC-A PO REJECT (backlog row 30f, fix 1): `values.mute`/`values.fullscreen`
  // are otherwise only ever set when THIS panel changes them, so a mute
  // toggled via the `N` key (or fullscreen toggled by the browser/Esc) while
  // the panel was closed would show stale on reopen - refresh both live here.
  values.mute = isMuted();
  if (typeof document !== 'undefined') values.fullscreen = !!document.fullscreenElement;
  selected = 0;
  panel.open();
}

/** US-090w: the title menu's Settings entry opens the same panel S opens from pause. */
export function openSettings(ctx) {
  if (!isSettingsOpen() && ctx.assets && ctx.assets.uiStyle && ctx.assets.uiStyle.settings) openPanel(ctx);
}

function closePanel() {
  if (panel) panel.close();
}

/**
 * Closes the panel immediately, with no fade-out - used for fix 2 (PC-A PO
 * REJECT, backlog row 30f): once the pointer re-locks (click-to-resume) play
 * has already resumed, so a fading panel would keep drawing/blocking input
 * over live gameplay. Bypasses `panel`'s opening/closing state machine
 * directly rather than adding a "skip fade" mode to the shared `engine/ui/
 * panel.js` primitive for this one caller.
 */
function closePanelInstant() {
  if (!panel) return;
  panel.state = 'closed';
  panel.a = 0;
  panel.openSec = 0;
}

function moveSelection(dir) {
  const n = visibleRows.length;
  selected = ((selected + dir) % n + n) % n; // wrap, per uiStyle.settings.stepRule
}

function applyValue(id, value, ctx) {
  values[id] = value;
  if (id === 'fullscreen') {
    try {
      if (value) { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }
      else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } catch { /* Fullscreen API unavailable/denied - the row still reflects the requested value */ }
  } else if (id === 'mouseSensitivity') {
    if (ctx.look) ctx.look.sensDegPerPx = value; // see header note 2 - no-op until playerLook.js reads it
  } else if (id === 'invertY') {
    if (ctx.look) ctx.look.invertY = value; // see header note 2
  } else if (id === 'mute') {
    setMuted(value);
  }
  saveSettings(id === 'mute' ? { muted: value } : { [id]: value });
}

function applyStep(dir, ctx) {
  const id = visibleRows[selected];
  if (id === 'back') return;
  const opt = findOption(id);
  if (!opt) return;
  const isDisabled = id === 'grid' ? (v) => gridFailed.has(v) : () => false;
  const next = stepOptionValue(opt, values[id], dir, isDisabled);
  if (next === values[id]) return;
  if (id === 'grid') {
    const m = /^(\d+)x(\d+)$/.exec(next);
    if (!m || !ctx.engine || typeof ctx.engine.setGrid !== 'function') return;
    const result = ctx.engine.setGrid(Number(m[1]), Number(m[2]));
    if (result.error) { gridFailed.add(next); return; } // refused (US-038a canHoldGrid) - keep the current value
    applyValue('grid', `${result.cols}x${result.rows}`, ctx);
    return;
  }
  applyValue(id, next, ctx);
}

/**
 * Call once per fixed step (same slot as `stepMapCard`). `ctx`:
 * `{ assets, engine, look, canOpen }` - `canOpen` = paused, not mid-map-card
 * (the same gate `main.js` uses for the pause overlay itself).
 * @param {number} dt
 * @param {import('../../../engine/index.js').Input} input
 * @param {{assets:Object, engine:Object, look:Object, canOpen:boolean}} ctx
 */
export function updateSettings(dt, input, ctx) {
  if (panel) panel.step(dt);
  const style = ctx.assets && ctx.assets.uiStyle && ctx.assets.uiStyle.settings;
  if (!style) return;

  // PC-A PO REJECT (backlog row 30f, fix 2): clicking the canvas while
  // Settings is open re-locks the pointer and resumes play (main.js's own
  // click-to-resume handling), but left the panel drawn and `uiLocked` true
  // with no way to move - close it immediately once the look is locked again.
  if (isSettingsOpen() && ctx.look && ctx.look.locked) {
    closePanelInstant();
    return;
  }

  if (!isSettingsOpen()) {
    if (ctx.canOpen && input.pressed('KeyS')) {
      input.consumePressed();
      openPanel(ctx);
    }
    return;
  }

  if (input.pressed('Escape')) { input.consumePressed(); closePanel(); return; }
  if (input.pressed('KeyW') || input.pressed('ArrowUp')) { input.consumePressed(); moveSelection(-1); return; }
  if (input.pressed('KeyS') || input.pressed('ArrowDown')) { input.consumePressed(); moveSelection(1); return; }
  if (input.pressed('KeyD') || input.pressed('ArrowRight')) { input.consumePressed(); applyStep(1, ctx); return; }
  if (input.pressed('KeyA') || input.pressed('ArrowLeft')) { input.consumePressed(); applyStep(-1, ctx); return; }
  if (input.pressed('Enter') || input.pressed('Space')) {
    input.consumePressed();
    if (visibleRows[selected] === 'back') closePanel();
  }
}

// ---- drawing --------------------------------------------------------------

function putChar(ui, x, y, ch, rgb) {
  if (x < 0 || x >= ui.cols || y < 0 || y >= ui.rows || !ch || !rgb) return;
  const code = ch.charCodeAt(0);
  const gi = code < 32 || code > 126 ? 0 : code - 32;
  ui.setCellRGB(x, y, gi, rgb[0], rgb[1], rgb[2], 0, 0, 0);
}
function putStr(ui, x, y, text, rgb) {
  for (let i = 0; i < text.length; i++) putChar(ui, x + i, y, text[i], rgb);
}
function putStrHighlightKeys(ui, x, y, text, baseRgb, keys, keyRgb) {
  putStr(ui, x, y, text, baseRgb);
  if (!keys) return;
  for (const k of keys) {
    let idx = text.indexOf(k);
    while (idx !== -1) { putStr(ui, x + idx, y, k, keyRgb); idx = text.indexOf(k, idx + k.length); }
  }
}

function formatValue(opt, raw) {
  if (!opt) return String(raw);
  if (opt.type === 'toggle') return raw ? 'on' : 'off';
  if (opt.type === 'range') return raw.toFixed(3);
  return String(raw);
}

/**
 * Darkens `rt` cells under a UI-grid rect in place (same "multiply the
 * already-rendered scene" technique as `pauseOverlay.js`'s plate - works
 * unconditionally on both the GPU and CPU render paths, per that file's
 * header note, and lets this module draw last, right where the pause
 * overlay already does, with no extra `render()` hook).
 */
function dimSceneRect(rt, ui, ux0, uy0, uw, uh, mul) {
  const sx = ui.sx, sy = ui.sy;
  const r0 = Math.max(0, Math.floor(uy0 * sy));
  const r1 = Math.min(rt.rows - 1, Math.ceil((uy0 + uh) * sy) - 1);
  const c0 = Math.max(0, Math.floor(ux0 * sx));
  const c1 = Math.min(rt.cols - 1, Math.ceil((ux0 + uw) * sx) - 1);
  const cb = rt.cells;
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const i = y * rt.cols + x;
      const fi = i * 4;
      rt.setCellRGB(x, y, cb.glyphIdx[i],
        Math.round(cb.fg[fi] * mul), Math.round(cb.fg[fi + 1] * mul), Math.round(cb.fg[fi + 2] * mul),
        Math.round(cb.bg[fi] * mul), Math.round(cb.bg[fi + 1] * mul), Math.round(cb.bg[fi + 2] * mul));
    }
  }
}

function drawFrame(ui, style, palette) {
  const { x, y, w, h } = style.panel;
  const f = style.frame;
  const c = palette.rgb[f.color], cc = palette.rgb[f.cornerColor];
  putChar(ui, x, y, f.corner, cc); putChar(ui, x + w - 1, y, f.corner, cc);
  putChar(ui, x, y + h - 1, f.corner, cc); putChar(ui, x + w - 1, y + h - 1, f.corner, cc);
  for (let i = 1; i < w - 1; i++) { putChar(ui, x + i, y, f.h, c); putChar(ui, x + i, y + h - 1, f.h, c); }
  for (let j = 1; j < h - 1; j++) { putChar(ui, x, y + j, f.v, c); putChar(ui, x + w - 1, y + j, f.v, c); }

  const t = style.title;
  if (t) {
    const text = ` ${t.text} `;
    const startX = t.align === 'center' ? x + Math.floor((w - text.length) / 2) : x + (t.pad || 0);
    putStr(ui, startX, y + t.row, text, palette.rgb[t.color]);
  }
}

function drawRows(ui, style, palette) {
  const px = style.panel.x, py = style.panel.y;
  const r = style.rows;
  for (let i = 0; i < visibleRows.length; i++) {
    const id = visibleRows[i];
    const y = py + r.first + i * r.gap;
    const isSel = i === selected;
    const opt = findOption(id);
    const label = (style.labels && style.labels[id]) || (opt && opt.label) || (id === 'back' ? 'Back' : id);
    putStr(ui, px + r.labelCol, y, label, palette.rgb[isSel ? style.selected.label : style.label.color]);
    if (isSel && style.marker) putChar(ui, px + r.markerCol, y, style.marker.glyph, palette.rgb[style.marker.color]);

    if (opt) {
      const raw = values[id];
      const disabled = id === 'grid' && gridFailed.has(raw);
      const vt = style.valueText && style.valueText[id] && style.valueText[id][String(raw)];
      const text = vt || formatValue(opt, raw);
      const [a0, a1] = (style.value && style.value.arrows) || ['<', '>'];
      const suffix = disabled && style.disabled ? (style.disabled.suffix || '') : '';
      const valueColor = disabled && style.disabled ? style.disabled.color : (isSel ? style.selected.value : style.value.color);
      const fmt = (style.value && style.value.format) || '< {text} >';
      const full = fmt.replace('{text}', text + suffix).replace('<', a0).replace('>', a1);
      putStr(ui, px + r.valueCol, y, full, palette.rgb[valueColor]);

      if (isSel && style.note && style.note.show === 'selected') {
        const notesForId = style.notes && style.notes[id];
        const note = notesForId && (notesForId[String(raw)] || notesForId.default);
        if (note) putStr(ui, px + style.note.col, y + r.noteOffset, note, palette.rgb[style.note.color]);
      }
    }
  }

  if (style.separator) {
    const y = py + style.separator.row;
    const inset = style.separator.inset || 0;
    const color = palette.rgb[style.separator.color];
    for (let x = inset; x < style.panel.w - inset; x++) putChar(ui, px + x, y, style.separator.glyph, color);
  }
  if (style.keyHints) {
    const kh = style.keyHints;
    const x = kh.align === 'center' ? px + Math.floor((style.panel.w - kh.text.length) / 2) : px;
    putStrHighlightKeys(ui, x, py + kh.row, kh.text, palette.rgb[kh.color], kh.keys, palette.rgb[kh.key]);
  }
}

function drawEntryLine(ui, style, palette) {
  const e = style.pauseEntry;
  if (!e) return;
  const x = e.align === 'center' ? Math.floor((ui.cols - e.text.length) / 2) : 0;
  putStr(ui, x, e.row, e.text, palette.rgb[e.color]);
}

/**
 * Draws the panel while open, or just the `[S] Settings` pause-entry hint
 * (`ctx.showEntry`) while closed. Call right where `drawPauseOverlay` is
 * called today (after the 3D scene/sprites/UI, before `rt.present()`).
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {Object} assets
 * @param {{showEntry?: boolean}} [ctx]
 */
export function drawSettingsPanel(ui, rt, assets, ctx = {}) {
  const style = assets && assets.uiStyle && assets.uiStyle.settings;
  const palette = assets && assets.palette;
  if (!style || !palette) return;

  if (!isSettingsOpen()) {
    if (ctx.showEntry) drawEntryLine(ui, style, palette);
    return;
  }

  const a = panel.a;
  const { x, y, w, h } = style.panel;
  const sceneDimMul = 1 + ((style.sceneDim.bgMul) - 1) * a;
  const plateMul = 1 + ((style.plate.bgMul) - 1) * a;
  dimSceneRect(rt, ui, 0, 0, ui.cols, ui.rows, sceneDimMul);
  const pad = style.plate.pad || 0;
  dimSceneRect(rt, ui, x - pad, y - pad, w + pad * 2, h + pad * 2, plateMul);

  drawFrame(ui, style, palette);
  drawRows(ui, style, palette);
}

// S8-C-04: opt-in full Settings view. The host owns persistence/application;
// the existing pause-panel exports above remain available to legacy callers.
const FULL_OPTIONS = [
  { id: 'quality', values: ['low', 'medium', 'high', 'ultra', 'auto'], default: 'high' },
  { id: 'shadows', values: ['off', 'low', 'mid', 'high'], default: 'high' },
  { id: 'grid', values: ['240x90', '320x120', '400x150', '480x180'], default: '400x150' },
  { id: 'volume', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
  { id: 'mute', values: [false, true], default: false },
  { id: 'textSize', values: ['small', 'normal', 'large'], default: 'normal' },
  { id: 'reduceMotion', values: [false, true], default: false },
];

/** Pure full-panel view; `options`/snapshot use volume 0..1 and the designer's row ids.
 * Host maps mute -> muted and shadows -> shadowQuality for platform storage.
 * onChange runs only on a valid change, never during draw; takeAction returns Back once.
 */
export function createSettingsView(options = {}, { style, controls, quality, rgb, onChange, isDisabled } = {}) {
  if (!style || !controls || !quality || !rgb) throw new TypeError('Settings style, controls, quality and rgb required');
  const state = {};
  for (const opt of FULL_OPTIONS) {
    const value = options[opt.id] ?? opt.default;
    if (opt.type === 'range' ? typeof value !== 'number' || !Number.isFinite(value) || value < opt.min || value > opt.max : !opt.values.includes(value)) {
      throw new TypeError('Invalid settings option: ' + opt.id);
    }
    state[opt.id] = value;
  }
  const optionById = Object.fromEntries(FULL_OPTIONS.map(opt => [opt.id, opt]));
  const rows = style.rowOrder.slice();
  if (rows.length !== 8 || new Set(rows).size !== 8 || !rows.includes('back') || FULL_OPTIONS.some(o => !rows.includes(o.id))) throw new TypeError('Invalid Settings rows');
  const rowY = {};
  for (const row of style.layout) if (row.id) rowY[row.id] = row.y;
  if (rows.some(id => !Number.isInteger(rowY[id]))) throw new TypeError('Missing Settings row layout');
  let focus = 0, action = null;
  const labels = {}, notes = {};
  function refresh(id) {
    const value = state[id];
    if (id === 'volume') {
      const n = Math.round(value * controls.slider.cells);
      let bar = controls.slider.left;
      for (let i = 0; i < controls.slider.cells; i++) bar += i === Math.max(0, n - 1) ? controls.slider.knob : i < n ? controls.slider.fill : controls.slider.empty;
      labels[id] = bar + controls.slider.right + '  ' + Math.round(value * 10);
    } else if (typeof value === 'boolean') {
      const token = value ? controls.toggle.on : controls.toggle.off;
      labels[id] = token.box + ' ' + token.text;
    } else labels[id] = '< ' + (id === 'shadows' && value === 'mid' ? 'Mid' : style.valueText[id]?.[value] || value) + ' >';
    notes[id] = id === 'quality' || id === 'shadows' ? 'Restart to apply' : id === 'reduceMotion' ? 'Less head bob and camera kick' : (style.notes[id]?.[value] || style.notes[id]?.default || '');
  }
  for (const opt of FULL_OPTIONS) refresh(opt.id);
  function disabled(id, value) { return !!isDisabled && !!isDisabled(id, value); }
  function move(dir) {
    for (let i = 1; i <= rows.length; i++) {
      const next = (focus + dir * i + rows.length) % rows.length;
      if (!disabled(rows[next])) { focus = next; return; }
    }
  }
  function step(dir, toggle = false) {
    const id = rows[focus], opt = FULL_OPTIONS.find(o => o.id === id);
    if (!opt || disabled(id)) return;
    const current = state[id];
    const next = toggle && typeof current === 'boolean' ? !current : stepOptionValue(opt, current, dir, value => disabled(id, value));
    if (next === current || disabled(id, next)) return;
    state[id] = next; refresh(id);
    if (onChange) onChange(id, next);
  }
  function handleKey(code) {
    if (code === 'Escape') action = 'back';
    else if (code === 'ArrowUp' || code === 'KeyW') move(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') move(1);
    else if (code === 'ArrowLeft' || code === 'KeyA') step(-1);
    else if (code === 'ArrowRight' || code === 'KeyD') step(1);
    else if (code === 'Enter' || code === 'Space') { if (rows[focus] === 'back') action = 'back'; else step(1, true); }
    else return false;
    return true;
  }
  const p = style.panel, r = style.rows, bg = style.bgRgb.panel;
  let drawingUi;
  const titleText = '[ ' + style.title.text + ' ]';
  const stripLabels = quality.choices.map(choice => ({choice, normal: ' ' + quality.text[choice] + ' ', current: '[' + quality.text[choice] + ']'}));
  function cell(x, y, ch, fg, backing = bg) {
    if (x < 0 || x >= drawingUi.cols || y < 0 || y >= drawingUi.rows) return;
    const c = rgb[fg];
    drawingUi.setCellRGB(x, y, ch.charCodeAt(0) - 32, c[0], c[1], c[2], backing[0], backing[1], backing[2]);
  }
  function text(x, y, str, fg, backing = bg, max = p.w - 2) {
    for (let i = 0; i < str.length && i < max; i++) cell(x + i, y, str[i], fg, backing);
  }
  function draw(ui) {
    drawingUi = ui;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) cell(p.x + x, p.y + y, ' ', style.frame.color);
    cell(p.x, p.y, style.frame.corner, style.frame.cornerColor);
    cell(p.x + p.w - 1, p.y, style.frame.corner, style.frame.cornerColor);
    cell(p.x, p.y + p.h - 1, style.frame.corner, style.frame.cornerColor);
    cell(p.x + p.w - 1, p.y + p.h - 1, style.frame.corner, style.frame.cornerColor);
    for (let x = 1; x < p.w - 1; x++) { cell(p.x + x, p.y, style.frame.h, style.frame.color); cell(p.x + x, p.y + p.h - 1, style.frame.h, style.frame.color); }
    for (let y = 1; y < p.h - 1; y++) { cell(p.x, p.y + y, style.frame.v, style.frame.color); cell(p.x + p.w - 1, p.y + y, style.frame.v, style.frame.color); }
    text(p.x + Math.floor((p.w - titleText.length) / 2), p.y + style.title.row, titleText, style.title.color);
    for (const x of style.frame.rivets.cols) { cell(p.x + x, p.y, style.frame.rivets.glyph, style.frame.rivets.color); cell(p.x + x, p.y + p.h - 1, style.frame.rivets.glyph, style.frame.rivets.color); }
    for (const row of style.layout) {
      if (row.section) {
        text(p.x + style.section.col, p.y + row.y, row.section, style.section.color);
        for (let x = style.section.col + row.section.length + 1; x <= style.section.rule.toCol; x++) cell(p.x + x, p.y + row.y, style.section.rule.glyph, style.section.rule.color);
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i], y = p.y + rowY[id], selected = i === focus, off = disabled(id);
      const mode = off ? 'disabled' : selected ? 'focus' : 'normal';
      const band = selected ? style.bgRgb.band : bg;
      for (let x = r.bandFrom; x <= r.bandTo; x++) cell(p.x + x, y, ' ', controls.label[mode], band);
      text(p.x + r.labelCol, y, style.labels[id], controls.label[mode], band, r.valueCol - r.labelCol - 1);
      if (selected) cell(p.x + r.markerCol, y, controls.marker.glyph, controls.marker.fg, band);
      if (id === 'back') continue;
      if (id === 'quality') {
        let x = p.x + r.valueCol;
        for (const entry of stripLabels) {
          const choice = entry.choice;
          const current = choice === state.quality, unavailable = off || disabled(id, choice);
          const token = controls.strip[mode];
          const fg = unavailable ? controls.strip.disabledChoice.fg : current ? token.current : token.choice;
          const label = current ? entry.current : entry.normal;
          text(x, y, label, fg, band, r.valueW - (x - p.x - r.valueCol));
          x += label.length;
        }
      } else {
        const kind = style.controlOf[id], token = controls[kind][mode], label = labels[id];
        const opt = optionById[id];
        for (let j = 0; j < label.length && j < r.valueW; j++) {
          const ch = label[j];
          let fg = token.text;
          if (kind === 'slider') fg = ch === '[' || ch === ']' ? token.bracket : ch === controls.slider.knob ? token.knob : ch === controls.slider.fill ? token.fill : ch === controls.slider.empty ? token.empty : token.value;
          else if (kind === 'toggle' && j < 3) fg = j === 1 ? token.mark : token.bracket;
          else if (kind === 'select' && (j === 0 || j === label.length - 1)) {
            const end = j === 0 ? opt.values[0] : opt.values[opt.values.length - 1];
            fg = state[id] === end ? controls.select.endStop.arrowFg : token.arrows;
          }
          cell(p.x + r.valueCol + j, y, ch, fg, band);
        }
      }
      if (selected) text(p.x + style.note.col, y + r.noteOffset, off ? controls.disabledSuffix.text : notes[id], style.note.color, bg, p.w - style.note.col - 1);
    }
    for (let x = style.separator.inset; x < p.w - style.separator.inset; x++) cell(p.x + x, p.y + style.separator.row, style.separator.glyph, style.separator.color);
    const hints = style.keyHints;
    text(p.x + Math.floor((p.w - hints.text.length) / 2), p.y + hints.row, hints.text, hints.color);
  }
  return {
    handleKey, draw,
    snapshot: () => ({ ...state }),
    selectedId: () => rows[focus],
    takeAction() { const result = action; action = null; return result; },
  };
}
