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
