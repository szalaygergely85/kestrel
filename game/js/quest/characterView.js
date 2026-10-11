// game/js/quest/characterView.js (EQ-03 + EQ-04a wiring, docs/architecture.md 38.40). The "Character" tab of the pack menu.
// inventoryView.js owns open/close/tab switching and the panel frame; this module owns everything inside the panel on
// tab 1: 11 equipment slots around the lit player model (modelPreview, CPU mini-stage copied into the UI layer), the pack
// grid at the right, the stats line `Hearts / Defence (-n%) / Arrows`, a tooltip with tier colour + compare delta.
// Sim calls come from sim/equipment.js (equip/unequip/defenceOf); view-only yaw from previewYaw.js. No allocation in draw()
// except when the cursor / gear / stats change (strings are rebuilt then, cached otherwise). No text mentions Esc (owner rule).
import { equip as eqEquip, unequip as eqUnequip, syncHands, defenceOf, reductionOf } from './sim/equipment.js';
import { SLOTS as PACK_SLOTS } from './sim/inventory.js';
import { gearRecipe } from './gearLook.js';
import { createPreviewYaw } from './previewYaw.js';

// Panel-relative layout (panel = 100 x 29 at UI (30,15)). Slot boxes are the pack's 9x5 boxes. EQ-D2's `uiStyle.character`
// is not merged yet, so these numbers live here; `o.layout` can override any of them once the designer's data lands.
export const LAYOUT = Object.freeze({
  // [slot, x, y, label]: 3 left, 3 right, the bottom row of 5 touches the view box
  slots: Object.freeze([
    ['head', 1, 3, 'Head'], ['body', 1, 8, 'Chest'], ['hands', 1, 13, 'Gloves'],
    ['legs', 33, 3, 'Legs'], ['feet', 33, 8, 'Boots'], ['cloak', 33, 13, 'Cloak'],
    ['belt', 1, 18, 'Belt'], ['main', 9, 18, 'Main'], ['off', 17, 18, 'Off'], ['ranged', 25, 18, 'Ranged'], ['quiver', 33, 18, 'Quiver'],
  ]),
  view: Object.freeze({ x: 10, y: 3, w: 23, h: 15 }), // frame; the model fills the interior (x+1, y+1, w-2, h-2)
  pack: Object.freeze({ x: 50, y: 3 }),                // 6 x 4, pitch from uiStyle.inventory.grid
  sepCol: 45, stats: Object.freeze({ x: 2, y: 24 }), tip: Object.freeze({ x: 47, y: 21, w: 50 }), hintRow: 27, tabRow: 1,
});
const RED = [230, 80, 70];
const N_EQ = 11, VIEW = N_EQ, PACK0 = N_EQ + 1;
const F_REFUSE = 1, F_OK = 2;

/**
 * @param {object} o
 * @param {any} o.style `ASSETS.uiStyle.inventory`   @param {any} o.items `ASSETS.items`
 * @param {() => any} o.inventoryOf @param {() => any} o.equipmentOf `player.components.equipment`
 * @param {() => ({hp:number,max:number}|null)} [o.healthOf] @param {number} [o.hpPerHeart] HP per heart (default 10)
 * @param {() => any} [o.createPreview] lazy `createModelPreview(...)` (first open of the tab) @param {{get:Function}} [o.charCache]
 * @param {() => any} [o.getLook] the player's chargen look @param {() => void} [o.onGearChanged] after an equip / unequip
 * @param {{say?: Function}|null} [o.toast] @param {(i:number)=>boolean} [o.isSlotDisabled]
 */
export function createCharacterView(o) {
  const S = o.style, C = S.rgb, defs = o.items.defs, slotCfg = S.slot, G = S.grid, L = Object.assign({}, LAYOUT, o.layout || {});
  const perHeart = o.hpPerHeart || 10;
  const tierFg = { worn: C.uiHint, sturdy: C.heroGreen, fine: C.gold };
  const tierName = { worn: 'Worn', sturdy: 'Sturdy', fine: 'Fine' };
  const slotLabel = {}, slotTag = {}; for (const s of L.slots) { slotLabel[s[0]] = s[3]; slotTag[s[0]] = s[3].length < 7 ? s[3] + ' ' : s[3]; }
  const cStr = []; for (let n = 0; n < 100; n++) cStr.push('x' + n);

  // ---- navigation nodes: 11 equipment slots, the view box, the 24 pack cells ----
  const nodes = [];
  for (const s of L.slots) nodes.push({ kind: 0, slot: s[0], i: -1, x: s[1], y: s[2], w: slotCfg.box.w, h: slotCfg.box.h });
  nodes.push({ kind: 1, slot: 'view', i: -1, x: L.view.x, y: L.view.y, w: L.view.w, h: L.view.h });
  for (let i = 0; i < PACK_SLOTS; i++) {
    nodes.push({ kind: 2, slot: 'pack', i, x: L.pack.x + (i % G.cols) * G.pitchX, y: L.pack.y + ((i / G.cols) | 0) * G.pitchY, w: slotCfg.box.w, h: slotCfg.box.h });
  }
  for (const n of nodes) { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; }
  const rect = { x: 0, y: 0, w: L.view.w - 2, h: L.view.h - 2 }; // absolute UI cells, set on first draw
  const subj = { yawDeg: 180 };
  const yaw = createPreviewYaw();

  let isOpen = false, cur = VIEW, preview = null, previewOk = false, curDef = null;
  let dragging = false, dragPx = 0, pxLast = -1, dtAcc = 0, yawAcc = 0;
  const flash = { node: -1, kind: 0, until: 0 };
  let t = 0;
  // cached strings (rebuilt only when their key changes)
  let sHp = -1, sMax = -1, sDef = -1, sArr = -1, statsText = '', tipCur = -1, tipId = null, tipWorn = null, tipDef = -1, tipLines = [], tipFg = [];

  const inv = () => o.inventoryOf();
  const eq = () => o.equipmentOf();
  const slotDisabled = (i) => !!o.isSlotDisabled && o.isSlotDisabled(i);
  const say = (text, fg) => { if (o.toast && o.toast.say) o.toast.say(text, fg); };

  function wornId(slot) { const e = eq(); if (!e) return null; if (slot === 'quiver') return e.quiver ? e.quiver.id : null; return e[slot] || null; }
  function idAt(node) {
    if (node.kind === 0) return wornId(node.slot);
    if (node.kind === 2) { const v = inv(); const s = v && v.slots[node.i]; return s && s.id ? s.id : null; }
    return null;
  }
  function setFlash(n, kind, ms) { flash.node = n; flash.kind = kind; flash.until = t + ms / 1000; }

  /** Recompose the player model from look + worn gear (cache: once per distinct recipe). Called on open and after a change. */
  function refreshModel() {
    if (!o.createPreview || !o.charCache || !o.getLook) return;
    try {
      if (!preview) preview = o.createPreview();
      const def = o.charCache.get(gearRecipe(o.getLook(), eq(), defs));
      if (def !== curDef) { preview.setModel('char.preview', def); curDef = def; }
      previewOk = true;
    } catch (e) { previewOk = false; if (typeof console !== 'undefined') console.warn('[character] preview off:', e && e.message); }
  }

  function changed() {
    const v = inv(), e = eq();
    if (v && e) syncHands(v, e);
    if (o.onGearChanged) o.onGearChanged();
    refreshModel();
    tipCur = -1;
  }

  /** E / Enter / click on a node. Pack item -> wear it; worn slot -> back to the pack; anything else refuses. */
  function activate(n) {
    const node = nodes[n], v = inv(), e = eq();
    if (!v || !e || node.kind === 1) return;
    if (node.kind === 2) {
      const id = idAt(node);
      if (!id || slotDisabled(node.i) || !defs[id] || !defs[id].equip) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); return; }
      const slot = defs[id].equip.slot;
      if (!eqEquip(v, e, defs, id)) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); say('Cannot wear that now', C.ember); return; }
      for (let k = 0; k < N_EQ; k++) if (nodes[k].slot === slot) setFlash(k, F_OK, slotCfg.flash.assign.ms);
      changed();
    } else {
      if (!wornId(node.slot)) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); return; }
      if (!eqUnequip(v, e, defs, node.slot)) { setFlash(n, F_REFUSE, slotCfg.flash.refuse.ms); say('Pack is full', C.ember); return; }
      setFlash(n, F_OK, slotCfg.flash.cleared.ms);
      changed();
    }
  }

  function move(dx, dy) {
    const c = nodes[cur];
    let best = -1, bestScore = 1e9;
    for (let k = 0; k < nodes.length; k++) {
      if (k === cur || (nodes[k].kind === 2 && slotDisabled(nodes[k].i))) continue;
      const n = nodes[k], ax = (n.cx - c.cx) * dx + (n.cy - c.cy) * dy * 2.5; // rows are ~2.5x taller than cells are wide
      if (ax <= 0.5) continue;
      const px = dx !== 0 ? (n.cy - c.cy) * 2.5 : n.cx - c.cx;
      const sc = ax * ax + 3 * px * px;
      if (sc < bestScore) { bestScore = sc; best = k; }
    }
    if (best >= 0) cur = best;
  }

  function hit(rx, ry) {
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k];
      if (rx >= n.x && rx < n.x + n.w && ry >= n.y && ry < n.y + n.h) return k;
    }
    return -1;
  }

  const view = {
    get isOpen() { return isOpen; },
    get cursor() { return cur; },
    get nodes() { return nodes; },
    get yawDeg() { return yaw.yawDeg; },
    get previewOk() { return previewOk; },
    get rect() { return rect; },
    open() { isOpen = true; cur = VIEW; dragging = false; dragPx = 0; yaw.reset(); subj.yawDeg = 180; flash.kind = 0; tipCur = -1; refreshModel(); },
    close() { isOpen = false; dragging = false; },

    /** Hover (panel-relative cell). Moves the cursor onto the node under the mouse; while dragging the view it only turns the model. */
    setPointer(rx, ry) {
      if (dragging) { if (pxLast >= 0) dragPx += rx - pxLast; pxLast = rx; return; }
      pxLast = rx;
      const k = hit(rx, ry);
      if (k >= 0) cur = k;
    },

    /** One fixed update while the tab is open (edges are consumed by inventoryView). */
    step(dt, input) {
      t += dt; dtAcc += dt;
      const down = input.isDown ? (c) => input.isDown(c) : () => false;
      if (input.pressed('KeyW') || input.pressed('ArrowUp')) move(0, -1);
      if (input.pressed('KeyS') || input.pressed('ArrowDown')) move(0, 1);
      let dir = 0;
      if (cur === VIEW) dir = ((down('KeyD') || down('ArrowRight')) ? 1 : 0) - ((down('KeyA') || down('ArrowLeft')) ? 1 : 0);
      else {
        if (input.pressed('KeyA') || input.pressed('ArrowLeft')) move(-1, 0);
        if (input.pressed('KeyD') || input.pressed('ArrowRight')) move(1, 0);
      }
      if (input.pressed('Mouse0')) {
        if (cur === VIEW) dragging = true; else activate(cur);
      }
      if (dragging && !down('Mouse0') && !input.pressed('Mouse0')) dragging = false;
      if (input.pressed('KeyE') || input.pressed('Enter') || input.pressed('NumpadEnter')) activate(cur);
      const dp = dragPx; dragPx = 0;
      yaw.step(dt, dir, dp);
      yawAcc += dt; // the model is re-posed at most 10 Hz while turning (EQ-04 budget fix)
      if (yawAcc >= 0.1 && yaw.yawDeg !== subj.yawDeg) { subj.yawDeg = yaw.yawDeg; yawAcc = 0; }
    },

    /** @param {{put:Function,text:Function,box:Function,info:(id:string)=>any,ui:any,ox:number,oy:number,bg:number[]}} k inventoryView's drawing kit */
    draw(k) {
      const v = inv(), e = eq();
      if (!v || !e) return;
      const { put, text, box, bg } = k;
      const sb = slotCfg.box;
      // separator between the paper doll and the pack
      for (let y = 2; y < 27; y++) put(L.sepCol, y, 58, C.uiDim, bg); // ':'
      // view box frame + the lit model
      const vn = nodes[VIEW], vsel = cur === VIEW;
      const bd = slotCfg.border, vfg = vsel ? slotCfg.selected.fg : bd.fg;
      for (let x = 1; x < vn.w - 1; x++) { put(vn.x + x, vn.y, bd.h.charCodeAt(0), vfg, bg); put(vn.x + x, vn.y + vn.h - 1, bd.h.charCodeAt(0), vfg, bg); }
      for (let y = 1; y < vn.h - 1; y++) { put(vn.x, vn.y + y, bd.v.charCodeAt(0), vfg, bg); put(vn.x + vn.w - 1, vn.y + y, bd.v.charCodeAt(0), vfg, bg); }
      put(vn.x, vn.y, bd.corner.charCodeAt(0), vfg, bg); put(vn.x + vn.w - 1, vn.y, bd.corner.charCodeAt(0), vfg, bg);
      put(vn.x, vn.y + vn.h - 1, bd.corner.charCodeAt(0), vfg, bg); put(vn.x + vn.w - 1, vn.y + vn.h - 1, bd.corner.charCodeAt(0), vfg, bg);
      rect.x = k.ox + vn.x + 1; rect.y = k.oy + vn.y + 1;
      if (preview && previewOk) {
        try { preview.render(subj, dtAcc, k.ui, rect); } catch (err) { previewOk = false; if (typeof console !== 'undefined') console.warn('[character] preview render:', err && err.message); }
        dtAcc = 0;
      } else text(vn.x + 3, vn.y + 7, '(no preview)', C.uiDim, bg);
      // equipment slots (non-selected first so the cursor box wins shared edges), then the pack cells
      const flashOn = t < flash.until;
      for (let pass = 0; pass < 2; pass++) {
        for (let n = 0; n < nodes.length; n++) {
          const node = nodes[n];
          if (node.kind === 1) continue;
          const isSel = cur === n;
          if (pass !== (isSel ? 1 : 0)) continue;
          const id = idAt(node);
          let bf = slotCfg.border.fg, ibg = isSel ? slotCfg.selected.innerBg : slotCfg.innerBg;
          if (node.kind === 2 && slotDisabled(node.i)) { box(node.x, node.y, null, false, bf, ibg, false, null, 0); continue; }
          const d = id && defs[id];
          if (node.kind === 0 && d && d.equip && tierFg[d.equip.tier]) bf = tierFg[d.equip.tier];
          if (flashOn && flash.node === n) bf = flash.kind === F_REFUSE ? slotCfg.flash.refuse.borderFg : slotCfg.flash.assign.borderFg;
          const count = node.kind === 0 && node.slot === 'quiver' && e.quiver ? e.quiver.n : 0;
          box(node.x, node.y, id, isSel, bf, ibg, false, null, count);
          if (!id) put(node.x + slotCfg.empty.x, node.y + slotCfg.empty.y, slotCfg.empty.glyph.charCodeAt(0), slotCfg.empty.fg, ibg);
          if (node.kind === 0) text(node.x + 1, node.y, slotTag[node.slot], isSel ? slotCfg.selected.fg : C.uiHint, bg);
        }
      }
      for (let i = 0; i < PACK_SLOTS; i++) { // counts last: they sit on the bottom border the next row overwrites
        const s = v.slots[i];
        if (s.id && s.n >= slotCfg.count.minN && !slotDisabled(i)) { const nd = nodes[PACK0 + i], str = cStr[s.n > 99 ? 99 : s.n]; text(nd.x + sb.w - 1 - str.length, nd.y + sb.h - 1, str, slotCfg.count.fg, bg); }
      }
      // stats line
      const h = o.healthOf ? o.healthOf() : null, def = defenceOf(e, defs), arrows = e.quiver ? e.quiver.n : 0;
      const hp = h ? h.hp : -2, hmax = h ? h.max : -2;
      if (hp !== sHp || hmax !== sMax || def !== sDef || arrows !== sArr) {
        sHp = hp; sMax = hmax; sDef = def; sArr = arrows;
        const pct = Math.round(reductionOf(def) * 100);
        statsText = 'Hearts ' + (h ? Math.ceil(h.hp / perHeart) + '/' + Math.ceil(h.max / perHeart) : '-') + '  /  Defence ' + def + ' (-' + pct + '%)  /  Arrows ' + arrows;
      }
      text(L.stats.x, L.stats.y, statsText, C.uiText, bg);
      // tooltip
      const node = nodes[cur], id = idAt(node), worn = node.kind === 2 && id && defs[id] && defs[id].equip ? wornId(defs[id].equip.slot) : null;
      if (cur !== tipCur || id !== tipId || worn !== tipWorn || def !== tipDef) { tipCur = cur; tipId = id; tipWorn = worn; tipDef = def; buildTip(node, id, worn, k.info); }
      for (let i = 0; i < tipLines.length; i++) text(L.tip.x, L.tip.y + i, tipLines[i], tipFg[i], bg);
      // key hints (gold keys); no Esc text anywhere
      const hy = L.hintRow, segs = HINTS;
      let hl = 0; for (let i = 0; i < segs.length; i++) hl += segs[i][0].length;
      let hx = (100 - hl) >> 1;
      for (let i = 0; i < segs.length; i++) { text(hx, hy, segs[i][0], segs[i][1] ? S.keyHints.keyFg : S.keyHints.fg, bg); hx += segs[i][0].length; }
    },
  };

  function buildTip(node, id, worn, info) {
    tipLines = []; tipFg = [];
    const add = (s, fg) => { tipLines.push(s); tipFg.push(fg); };
    if (node.kind === 1) { add('Your look', C.uiText); add('Turn it with A / D or drag the mouse.', C.uiDim); return; }
    const d = id && defs[id];
    if (!d) { add(node.kind === 0 ? 'Empty ' + slotLabel[node.slot].toLowerCase() + ' slot' : 'Empty', C.uiDim); return; }
    const q = d.equip, tier = q ? q.tier : null, fg = tier && tierFg[tier] ? tierFg[tier] : C.uiText;
    add(d.name, fg);
    if (q) {
      add((tierName[tier] || '') + ' ' + (slotLabel[q.slot] || q.slot).toLowerCase() + (q.def > 0 ? '  -  Defence ' + q.def : ''), C.uiHint);
      if (node.kind === 2) { // compare with what is worn in that slot
        const wd = worn && defs[worn];
        const delta = (q.def || 0) - (wd && wd.equip ? wd.equip.def || 0 : 0);
        const vs = wd ? ' vs ' + wd.name : ' (slot empty)';
        add(delta > 0 ? 'Defence +' + delta + vs : delta < 0 ? 'Defence ' + delta + vs : 'Same defence' + vs, delta > 0 ? C.heroGreen : delta < 0 ? RED : C.uiDim);
      } else add('Worn  -  press E to take it off', C.uiDim);
    } else add(node.kind === 2 ? 'Cannot be worn' : '', C.uiDim);
    const inf = info(id);
    if (inf) for (let i = 0; i < inf.lines.length; i++) add(inf.lines[i], C.uiText);
    while (tipLines.length > 0 && tipLines[tipLines.length - 1] === '') { tipLines.pop(); tipFg.pop(); }
  }
  return view;
}

const HINTS = [['W/A/S/D', true], [' select   ', false], ['E', true], [' wear / take off   ', false], ['A/D', true], [' turn   ', false], ['Tab', true], [' items   ', false], ['C', true], [' close', false]];
