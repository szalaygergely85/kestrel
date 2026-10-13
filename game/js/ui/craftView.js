// CRAFT-VIEW-01 (S8-C-10 follow-up): crafting list over the shipped crafting sim (sim/crafting.js).
// Same shape/input conventions as quest/inventoryView.js: `{step, draw, open, close, pushDim}`; step runs per
// fixed update (reads edges, eats them while open), draw only walks prebuilt strings and calls ui.setCellRGB
// (zero allocation per frame). Not mounted: main.js needs view.step/draw + open() from a key = NEEDS B1.
import { countOf } from '../quest/sim/inventory.js';
import { CRAFT_TEXT } from './craftText.js';

const W = 60, ROW_H = 3, TOP = 3; // panel width in cells; each recipe = name row + ingredient row + gap
const numStr = []; for (let n = 0; n < 100; n++) numStr.push(String(n));

/**
 * @param {object} o
 * @param {{canCraft:Function, craft:Function}} o.crafting createCrafting(...) instance
 * @param {Array<{id:string,inputs:{item:string,n:number}[],output:{item:string,n:number}}>} o.recipes
 * @param {Record<string,{name:string}>} o.defs item defs (ASSETS.items.defs)
 * @param {Record<string,number[]>} o.rgb uiStyle.inventory.rgb (panel, uiText, uiDim, gold, ember, heroGreen)
 * @param {() => any} o.inventoryOf the player's inventory (or null)
 * @param {{say?:(t:string,fg:number[])=>void}|null} [o.toast]
 * @param {() => void} [o.onOpen]
 * @param {() => void} [o.onClose]
 */
export function createCraftView(o) {
  const C = o.rgb, bg = C.panel, list = o.recipes, n = list.length;
  const T = CRAFT_TEXT;
  const nameOf = id => (o.defs[id] && o.defs[id].name) || id;
  // per-recipe prebuilt strings (construct time)
  const rows = list.map(r => ({
    id: r.id,
    title: nameOf(r.output.item) + (r.output.n > 1 ? ' x' + r.output.n : ''),
    made: T.made.replace('{name}', nameOf(r.output.item)),
    inputs: r.inputs.map(i => ({ item: i.item, need: i.n, name: nameOf(i.item) })),
  }));
  const H = TOP + Math.max(1, n) * ROW_H + 4, resultRow = H - 3, hintRow = H - 2;
  let isOpen = false, sel = 0, result = T.pickOne, resultFg = C.uiDim;
  let U = null, ox = 0, oy = 0;

  function put(x, y, ch, fg, b) {
    x += ox; y += oy;
    if (x < 0 || y < 0 || x >= U.cols || y >= U.rows) return;
    U.setCellRGB(x, y, ch - 32, fg[0], fg[1], fg[2], b[0], b[1], b[2]);
  }
  function text(x, y, s, fg) { for (let j = 0; j < s.length; j++) put(x + j, y, s.charCodeAt(j), fg, bg); return x + s.length; }

  function doCraft() {
    const inv = o.inventoryOf();
    if (!inv || !n) return;
    const res = o.crafting.craft(inv, rows[sel].id);
    if (res.ok) { result = rows[sel].made; resultFg = C.heroGreen; if (o.toast && o.toast.say) o.toast.say(result, C.heroGreen); }
    else {
      result = res.reason === 'missing-inputs' ? T.missing : res.reason === 'output-full' ? T.full : T.unknown;
      resultFg = C.ember;
    }
  }

  const view = {
    get isOpen() { return isOpen; },
    get selected() { return sel; },
    get resultLine() { return result; },
    open() { if (isOpen) return; isOpen = true; sel = 0; result = T.pickOne; resultFg = C.uiDim; if (o.onOpen) o.onOpen(); },
    close() { if (!isOpen) return; isOpen = false; if (o.onClose) o.onClose(); },
    /** One fixed update. No-op while closed (opening is the host's call: view.open()). */
    step(dt, input) {
      if (!isOpen) return;
      if (input.pressed('Escape')) view.close();
      else {
        if (n && (input.pressed('KeyW') || input.pressed('ArrowUp'))) sel = (sel + n - 1) % n;
        if (n && (input.pressed('KeyS') || input.pressed('ArrowDown'))) sel = (sel + 1) % n;
        if (input.pressed('Enter') || input.pressed('NumpadEnter')) doCraft();
      }
      if (input.consumePressed) input.consumePressed();
    },
    pushDim(dim) { if (isOpen && dim && 0.35 < dim.all) dim.all = 0.35; },
    draw(ui) {
      if (!isOpen) return;
      const inv = o.inventoryOf();
      if (!inv) return;
      U = ui; ox = (ui.cols - W) >> 1; oy = (ui.rows - H) >> 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 32, C.uiText, bg);
      for (let x = 1; x < W - 1; x++) { put(x, 0, 45, C.uiDim, bg); put(x, H - 1, 45, C.uiDim, bg); }
      for (let y = 1; y < H - 1; y++) { put(0, y, 124, C.uiDim, bg); put(W - 1, y, 124, C.uiDim, bg); }
      text((W - T.title.length) >> 1, 0, T.title, C.gold);
      if (!n) text(3, TOP, T.empty, C.uiDim);
      for (let i = 0; i < n; i++) {
        const r = rows[i], y = TOP + i * ROW_H, ok = o.crafting.canCraft(inv, r.id);
        const main = ok ? C.uiText : C.uiDim; // unavailable = dimmed
        if (i === sel) text(1, y, '>', C.gold);
        text(3, y, r.title, i === sel && ok ? C.gold : main);
        let x = 5;
        for (let k = 0; k < r.inputs.length; k++) {
          const inp = r.inputs[k], have = countOf(inv, inp.item);
          const fg = have < inp.need ? C.ember : C.uiDim; // missing items stand out in ember
          x = text(x, y + 1, inp.name + ' ', fg);
          x = text(x, y + 1, numStr[have > 99 ? 99 : have], fg);
          x = text(x, y + 1, '/', fg);
          x = text(x, y + 1, numStr[inp.need > 99 ? 99 : inp.need], fg);
          x += 2;
        }
      }
      text(3, resultRow, result, resultFg);
      text(3, hintRow, T.hint, C.uiDim);
    },
  };
  return view;
}
