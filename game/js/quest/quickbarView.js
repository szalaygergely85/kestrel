// game/js/quest/quickbarView.js (EQ-12 + owner D-068 + QB-6 redesign). The 6-slot bar is drawn through `ui.setCellRGB` with a
// plate bg (readable on bright grass): the 6-slot quick bar bottom-centre ([L] [R] mouse-hand slots, then keys 1-4; also drawn
// inside the pack / character menu as the drag-and-drop target).
// Slot = 7x4 cells: label top-left (L / R = mouse buttons on a blue-grey plate, digits gold), the 5x3 item icon, count bottom-right
// (stacks only). Active hand item = gold tinted plate + bright [ ] brackets; empty slot = dim dotted corners; an item with
// count 0 shows dimmed with `x0`. `slotAt` = hit test for the drag-and-drop; `drawGhost` = the item riding the pointer.
// No allocation per frame after the first draw of an item (icon cells and count strings are cached).
import { QB_SLOTS, HAND_SLOTS } from './sim/quickbar.js';

export const SLOT_W = 7, SLOT_H = 4, SLOT_GAP = 1, GROUP_GAP = 2; // GROUP_GAP = extra gap between the hand pair and the keys
const PLATE = [10, 11, 16], PLATE_ON = [64, 54, 24], GOLD = [236, 196, 92], DIM = [96, 92, 80], TEXT = [226, 214, 176], WARN = [200, 70, 60];
const LABELS = ['L', 'R', '1', '2', '3', '4'];
// VISQA-06: 1-cell lighter rim so the plates read against the navy night scene (UI is not night-graded, the plates are just very dark)
const rimOf = (b) => [Math.min(255, b[0] + 30), Math.min(255, b[1] + 38), Math.min(255, b[2] + 56)];
const HAND_PLATE = [14, 20, 34], HAND_ON = [40, 56, 84], HAND_TXT = [140, 190, 236], DRAG_BG = [90, 76, 30];

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
  function icon(ui, x, y, id, dim, bg, rimBottom) {
    const cells = dim ? (cellsOf(id), dimCache[id]) : cellsOf(id);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
      const cl = cells[r * 5 + k], b = rimBottom && r === 2 ? rimBottom : bg;
      if (cl.rgb && x + k >= 0 && x + k < ui.cols && y + r < ui.rows) ui.setCellRGB(x + k, y + r, cl.code, cl.rgb[0], cl.rgb[1], cl.rgb[2], b[0], b[1], b[2]);
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

  const view = {
    slotX(cols, i) { return ((cols - (QB_SLOTS * SLOT_W + (QB_SLOTS - 1) * SLOT_GAP + GROUP_GAP)) >> 1) + i * (SLOT_W + SLOT_GAP) + (i >= HAND_SLOTS ? GROUP_GAP : 0); },
    slotY(rows) { return rows - SLOT_H - 1; },
    /** bar slot 0..5 under UI cell (cx, cy), or -1 */
    slotAt(ui, cx, cy) {
      const y = view.slotY(ui.rows);
      if (cy < y || cy >= y + SLOT_H) return -1;
      for (let i = 0; i < QB_SLOTS; i++) { const x = view.slotX(ui.cols, i); if (cx >= x && cx < x + SLOT_W) return i; }
      return -1;
    },
    /** the dragged item's icon centred on the pointer (menu only); `hot` = slot under the pointer gets a gold frame */
    drawGhost(ui, id, cx, cy) {
      if (!id || !defs[id]) return;
      const hot = view.slotAt(ui, cx, cy);
      if (hot >= 0) { const x = view.slotX(ui.cols, hot), y = view.slotY(ui.rows); for (let c = 0; c < SLOT_W; c++) { put(ui, x + c, y, '-', GOLD, DRAG_BG); put(ui, x + c, y + SLOT_H - 1, '-', GOLD, DRAG_BG); } }
      icon(ui, cx - 2, cy - 1, id, false, DRAG_BG);
    },
    /** @param {any} ui @param {any} player entity data @param {{lastId:string|null, sipT:number}} sip @param {boolean} visible
     * @param {Object<string,boolean>} [locked] FB-03: ids still locked (spell.fireball, potion.mp): the spell hand box is hidden (drawn empty), a locked potion is drawn dimmed */
    drawBar(ui, player, sip, visible, locked) {
      if (!visible || !player || !player.components || !Array.isArray(player.components.quickbar)) return;
      const qb = player.components.quickbar, eq = player.components.equipment, inv = player.components.inventory;
      const y = view.slotY(ui.rows), sipId = sip && sip.sipT > 0 ? sip.lastId : null;
      for (let i = 0; i < QB_SLOTS; i++) {
        const x = view.slotX(ui.cols, i), hand = i < HAND_SLOTS, lk = !!(locked && qb[i] && locked[qb[i]]);
        const id = lk && hand && defs[qb[i]] && defs[qb[i]].kind !== 'potion' ? null : qb[i]; // FB-03: locked spell hand box = an empty slot
        const on = !!id && !lk && isActive(id, eq, sipId), n = id ? countOfId(inv, id) : -1, dim = !!id && (n === 0 || lk);
        const bg = hand ? (on ? HAND_ON : HAND_PLATE) : (on ? PLATE_ON : PLATE);
        const rim = rimOf(bg);
        for (let r = 0; r < SLOT_H; r++) for (let c = 0; c < SLOT_W; c++) put(ui, x + c, y + r, ' ', TEXT, r === 0 || r === SLOT_H - 1 || c === 0 || c === SLOT_W - 1 ? rim : bg);
        if (id) {
          icon(ui, x + 1, y + 1, id, dim, bg, rim);
          if (on) for (let r = 1; r < 3; r++) { put(ui, x, y + r, '[', GOLD, rim); put(ui, x + SLOT_W - 1, y + r, ']', GOLD, rim); }
          if (n >= 0) { const s = cStr[n > 99 ? 99 : n]; for (let k = 0; k < s.length; k++) put(ui, x + SLOT_W - s.length + k, y + SLOT_H - 1, s[k], n === 0 ? WARN : TEXT, rim); }
        } else {
          put(ui, x, y, '.', DIM, rim); put(ui, x + SLOT_W - 1, y, '.', DIM, rim); put(ui, x, y + SLOT_H - 1, '.', DIM, rim); put(ui, x + SLOT_W - 1, y + SLOT_H - 1, '.', DIM, rim);
        }
        put(ui, x, y, LABELS[i], hand ? HAND_TXT : id ? GOLD : DIM, rim);
      }
    },
  };
  return view;
}
