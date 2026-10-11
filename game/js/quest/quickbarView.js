// game/js/quest/quickbarView.js (EQ-12 + owner D-068). Two HUD pieces, both drawn through `ui.setCellRGB` with a plate bg
// (readable on bright grass): the 4-slot quick bar bottom-centre and the potion button next to the hearts.
// Slot = 7x4 cells: key digit (gold) top-left, the 5x3 item icon, count bottom-right (stacks only). Active hand item = gold
// tinted plate + bright [ ] brackets; empty slot = dim dotted corners; an item with count 0 shows dimmed with `x0`.
// No allocation per frame after the first draw of an item (icon cells and count strings are cached).
import { QB_SLOTS, POTION_ID } from './sim/quickbar.js';

export const SLOT_W = 7, SLOT_H = 4, SLOT_GAP = 1;
const PLATE = [10, 11, 16], PLATE_ON = [64, 54, 24], GOLD = [236, 196, 92], DIM = [96, 92, 80], TEXT = [226, 214, 176], WARN = [200, 70, 60];
const DIGITS = ['1', '2', '3', '4'];

/** @param {{defs:any, keys:any, rgb:any}} o  keys = items.keys (icon colour letters), rgb = palette rgb */
export function createQuickbarView(o) {
  const { defs, keys, rgb } = o;
  const cache = Object.create(null);           // id -> 15 cells {code, rgb|null}
  const dimCache = Object.create(null);
  const cStr = []; for (let n = 0; n < 100; n++) cStr.push('x' + n);

  function cellsOf(id) {
    let c = cache[id];
    if (c) return c;
    c = cache[id] = []; const dim = dimCache[id] = [];
    const d = defs[id], ic = d && d.icon;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
      const ch = ic ? (ic.glyphs[r].charAt(k) || ' ') : ' ', kc = ic ? ic.fg[r].charAt(k) : ' ';
      const key = keys && keys[kc] ? keys[kc].c : null, col = ch === ' ' ? null : (key && rgb[key]) || TEXT;
      c.push({ code: ch.charCodeAt(0) - 32, rgb: col });
      dim.push({ code: ch.charCodeAt(0) - 32, rgb: col ? [(col[0] * 0.4) | 0, (col[1] * 0.4) | 0, (col[2] * 0.4) | 0] : null });
    }
    return c;
  }
  const put = (ui, x, y, ch, fg, bg) => { if (x >= 0 && y >= 0 && x < ui.cols && y < ui.rows) ui.setCellRGB(x, y, ch.charCodeAt(0) - 32, fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]); };
  function icon(ui, x, y, id, dim, bg) {
    const cells = dim ? (cellsOf(id), dimCache[id]) : cellsOf(id);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
      const cl = cells[r * 5 + k];
      if (cl.rgb && x + k >= 0 && x + k < ui.cols && y + r < ui.rows) ui.setCellRGB(x + k, y + r, cl.code, cl.rgb[0], cl.rgb[1], cl.rgb[2], bg[0], bg[1], bg[2]);
    }
  }
  function isActive(id, eq, sipId) {
    const d = defs[id];
    if (!d) return false;
    if (sipId === id) return true;
    if (!eq || !d.equip) return false;
    const s = d.equip.slot;
    return (s === 'main' && eq.set === 'melee' && eq.main === id) || (s === 'ranged' && eq.set === 'ranged' && eq.ranged === id)
      || (s === 'off' && eq.set === 'melee' && eq.off === id);
  }
  /** count shown for a potion / food stack, -1 for single items (no number) */
  function countOfId(inv, id) {
    const d = defs[id];
    if (!d || (d.kind !== 'potion' && d.kind !== 'food') || !inv) return -1;
    let n = 0; for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i].id === id) n += inv.slots[i].n;
    return n;
  }

  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const view = {
    slotX(cols, i) { return ((cols - (QB_SLOTS * SLOT_W + (QB_SLOTS - 1) * SLOT_GAP)) >> 1) + i * (SLOT_W + SLOT_GAP); },
    slotY(rows) { return rows - SLOT_H - 1; },
    /** @param {any} ui @param {any} player entity data @param {{lastId:string|null, sipT:number}} sip @param {boolean} visible */
    drawBar(ui, player, sip, visible) {
      if (!visible || !player || !player.components || !Array.isArray(player.components.quickbar)) return;
      const qb = player.components.quickbar, eq = player.components.equipment, inv = player.components.inventory;
      const y = view.slotY(ui.rows), sipId = sip && sip.sipT > 0 ? sip.lastId : null;
      for (let i = 0; i < QB_SLOTS; i++) {
        const x = view.slotX(ui.cols, i), id = qb[i];
        const on = !!id && isActive(id, eq, sipId), n = id ? countOfId(inv, id) : -1, dim = !!id && n === 0;
        const bg = on ? PLATE_ON : PLATE;
        for (let r = 0; r < SLOT_H; r++) for (let c = 0; c < SLOT_W; c++) put(ui, x + c, y + r, ' ', TEXT, bg);
        if (id) {
          icon(ui, x + 1, y + 1, id, dim, bg);
          if (on) for (let r = 1; r < 3; r++) { put(ui, x, y + r, '[', GOLD, bg); put(ui, x + SLOT_W - 1, y + r, ']', GOLD, bg); }
          if (n >= 0) { const s = cStr[n > 99 ? 99 : n]; for (let k = 0; k < s.length; k++) put(ui, x + SLOT_W - s.length + k, y + SLOT_H - 1, s[k], n === 0 ? WARN : TEXT, bg); }
        } else {
          put(ui, x, y, '.', DIM, bg); put(ui, x + SLOT_W - 1, y, '.', DIM, bg); put(ui, x, y + SLOT_H - 1, '.', DIM, bg); put(ui, x + SLOT_W - 1, y + SLOT_H - 1, '.', DIM, bg);
        }
        put(ui, x, y, DIGITS[i], id ? GOLD : DIM, bg);
      }
    },
    /**
     * Potion HUD button next to the hearts (owner D-068): icon + count + key hint; greyed at 0. `style` = uiStyle.vitals.
     * `view.potionRect` holds its cell rect for the mouse test.
     */
    drawPotion(ui, style, player, sip, key, visible) {
      if (!visible || !style || !style.layout || !player || !player.components) return;
      const L = style.layout, x = L.x + L.numberCol + 17, y = L.hpRow;
      rect.x = x; rect.y = y; rect.w = 9; rect.h = 3;
      const n = countOfId(player.components.inventory, POTION_ID), has = n > 0, sipping = !!sip && sip.sipT > 0;
      const bg = sipping ? PLATE_ON : (style.textBg || PLATE);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) put(ui, x + c, y + r, ' ', TEXT, bg);
      icon(ui, x, y, POTION_ID, !has, bg);
      const s = cStr[n < 0 ? 0 : n > 99 ? 99 : n];
      for (let k = 0; k < s.length; k++) put(ui, x + 6 + k, y + 1, s[k], has ? TEXT : WARN, bg);
      put(ui, x + 6, y + 2, key, has ? GOLD : DIM, bg);
    },
    get potionRect() { return rect; },
    hitPotion(cx, cy) { return rect.w > 0 && cx >= rect.x && cx < rect.x + rect.w && cy >= rect.y && cy < rect.y + rect.h; },
  };
  return view;
}
