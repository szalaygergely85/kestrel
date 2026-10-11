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
const p = { components: { quickbar: ['sword', 'potion.hp', null, null], equipment: { set: 'melee', main: 'sword', off: null, ranged: null },
  inventory: { slots: [{ id: 'potion.hp', n: 3 }, { id: null, n: 0 }] } } };
const at = (x, y) => ui.cells.get(x + ',' + y).ch;

v.drawBar(ui, p, { sipT: 0, lastId: null }, false);
assert.equal(ui.cells.size, 0, 'hidden = nothing drawn');
v.drawBar(ui, p, { sipT: 0, lastId: null }, true);
const x0 = v.slotX(120, 0), y0 = v.slotY(40), x1 = v.slotX(120, 1), x2 = v.slotX(120, 2);
assert.equal(x0, (120 - 31) >> 1);
assert.equal(at(x0, y0), '1', 'digit top-left');
assert.equal(at(x0, y0 + 1), '[', 'active sword frame');
assert.equal(at(x1 + 5, y0 + 3) + at(x1 + 6, y0 + 3), 'x3', 'count bottom-right');
assert.equal(at(x1, y0 + 1), ' ', 'potion not active');
assert.equal(at(x2, y0), '3', 'empty slot keeps its digit'); assert.equal(at(x2 + 6, y0), '.', 'dim dotted corner');
p.components.inventory.slots[0].n = 0; ui.cells.clear(); v.drawBar(ui, p, { sipT: 0 }, true);
assert.equal(at(x1 + 5, y0 + 3) + at(x1 + 6, y0 + 3), 'x0', 'gone stack shows x0');
ui.cells.clear(); v.drawBar(ui, p, { sipT: 5, lastId: 'potion.hp' }, true);
assert.equal(at(x1, y0 + 1), '[', 'sipping potion is the active slot');
// potion button next to the hearts
ui.cells.clear(); p.components.inventory.slots[0].n = 2;
v.drawPotion(ui, { layout: { x: 2, hpRow: 1, numberCol: 26 }, textBg: [0, 0, 0] }, p, { sipT: 0 }, 'H', true);
assert.equal(at(51, 3), 'H'); assert.equal(at(51, 2) + at(52, 2), 'x2'); assert.equal(v.hitPotion(46, 1), true); assert.equal(v.hitPotion(10, 1), false);
console.log('quickbarView.test: ok');
