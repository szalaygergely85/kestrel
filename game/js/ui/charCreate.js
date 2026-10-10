// CHARGEN-17: new-game character creation screen in the title-menu skin (docs/architecture.md 38.29 item 5).
// Pure view + state: the host (titleMenuHost.js) feeds keys and draws; no DOM, so the flow runs in Node (charCreate.test.js).
// Rows: Skin / Eyes / Height / Age, then one pair (item, colour) per kit slot that has items (hair, clothes appear once the
// kit ships them), then Random / Confirm / Back. Confirm builds `char.player` (the in-game look) and hands the recipe out.
import { drawText, randomRecipe, validateRecipe, composeCharacter, meshCharacter, collapseRig, HUMANOID_PART_MAP, riggedModelDef, SLOTS, HEIGHT_MIN, HEIGHT_MAX, AGES } from '../../../engine/index.js';

const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
const dyeGroup = (slot) => (slot === 'beard' ? 'hair' : slot);
const slotItems = (kit, slot) => [...new Set([...(kit.shells || []), ...(kit.attachments || [])].filter((i) => i.slot === slot).map((i) => i.id))];

/** The runtime player model def (same chain as an imported .glb): look -> {voxel: RiggedVoxelDef}. Throws on a bad recipe. */
export function buildPlayerModel(kit, look) {
  const { errors } = validateRecipe(kit, look);
  if (errors.length) throw new Error('charCreate: ' + errors[0]);
  return riggedModelDef(collapseRig(meshCharacter(composeCharacter(kit, look)), kit.partMap || HUMANOID_PART_MAP));
}

/**
 * @param {{kit:object, style?:object, seed?:number, initial?:object, colorOf?:(matKey:string)=>string, register?:(def:object)=>void}} o
 *   colorOf maps a palette material key to a CSS colour (hand preview swatches); register receives the char.player def on Confirm.
 */
export function createCharCreate({ kit, style = null, seed = 1, initial = null, colorOf = null, register = null }) {
  if (!kit || !kit.ramps || !kit.defaults) throw new Error('charCreate: kit required');
  let look = JSON.parse(JSON.stringify(initial || kit.defaults));
  let nextSeed = seed >>> 0, selected = 0, action = null, message = '';
  const keyOf = (key) => (style && (style.hex[key] || style.bg[key])) || '#d8d0b8';
  const rampIds = (g) => Object.keys((kit.ramps || {})[g] || {});
  const cycle = (arr, cur, d) => arr[(Math.max(0, arr.indexOf(cur)) + d + arr.length) % arr.length];

  // row = {id, label, get():string, step(d)}
  const rows = [];
  const add = (id, label, get, step) => rows.push({ id, label, get, step });
  add('skin', 'Skin', () => look.skin, (d) => { look.skin = cycle(rampIds('skin'), look.skin, d); });
  add('eyes', 'Eyes', () => look.eyes, (d) => { look.eyes = cycle(rampIds('eyes'), look.eyes, d); });
  add('height', 'Height', () => (look.height > 0 ? '+' : '') + look.height, (d) => { look.height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, look.height + d)); });
  add('age', 'Age', () => look.age, (d) => { look.age = cycle(AGES, look.age, d); });
  for (const slot of SLOTS) {
    const ids = slotItems(kit, slot);
    if (!ids.length) continue;
    const label = slot[0].toUpperCase() + slot.slice(1);
    add(slot, label, () => (look[slot] ? look[slot].id : 'none'), (d) => {
      const opts = ['none', ...ids], id = cycle(opts, look[slot] ? look[slot].id : 'none', d);
      look[slot] = id === 'none' ? null : { id, ramp: (look[slot] && look[slot].ramp) || rampIds(dyeGroup(slot))[0] || '' };
    });
    if (rampIds(dyeGroup(slot)).length) add(slot + 'Ramp', label + ' colour', () => (look[slot] ? look[slot].ramp : '-'), (d) => {
      if (look[slot]) look[slot] = { id: look[slot].id, ramp: cycle(rampIds(dyeGroup(slot)), look[slot].ramp, d) };
    });
  }
  for (const [id, label] of [['random', 'Random'], ['confirm', 'Confirm'], ['back', 'Back']]) add(id, label, null, null);

  function random() { look = randomRecipe(kit, nextSeed++); }
  function confirm() {
    try {
      const def = buildPlayerModel(kit, look);
      if (register) register(def);
      action = { type: 'confirm', look: JSON.parse(JSON.stringify(look)) };
    } catch (e) { message = ascii(e.message).slice(0, 60); }
  }
  function activate() {
    const r = rows[selected];
    if (r.id === 'random') random();
    else if (r.id === 'confirm') confirm();
    else if (r.id === 'back') action = { type: 'back' };
    else r.step(1);
    return true;
  }
  function handleKey(code) {
    if (action) return false;
    message = '';
    if (code === 'Escape') { action = { type: 'back' }; return true; }
    if (code === 'Enter' || code === 'Space') return activate();
    if (code === 'ArrowUp' || code === 'KeyW') { selected = (selected - 1 + rows.length) % rows.length; return true; }
    if (code === 'ArrowDown' || code === 'KeyS') { selected = (selected + 1) % rows.length; return true; }
    const d = code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
    if (!d) return false;
    if (rows[selected].step) rows[selected].step(d);
    return true;
  }
  function takeAction() { const a = action; action = null; return a; }

  const bounds = { x: 0, y: 0, w: style ? style.panel.w : 72, h: style ? style.panel.h : 28 };
  function draw(ui) {
    const fg = keyOf(style ? style.row.normal.fg : ''), bg = style ? style.bg.plate : '#1a1612';
    bounds.x = Math.floor((ui.cols - bounds.w) / 2); bounds.y = Math.floor((ui.rows - bounds.h) / 2);
    for (let y = 0; y < bounds.h; y++) for (let x = 0; x < bounds.w; x++) ui.setCell(bounds.x + x, bounds.y + y, ' ', fg, bg);
    if (style) {
      const f = style.frame, brass = keyOf(f.fg);
      for (let x = 1; x < bounds.w - 1; x++) { ui.setCell(bounds.x + x, bounds.y, f.h, brass, bg); ui.setCell(bounds.x + x, bounds.y + bounds.h - 1, f.h, brass, bg); }
      for (let y = 1; y < bounds.h - 1; y++) { ui.setCell(bounds.x, bounds.y + y, f.v, brass, bg); ui.setCell(bounds.x + bounds.w - 1, bounds.y + y, f.v, brass, bg); }
      for (const cx of [0, bounds.w - 1]) for (const cy of [0, bounds.h - 1]) ui.setCell(bounds.x + cx, bounds.y + cy, f.corner, keyOf(f.cornerFg), bg);
    }
    const title = 'CREATE YOUR WICK';
    drawText(ui, bounds.x + Math.floor((bounds.w - title.length) / 2), bounds.y + 2, title, keyOf(style ? style.title.fg : ''), bg);
    const step = rows.length <= 9 ? 2 : 1, y0 = bounds.y + 5;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], focus = i === selected, y = y0 + i * step;
      const st = style && (focus ? style.row.focus : style.row.normal);
      const ink = st ? keyOf(st.fg) : fg, back = st ? style.bg[st.bg] : bg;
      if (focus && style) for (let x = style.row.bandFrom; x <= Math.min(style.row.bandTo, 38); x++) ui.setCell(bounds.x + x, y, ' ', ink, back);
      drawText(ui, bounds.x + 4, y, r.label, ink, back);
      if (r.get) drawText(ui, bounds.x + 20, y, (focus ? '< ' : '  ') + ascii(r.get()) + (focus ? ' >' : ''), ink, back);
      if (focus) ui.setCell(bounds.x + 2, y, style ? st.marker : '>', style ? keyOf(st.markerFg) : fg, back);
    }
    // Hand preview (what the player sees in first person): skin tones + eye + top dye swatches. The full body preview
    // (char.player on a studio scene) needs engine work - see lane note ASK ARCHITECT.
    if (colorOf) {
      const px = bounds.x + 44, py = bounds.y + 5;
      drawText(ui, px, py, 'Preview', keyOf(style ? style.sectionLabel.newGame.fg : ''), bg);
      const sw = (key, x, y) => { if (!key) return; let c; try { c = colorOf(key); } catch (e) { c = null; } if (c) for (let k = 0; k < 4; k++) ui.setCell(x + k, y, ' ', fg, c); };
      const sk = (kit.ramps.skin || {})[look.skin] || {};
      ['light', 'base', 'shade', 'deep'].forEach((s, i) => { for (let r = 0; r < 3; r++) sw(sk[s], px + i * 5, py + 2 + r); });
      const ey = (kit.ramps.eyes || {})[look.eyes] || {};
      drawText(ui, px, py + 6, 'eyes', fg, bg); sw(ey.iris || ey.base, px + 6, py + 6);
      const tp = look.top && kit.ramps.top && kit.ramps.top[look.top.ramp];
      drawText(ui, px, py + 8, 'sleeve', fg, bg); sw(tp ? tp.base : 'linen', px + 8, py + 8);
    }
    if (message) drawText(ui, bounds.x + 4, bounds.y + bounds.h - 3, message, keyOf(style ? style.message.error : ''), bg);
  }
  return { handleKey, takeAction, draw, snapshot: () => ({ look: JSON.parse(JSON.stringify(look)), selected, rows: rows.map((r) => r.id), message }) };
}
