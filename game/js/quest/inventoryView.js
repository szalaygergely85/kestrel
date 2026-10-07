// game/js/quest/inventoryView.js (US-091b, D-040, architecture.md 37.16). The pack screen: `I` opens / closes it and
// main.js treats "open" as a pause (sim frozen, hands gate closed). Layout, colours, glyphs and flash states come
// from the designer's `ASSETS.uiStyle.inventory` (design/models/inventory_ui.js, all numbers in cells of the fixed
// 160x60 UI layer); item names / icons / kinds from `ASSETS.items`.
//
// Shape (like toastView.js): `createInventoryView(opts)` -> `{step, draw, setPointer, open, close, pushDim, ...}`.
// `step` runs once per fixed update (also while paused) and reads input edges; `draw` only walks prebuilt strings
// and writes `ui.setCellRGB` (no allocation per frame). Per-item text (wrapped description, icon cells, action rows)
// is built once at construct time.
import { assignHand, removeItem, countOf, SLOTS } from './sim/inventory.js';
import { wrapNoteLines } from './noteRead.js';

const ZONE_GRID = 0, ZONE_LEFT = 1, ZONE_RIGHT = 2;
const F_ASSIGN = 1, F_CLEARED = 2, F_USE = 3, F_REFUSE = 4;

/**
 * @param {object} o
 * @param {any} o.style `ASSETS.uiStyle.inventory`
 * @param {any} o.items `ASSETS.items` ({defs, keys})
 * @param {Record<string, number[]>} o.rgb palette key -> [r, g, b]
 * @param {() => any} o.inventoryOf the player's `components.inventory` (or null)
 * @param {() => ({hp: number, max: number}|null)} o.healthOf the player's `components.health`
 * @param {{say?: (text: string, fg: number[]) => void}|null} [o.toast]
 * @param {() => void} [o.onHandsChanged] called after a hand assignment (main.js re-steps the router)
 * @param {() => void} [o.onOpen]
 * @param {() => void} [o.onClose]
 */
export function createInventoryView(o) {
  const S = o.style, C = S.rgb, defs = o.items.defs, keyMap = o.items.keys;
  const P = S.panel;
  const slotCfg = S.slot, G = S.grid, H = S.hands, D = S.details;
  const cols = G.cols, rowsN = G.rows;

  // ---- per-item prebuilt data (construct time) ----
  const info = {};
  const kindLine = D.kind.text;
  for (const id of Object.keys(defs)) {
    const d = defs[id];
    const cells = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const ch = d.icon.glyphs[r].charAt(c) || ' ';
        const k = d.icon.fg[r].charAt(c);
        const key = keyMap[k] ? keyMap[k].c : null;
        cells.push({ code: ch.charCodeAt(0), rgb: ch === ' ' ? null : (key && o.rgb[key]) || C.uiText });
      }
    }
    const actions = [];
    const byKind = D.actions.byKind;
    if (d.hand === true) {
      for (const a of byKind.hand) actions.push({ keys: a.keys, text: a.text, hand: a.hand, fg: null });
    } else if (d.kind === 'food') {
      for (const a of byKind.food) actions.push({ keys: a.keys, text: a.text.replace('{heal}', String(d.use && d.use.heal || 0)), hand: null, fg: null });
    } else {
      for (const a of byKind.material) actions.push({ keys: '', text: (d.use && d.use.none) || a.text, hand: null, fg: a.fg });
    }
    const wrapped = wrapNoteLines([d.desc || ''], D.desc.w, D.desc.maxLines).rows;
    info[id] = { def: d, cells, actions, lines: wrapped, kind: d.hand === true ? kindLine[d.kind] || kindLine.tool : kindLine[d.kind] || '' };
  }
  const cntStr = [];
  for (let n = 0; n < 100; n++) cntStr.push('x' + n);
  const poolStr = [];
  for (let n = 0; n < 100; n++) poolStr.push(D.status.count.format.replace('{n}', String(n)));

  // key-hint segments: [{text, gold}] split on the designer's key list
  const hintSegs = [];
  {
    let rest = S.keyHints.text;
    for (const k of S.keyHints.keys) {
      const i = rest.indexOf(k);
      if (i < 0) continue;
      if (i > 0) hintSegs.push({ text: rest.slice(0, i), gold: false });
      hintSegs.push({ text: k, gold: true });
      rest = rest.slice(i + k.length);
    }
    if (rest) hintSegs.push({ text: rest, gold: false });
  }

  // ---- state ----
  let isOpen = false, t = 0;
  let zone = ZONE_GRID, idx = 0;
  let pxLast = -1, pyLast = -1;
  const handFlash = [{ kind: 0, until: 0 }, { kind: 0, until: 0 }];
  const slotFlash = { idx: -1, kind: 0, until: 0 };

  const inv = () => o.inventoryOf();

  function selectedId() {
    const v = inv();
    if (!v) return null;
    if (zone === ZONE_LEFT) return v.left || null;
    if (zone === ZONE_RIGHT) return v.right || null;
    const s = v.slots[idx];
    return s && s.id ? s.id : null;
  }

  function flashHand(hand, kind) { const f = handFlash[hand === 'left' ? 0 : 1]; f.kind = kind; f.until = t + (kind === F_ASSIGN ? slotCfg.flash.assign.ms : slotCfg.flash.cleared.ms) / 1000; }
  function flashSlot(i, kind) {
    slotFlash.idx = i; slotFlash.kind = kind;
    slotFlash.until = t + (kind === F_USE ? slotCfg.flash.use.ms : slotCfg.flash.refuse.ms) / 1000;
  }

  function doOpen() {
    const v = inv();
    isOpen = true; zone = ZONE_GRID; idx = 0; pxLast = pyLast = -1;
    if (v) for (let i = 0; i < SLOTS; i++) if (v.slots[i].id) { idx = i; break; }
    handFlash[0].kind = handFlash[1].kind = 0; slotFlash.kind = 0;
    if (o.onOpen) o.onOpen();
  }
  function doClose() {
    isOpen = false;
    if (o.onClose) o.onClose();
  }

  // ---- actions ----
  function equip(hand) {
    const v = inv(), id = selectedId();
    if (!v || !id || zone !== ZONE_GRID) return;
    if (!info[id] || info[id].def.hand !== true) { flashSlot(idx, F_REFUSE); return; }
    if (v[hand] === id) return;
    const other = hand === 'left' ? 'right' : 'left';
    const moved = v[other] === id;
    if (!assignHand(v, hand, id)) return;
    flashHand(hand, F_ASSIGN);
    if (moved) flashHand(other, F_CLEARED);
    if (o.onHandsChanged) o.onHandsChanged();
  }
  function emptyHand(hand) {
    const v = inv();
    if (!v || !v[hand]) return;
    assignHand(v, hand, null);
    flashHand(hand, F_CLEARED);
    if (o.onHandsChanged) o.onHandsChanged();
  }
  function say(text, fg) { if (o.toast && o.toast.say) o.toast.say(text, fg); }
  function useSelected() {
    const v = inv(), id = selectedId();
    if (!v || !id || zone !== ZONE_GRID) return;
    const d = info[id].def;
    if (d.kind === 'food' && d.use && d.use.heal) {
      const h = o.healthOf();
      if (!h) return;
      if (h.hp >= h.max) { say(d.use.fullHpToast || 'Not hurt', C.ember); flashSlot(idx, F_REFUSE); return; }
      h.hp = Math.min(h.max, h.hp + d.use.heal);
      removeItem(v, id, 1);
      flashSlot(idx, F_USE);
      say('Ate ' + d.name + '  +' + d.use.heal + ' HP', C.heroGreen);
    } else {
      say((d.use && d.use.none) || 'Nothing happens', C.uiDim);
      flashSlot(idx, F_REFUSE);
    }
  }

  function hitTest(px, py) {
    const ox = P.x, oy = P.y;
    const x = px - ox, y = py - oy;
    const b = slotCfg.box;
    if (y >= H.left.box.y && y < H.left.box.y + b.h) {
      if (x >= H.left.box.x && x < H.left.box.x + b.w) { zone = ZONE_LEFT; return true; }
      if (x >= H.right.box.x && x < H.right.box.x + b.w) { zone = ZONE_RIGHT; return true; }
    }
    const rx = x - G.x, ry = y - G.y;
    if (rx >= 0 && ry >= 0 && rx <= G.pitchX * cols && ry <= G.pitchY * rowsN) {
      const c = Math.min(cols - 1, Math.floor(rx / G.pitchX)), r = Math.min(rowsN - 1, Math.floor(ry / G.pitchY));
      zone = ZONE_GRID; idx = r * cols + c; return true;
    }
    return false;
  }

  function move(dx, dy) {
    if (zone === ZONE_GRID) {
      let c = idx % cols, r = (idx / cols) | 0;
      if (dy < 0 && r === 0) { zone = c < cols / 2 ? ZONE_LEFT : ZONE_RIGHT; return; }
      c = Math.max(0, Math.min(cols - 1, c + dx));
      r = Math.max(0, Math.min(rowsN - 1, r + dy));
      idx = r * cols + c;
    } else if (dy > 0) {
      idx = zone === ZONE_LEFT ? 0 : cols / 2; zone = ZONE_GRID;
    } else if (dx !== 0) {
      zone = dx < 0 ? ZONE_LEFT : ZONE_RIGHT;
    }
  }

  // ---- drawing helpers (hoisted: draw() must not create closures per frame) ----
  let U = null;
  const ox = P.x, oy = P.y, bg = P.bg;
  const sb = slotCfg.box, ib = slotCfg.inner;
  function put(x, y, ch, fg, b) {
    x += ox; y += oy;
    if (x < 0 || y < 0 || x >= U.cols || y >= U.rows) return;
    U.setCellRGB(x, y, ch - 32, fg[0], fg[1], fg[2], b[0], b[1], b[2]);
  }
  function text(x, y, s, fg, b) { for (let j = 0; j < s.length; j++) put(x + j, y, s.charCodeAt(j), fg, b); }
  // one 9x5 slot box. `sel` = gold cursor style, borderFg = border colour (flash override), innerBg = interior
  function box(bx, by, id, sel, borderFg, innerBg, handBox, handTag, count) {
        const bd = handBox ? H.frame : slotCfg.border;
        const bc = sel ? slotCfg.selected.corner.charCodeAt(0) : bd.corner.charCodeAt(0);
        const bh = sel ? slotCfg.selected.h.charCodeAt(0) : bd.h.charCodeAt(0);
        const bv = sel ? slotCfg.selected.v.charCodeAt(0) : bd.v.charCodeAt(0);
        const fg = sel ? slotCfg.selected.fg : borderFg;
        const cfg = sel ? slotCfg.selected.fg : (handBox ? H.frame.cornerFg : borderFg);
        for (let x = 1; x < sb.w - 1; x++) { put(bx + x, by, bh, fg, bg); put(bx + x, by + sb.h - 1, bh, fg, bg); }
        for (let y = 1; y < sb.h - 1; y++) { put(bx, by + y, bv, fg, bg); put(bx + sb.w - 1, by + y, bv, fg, bg); }
        put(bx, by, bc, cfg, bg); put(bx + sb.w - 1, by, bc, cfg, bg);
        put(bx, by + sb.h - 1, bc, cfg, bg); put(bx + sb.w - 1, by + sb.h - 1, bc, cfg, bg);
        for (let y = 0; y < ib.h; y++) for (let x = 0; x < ib.w; x++) put(bx + ib.x + x, by + ib.y + y, 32, C.uiText, innerBg);
        if (id && info[id]) {
          const cells = info[id].cells;
          for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
            const cl = cells[r * 5 + c];
            if (cl.rgb) put(bx + slotCfg.icon.x + c, by + slotCfg.icon.y + r, cl.code, cl.rgb, innerBg);
          }
        }
        if (handTag) put(bx + slotCfg.equippedTag.col, by + slotCfg.equippedTag.row, handTag.charCodeAt(0), slotCfg.equippedTag.fg, bg);
        if (count >= slotCfg.count.minN) {
          const s = cntStr[count > 99 ? 99 : count];
          text(bx + 8 - s.length, by + sb.h - 1, s, slotCfg.count.fg, bg);
        }
  }


  const view = {
    get isOpen() { return isOpen; },
    get cursor() { return { zone, idx }; },
    open() { if (!isOpen) doOpen(); },
    close() { if (isOpen) doClose(); },

    /** Hover: UI-layer cell under the mouse (or -1). Only a changed cell moves the cursor (keyboard keeps it otherwise). */
    setPointer(px, py) {
      if (!isOpen || (px === pxLast && py === pyLast)) return;
      pxLast = px; pyLast = py;
      hitTest(px, py);
    },

    /**
     * One fixed update. `canOpen`: main.js says nothing else owns the screen (not ending / note / map / dead).
     * @param {number} dt seconds
     * @param {{pressed: (code: string) => boolean, consumePressed?: () => void}} input
     * @param {boolean} canOpen
     */
    step(dt, input, canOpen) {
      t += dt;
      if (!isOpen) {
        if (canOpen && input.pressed('KeyI')) { doOpen(); if (input.consumePressed) input.consumePressed(); }
        return;
      }
      if (input.pressed('KeyI') || input.pressed('Escape')) {
        doClose();
        if (input.consumePressed) input.consumePressed();
        return;
      }
      if (input.pressed('KeyW') || input.pressed('ArrowUp')) { move(0, -1); }
      if (input.pressed('KeyS') || input.pressed('ArrowDown')) { move(0, 1); }
      if (input.pressed('KeyA') || input.pressed('ArrowLeft')) { move(-1, 0); }
      if (input.pressed('KeyD') || input.pressed('ArrowRight')) { move(1, 0); }
      const q = input.pressed('KeyQ'), e = input.pressed('KeyE'), l = input.pressed('Mouse0'), r = input.pressed('Mouse2');
      if (zone === ZONE_GRID) {
        if (q || l) { equip('left'); }
        if (e || r) { equip('right'); }
        if (input.pressed('Enter') || input.pressed('NumpadEnter') || input.pressed('KeyU')) { useSelected(); }
      } else if (q || e || l || r || input.pressed('Enter') || input.pressed('NumpadEnter')) {
        emptyHand(zone === ZONE_LEFT ? 'left' : 'right'); // a click / Enter on a hand slot empties it
       
      }
      // every edge is eaten while open: several fixed steps per frame must not repeat one, and M / S / N never reach the map etc.
      if (input.consumePressed) input.consumePressed();
    },

    /** Whole-scene dim while open (uiStyle.inventory.sceneDim.bgMul). */
    pushDim(dim) {
      if (isOpen && dim && S.sceneDim.bgMul < dim.all) dim.all = S.sceneDim.bgMul;
    },

    /** @param {any} ui UiLayer (setCellRGB, cols, rows) */
    draw(ui) {
      if (!isOpen) return;
      const v = inv();
      if (!v) return;
      U = ui;
      // panel fill + frame
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) put(x, y, 32, C.uiText, bg);
      const F = S.frame, fc = F.corner.charCodeAt(0), fh = F.h.charCodeAt(0), fv = F.v.charCodeAt(0);
      for (let x = 1; x < P.w - 1; x++) { put(x, 0, fh, F.fg, bg); put(x, P.h - 1, fh, F.fg, bg); }
      for (let y = 1; y < P.h - 1; y++) { put(0, y, fv, F.fg, bg); put(P.w - 1, y, fv, F.fg, bg); }
      put(0, 0, fc, F.cornerFg, bg); put(P.w - 1, 0, fc, F.cornerFg, bg);
      put(0, P.h - 1, fc, F.cornerFg, bg); put(P.w - 1, P.h - 1, fc, F.cornerFg, bg);
      const tl = F.title.text.length + 2, tx = ((P.w - tl) >> 1);
      text(tx, 0, ' ' + F.title.text + ' ', F.title.fg, bg);
      text(F.pausedTag.col - 1, F.pausedTag.row, ' ' + F.pausedTag.text + ' ', F.pausedTag.fg, bg);
      for (let si = 0; si < S.separators.length; si++) {
        const sp = S.separators[si];
        const g = sp.glyph.charCodeAt(0);
        if (sp.row !== undefined) for (let x = sp.from; x <= sp.to; x++) put(x, sp.row, g, sp.fg, bg);
        else for (let y = sp.from; y <= sp.to; y++) put(sp.col, y, g, sp.fg, bg);
      }

      // ---- grid ----
      const flashOnSlot = slotFlash.kind !== 0 && t < slotFlash.until;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < SLOTS; i++) {
          const isSel = zone === ZONE_GRID && i === idx;
          if ((pass === 1) !== isSel) continue; // the cursor slot last, so its border wins the shared edges
          const s = v.slots[i];
          const bx = G.x + (i % cols) * G.pitchX, by = G.y + ((i / cols) | 0) * G.pitchY;
          let bf = slotCfg.border.fg, ibg = isSel ? slotCfg.selected.innerBg : slotCfg.innerBg;
          if (flashOnSlot && slotFlash.idx === i) {
            if (slotFlash.kind === F_REFUSE) bf = slotCfg.flash.refuse.borderFg;
            else if (slotFlash.kind === F_USE) ibg = slotCfg.flash.use.innerBg;
          }
          const tag = s.id && v.left === s.id ? 'L' : s.id && v.right === s.id ? 'R' : null;
          box(bx, by, s.id, isSel, bf, ibg, false, tag, 0);
          if (!s.id) put(bx + slotCfg.empty.x, by + slotCfg.empty.y, slotCfg.empty.glyph.charCodeAt(0), slotCfg.empty.fg, ibg);
        }
      }

      // counts last: they sit on the bottom border, which the next row's top border would overwrite
      for (let i = 0; i < SLOTS; i++) {
        const s = v.slots[i];
        if (s.id && s.n >= slotCfg.count.minN) text(G.x + (i % cols) * G.pitchX + 8 - cntStr[s.n > 99 ? 99 : s.n].length, G.y + ((i / cols) | 0) * G.pitchY + sb.h - 1, cntStr[s.n > 99 ? 99 : s.n], slotCfg.count.fg, bg);
      }

      // ---- hands strip ----
      for (let h = 0; h < 2; h++) {
        const hc = h === 0 ? H.left : H.right, id = h === 0 ? v.left : v.right;
        const isSel = zone === (h === 0 ? ZONE_LEFT : ZONE_RIGHT);
        const f = handFlash[h];
        let bf = H.frame.fg;
        if (f.kind !== 0 && t < f.until) bf = f.kind === F_ASSIGN ? slotCfg.flash.assign.borderFg : slotCfg.flash.cleared.borderFg;
        box(hc.box.x, hc.box.y, id, isSel, bf, isSel ? slotCfg.selected.innerBg : slotCfg.innerBg, true, null, 0);
        if (!id) {
          const g = H.emptyGlyph[h === 0 ? 'left' : 'right'];
          for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
            const ch = g[r].charCodeAt(c);
            if (ch !== 32) put(hc.box.x + 1 + c, hc.box.y + 1 + r, ch, H.emptyGlyph.fg, isSel ? slotCfg.selected.innerBg : slotCfg.innerBg);
          }
        }
        text(hc.label.x, hc.label.y, hc.label.text, H.label.fg, bg);
        text(hc.label.x + hc.label.text.length + hc.button.gap, hc.label.y, hc.button.text, H.button.fg, bg);
        if (id && info[id]) {
          text(hc.name.x, hc.name.y, info[id].def.name, H.name.fg, bg);
          text(hc.kind.x, hc.kind.y, H.kindText[info[id].def.kind] || '', H.kind.fg, bg);
        } else text(hc.name.x, hc.name.y, H.emptyName.text, H.emptyName.fg, bg);
        if (isSel) text(hc.hint.x, hc.hint.y, H.hint.text, H.hint.fg, bg);
      }

      // ---- details ----
      const sid = selectedId();
      if (!sid || !info[sid]) {
        text(D.emptySlot.x, D.emptySlot.y, D.emptySlot.text, D.emptySlot.fg, bg);
        if (zone !== ZONE_GRID) text(D.handSlotSelected.x, D.handSlotSelected.y, D.handSlotSelected.text, D.handSlotSelected.fg, bg);
      } else {
        const inf = info[sid];
        box(D.iconBox.x, D.iconBox.y, sid, false, slotCfg.border.fg, slotCfg.innerBg, false, null, 0);
        text(D.name.x, D.name.y, inf.def.name, D.name.fg, bg);
        text(D.kind.x, D.kind.y, inf.kind, D.kind.fg, bg);
        const total = countOf(v, sid);
        if (v.left === sid) text(D.status.x, D.status.y, D.status.inLeft, D.status.fg, bg);
        else if (v.right === sid) text(D.status.x, D.status.y, D.status.inRight, D.status.fg, bg);
        else if (total >= 2) text(D.status.x, D.status.y, poolStr[total > 99 ? 99 : total], D.status.count.fg, bg);
        for (let i = 0; i < inf.lines.length; i++) text(D.desc.x, D.desc.y + i, inf.lines[i], D.desc.fg, bg);
        if (zone !== ZONE_GRID) text(D.handSlotSelected.x, D.handSlotSelected.y, D.handSlotSelected.text, D.handSlotSelected.fg, bg);
        else {
          for (let i = 0; i < inf.actions.length; i++) {
            const a = inf.actions[i], y = D.actions.y + i * (1 + D.actions.gapRows);
            if (a.keys) {
              text(D.actions.x, y, a.keys, D.actions.keyFg, bg);
              text(D.actions.x + 12, y, a.text, D.actions.textFg, bg);
              if (a.hand && v[a.hand] === sid) text(D.actions.x + 12 + a.text.length + 1, y, D.actions.here.text, D.actions.here.fg, bg);
            } else text(D.actions.x, y, a.text, a.fg || D.actions.textFg, bg);
          }
        }
      }

      // ---- key hints ----
      let hl = 0;
      for (let i = 0; i < hintSegs.length; i++) hl += hintSegs[i].text.length;
      let hx = (P.w - hl) >> 1;
      for (let i = 0; i < hintSegs.length; i++) {
        text(hx, S.keyHints.row, hintSegs[i].text, hintSegs[i].gold ? S.keyHints.keyFg : S.keyHints.fg, bg);
        hx += hintSegs[i].text.length;
      }
    },
  };
  return view;
}
