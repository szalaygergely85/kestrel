// game/js/quest/quickbarView.test.js (EQ-12). Node ESM: node game/js/quest/quickbarView.test.js
import assert from 'node:assert/strict';
import { createQuickbarView } from './quickbarView.js';

const icon = { glyphs: ['  _  ', ' (R) ', ' \\_/ '], fg: ['  g  ', ' cLc ', ' ccc '] };
const defs = {
  sword: { id: 'sword', kind: 'weapon', icon: { glyphs: [' .   ', 'o+==>', ' \'   '], fg: [' Z   ', 'zZSSW', ' z   '] }, equip: { slot: 'main' } },
  'potion.hp': { id: 'potion.hp', kind: 'potion', icon },
};
const keys = { g: { c: 'a' }, c: { c: 'b' }, L: { c: 'b' }, Z: { c: 'a' }, z: { c: 'a' }, S: { c: 'a' }, W: { c: 'a' } };
const rgb = { a: [200, 200, 200], b: [200, 60, 60] };
const ui = { cols: 120, rows: 40, cells: new Map(), setCellRGB(x, y, code, fr, fg, fb, br, bg, bb) { this.cells.set(x + ',' + y, { ch: String.fromCharCode(code + 32), fr, bg: [br, bg, bb] }); } };
const v = createQuickbarView({ defs, keys, rgb });
const p = { components: { quickbar: ['sword', null, 'potion.hp', null, null, null], equipment: { set: 'melee', main: 'sword', off: null, ranged: null },
  inventory: { slots: [{ id: 'potion.hp', n: 3 }, { id: null, n: 0 }] } } };
const at = (x, y) => ui.cells.get(x + ',' + y).ch;

v.drawBar(ui, p, { sipT: 0, lastId: null }, false);
assert.equal(ui.cells.size, 0, 'hidden = nothing drawn');
v.drawBar(ui, p, { sipT: 0, lastId: null }, true);
const X = [0, 1, 2, 3, 4, 5].map((i) => v.slotX(120, i)), y0 = v.slotY(40);
assert.equal(X[1] - X[0], 8); assert.equal(X[2] - X[1], 10, 'group gap between hands and keys');
assert.equal(X[0], (120 - 49) >> 1);
assert.equal(at(X[0], y0), 'L', 'LMB label'); assert.equal(at(X[1], y0), 'R', 'RMB label');
assert.equal(at(X[2], y0), '1'); assert.equal(at(X[5], y0), '4');
assert.notDeepEqual(ui.cells.get(X[1] + ',' + y0).bg, ui.cells.get(X[3] + ',' + y0).bg, 'hand slots look different from key slots');
assert.equal(at(X[0], y0 + 1), '[', 'active sword frame in LMB');
assert.equal(at(X[2] + 5, y0 + 3) + at(X[2] + 6, y0 + 3), 'x3', 'count bottom-right');
assert.equal(at(X[2], y0 + 1), ' ', 'potion not active');
assert.equal(at(X[3], y0), '2', 'empty slot keeps its label'); assert.equal(at(X[3] + 6, y0), '.', 'dim dotted corner');
// hit test + ghost
assert.equal(v.slotAt(ui, X[0], y0), 0); assert.equal(v.slotAt(ui, X[5] + 6, y0 + 3), 5); assert.equal(v.slotAt(ui, X[1] + 8, y0), -1, 'gap'); assert.equal(v.slotAt(ui, X[0], y0 - 1), -1);
ui.cells.clear(); v.drawGhost(ui, null, 10, 10); assert.equal(ui.cells.size, 0); v.drawGhost(ui, 'potion.hp', X[3] + 2, y0 + 1); assert.equal(at(X[3] + 3, y0), '-', 'hot slot frame');
ui.cells.clear(); p.components.inventory.slots[0].n = 0; v.drawBar(ui, p, { sipT: 0 }, true);
assert.equal(at(X[2] + 5, y0 + 3) + at(X[2] + 6, y0 + 3), 'x0', 'gone stack shows x0');
ui.cells.clear(); v.drawBar(ui, p, { sipT: 5, lastId: 'potion.hp' }, true);
assert.equal(at(X[2], y0 + 1), '[', 'sipping potion is the active slot');
// OB-011: no potion HUD piece any more (the count lives on the bar slot)
assert.equal(v.drawPotion, undefined); assert.equal(v.hitPotion, undefined);
ui.cells.clear(); p.components.inventory.slots[0].n = 3; v.drawBar(ui, p, { sipT: 0 }, true);
assert.equal(at(X[2] + 5, y0 + 3) + at(X[2] + 6, y0 + 3), 'x3', 'bar slot shows the stack count');
// FB-03: locked ids. The spell in a hand slot is hidden (empty dotted slot); a locked potion stays but dimmed (40%).
{
  const d2 = { ...defs, 'spell.fireball': { id: 'spell.fireball', kind: 'spell', icon: { glyphs: ['  *  ', ' *** ', '  *  '], fg: ['  Z  ', ' ZZZ ', '  Z  '] } }, 'potion.mp': { id: 'potion.mp', kind: 'potion', icon } };
  const v2 = createQuickbarView({ defs: d2, keys, rgb });
  const q = { components: { quickbar: ['sword', 'spell.fireball', 'potion.mp', null, null, null], equipment: { set: 'melee', main: 'sword', off: null, ranged: null },
    inventory: { slots: [{ id: 'potion.mp', n: 2 }] } } };
  const lockedIds = { 'spell.fireball': true, 'potion.mp': true };
  const x1 = v2.slotX(ui.cols, 1), x2 = v2.slotX(ui.cols, 2), y = v2.slotY(ui.rows);
  ui.cells.clear(); v2.drawBar(ui, q, { sipT: 0 }, true, lockedIds);
  assert.equal(ui.cells.get((x1 + 3) + ',' + (y + 2)).ch, ' ', 'locked spell: icon not drawn (hand box hidden)');
  assert.equal(at(x1, y + 3), '.', 'locked spell: empty-slot dotted corner');
  const dimR = ui.cells.get((x2 + 3) + ',' + (y + 1)).fr;
  ui.cells.clear(); v2.drawBar(ui, q, { sipT: 0 }, true, null);
  const fullR = ui.cells.get((x2 + 3) + ',' + (y + 1)).fr;
  assert.ok(dimR > 0 && dimR < fullR && dimR === ((fullR * 0.4) | 0), 'locked potion.mp: dimmed to 40% (' + dimR + ' vs ' + fullR + ')');
  assert.equal(ui.cells.get((x1 + 3) + ',' + (y + 2)).ch !== ' ', true, 'unlocked: spell icon drawn');
}
console.log('quickbarView.test: ok');
