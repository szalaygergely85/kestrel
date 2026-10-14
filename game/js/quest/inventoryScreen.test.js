// OB-112: the one inventory screen. Run: node game/js/quest/inventoryScreen.test.js
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';
import itemsMod from '../../../design/items.js';
import looksMod from '../../../design/itemLooks.js';
import { registerGenDefs } from './sim/itemInst.js';
import invStyleMod from '../../../design/models/inventory_ui.js';
import { createInventoryScreen, LAYOUT } from './inventoryScreen.js';
import { ensureInventory, addItem } from './sim/inventory.js';
import { ensureEquipment, defenceOf } from './sim/equipment.js';

paletteMod; itemsMod; looksMod; invStyleMod;
const A = globalThis.ASSETS, style = A.uiStyle.inventory, items = A.items, defs = items.defs, P = style.panel;
const rgb = A.palette.rgb;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeUi(cols = 160, rows = 60) {
  const ch = new Int32Array(cols * rows).fill(-1);
  return { cols, rows, ch, setCellRGB(x, y, code) { ch[y * cols + x] = code + 32; }, clear() { ch.fill(-1); },
    all() { let s = ''; for (let y = 0; y < rows; y++) { for (let x = 0; x < cols; x++) { const c = ch[y * cols + x]; s += c < 0 ? ' ' : String.fromCharCode(c); } s += '\n'; } return s; } };
}
function makeInput() {
  const edge = new Set(), held = new Set();
  return { press(...c) { c.forEach((k) => edge.add(k)); }, hold(...c) { c.forEach((k) => held.add(k)); }, release(...c) { c.forEach((k) => held.delete(k)); },
    pressed: (k) => edge.has(k), isDown: (k) => held.has(k), consumePressed() { edge.clear(); } };
}
function rig(extra = {}) {
  const player = { components: { health: { hp: 20, max: 30, invuln: 0 } } };
  const inv = ensureInventory(player, { pack: [{ id: 'sword', n: 1 }], left: null, right: null });
  const eq = ensureEquipment(player);
  addItem(inv, defs, 'gear.head.hood.sturdy', 1); addItem(inv, defs, 'gear.head.hood.worn', 1); addItem(inv, defs, 'boar.meat', 2);
  const calls = { gear: 0, qb: [] };
  const preview = { setModel() {}, render() { return true; } };
  const cache = new Map();
  const charCache = { get(recipe) { const k = JSON.stringify(recipe); if (!cache.has(k)) cache.set(k, { k }); return cache.get(k); } };
  const locked = new Set();
  const view = createInventoryScreen({ style, items, rgb, inventoryOf: () => inv, healthOf: () => player.components.health, isSlotDisabled: (i) => locked.has(i),
    quickbar: { assign: (n, id) => { calls.qb.push([n, id]); return true; } },
    character: { equipmentOf: () => eq, getLook: () => ({ body: 'm_avg' }), charCache, createPreview: () => preview, onGearChanged: () => calls.gear++ }, ...extra });
  const input = makeInput(), ui = makeUi();
  const step = (...k) => { input.press(...k); view.step(1 / 60, input, true); };
  const draw = () => { ui.clear(); view.draw(ui); return ui.all(); };
  return { player, inv, eq, view, input, ui, step, draw, calls, locked };
}
const ptr = (r, rx, ry) => r.view.setPointer(P.x + rx, P.y + ry);
const packPtr = (r, i) => ptr(r, LAYOUT.pack.x + 1 + (i % 6) * 8, LAYOUT.pack.y + 1 + ((i / 6) | 0) * 4);
const slotPtr = (r, slot) => { const s = LAYOUT.slots.find((q) => q[0] === slot); ptr(r, s[1] + 1, s[2] + 1); };
const idx = (r, id) => r.inv.slots.findIndex((s) => s.id === id);
/** press at the current pointer, move to a target, release */
function drag(r, from, to) {
  from(); r.input.press('Mouse0'); r.input.hold('Mouse0'); r.view.step(1 / 60, r.input, true);
  to(); r.view.step(1 / 60, r.input, true);
  r.input.release('Mouse0'); r.view.step(1 / 60, r.input, true);
}

// ---- layout fits every grid size ----
for (const [cols, rows] of [[160, 60], [240, 90], [480, 180], [560, 210]]) {
  ok(`panel fits ${cols}x${rows}`, P.x >= 0 && P.y >= 0 && P.x + P.w <= cols && P.y + P.h <= rows);
  const r = rig(); r.step('KeyI'); const ui = makeUi(cols, rows); ui.clear(); r.view.draw(ui);
  ok(`draws on ${cols}x${rows}`, /PACK/.test(ui.all()) && /WICK/.test(ui.all()));
}
{
  const b = style.slot.box, G = style.grid; let maxX = 0, maxY = 0;
  for (const s of LAYOUT.slots) { maxX = Math.max(maxX, s[1] + b.w); maxY = Math.max(maxY, s[2] + b.h); }
  maxX = Math.max(maxX, LAYOUT.pack.x + 5 * G.pitchX + b.w); maxY = Math.max(maxY, LAYOUT.pack.y + 3 * G.pitchY + b.h);
  ok('every box inside the panel frame', maxX < P.w && maxY < P.h - 3, maxX + 'x' + maxY);
}
// ---- I / C / Tab open and close the SAME screen ----
for (const k of ['KeyI', 'KeyC', 'Tab']) {
  const r = rig(); r.step(k); ok(k + ' opens', r.view.isOpen);
  for (const k2 of ['KeyI', 'KeyC', 'Tab', 'Escape']) { const r2 = rig(); r2.step(k); r2.step(k2); ok(k + ' open, ' + k2 + ' closes', !r2.view.isOpen); }
}
{
  const r = rig(); r.input.press('KeyI'); r.view.step(1 / 60, r.input, false); ok('canOpen=false blocks I', !r.view.isOpen);
  const noKey = rig({ characterKey: false }); noKey.step('KeyC'); ok('characterKey:false leaves C to crafting', !noKey.view.isOpen);
  const plain = rig({ character: undefined }); plain.step('KeyI'); const t = plain.draw(); ok('no character option still shows the pack', plain.view.isOpen && /PACK/.test(t));
  const rr = rig(); rr.step('KeyI'); const txt = rr.draw();
  ok('no Esc text', !/esc/i.test(txt));
  ok('no tab bar, one screen', !/Items|Character/.test(txt));
  ok('11 slot labels', ['Head', 'Chest', 'Gloves', 'Belt', 'Legs', 'Boots', 'Cloak', 'L hand', 'R hand', 'Ranged', 'Quiver'].every((l) => txt.includes(l)));
  ok('stats HP / DEF / DMG', /HP 20\/30 {3}DEF 0 \(-0%\)/.test(txt) && /DMG x1/.test(txt));
}
// ---- click / E path + details + stats ----
{
  const r = rig(); r.step('KeyI');
  const hood = idx(r, 'gear.head.hood.sturdy'); packPtr(r, hood);
  let txt = r.draw(); ok('details under the pack name the item and delta', /Sturdy Hood/.test(txt) && /Defence \+2 \(slot empty\)/.test(txt));
  r.step('KeyE'); ok('E wears it', r.eq.head === 'gear.head.hood.sturdy' && r.calls.gear === 1);
  txt = r.draw(); ok('stats update after wearing', /DEF 2 \(-6%\)/.test(txt));
  packPtr(r, idx(r, 'gear.head.hood.worn')); r.step('Enter'); ok('Enter swaps, old piece returns', r.eq.head === 'gear.head.hood.worn' && idx(r, 'gear.head.hood.sturdy') >= 0);
  packPtr(r, idx(r, 'boar.meat')); const hp = r.player.components.health.hp; r.step('KeyE');
  ok('E on food eats it', r.player.components.health.hp > hp && r.inv.slots.some((s) => s.id === 'boar.meat' && s.n === 1));
  packPtr(r, idx(r, 'sword')); r.step('Digit2'); ok('1-4 assigns the hovered item to the quick bar', r.calls.qb.length === 1 && r.calls.qb[0][0] === 1 && r.calls.qb[0][1] === 'sword');
  slotPtr(r, 'head'); r.step('KeyE'); ok('E on a worn slot takes it off', r.eq.head === null);
  r.step('KeyE'); ok('E on an empty slot refuses', r.eq.head === null);
}
// ---- drag to equip / unequip ----
{
  const r = rig(); r.step('KeyI');
  const hood = idx(r, 'gear.head.hood.sturdy');
  drag(r, () => packPtr(r, hood), () => slotPtr(r, 'head'));
  ok('drag pack -> head slot equips', r.eq.head === 'gear.head.hood.sturdy' && idx(r, 'gear.head.hood.sturdy') < 0);
  ok('stats follow the drag', defenceOf(r.eq, defs) === 2 && /DEF 2/.test(r.draw()));
  drag(r, () => slotPtr(r, 'head'), () => packPtr(r, 20));
  ok('drag worn -> pack unequips', r.eq.head === null && idx(r, 'gear.head.hood.sturdy') >= 0);
  const sw = idx(r, 'sword');
  drag(r, () => packPtr(r, sw), () => slotPtr(r, 'legs'));
  ok('drop on the wrong slot refuses', r.eq.main !== 'sword' && r.eq.legs == null);
  drag(r, () => packPtr(r, idx(r, 'gear.head.hood.worn')), () => ptr(r, LAYOUT.view.x + 8, LAYOUT.view.y + 6));
  ok('drop on Wick equips', r.eq.head === 'gear.head.hood.worn');
  const r2 = rig(); r2.step('KeyI'); packPtr(r2, idx(r2, 'gear.head.hood.sturdy'));
  r2.input.press('Mouse0'); r2.input.hold('Mouse0'); r2.view.step(1 / 60, r2.input, true); r2.input.release('Mouse0'); r2.view.step(1 / 60, r2.input, true);
  ok('click without moving still equips', r2.eq.head === 'gear.head.hood.sturdy');
  r.eq.legs = 'gear.legs.pants.worn'; // full pack: unequip refuses
  for (let i = 0; i < r.inv.slots.length; i++) if (!r.inv.slots[i].id) r.inv.slots[i] = { id: 'boar.hide', n: 1 };
  drag(r, () => slotPtr(r, 'legs'), () => packPtr(r, 0));
  ok('unequip into a full pack refuses', r.eq.legs === 'gear.legs.pants.worn');
}
// ---- locked slots ----
{
  const r = rig(); r.locked.add(0); r.locked.add(1); r.step('KeyI');
  ok('cursor opens on a live slot', r.view.cursor >= 12 && !r.locked.has(r.view.cursor - 12));
  const before = r.view.cursor; packPtr(r, 0); ok('pointer cannot select a locked slot', r.view.cursor === before);
  const nx = (t) => (t.match(/x/g) || []).length;
  const rE = rig(); rE.inv.slots[0].id = null; rE.locked.add(0); rE.step('KeyI'); const rI = rig(); rI.locked.add(0); rI.step('KeyI');
  ok('empty locked cell draws x, one holding an item does not', nx(rE.draw()) === nx(rI.draw()) + 1, nx(rE.draw()) + '/' + nx(rI.draw()));
  const rl = rig({ slotLockText: () => 'Locked - learn fire first' }); rl.locked.add(0); rl.locked.add(23); rl.step('KeyI');
  ok('locked item icon still drawn', /Sword/i.test('Sword') && rl.draw().length > 0);
  packPtr(rl, 0); const tip = rl.draw();
  ok('hovering a locked item shows its name + lock line', /Ruin Sword/.test(tip) && /Locked - learn fire first/.test(tip), 'tip');
  ok('cursor still refuses the locked cell', rl.view.cursor !== 12);
}
// ---- Wick turns: A/D held on the model, mouse drag ----
{
  const r = rig(); r.step('KeyI'); ptr(r, LAYOUT.view.x + 4, LAYOUT.view.y + 4);
  r.input.hold('KeyD'); for (let i = 0; i < 60; i++) r.view.step(1 / 60, r.input, true); r.input.release('KeyD');
  ok('D held 1 s turns ~150 deg', Math.abs(r.view.yawDeg - 330) < 2, String(r.view.yawDeg));
  const r4 = rig(); r4.step('KeyI'); ptr(r4, 70, 10); r4.input.press('Mouse0'); r4.input.hold('Mouse0'); r4.view.step(1 / 60, r4.input, true);
  ptr(r4, 80, 10); r4.view.step(1 / 60, r4.input, true);
  ok('mouse drag of 10 px turns ~6 deg', Math.abs(r4.view.yawDeg - 186) < 0.5, String(r4.view.yawDeg));
}
// ---- SPELLBOOK-01: B opens the spellbook page; learned spells only ----
{
  const learned = [], bar = [];
  const r = rig({ spellbook: { ids: () => learned, tierOf: () => 1, equip: (id, hand) => { bar.push([hand, id]); return true; } } });
  r.step('KeyI'); r.step('KeyB');
  ok('spellbook page: empty book says so', /SPELLBOOK/.test(r.draw()) && /No spells learned/.test(r.draw()) && !/Fireball/.test(r.draw()));
  learned.push('spell.fireball');
  const t = r.draw();
  ok('spellbook page lists name, tier, mana, blurb', /Fireball {3}Tier 1/.test(t) && /Mana 5 . 10/.test(t) && /Tap to throw/.test(t));
  r.step('Digit2'); r.step('KeyE'); r.step('KeyQ');
  ok('spellbook (D-100): digits do nothing, E = right hand, Q = left hand', JSON.stringify(bar) === JSON.stringify([['right', 'spell.fireball'], ['left', 'spell.fireball']]));
  ok('spellbook: hoverItemId is the selected spell (drag source)', r.view.hoverItemId === 'spell.fireball');
  r.step('KeyB'); ok('B again returns to the pack', /PACK/.test(r.draw()));
}
{ // ITEM-07: rolled gear shows the item card (name + tag, bonus line, compare against the worn piece, empty slot = green)
  registerGenDefs(defs);
  const r = rig();
  r.inv.slots[3] = { id: 'gen.sword', n: 1, it: { iL: 5, r: 2, a: [['A1', 0.18], ['A8', 4]], req: { str: 5 } } };
  r.step('KeyI'); packPtr(r, 3); const t = r.draw();
  ok('item card: name + rarity tag, level, bonus lines', /Iron Sword +\[Rare\]/.test(t) && /Main hand {2}- {2}Level 5/.test(t) && /\+18 % damage/.test(t) && /\+4 STR/.test(t));
  ok('item card: empty slot -> compare in the right column', /vs empty slot/.test(t) && /Avg damage \+/.test(t));
  ok('item card: no Esc text', !/Esc/.test(t));
  r.eq.rev = (r.eq.rev | 0) + 1; r.eq.main = 'gen.sword'; r.eq.it = r.eq.it || {}; r.eq.it.main = { iL: 3, r: 1, a: [['A3', 0.02]] };
  const t2 = r.draw();
  ok('item card: vs worn piece, worse stat shown', /vs Worn Sword|vs worn Worn Sword/.test(t2) && /Crit chance -2 %/.test(t2) && /Avg damage \+/.test(t2));
}
{ // ITEM-07b: a 3-bonus Epic card floats over the pack and shows every line (base stats, 3 bonuses, requirement, compare)
  registerGenDefs(defs);
  const r = rig();
  r.inv.slots[3] = { id: 'gen.sword', n: 1, it: { iL: 6, r: 3, a: [['A1', 0.18], ['A8', 4], ['A3', 0.03]], req: { str: 9 } } };
  r.eq.rev = (r.eq.rev | 0) + 1; r.eq.main = 'gen.sword'; r.eq.it = r.eq.it || {}; r.eq.it.main = { iL: 2, r: 1, a: [['A3', 0.02]] };
  r.step('KeyI'); packPtr(r, 3); const t = r.draw();
  ok('epic card: name + [Epic] tag, level line', /Steel Sword +\[Epic\]|Iron Sword +\[Epic\]/.test(t) && /Level 6/.test(t));
  ok('epic card: all 3 bonus lines', /\+18 % damage/.test(t) && /\+4 STR/.test(t) && /Crit chance/.test(t));
  ok('epic card: requirement + compare present', /Needs STR 9|STR 9/.test(t) && /Avg damage/.test(t));
  ok('epic card: floating panel taller than the 6-row pane', /\+-{20,}\+/.test(t));
}
if (global.gc) {
  const r = rig(); r.step('KeyI'); r.draw(); for (let i = 0; i < 100; i++) r.view.draw(r.ui);
  global.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 3000; i++) r.view.draw(r.ui);
  global.gc(); ok('draw allocates ~nothing', process.memoryUsage().heapUsed <= before + 3e5);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
