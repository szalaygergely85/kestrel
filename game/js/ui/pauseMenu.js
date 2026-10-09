// PAUSE-MENU-01 (D-053): in-game pause menu in the title menu's skin (uiStyle.menu).
// Items: Resume, Settings, Save, Load, Back to main menu. Slots appear ONLY in the Load submenu (title menu's slot labels).
// Pure view/controller: no DOM, callbacks injected by main.js. Strings are built on reset()/input, never in draw().
import { drawText } from '../../../engine/index.js';
import { slotLabel } from './titleMenu.js';

const PLATE = '#0a0b10', TEXT = '#e8e2d0';
export const PAUSE_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Enter', 'Space', 'Escape'];
export const PAUSE_ITEMS = ['Resume', 'Settings', 'Save', 'Load', 'Back to main menu'];
const IDS = ['resume', 'settings', 'save', 'load', 'menu'];

/**
 * @param {{adapter:any, style?:any, onResume:()=>void, onSettings:()=>void, onSave:()=>boolean, onLoad:(slot:number,save:any)=>void,
 *          onMainMenu:()=>void, isDirty?:()=>boolean}} o
 */
export function createPauseMenu({ adapter, style = null, onResume, onSettings, onSave, onLoad, onMainMenu, isDirty = () => false }) {
  const colour = key => (style && (style.hex[key] || style.bg[key])) || TEXT;
  const fg = style ? colour(style.row.normal.fg) : TEXT, bg = style ? style.bg.plate : PLATE;
  const heading = 'PAUSED';
  const titleText = style ? style.title.decor[0] + heading.split('').join(' '.repeat(style.title.letterSpace)) + style.title.decor[1] : heading;
  const hints = 'Arrows select  Enter choose';
  const hintParts = ['Arrows', 'Enter'].map(text => ({ text, x: hints.indexOf(text) }));
  const bounds = { x: 0, y: 0, w: 72, h: 24 };
  let mode = 'main', rows = [], selected = 0, slots = [], message = '', error = false;

  function build() {
    if (mode === 'confirm') rows = [{ id: 'yes', text: 'Yes', y: 10, enabled: true }, { id: 'no', text: 'No', y: 12, enabled: true }];
    else if (mode === 'load') {
      rows = slots.map(s => ({ id: 'slot', slot: s.slot, text: s.label, y: 7 + s.slot * 2, enabled: !!(s.ok && s.meta) }));
      rows.push({ id: 'back', text: 'Back', y: 14, enabled: true });
    } else rows = PAUSE_ITEMS.map((text, i) => ({ id: IDS[i], text, y: 7 + i * 2, enabled: true }));
    for (const r of rows) r.display = (r.text + (r.enabled ? '' : ' (empty)')).slice(0, bounds.w - 6);
    selected = Math.min(selected, rows.length - 1);
  }
  function refreshSlots() {
    let listed = [];
    try { listed = adapter ? adapter.listSlots() : []; } catch (e) { listed = []; }
    slots = [0, 1, 2].map(n => {
      const f = listed.find(r => r.slot === n);
      const v = f ? { ...f } : { slot: n, ok: false, meta: null };
      v.label = slotLabel(v); return v;
    });
  }
  function go(m, sel = 0) { mode = m; selected = sel; build(); }
  /** Call when the pause starts: back to the main list, clear the toast. */
  function reset() { message = ''; error = false; go('main'); }
  function activate() {
    const row = rows[selected];
    if (!row || !row.enabled) return false;
    message = ''; error = false;
    switch (row.id) {
      case 'resume': onResume(); break;
      case 'settings': onSettings(); break;
      case 'save': { const ok = onSave(); message = ok ? 'Saved.' : 'Could not save.'; error = !ok; break; }
      case 'load': refreshSlots(); go('load', Math.max(0, slots.findIndex(s => s.ok && s.meta))); break;
      case 'menu': if (isDirty()) go('confirm'); else onMainMenu(); break;
      case 'back': go('main', 3); break;
      case 'slot':
        try {
          const r = adapter.readSlot(row.slot);
          if (r.ok && r.save) onLoad(row.slot, r.save); else { message = 'Could not read slot.'; error = true; }
        } catch (e) { message = 'Could not read slot.'; error = true; }
        break;
      case 'yes': { const ok = onSave(); if (ok) onMainMenu(); else { message = 'Could not save.'; error = true; go('main', 4); } break; }
      case 'no': onMainMenu(); break;
    }
    return true;
  }
  function handleKey(code) {
    if (code === 'Escape') { if (mode === 'main') return false; message = ''; go('main', mode === 'load' ? 3 : 4); return true; }
    if (code === 'Enter' || code === 'Space') return activate();
    const d = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    if (!d) return false;
    for (let s = 1; s <= rows.length; s++) {
      const n = (selected + d * s + rows.length) % rows.length;
      if (rows[n].enabled) { selected = n; break; }
    }
    return true;
  }
  /** UI-grid cell; click false = hover only. Returns true when a row was hit. */
  function handlePointer(x, y, click = true) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds.x + 1 || x >= bounds.x + bounds.w - 1) return false;
    const i = rows.findIndex(r => Math.floor(y) === bounds.y + r.y && r.enabled);
    if (i < 0) return false;
    selected = i; return click ? activate() : true;
  }
  function draw(ui) {
    bounds.x = Math.floor((ui.cols - bounds.w) / 2); bounds.y = Math.floor((ui.rows - bounds.h) / 2);
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) for (let x = bounds.x; x < bounds.x + bounds.w; x++) ui.setCell(x, y, ' ', fg, bg);
    const f = style?.frame, fi = f ? colour(f.fg) : fg;
    for (let x = 1; x < bounds.w - 1; x++) { ui.setCell(bounds.x + x, bounds.y, f?.h || '-', fi, bg); ui.setCell(bounds.x + x, bounds.y + bounds.h - 1, f?.h || '-', fi, bg); }
    for (let y = 0; y < bounds.h; y++) {
      const corner = y === 0 || y === bounds.h - 1;
      const g = corner ? f?.corner || '+' : f?.v || '|', ink = f ? colour(corner ? f.cornerFg : f.fg) : fg;
      ui.setCell(bounds.x, bounds.y + y, g, ink, bg); ui.setCell(bounds.x + bounds.w - 1, bounds.y + y, g, ink, bg);
    }
    if (style) {
      for (const x of f.rivets.cols) {
        ui.setCell(bounds.x + x, bounds.y, f.rivets.glyph, colour(f.rivets.fg), bg);
        ui.setCell(bounds.x + x, bounds.y + bounds.h - 1, f.rivets.glyph, colour(f.rivets.fg), bg);
      }
      for (let x = 3; x <= 68; x++) ui.setCell(bounds.x + x, bounds.y + 4, '-', colour('brassShadow'), bg);
    }
    drawText(ui, bounds.x + (style ? Math.floor((bounds.w - titleText.length) / 2) : 3), bounds.y + 2, titleText, style ? colour(style.title.fg) : fg, bg);
    if (mode === 'load') drawText(ui, bounds.x + 4, bounds.y + 5, 'Choose a slot to load', style ? colour(style.sectionLabel.newGame.fg) : fg, bg);
    if (mode === 'confirm') drawText(ui, bounds.x + 4, bounds.y + 7, 'Save first?', style ? colour(style.confirm.fg.replace) : fg, bg);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], focus = i === selected;
      const st = style && (focus ? style.row.focus : row.enabled ? style.row.normal : style.row.disabled);
      const ink = style ? colour(st.fg) : fg, back = style ? style.bg[st.bg] : bg;
      if (focus && style) for (let x = style.row.bandFrom; x <= style.row.bandTo; x++) ui.setCell(bounds.x + x, bounds.y + row.y, ' ', ink, back);
      drawText(ui, bounds.x + 4, bounds.y + row.y, row.display, ink, back);
      if (focus) {
        ui.setCell(bounds.x + 2, bounds.y + row.y, style ? st.marker : '>', style ? colour(st.markerFg) : fg, back);
        if (style) ui.setCell(bounds.x + st.markerRightCol, bounds.y + row.y, st.markerRight, colour(st.markerFg), back);
      }
    }
    if (message) {
      drawText(ui, bounds.x + 4, bounds.y + 19, message, style ? colour(error ? style.message.error : style.message.info) : fg, bg);
      if (style) ui.setCell(bounds.x + 2, bounds.y + 19, '>', colour(style.message.prefixFg), bg);
    }
    const hx = bounds.x + Math.floor((bounds.w - hints.length) / 2);
    drawText(ui, hx, bounds.y + 21, hints, style ? colour(style.keyHints.fg) : fg, bg);
    if (style) for (const p of hintParts) drawText(ui, hx + p.x, bounds.y + 21, p.text, colour(style.keyHints.keyFg), bg);
    return bounds;
  }
  refreshSlots(); build();
  return { reset, draw, handleKey, handlePointer, refreshSlots, snapshot() { return { mode, selected, message, error, rows: rows.map(r => ({ ...r })) }; } };
}
