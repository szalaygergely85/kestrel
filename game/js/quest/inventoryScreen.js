// game/js/quest/inventoryScreen.js (OB-112, replaces inventoryView.js + characterView.js; D-040, architecture.md 37.16 / 38.40).
// ONE inventory screen. I, C and Tab all open and close it (no tabs). Left: the 24-slot pack grid with the details of the
// selected item under it. Right: Wick as the lit model (modelPreview, previewYaw rotation) with the gear slots around him
// and his stats (HP / DEF / DMG) under him. Equip by drag (pack -> slot or Wick), unequip by drag (worn -> pack), or the
// click / E path. Layout, colours, glyphs and flash states come from `ASSETS.uiStyle.inventory`; numbers are UI-layer cells.
// `draw` only walks cached strings and writes `ui.setCellRGB`. No text mentions Esc (owner rule).
import { equipAt, unequipSlot, OK as EQ_OK, NEEDS as EQ_NEEDS, BREAKS as EQ_BREAKS, PACK_FULL as EQ_FULL, syncHands, defenceOf, reductionOf } from './sim/equipment.js';
import { SLOTS as PACK_SLOTS, assignHand, removeItem } from './sim/inventory.js';
import { wrapNoteLines } from './noteRead.js';
import { gearRecipe } from './gearLook.js';
import { createPreviewYaw } from './previewYaw.js';
import { itemDisplayName } from './sim/inventory.js';
import { itemName, rarityOf, reqOf, createStatsCache, refreshTotals } from './sim/itemInst.js';

// Panel-relative layout (panel 100 x 29). Slot boxes are the style's 9x5 boxes, pitch from `uiStyle.inventory.grid`.
export const LAYOUT = Object.freeze({
  pack: Object.freeze({ x: 2, y: 3 }),            // 6 x 4 cells
  sepCol: 52, titleRow: 1,
  // [slot, x, y, label]: 3 left, 3 right of the view box, the bottom row of 5 touches it
  slots: Object.freeze([
    ['head', 54, 3, 'Head'], ['body', 54, 8, 'Chest'], ['hands', 54, 13, 'Gloves'],
    ['legs', 86, 3, 'Legs'], ['feet', 86, 8, 'Boots'], ['cloak', 86, 13, 'Cloak'],
    ['belt', 54, 18, 'Belt'], ['main', 62, 18, 'L hand'], ['off', 70, 18, 'R hand'], ['ranged', 78, 18, 'Ranged'], ['quiver', 86, 18, 'Quiver'],
  ]),
  view: Object.freeze({ x: 63, y: 3, w: 23, h: 15 }), // frame; the model fills the interior
  stats: Object.freeze({ x: 54, y: 24 }), details: Object.freeze({ x: 2, y: 21, w: 48, rows: 6 }), hintRow: 27,
});
export const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const RED = [230, 80, 70];
const N_EQ = 11, VIEW = N_EQ, PACK0 = N_EQ + 1;
const F_REFUSE = 1, F_OK = 2, F_USE = 3;
const HINTS = [['W/A/S/D', true], [' select   ', false], ['E', true], [' use / wear   ', false], ['drag', true], [' equip   ', false], ['A/D', true], [' turn   ', false], ['B', true], [' spellbook   ', false], ['I', true], [' close', false]];

/**
 * @param {object} o
 * @param {any} o.style `ASSETS.uiStyle.inventory`   @param {any} o.items `ASSETS.items` ({defs, keys})
 * @param {Record<string, number[]>} o.rgb palette key -> [r, g, b]   @param {() => any} o.inventoryOf
 * @param {() => ({hp:number,max:number}|null)} [o.healthOf] @param {{say?: Function}|null} [o.toast]
 * @param {() => void} [o.onHandsChanged] after a hand assignment (spells) @param {() => void} [o.onOpen] @param {() => void} [o.onClose]
 * @param {(i:number)=>string} [o.slotLockText] OB-156: detail line for a locked cell that holds an item
 * @param {(i:number)=>boolean} [o.isSlotDisabled] host-owned pack locks @param {boolean} [o.characterKey] false: C belongs to crafting
 * @param {{assign:(n:number,id:string)=>boolean}} [o.quickbar] 1-4 over an item
 * @param {{ids:()=>string[], tierOf:(id:string)=>number, equip:(id:string)=>boolean, assign:(n:number,id:string)=>boolean}} [o.spellbook] SPELLBOOK-01: B toggles the SPELLBOOK page (learned spells only); E = right hand, 1-4 = quick bar
 * @param {object} [o.character] {equipmentOf, createPreview, charCache, getLook, kit, onGearChanged}; absent = no gear slots / model
 * @param {object} [o.layout] overrides for LAYOUT
 */
export function createInventoryScreen(o) {
  const S = o.style, C = S.rgb, defs = o.items.defs, keyMap = o.items.keys, P = S.panel;
  const slotCfg = S.slot, G = S.grid, cols = G.cols, sb = slotCfg.box, ib = slotCfg.inner;
  const ch = o.character || {};
  const L = Object.assign({}, LAYOUT, o.layout || {});
  const styleAt = (path) => path.split('.').reduce((v, k) => v[k], S);
  const disabledSlot = S.states ? styleAt(S.states.slot.disabled) : slotCfg.disabled;
  const slotDisabled = (i) => !!o.isSlotDisabled && o.isSlotDisabled(i);
  const charKey = o.characterKey !== false;
  const rarityFg = [C.uiText, C.heroGreen, C.gold, C.ember, C.ember]; // ITEM-02a placeholder colours per rarity (common..unique); UI redesign is a later story
  const tierFg = { worn: C.uiHint, sturdy: C.heroGreen, fine: C.gold, tempered: C.gold, warden: C.gold };
  const tierName = { worn: 'Worn', sturdy: 'Sturdy', fine: 'Fine', tempered: 'T4', warden: 'T5' };
  const slotLabel = {}, slotTag = {}; for (const s of L.slots) { slotLabel[s[0]] = s[3]; slotTag[s[0]] = s[3].length < 7 ? s[3] + ' ' : s[3]; }
  const cStr = []; for (let n = 0; n < 100; n++) cStr.push('x' + n);

  // ---- per-item prebuilt data (construct time): icon cells + wrapped description ----
  const info = {};
  for (const id of Object.keys(defs)) {
    const d = defs[id], cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const g = d.icon.glyphs[r].charAt(c) || ' ', k = d.icon.fg[r].charAt(c), key = keyMap[k] ? keyMap[k].c : null;
      cells.push({ code: g.charCodeAt(0), rgb: g === ' ' ? null : (key && o.rgb[key]) || C.uiText });
    }
    info[id] = { def: d, cells, lines: wrapNoteLines([d.desc || ''], L.details.w, 3).rows };
  }

  // ---- navigation nodes: 11 equipment slots, the view box, the 24 pack cells ----
  const nodes = [];
  for (const s of L.slots) nodes.push({ kind: 0, slot: s[0], i: -1, x: s[1], y: s[2], w: sb.w, h: sb.h });
  nodes.push({ kind: 1, slot: 'view', i: -1, x: L.view.x, y: L.view.y, w: L.view.w, h: L.view.h });
  for (let i = 0; i < PACK_SLOTS; i++) nodes.push({ kind: 2, slot: 'pack', i, x: L.pack.x + (i % cols) * G.pitchX, y: L.pack.y + ((i / cols) | 0) * G.pitchY, w: sb.w, h: sb.h });
  for (const n of nodes) { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; }
  const rect = { x: 0, y: 0, w: L.view.w - 2, h: L.view.h - 2 }; // absolute UI cells, set on draw
  const subj = { yawDeg: 180 };
  const yaw = createPreviewYaw();

  let isOpen = false, cur = PACK0, t = 0, pxLast = -1, pyLast = -1, rx = 0, ry = 0;
  let preview = null, previewOk = false, curDef = null;
  let turning = false, dragPx = 0, rxLast = -1, dtAcc = 0, yawAcc = 0;
  let dragSrc = -1, dragMoved = false; // item drag (pack <-> gear)
  const flash = { node: -1, kind: 0, until: 0 };
  let sHp = -1, sMax = -1, sDef = -1, sArr = -1, sDmg = -1, stat1 = '', stat2 = '', tipCur = -1, tipId = null, tipWorn = null, tipDef = -1, tipLines = [], tipFg = [];
  const EMPTY_EQ = {};

  const inv = () => o.inventoryOf();
  const eq = () => (ch.equipmentOf ? ch.equipmentOf() : null);
  const say = (text, fg) => { if (o.toast && o.toast.say) o.toast.say(text, fg); };
  const setFlash = (n, kind, ms) => { flash.node = n; flash.kind = kind; flash.until = t + ms / 1000; };
  // ---- SPELLBOOK page (SPELLBOOK-01, D-099): learned spells only, replaces the pack grid while shown ----
  let page = 0, spCur = 0; // page 1 = spellbook
  const spIds = () => (o.spellbook ? o.spellbook.ids() : []);
  function spellStep(input) {
    const ids = spIds();
    if (spCur >= ids.length) spCur = Math.max(0, ids.length - 1);
    if (input.pressed('KeyW') || input.pressed('ArrowUp')) spCur = Math.max(0, spCur - 1);
    if (input.pressed('KeyS') || input.pressed('ArrowDown')) spCur = Math.min(ids.length - 1, spCur + 1);
    const id = ids[spCur];
    if (!id) return;
    // SPELLBOOK-02 (D-100): spells live only in the hands. E / Enter = right hand, Shift+E / Q = left hand (no quick-bar keys).
    const e = input.pressed('KeyE') || input.pressed('Enter'), q = input.pressed('KeyQ');
    if (e || q) {
      const left = q || (input.isDown && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')));
      if (o.spellbook.equip(id, left ? 'left' : 'right')) { say(defs[id].name + (left ? ' in your left hand' : ' in your right hand'), C.heroGreen); if (o.onHandsChanged) o.onHandsChanged(); } else say('Cannot be placed there', C.ember);
    }
  }
  function drawSpellbook() {
    for (let y = 2; y < 27; y++) for (let x = 1; x < L.sepCol; x++) put(x, y, 32, C.uiText, bg);
    text(L.pack.x + 1, L.titleRow, ' SPELLBOOK ', slotCfg.selected.fg, bg);
    const ids = spIds();
    if (!ids.length) { text(L.pack.x + 2, 5, 'No spells learned yet.', C.uiDim, bg); return; }
    for (let i = 0; i < ids.length; i++) {
      const d = defs[ids[i]], sp = d.spellbook || {}, y = 3 + i * 6, sel = i === spCur;
      text(L.pack.x, y, (sel ? '> ' : '  ') + d.name + '   Tier ' + o.spellbook.tierOf(ids[i]), sel ? slotCfg.selected.fg : C.uiText, bg);
      text(L.pack.x + 2, y + 1, 'Mana ' + (sp.mana || '-'), C.uiHint, bg);
      text(L.pack.x + 2, y + 2, sp.blurb || d.desc || '', C.uiDim, bg);
    }
    text(L.pack.x, 25, 'E: right hand    Shift+E / Q: left hand    drag onto a hand slot', C.uiHint, bg);
  }

  function wornId(slot) { const e = eq(); if (!e) return null; if (slot === 'quiver') return e.quiver ? e.quiver.id : null; return e[slot] || null; }
  function idAt(node) {
    if (node.kind === 0) return wornId(node.slot);
    if (node.kind === 2) { const v = inv(); const s = v && v.slots[node.i]; return s && s.id ? s.id : null; }
    return null;
  }

  /** Recompose the player model from look + worn gear (cache: once per distinct recipe). Called on open and after a change. */
  function refreshModel() {
    if (!ch.createPreview || !ch.charCache || !ch.getLook) return;
    try {
      if (!preview) preview = ch.createPreview();
      const def = ch.charCache.get(gearRecipe(ch.getLook(), eq(), defs, ch.kit));
      if (def !== curDef) { preview.setModel('char.preview', def); curDef = def; }
      previewOk = true;
    } catch (e) { previewOk = false; if (typeof console !== 'undefined') console.warn('[inventory] preview off:', e && e.message); }
  }
  function changed() {
    const v = inv(), e = eq();
    if (v && e) syncHands(v, e);
    if (ch.onGearChanged) ch.onGearChanged();
    refreshModel();
    tipCur = -1;
  }

  // ---- actions ----
  const statsCache = o.statsCache || createStatsCache(), why = { attr: '', need: 0, have: 0, blockerSlot: '', blockerId: null };
  /** Plain-words refusal from an equipAt / unequipSlot code + `why` (38.66 s4). */
  function refusalText(rc) {
    if (rc === EQ_NEEDS) return 'Needs ' + why.attr.toUpperCase() + ' ' + why.need;
    if (rc === EQ_BREAKS) { const b = why.blockerId && defs[why.blockerId]; return (b ? itemDisplayName(b) : 'Another piece') + ' needs ' + why.attr.toUpperCase() + ' ' + why.need; }
    if (rc === EQ_FULL) return 'Pack is full';
    return 'Cannot wear that now';
  }
  /** Wear the pack item at node n (`dropSlot` = the slot it was dropped on, or null for click / E). */
  function wear(n, dropSlot) {
    const node = nodes[n], v = inv(), e = eq(), id = idAt(node), rf = slotCfg.flash.refuse.ms;
    if (!v || !e || !id || slotDisabled(node.i) || !defs[id] || !defs[id].equip) { setFlash(n, F_REFUSE, rf); return false; }
    const slot = defs[id].equip.slot;
    if (dropSlot && dropSlot !== slot) { setFlash(n, F_REFUSE, rf); say('Does not fit there', C.ember); return false; }
    const rc = node.kind === 2 ? equipAt(v, e, defs, node.i, statsCache, why) : 99;
    if (rc !== EQ_OK) { setFlash(n, F_REFUSE, rf); say(refusalText(rc), C.ember); return false; }
    for (let k = 0; k < N_EQ; k++) if (nodes[k].slot === slot) setFlash(k, F_OK, slotCfg.flash.assign.ms);
    changed();
    return true;
  }
  function takeOff(n) {
    const node = nodes[n], v = inv(), e = eq();
    if (!v || !e || !wornId(node.slot)) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); return false; }
    const rc = unequipSlot(v, e, defs, node.slot, statsCache, why);
    if (rc !== EQ_OK) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); say(refusalText(rc), C.ember); return false; }
    setFlash(n, F_OK, slotCfg.flash.cleared.ms);
    changed();
    return true;
  }
  function eat(n, id) {
    const v = inv(), d = defs[id], h = o.healthOf ? o.healthOf() : null;
    if (!h) return;
    if (h.hp >= h.max) { say(d.use.fullHpToast || 'Not hurt', C.ember); setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); return; }
    h.hp = Math.min(h.max, h.hp + d.use.heal);
    removeItem(v, id, 1);
    setFlash(n, F_USE, slotCfg.flash.use.ms);
    say('Ate ' + itemDisplayName(d) + '  +' + d.use.heal + ' HP', C.heroGreen);
  }
  /** Spells and other hand-only items (no gear slot): Q = left hand, E / click = right hand; again = empty it. */
  function toHand(n, id, hand) {
    const v = inv();
    assignHand(v, hand, v[hand] === id ? null : id);
    setFlash(n, F_OK, slotCfg.flash.assign.ms);
    if (o.onHandsChanged) o.onHandsChanged();
  }
  /** E / Enter / click on a node: pack item -> eat / wear / hand; worn slot -> back to the pack. */
  function activate(n, hand) {
    const node = nodes[n], v = inv();
    if (!v || node.kind === 1) return;
    if (node.kind === 0) { takeOff(n); return; }
    const id = idAt(node);
    if (!id || slotDisabled(node.i)) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); return; }
    const d = defs[id];
    if (d.equip) { wear(n, null); return; }
    if (d.kind === 'food' && d.use && d.use.heal) { eat(n, id); return; }
    if (d.hand === true) { toHand(n, id, hand || 'right'); return; }
    say((d.use && d.use.none) || 'Nothing happens', C.uiDim);
    setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms);
  }
  /** Mouse release after a press on node `src`: same node = click, else drop on the node now under the cursor. */
  function release(src) {
    const s = nodes[src], dst = nodes[cur];
    if (cur === src || !dragMoved) { activate(src); return; }
    if (s.kind === 2) { // pack item -> a gear slot or Wick equips; elsewhere does nothing
      if (dst.kind === 0) wear(src, dst.slot); else if (dst.kind === 1) wear(src, null);
    } else if (s.kind === 0 && dst.kind !== 0) takeOff(src); // worn item -> pack / Wick unequips
    else if (s.kind === 0) setFlash(cur, F_REFUSE, slotCfg.flash.refuse.ms);
  }

  function move(dx, dy) {
    const c = nodes[cur];
    let best = -1, bestScore = 1e9;
    for (let k = 0; k < nodes.length; k++) {
      if (k === cur || (nodes[k].kind === 2 && slotDisabled(nodes[k].i))) continue;
      if (nodes[k].kind === 0 && !eq()) continue;
      const n = nodes[k], ax = (n.cx - c.cx) * dx + (n.cy - c.cy) * dy * 2.5; // rows are ~2.5x taller than cells are wide
      if (ax <= 0.5) continue;
      const px = dx !== 0 ? (n.cy - c.cy) * 2.5 : n.cx - c.cx;
      const sc = ax * ax + 3 * px * px;
      if (sc < bestScore) { bestScore = sc; best = k; }
    }
    if (best >= 0) cur = best;
  }
  function hit(x, y) {
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k];
      if (x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h) return (n.kind === 2 && slotDisabled(n.i)) ? -1 : k;
    }
    return -1;
  }
  function firstPack() {
    const v = inv();
    let first = -1;
    for (let i = 0; i < PACK_SLOTS; i++) if (!slotDisabled(i)) { if (first < 0) first = i; if (v && v.slots[i].id) { first = i; break; } }
    return PACK0 + (first < 0 ? 0 : first);
  }

  function doOpen() {
    isOpen = true; cur = firstPack(); pxLast = pyLast = -1; turning = false; dragSrc = -1; dragMoved = false; dragPx = 0;
    yaw.reset(); subj.yawDeg = 180; flash.kind = 0; tipCur = -1; refreshModel();
    if (o.onOpen) o.onOpen();
  }
  function doClose() { isOpen = false; page = 0; turning = false; dragSrc = -1; if (o.onClose) o.onClose(); }

  // ---- drawing helpers (hoisted: draw() must not create closures per frame) ----
  let U = null;
  const ox = P.x, oy = P.y, bg = P.bg;
  function put(x, y, code, fg, b) {
    x += ox; y += oy;
    if (x < 0 || y < 0 || x >= U.cols || y >= U.rows) return;
    U.setCellRGB(x, y, code - 32, fg[0], fg[1], fg[2], b[0], b[1], b[2]);
  }
  function text(x, y, s, fg, b) { for (let j = 0; j < s.length; j++) put(x + j, y, s.charCodeAt(j), fg, b); }
  /** one 9x5 slot box. `sel` = gold cursor style, borderFg = border colour (flash override), innerBg = interior */
  function box(bx, by, id, sel, borderFg, innerBg, handTag, count, borderOverride, dim) {
    const bd = borderOverride || slotCfg.border;
    const bc = (sel ? slotCfg.selected : bd).corner.charCodeAt(0), bh = (sel ? slotCfg.selected : bd).h.charCodeAt(0), bv = (sel ? slotCfg.selected : bd).v.charCodeAt(0);
    const fg = sel ? slotCfg.selected.fg : borderFg;
    for (let x = 1; x < sb.w - 1; x++) { put(bx + x, by, bh, fg, bg); put(bx + x, by + sb.h - 1, bh, fg, bg); }
    for (let y = 1; y < sb.h - 1; y++) { put(bx, by + y, bv, fg, bg); put(bx + sb.w - 1, by + y, bv, fg, bg); }
    put(bx, by, bc, fg, bg); put(bx + sb.w - 1, by, bc, fg, bg); put(bx, by + sb.h - 1, bc, fg, bg); put(bx + sb.w - 1, by + sb.h - 1, bc, fg, bg);
    for (let y = 0; y < ib.h; y++) for (let x = 0; x < ib.w; x++) put(bx + ib.x + x, by + ib.y + y, 32, C.uiText, innerBg);
    if (id && info[id]) iconAt(bx + slotCfg.icon.x, by + slotCfg.icon.y, id, innerBg, dim);
    if (handTag) put(bx + slotCfg.equippedTag.col, by + slotCfg.equippedTag.row, handTag.charCodeAt(0), slotCfg.equippedTag.fg, bg);
    if (count >= slotCfg.count.minN) { const s = cStr[count > 99 ? 99 : count]; text(bx + sb.w - 1 - s.length, by + sb.h - 1, s, slotCfg.count.fg, bg); }
  }
  const dimRgb = [0, 0, 0];
  function iconAt(x, y, id, b, dim) {
    const cells = info[id].cells;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const cl = cells[r * 5 + c]; if (!cl.rgb) continue;
      if (dim) { dimRgb[0] = cl.rgb[0] * 0.4; dimRgb[1] = cl.rgb[1] * 0.4; dimRgb[2] = cl.rgb[2] * 0.4; put(x + c, y + r, cl.code, dimRgb, b); } else put(x + c, y + r, cl.code, cl.rgb, b);
    }
  }
  /** OB-156: a locked pack cell under the mouse (the cursor itself still refuses it); its detail pane names the item + the lock reason. */
  let lockHover = -1, tipLock = -2;
  function lockedAt(x, y) {
    for (let k = nodes.length - 1; k >= 0; k--) { const n = nodes[k]; if (n.kind === 2 && x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h && slotDisabled(n.i)) return k; }
    return -1;
  }

  function buildTip(node, id, worn, lockText) {
    tipLines = []; tipFg = [];
    const add = (s, fg) => { tipLines.push(s); tipFg.push(fg); };
    if (node.kind === 1) { add('Wick', C.uiText); add('Drag a piece onto him to wear it. Turn him with A / D or the mouse.', C.uiDim); return; }
    const d = id && defs[id];
    if (!d) { add(node.kind === 0 ? 'Empty ' + slotLabel[node.slot].toLowerCase() + ' slot' : 'Empty', C.uiDim); return; }
    const q = d.equip, tier = q ? q.tier : null;
    const ent = node.kind === 2 && inv() ? inv().slots[node.i] : { id, it: null }; // pack slot may hold an instance
    const rar = ent.it != null ? rarityOf(ent, defs) : -1;
    add(itemName(ent, defs), rar >= 0 ? rarityFg[rar] : tier && tierFg[tier] ? tierFg[tier] : C.uiText);
    if (lockText) { add(lockText, C.uiDim); return; }
    if (q) {
      add((tierName[tier] || '') + ' ' + (slotLabel[q.slot] || q.slot).toLowerCase() + (q.def > 0 ? '  -  Defence ' + q.def : '') + (q.stats && q.stats.dmgMul ? '  -  Damage x' + q.stats.dmgMul : ''), C.uiHint);
      if (node.kind === 2) { // compare with what is worn in that slot
        const wd = worn && defs[worn], delta = (q.def || 0) - (wd && wd.equip ? wd.equip.def || 0 : 0);
        const vs = wd ? ' vs ' + wd.name : ' (slot empty)';
        add(delta > 0 ? 'Defence +' + delta + vs : delta < 0 ? 'Defence ' + delta + vs : 'Same defence' + vs, delta > 0 ? C.heroGreen : delta < 0 ? RED : C.uiDim);
      } else add('Worn  -  drag it to the pack, or press E', C.uiDim);
    } else if (d.kind === 'food' && d.use && d.use.heal) add('Food  -  E eats it (+' + d.use.heal + ' HP)', C.uiHint);
    else if (d.hand === true) add('Hand item  -  Q left hand, E right hand', C.uiHint);
    const rq = reqOf(ent, defs); // requirement line, red when the hero cannot meet it right now
    if (rq && node.kind === 2) {
      const e = eq(), t = e ? refreshTotals(statsCache, e, defs) : null, bad = t && (t.str < (rq.str || 0) || t.dex < (rq.dex || 0) || t.int < (rq.int || 0));
      add('Needs ' + [rq.str ? 'STR ' + rq.str : '', rq.dex ? 'DEX ' + rq.dex : '', rq.int ? 'INT ' + rq.int : ''].filter(Boolean).join('  '), bad ? RED : C.uiDim);
    }
    const inf = info[id];
    for (let i = 0; i < inf.lines.length && tipLines.length < L.details.rows; i++) add(inf.lines[i], C.uiText);
    while (tipLines.length > 0 && tipLines[tipLines.length - 1] === '') { tipLines.pop(); tipFg.pop(); }
  }

  const view = {
    get isOpen() { return isOpen; },
    get cursor() { return cur; },
    get nodes() { return nodes; },
    get yawDeg() { return yaw.yawDeg; },
    get previewOk() { return previewOk; },
    get rect() { return rect; },
    get dragging() { return dragSrc >= 0 && dragMoved; },
    /** the node under the cursor (kind 0 gear / 1 Wick / 2 pack) */
    get node() { return nodes[cur]; },
    /** item id under the cursor (worn piece or pack item), null on Wick / an empty cell; QB drag source */
    get hoverItemId() { return isOpen ? (page === 1 ? spIds()[spCur] || null : idAt(nodes[cur])) : null; }, // page 1: the spell row under the pointer (SPELLBOOK-02 drag source)
    open() { if (!isOpen) doOpen(); },
    close() { if (isOpen) doClose(); },

    /** Hover: UI-layer cell under the mouse. Only a changed cell moves the cursor (keyboard keeps it otherwise); while turning it only rotates Wick. */
    setPointer(px, py) {
      if (!isOpen || (px === pxLast && py === pyLast)) return;
      pxLast = px; pyLast = py; rx = px - ox; ry = py - oy;
      if (turning) { if (rxLast >= 0) dragPx += rx - rxLast; rxLast = rx; return; }
      rxLast = rx;
      if (page === 1) { const r = Math.floor((ry - 3) / 6); if (r >= 0 && r < spIds().length) spCur = r; return; } // spell rows are 6 lines apart from y 3
      const k = hit(rx, ry); lockHover = k >= 0 ? -1 : lockedAt(rx, ry);
      if (k >= 0 && !(k < N_EQ && !eq())) { if (k !== cur && dragSrc >= 0) dragMoved = true; cur = k; }
    },

    /** One fixed update (also while paused). `canOpen`: main.js says nothing else owns the screen. */
    step(dt, input, canOpen) {
      t += dt; dtAcc += dt;
      const kI = input.pressed('KeyI'), kC = charKey && input.pressed('KeyC'), kTab = input.pressed('Tab');
      if (!isOpen) {
        if (canOpen && (kI || kC || (kTab && o.tabOpens !== false))) { doOpen(); if (input.consumePressed) input.consumePressed(); }
        return;
      }
      if (input.pressed('Escape') || kI || kC || kTab) { doClose(); if (input.consumePressed) input.consumePressed(); return; }
      if (input.pressed('KeyB') && o.spellbook) { page ^= 1; if (input.consumePressed) input.consumePressed(); return; }
      if (page === 1) { spellStep(input); if (input.consumePressed) input.consumePressed(); return; }
      // 1-4 while an item is hovered / selected assigns it to that quick-bar slot
      if (o.quickbar) {
        for (let n = 0; n < 4; n++) {
          if (!input.pressed(DIGIT_CODES[n])) continue;
          const qid = idAt(nodes[cur]);
          if (!qid) say('Select an item first', C.uiDim);
          else if (o.quickbar.assign(n, qid)) say('Quick slot ' + (n + 1) + ': ' + (defs[qid] ? defs[qid].name : qid), C.heroGreen);
          else say('Cannot be placed on the quick bar', C.ember);
          if (input.consumePressed) input.consumePressed();
          return;
        }
      }
      const down = input.isDown ? (c) => input.isDown(c) : () => false;
      if (input.pressed('KeyW') || input.pressed('ArrowUp')) move(0, -1);
      if (input.pressed('KeyS') || input.pressed('ArrowDown')) move(0, 1);
      let dir = 0;
      if (cur === VIEW) dir = ((down('KeyD') || down('ArrowRight')) ? 1 : 0) - ((down('KeyA') || down('ArrowLeft')) ? 1 : 0);
      else {
        if (input.pressed('KeyA') || input.pressed('ArrowLeft')) move(-1, 0);
        if (input.pressed('KeyD') || input.pressed('ArrowRight')) move(1, 0);
      }
      // mouse: press on Wick = turn; press on an item = pick it up (click if it never leaves the cell, drop elsewhere)
      if (input.pressed('Mouse0')) {
        if (cur === VIEW) turning = true;
        else if (idAt(nodes[cur]) || nodes[cur].kind === 0) { dragSrc = cur; dragMoved = false; }
      }
      const held = down('Mouse0');
      if (turning && !held && !input.pressed('Mouse0')) turning = false;
      if (dragSrc >= 0 && !held) { const s = dragSrc; dragSrc = -1; release(s); dragMoved = false; }
      if (input.pressed('KeyE') || input.pressed('Enter') || input.pressed('NumpadEnter')) activate(cur);
      if (input.pressed('KeyQ')) activate(cur, 'left');
      const dp = dragPx; dragPx = 0;
      yaw.step(dt, dir, dp);
      yawAcc += dt; // the model is re-posed at most 10 Hz while turning (EQ-04 budget fix)
      if (yawAcc >= 0.1 && yaw.yawDeg !== subj.yawDeg) { subj.yawDeg = yaw.yawDeg; yawAcc = 0; }
      // every edge is eaten while open: several fixed steps per frame must not repeat one, and M / S / N never reach the map etc.
      if (input.consumePressed) input.consumePressed();
    },

    /** Whole-scene dim while open (uiStyle.inventory.sceneDim.bgMul). */
    pushDim(dim) { if (isOpen && dim && S.sceneDim.bgMul < dim.all) dim.all = S.sceneDim.bgMul; },

    /** @param {any} ui UiLayer (setCellRGB, cols, rows) */
    draw(ui) {
      if (!isOpen) return;
      const v = inv();
      if (!v) return;
      U = ui;
      const e = eq() || EMPTY_EQ;
      // panel fill + frame + title
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) put(x, y, 32, C.uiText, bg);
      const F = S.frame, fc = F.corner.charCodeAt(0), fh = F.h.charCodeAt(0), fv = F.v.charCodeAt(0);
      for (let x = 1; x < P.w - 1; x++) { put(x, 0, fh, F.fg, bg); put(x, P.h - 1, fh, F.fg, bg); }
      for (let y = 1; y < P.h - 1; y++) { put(0, y, fv, F.fg, bg); put(P.w - 1, y, fv, F.fg, bg); }
      put(0, 0, fc, F.cornerFg, bg); put(P.w - 1, 0, fc, F.cornerFg, bg); put(0, P.h - 1, fc, F.cornerFg, bg); put(P.w - 1, P.h - 1, fc, F.cornerFg, bg);
      text((P.w - F.title.text.length - 2) >> 1, 0, ' ' + F.title.text + ' ', F.title.fg, bg);
      text(F.pausedTag.col - 1, F.pausedTag.row, ' ' + F.pausedTag.text + ' ', F.pausedTag.fg, bg);
      text(L.pack.x + 1, L.titleRow, ' PACK ', slotCfg.selected.fg, bg);
      text(L.view.x + 9, L.titleRow, ' WICK ', slotCfg.selected.fg, bg);
      for (let y = 2; y < 27; y++) put(L.sepCol, y, 58, C.uiDim, bg); // ':'
      // Wick: view box frame + the lit model
      const vn = nodes[VIEW], vsel = cur === VIEW, bd = slotCfg.border, vfg = vsel ? slotCfg.selected.fg : bd.fg;
      for (let x = 1; x < vn.w - 1; x++) { put(vn.x + x, vn.y, bd.h.charCodeAt(0), vfg, bg); put(vn.x + x, vn.y + vn.h - 1, bd.h.charCodeAt(0), vfg, bg); }
      for (let y = 1; y < vn.h - 1; y++) { put(vn.x, vn.y + y, bd.v.charCodeAt(0), vfg, bg); put(vn.x + vn.w - 1, vn.y + y, bd.v.charCodeAt(0), vfg, bg); }
      for (let c = 0; c < 4; c++) put(vn.x + (c & 1) * (vn.w - 1), vn.y + (c >> 1) * (vn.h - 1), bd.corner.charCodeAt(0), vfg, bg);
      rect.x = ox + vn.x + 1; rect.y = oy + vn.y + 1;
      if (preview && previewOk) {
        try { preview.render(subj, dtAcc, ui, rect); } catch (err) { previewOk = false; if (typeof console !== 'undefined') console.warn('[inventory] preview render:', err && err.message); }
        dtAcc = 0;
      } else text(vn.x + 3, vn.y + 7, '(no preview)', C.uiDim, bg);
      // gear slots + pack cells (non-selected first so the cursor box wins shared edges)
      const flashOn = t < flash.until, hasEq = !!eq();
      for (let pass = 0; pass < 2; pass++) {
        for (let n = 0; n < nodes.length; n++) {
          const node = nodes[n];
          if (node.kind === 1 || (node.kind === 0 && !hasEq)) continue;
          const isSel = cur === n;
          if (pass !== (isSel ? 1 : 0)) continue;
          let bf = bd.fg, ibg = isSel ? slotCfg.selected.innerBg : slotCfg.innerBg;
          if (node.kind === 2 && slotDisabled(node.i)) {
            const held = idAt(node);
            if (held && info[held]) box(node.x, node.y, held, false, disabledSlot.fg, disabledSlot.innerBg, null, 0, disabledSlot, true); // OB-156: item stays visible, dimmed, no x
            else if (disabledSlot) { box(node.x, node.y, null, false, disabledSlot.fg, disabledSlot.innerBg, null, 0, disabledSlot); put(node.x + disabledSlot.x, node.y + disabledSlot.y, disabledSlot.glyph.charCodeAt(0), disabledSlot.glyphFg, disabledSlot.innerBg); }
            continue;
          }
          const id = idAt(node), d = id && defs[id];
          if (node.kind === 0 && d && d.equip && tierFg[d.equip.tier]) bf = tierFg[d.equip.tier];
          if (flashOn && flash.node === n) {
            if (flash.kind === F_REFUSE) bf = slotCfg.flash.refuse.borderFg; else if (flash.kind === F_USE) ibg = slotCfg.flash.use.innerBg; else bf = slotCfg.flash.assign.borderFg;
          }
          const tag = node.kind === 2 && id ? (v.left === id ? 'L' : v.right === id && !(d && d.equip) ? 'R' : null) : null;
          box(node.x, node.y, id, isSel, bf, ibg, tag, node.kind === 0 && node.slot === 'quiver' && e.quiver ? e.quiver.n : 0, null);
          if (!id) put(node.x + slotCfg.empty.x, node.y + slotCfg.empty.y, slotCfg.empty.glyph.charCodeAt(0), slotCfg.empty.fg, ibg);
          if (node.kind === 0) text(node.x + 1, node.y, slotTag[node.slot], isSel ? slotCfg.selected.fg : C.uiHint, bg);
        }
      }
      for (let i = 0; i < PACK_SLOTS; i++) { // counts last: they sit on the bottom border the next row overwrites
        const s = v.slots[i];
        if (s.id && s.n >= slotCfg.count.minN && !slotDisabled(i)) { const nd = nodes[PACK0 + i], str = cStr[s.n > 99 ? 99 : s.n]; text(nd.x + sb.w - 1 - str.length, nd.y + sb.h - 1, str, slotCfg.count.fg, bg); }
      }
      // stats under Wick: HP / DEF / DMG (+ arrows)
      const h = o.healthOf ? o.healthOf() : null, def = defenceOf(e, defs), arrows = e.quiver ? e.quiver.n : 0;
      const md = e.main && defs[e.main] && defs[e.main].equip && defs[e.main].equip.stats ? defs[e.main].equip.stats.dmgMul || 1 : 1;
      const hp = h ? h.hp : -2, hmax = h ? h.max : -2;
      if (hp !== sHp || hmax !== sMax || def !== sDef || arrows !== sArr || md !== sDmg) {
        sHp = hp; sMax = hmax; sDef = def; sArr = arrows; sDmg = md;
        stat1 = 'HP ' + (h ? Math.ceil(h.hp) + '/' + Math.ceil(h.max) : '-') + '   DEF ' + def + ' (-' + Math.round(reductionOf(def) * 100) + '%)';
        stat2 = 'DMG x' + (Math.round(md * 100) / 100) + '   Arrows ' + arrows;
      }
      text(L.stats.x, L.stats.y, stat1, C.uiText, bg); text(L.stats.x, L.stats.y + 1, stat2, C.uiText, bg);
      // details of the item under the cursor, under the pack
      const lk = lockHover >= 0 && slotDisabled(nodes[lockHover].i) && idAt(nodes[lockHover]) ? lockHover : -1;
      if (lk >= 0 && (tipLock !== lk || tipCur !== -3)) { tipLock = lk; tipCur = -3; tipId = null; buildTip(nodes[lk], idAt(nodes[lk]), null, o.slotLockText ? o.slotLockText(nodes[lk].i) : 'Locked'); }
      else if (lk < 0) tipLock = -2;
      const node = nodes[cur], id = idAt(node), worn = node.kind === 2 && id && defs[id] && defs[id].equip ? wornId(defs[id].equip.slot) : null;
      if (lk < 0 && (cur !== tipCur || id !== tipId || worn !== tipWorn || def !== tipDef)) { tipCur = cur; tipId = id; tipWorn = worn; tipDef = def; buildTip(node, id, worn); }
      for (let i = 0; i < tipLines.length; i++) text(L.details.x, L.details.y + i, tipLines[i], tipFg[i], bg);
      // the dragged icon rides the pointer
      if (dragSrc >= 0 && dragMoved) { const did = idAt(nodes[dragSrc]); if (did) iconAt(rx - 2, ry - 1, did, slotCfg.selected.innerBg); }
      if (page === 1) drawSpellbook(); // over the pack grid + details
      drawHints();
    },
  };
  function drawHints() { // key hints (gold keys); no Esc text anywhere
      let hl = 0; for (let i = 0; i < HINTS.length; i++) hl += HINTS[i][0].length;
      let hx = (P.w - hl) >> 1;
      for (let i = 0; i < HINTS.length; i++) { text(hx, L.hintRow, HINTS[i][0], HINTS[i][1] ? S.keyHints.keyFg : S.keyHints.fg, bg); hx += HINTS[i][0].length; }
  }
  return view;
}
