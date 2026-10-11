// game/js/quest/characterView.test.js (EQ-03 + EQ-04a wiring). Headless Node ESM. Run: node --expose-gc game/js/quest/characterView.test.js
// The Items | Character menu against the REAL style + item defs + equipment sim, drawn into a recording fake UI layer.
// The model preview and the char cache are fakes that count calls (the real ones have their own tests).
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';
import itemsMod from '../../../design/items.js';
import invStyleMod from '../../../design/models/inventory_ui.js';
import { createInventoryView } from './inventoryView.js';
import { ensureInventory, addItem } from './sim/inventory.js';
import { ensureEquipment, defenceOf } from './sim/equipment.js';

paletteMod; itemsMod; invStyleMod;
const A = globalThis.ASSETS, style = A.uiStyle.inventory, items = A.items, defs = items.defs, P = style.panel;
const rgb = A.palette.rgb || (() => { const o = {}; for (const k of Object.keys(A.palette.colors)) { const h = A.palette.colors[k]; o[k] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); } return o; })();
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
function rig() {
  const player = { components: { health: { hp: 20, max: 30, invuln: 0 } } };
  const inv = ensureInventory(player, { pack: [{ id: 'sword', n: 1 }], left: null, right: null });
  const eq = ensureEquipment(player);
  addItem(inv, defs, 'gear.head.hood.sturdy', 1); addItem(inv, defs, 'gear.head.hood.worn', 1); addItem(inv, defs, 'boar.meat', 2);
  const calls = { setModel: [], render: [], gear: 0, recipes: [] };
  const preview = { setModel(k, d) { calls.setModel.push([k, d]); }, render(s, dt, ui, rect) { if (calls.render.length < 400) calls.render.push({ yaw: s.yawDeg, rect: { ...rect } }); return true; } };
  const cache = new Map();
  const charCache = { get(recipe) { calls.recipes.push(recipe); const k = JSON.stringify(recipe); if (!cache.has(k)) cache.set(k, { k }); return cache.get(k); } };
  const view = createInventoryView({ style, items, rgb, inventoryOf: () => inv, healthOf: () => player.components.health,
    character: { equipmentOf: () => eq, getLook: () => ({ body: 'm_avg' }), charCache, createPreview: () => preview, onGearChanged: () => calls.gear++ } });
  const input = makeInput(), ui = makeUi();
  const step = (...k) => { input.press(...k); view.step(1 / 60, input, true); };
  const draw = () => { ui.clear(); view.draw(ui); return ui.all(); };
  return { player, inv, eq, view, input, ui, step, draw, calls };
}
const ptr = (r, rx, ry) => r.view.setPointer(P.x + rx, P.y + ry);
const packPtr = (r, i) => ptr(r, 50 + 1 + (i % 6) * 8, 3 + 1 + ((i / 6) | 0) * 4);

// ---- tabs: I / C / Tab, pause gate = isOpen ----
{
  const r = rig();
  r.step('KeyC'); ok('C opens the Character tab', r.view.isOpen && r.view.tab === 1);
  r.step('Tab'); ok('Tab switches to Items', r.view.tab === 0);
  r.step('Tab'); ok('Tab switches back', r.view.tab === 1);
  r.step('KeyI'); ok('I on Character switches to Items', r.view.isOpen && r.view.tab === 0);
  r.step('KeyI'); ok('I on Items closes', !r.view.isOpen);
  r.step('KeyI'); r.step('KeyC'); ok('C on Items switches to Character', r.view.isOpen && r.view.tab === 1);
  r.step('KeyC'); ok('C on Character closes', !r.view.isOpen);
  r.step('Tab'); ok('Tab does not open the menu (it cycles targets)', !r.view.isOpen);
  r.step('KeyC'); r.step('Escape'); ok('Escape key still closes', !r.view.isOpen);
  const r2 = rig(); r2.input.press('KeyC'); r2.view.step(1 / 60, r2.input, false); ok('canOpen=false blocks C', !r2.view.isOpen);
  const noKey = createInventoryView({ style, items, rgb, inventoryOf: () => r.inv, characterKey: false, character: { equipmentOf: () => r.eq } });
  const inp = makeInput(); inp.press('KeyC'); noKey.step(1 / 60, inp, true); ok('characterKey:false leaves C to crafting', !noKey.isOpen);
  const plain = createInventoryView({ style, items, rgb, inventoryOf: () => r.inv });
  const inp2 = makeInput(); inp2.press('KeyC'); plain.step(1 / 60, inp2, true); ok('no character option = no Character tab', !plain.isOpen);
}
// ---- no "Esc" text on either tab ----
{
  const r = rig(); r.step('KeyI'); const items0 = r.draw(); r.step('KeyC'); const ch = r.draw();
  ok('Items tab has no Esc text', !/esc/i.test(items0));
  ok('Character tab has no Esc text', !/esc/i.test(ch));
  ok('tab bar shows both tabs', /Items/.test(ch) && /Character/.test(ch));
  ok('11 slot labels drawn', ['Head', 'Chest', 'Gloves', 'Belt', 'Legs', 'Boots', 'Cloak', 'Main', 'Off', 'Ranged', 'Quiver'].every((l) => ch.includes(l)));
  ok('stats line Hearts / Defence (-n%) / Arrows, no XP', /Hearts 2\/3 {2}\/ {2}Defence 0 \(-0%\) {2}\/ {2}Arrows 0/.test(ch) && !/\bXP\b/.test(ch), ch.split('\n')[P.y + 24]);
}
// ---- equip / unequip, tooltip + compare, refuse ----
{
  const r = rig(); r.step('KeyC');
  ok('model composed once on open', r.calls.setModel.length === 1 && r.calls.setModel[0][0] === 'char.preview');
  r.draw(); ok('draw copies the preview into the view box', r.calls.render.length === 1 && r.calls.render[0].rect.x === P.x + 11 && r.calls.render[0].rect.y === P.y + 4 && r.calls.render[0].rect.w === 21 && r.calls.render[0].rect.h === 13);
  const hoodIdx = r.inv.slots.findIndex((s) => s.id === 'gear.head.hood.sturdy');
  packPtr(r, hoodIdx);
  let txt = r.draw();
  ok('tooltip names the item + defence delta (slot empty)', /Sturdy Hood/.test(txt) && /Defence \+2 \(slot empty\)/.test(txt));
  r.step('KeyE');
  ok('E wears it', r.eq.head === 'gear.head.hood.sturdy' && r.calls.gear === 1);
  ok('equip recomposes once (new recipe, new model)', r.calls.setModel.length === 2 && r.calls.recipes[1].hat && r.calls.recipes[1].hat.id === 'hat');
  txt = r.draw(); ok('stats show defence after wearing', /Defence 2 \(-6%\)/.test(txt), txt.split('\n')[P.y + 24]);
  const wornIdx = r.inv.slots.findIndex((s) => s.id === 'gear.head.hood.worn');
  packPtr(r, wornIdx);
  txt = r.draw(); ok('compare shows a loss against the worn piece', /Defence -1 vs Sturdy Hood/.test(txt));
  r.step('Enter'); ok('Enter swaps; the old piece returns to the pack', r.eq.head === 'gear.head.hood.worn' && r.inv.slots.some((s) => s.id === 'gear.head.hood.sturdy'));
  const meatIdx = r.inv.slots.findIndex((s) => s.id === 'boar.meat'); const g0 = r.calls.gear;
  packPtr(r, meatIdx);
  r.step('KeyE'); ok('a non-gear item refuses (no change)', r.calls.gear === g0 && r.eq.head === 'gear.head.hood.worn');
  ptr(r, 1 + 1, 3 + 1); r.step('KeyE'); ok('E on a worn slot takes it off', r.eq.head === null && r.calls.gear === g0 + 1);
  ptr(r, 1 + 1, 3 + 1); const g1 = r.calls.gear; r.step('KeyE'); ok('E on an empty slot refuses', r.calls.gear === g1);
  // full pack: unequip must refuse and keep the piece
  r.eq.legs = 'gear.legs.pants.worn';
  for (let i = 0; i < r.inv.slots.length; i++) if (!r.inv.slots[i].id) r.inv.slots[i] = { id: 'boar.hide', n: 1 };
  ptr(r, 33 + 1, 3 + 1); const g2 = r.calls.gear; r.step('KeyE'); ok('unequip into a full pack refuses', r.eq.legs === 'gear.legs.pants.worn' && r.calls.gear === g2);
  ok('defenceOf agrees with the sim', defenceOf(r.eq, defs) === 1);
}
// ---- rotation: A/D held turns, 10 Hz re-pose, drag, keys navigate when a slot has the cursor ----
{
  const r = rig(); r.step('KeyC');
  ok('cursor starts on the view box', r.view.character.cursor === 11);
  r.input.hold('KeyD');
  for (let i = 0; i < 60; i++) r.view.step(1 / 60, r.input, true);
  r.input.release('KeyD');
  ok('D held 1 s turns ~150 deg', Math.abs(r.view.character.yawDeg - 330) < 2, String(r.view.character.yawDeg));
  r.draw(); const y1 = r.calls.render[r.calls.render.length - 1].yaw;
  ok('the stage yaw follows (quantised)', Math.abs(y1 - r.view.character.yawDeg) < 16, y1 + ' vs ' + r.view.character.yawDeg);
  const r2 = rig(); r2.step('KeyC'); const seen = new Set();
  r2.input.hold('KeyA');
  for (let i = 0; i < 60; i++) { r2.view.step(1 / 60, r2.input, true); r2.draw(); seen.add(r2.calls.render[r2.calls.render.length - 1].yaw); }
  ok('re-pose rate <= ~10 Hz while turning', seen.size <= 11 && seen.size >= 5, 'distinct yaws ' + seen.size);
  const r3 = rig(); r3.step('KeyC'); r3.draw(); const yA = r3.calls.render[0].yaw; for (let i = 0; i < 30; i++) { r3.view.step(1 / 60, r3.input, true); r3.draw(); }
  ok('idle keeps the same yaw (no re-render trigger)', r3.calls.render.every((c) => c.yaw === yA));
  const r4 = rig(); r4.step('KeyC'); ptr(r4, 20, 10); r4.input.press('Mouse0'); r4.input.hold('Mouse0'); r4.view.step(1 / 60, r4.input, true);
  ptr(r4, 30, 10); r4.view.step(1 / 60, r4.input, true);
  ok('mouse drag of 10 px turns ~6 deg', Math.abs(r4.view.character.yawDeg - 186) < 0.5, String(r4.view.character.yawDeg));
  const r5 = rig(); r5.step('KeyC'); r5.step('KeyW'); const c1 = r5.view.character.cursor; ok('W leaves the view box', c1 < 11);
  const yaw5 = r5.view.character.yawDeg; r5.step('KeyD');
  ok('D on a slot navigates, does not turn', r5.view.character.cursor !== c1 && r5.view.character.yawDeg === yaw5);
}
// ---- draw allocates nothing once the strings are cached ----
if (global.gc) {
  const r = rig(); r.step('KeyC'); r.draw(); for (let i = 0; i < 100; i++) r.view.draw(r.ui);
  global.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 3000; i++) r.view.draw(r.ui);
  global.gc(); const after = process.memoryUsage().heapUsed;
  ok('Character draw allocates ~nothing', after <= before + 3e5, `before=${before} after=${after}`);
} else console.log('(skip) zero-allocation heap check needs --expose-gc');

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
