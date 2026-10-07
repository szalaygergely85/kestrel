// game/js/quest/inventoryView.test.js (US-091b). Headless Node ESM. Run: node --expose-gc game/js/quest/inventoryView.test.js
// The pack screen against the REAL designer style (design/models/inventory_ui.js) + item defs, the real hands router and
// pack functions, drawn into a recording fake UI layer.
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';
import itemsMod from '../../../design/items.js';
import invStyleMod from '../../../design/models/inventory_ui.js';
import { createInventoryView } from './inventoryView.js';
import { createToastView } from './toastView.js';
import { createHands } from './sim/hands.js';
import { ensureInventory, countOf } from './sim/inventory.js';

paletteMod; itemsMod; invStyleMod;
const A = globalThis.ASSETS;
const style = A.uiStyle.inventory, items = A.items, defs = items.defs;
const rgb = A.palette.rgb || (() => {
  const o = {};
  for (const k of Object.keys(A.palette.colors)) { const h = A.palette.colors[k]; o[k] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  return o;
})();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeEvents() {
  const ls = new Map();
  return {
    on(n, fn) { if (!ls.has(n)) ls.set(n, new Set()); ls.get(n).add(fn); return () => ls.get(n).delete(fn); },
    emit(n, p) { const s = ls.get(n); if (s) for (const fn of s) fn(p); },
  };
}
function makeUi(cols = 160, rows = 60) {
  const ch = new Int32Array(cols * rows).fill(-1);
  return {
    cols, rows, ch, setCellRGB(x, y, code) { ch[y * cols + x] = code + 32; },
    row(y, x0 = 0, x1 = cols) { let s = ''; for (let x = x0; x < x1; x++) { const c = ch[y * cols + x]; s += c < 0 ? '?' : String.fromCharCode(c); } return s; },
  };
}
function makeInput() {
  const down = new Set();
  return { press(...c) { c.forEach((k) => down.add(k)); }, pressed: (k) => down.has(k), consumePressed() { down.clear(); } };
}

const FULL = { pack: [{ id: 'sword', n: 1 }, { id: 'spell.fireball', n: 1 }, { id: 'boar.meat', n: 3 }, { id: 'boar.hide', n: 2 }], left: 'sword', right: 'spell.fireball' };
function rig({ hp = 20, max = 30, pack = true } = {}) {
  const events = makeEvents();
  const player = { components: { health: { hp, max, invuln: 0 } } };
  ensureInventory(player, pack ? FULL : { pack: [], left: null, right: null });
  const hands = createHands(events);
  const cancels = { sword: 0, 'spell.fireball': 0 };
  for (const id of Object.keys(cancels)) hands.register(id, { cancel() { cancels[id]++; }, setHand() {}, step() {} });
  let opened = 0, closed = 0;
  const toast = createToastView(events, items.toast, defs, rgb);
  const view = createInventoryView({
    style, items, rgb, toast,
    inventoryOf: () => player.components.inventory, healthOf: () => player.components.health,
    onHandsChanged: () => hands.step(player, false, false, false),
    onOpen: () => opened++, onClose: () => closed++,
  });
  hands.step(player, false, false, true);
  const input = makeInput();
  const step = (...keys) => { input.press(...keys); view.step(1 / 60, input, true); };
  return { events, player, inv: player.components.inventory, hands, view, toast, input, step, cancels, get opened() { return opened; }, get closed() { return closed; } };
}

// ---- open / close / pause gate ----
{
  const r = rig();
  ok('closed at start', !r.view.isOpen);
  r.step('KeyE'); ok('E does not open it', !r.view.isOpen);
  r.step('KeyI'); ok('I opens', r.view.isOpen && r.opened === 1);
  r.step('KeyI'); ok('I closes', !r.view.isOpen && r.closed === 1);
  r.step('KeyI'); r.step('Escape'); ok('Esc closes', !r.view.isOpen && r.closed === 2);
  const r2 = rig();
  r2.input.press('KeyI'); r2.view.step(1 / 60, r2.input, false);
  ok('canOpen=false blocks I', !r2.view.isOpen);
  r.step('KeyI');
  const dim = { all: 1 }; r.view.pushDim(dim);
  ok('open dims the scene to bgMul', dim.all === style.sceneDim.bgMul);
  // main.js passes gateOpen=false while open: the router disarms (cancels both items), no `down`
  r.hands.step(r.player, true, true, false);
  ok('gate closed: no swing / cast down', !r.hands.downOf('sword') && !r.hands.downOf('spell.fireball'));
  r.view.close(); ok('close() programmatic', !r.view.isOpen);
}

// ---- selection ----
{
  const r = rig();
  r.step('KeyI');
  ok('cursor starts on the first item slot', r.view.cursor.zone === 0 && r.view.cursor.idx === 0);
  r.step('KeyD'); ok('D moves right', r.view.cursor.idx === 1);
  r.step('KeyS'); ok('S moves down a row', r.view.cursor.idx === 7);
  r.step('KeyA'); r.step('KeyA'); ok('A no wrap at the left edge', r.view.cursor.idx === 6);
  r.step('KeyW'); r.step('KeyW'); ok('W from row 0 goes to the hands strip (left)', r.view.cursor.zone === 1);
  r.step('KeyD'); ok('D on the strip -> right hand', r.view.cursor.zone === 2);
  r.step('KeyS'); ok('S from RIGHT -> grid col 3', r.view.cursor.zone === 0 && r.view.cursor.idx === 3);
  r.step('ArrowRight'); ok('arrow keys work', r.view.cursor.idx === 4);
  r.view.setPointer(style.panel.x + 3 + 8 * 2 + 3, style.panel.y + 8 + 4 * 1 + 2);
  ok('mouse hover picks the slot (col 2, row 1)', r.view.cursor.zone === 0 && r.view.cursor.idx === 8, JSON.stringify(r.view.cursor));
  r.view.setPointer(style.panel.x + 56, style.panel.y + 3);
  ok('hover on the right hand box', r.view.cursor.zone === 2);
  r.view.setPointer(style.panel.x + 4, style.panel.y + 3);
  ok('hover on the left hand box', r.view.cursor.zone === 1);
}

// ---- assign: LMB left / RMB right / move from the other hand / refusals ----
{
  const r = rig();
  r.step('KeyI');
  const log = []; r.events.on('hands:changed', (p) => log.push(p.left + '|' + p.right));
  // slot 1 = fireball (in the right hand); LMB moves it to the left, the right hand empties
  r.step('KeyD'); r.step('Mouse0');
  ok('LMB: fireball -> left, right emptied', r.inv.left === 'spell.fireball' && r.inv.right === null);
  ok('router saw it at once (hands:changed, handOf)', log.length === 1 && r.hands.handOf('spell.fireball') === 'left');
  ok('router cancelled the items that moved', r.cancels['spell.fireball'] >= 1);
  r.step('KeyA'); r.step('Mouse2');
  ok('RMB: sword -> right', r.inv.right === 'sword' && r.inv.left === 'spell.fireball');
  r.step('KeyQ'); ok('Q = left hand (moves sword left, fireball leaves)', r.inv.left === 'sword' && r.inv.right === null);
  r.step('KeyE'); ok('E = right hand (sword moves back)', r.inv.right === 'sword' && r.inv.left === null);
  const n = log.length; r.step('KeyE'); ok('same hand again is a no-op', log.length === n);
  r.step('KeyD'); r.step('KeyD'); r.step('Mouse0');
  ok('meat cannot go in a hand', r.inv.left === null && r.inv.right === 'sword');
  r.step('KeyW'); r.step('KeyW'); r.step('KeyD');
  ok('cursor on the right hand', r.view.cursor.zone === 2);
  r.step('Mouse0'); ok('click on the hand slot empties it, item stays in the pack', r.inv.right === null && countOf(r.inv, 'sword') === 1);
}

// ---- use meat ----
{
  const r = rig({ hp: 20 });
  r.step('KeyI'); r.step('KeyD'); r.step('KeyD');
  ok('on the meat slot', r.inv.slots[2].id === 'boar.meat');
  r.step('Enter');
  ok('meat heals +10', r.player.components.health.hp === 30);
  ok('meat -1 from the stack', countOf(r.inv, 'boar.meat') === 2);
  const L = r.toast.lines[0];
  ok('toast "Ate Boar Meat"', r.toast.used === 1 && L.text.startsWith('Ate Boar Meat'), JSON.stringify(L.text));
  r.step('KeyU');
  ok('at full HP: "Not hurt", nothing used', countOf(r.inv, 'boar.meat') === 2 && r.player.components.health.hp === 30 && r.toast.lines[1].text === 'Not hurt');
  const r2 = rig({ hp: 28 });
  r2.step('KeyI'); r2.step('KeyD'); r2.step('KeyD'); r2.step('Enter');
  ok('heal clamps at max', r2.player.components.health.hp === 30);
  const r3 = rig({ hp: 1 });
  r3.inv.slots[2].n = 1;
  r3.step('KeyI'); r3.step('KeyD'); r3.step('KeyD'); r3.step('Enter');
  ok('last meat empties the slot', r3.inv.slots[2].id === null && countOf(r3.inv, 'boar.meat') === 0);
  r3.step('Enter'); ok('empty slot: Enter is a no-op', r3.player.components.health.hp === 11);
  const r4 = rig({ hp: 10 });
  r4.step('KeyI'); r4.step('KeyD'); r4.step('KeyD'); r4.step('KeyD'); r4.step('Enter');
  ok('hide: "Material - no use yet", nothing removed', countOf(r4.inv, 'boar.hide') === 2 && r4.toast.lines[0].text === 'Material - no use yet');
  r4.step('KeyD'); r4.step('Mouse0'); r4.step('KeyE');
  ok('empty slot: LMB / E no-op', r4.inv.left === 'sword' && r4.inv.right === 'spell.fireball');
}

// ---- layout ----
{
  const P = style.panel;
  ok('panel fits the 160x60 UI layer', P.x >= 0 && P.y >= 0 && P.x + P.w <= 160 && P.y + P.h <= 60);
  ok('panel is centred', P.x === ((160 - P.w) >> 1) && P.y === ((60 - P.h) >> 1));
  const r = rig(); r.step('KeyI');
  const ui = makeUi(); r.view.draw(ui);
  const row = (y, a = 0, b = P.w) => ui.row(P.y + y, P.x + a, P.x + b);
  ok('title row', row(0).includes(' PACK '));
  ok('hands strip names', row(3).includes('Ruin-steel Sword') && row(3).includes('Ember'));
  ok('hand labels + buttons', row(2).includes('LEFT HAND [LMB]') && row(2).includes('RIGHT HAND [RMB]'));
  ok('L / R tags on the grid slots', row(8, 3, 20).charAt(1) === 'L' && row(8, 3, 20).charAt(9) === 'R');
  ok('stack count x3 on the meat slot border', row(12, 19, 28).includes('x3'));
  ok('key hints row', row(26).includes('Enter use'));
  ok('paused tag', row(P.h - 1).includes(' paused '));
  ok('details: name of slot 0', row(9, 66).startsWith('Ruin-steel Sword'));
  r.step('KeyD'); r.step('KeyD'); r.view.draw(ui);
  ok('details: meat actions "Eat (+10 HP)"', row(19, 55).includes('Eat (+10 HP)'));
  let inside = true;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 160; x++) if (ui.ch[y * 160 + x] >= 0 && (x < P.x || x >= P.x + P.w || y < P.y || y >= P.y + P.h)) inside = false;
  ok('nothing drawn outside the panel', inside);
  const e = rig({ pack: false }); e.step('KeyI'); const u2 = makeUi(); e.view.draw(u2);
  ok('empty hands show "- empty -"', u2.row(P.y + 3, P.x, P.x + P.w).split('- empty -').length === 3);
  ok('empty slot details say Empty', u2.row(P.y + 9, P.x + 66, P.x + P.w).startsWith('Empty'));
  const c = rig(); const u3 = makeUi(); c.view.draw(u3); ok('closed draws nothing', u3.ch.every((v) => v < 0));
}

// ---- no allocation per frame while open ----
{
  const r = rig(); r.step('KeyI'); r.step('KeyD');
  const ui = { cols: 160, rows: 60, setCellRGB() {} };
  for (let i = 0; i < 200; i++) r.view.draw(ui);
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) r.view.draw(ui);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    ok('draw allocates nothing (--expose-gc heap check)', after <= before + 3e5, `before=${before} after=${after}`);
  } else console.log('(skip) zero-allocation heap check needs --expose-gc');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
