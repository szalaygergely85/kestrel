import assert from 'node:assert/strict';
import { parseDemo, filterDemoParams, demoStorage, blockFKeys, createEndCard, DEMO_ALLOW, END_CARD_TEXT } from './demoMode.js';
import { createStorageAdapter } from './quest/save/saveState.js';

for (const g of [undefined, null, '', 'demo=0', 'demo=2', 'x=1', 42, {}]) assert.equal(parseDemo(g).on, false, String(g));
assert.deepEqual(parseDemo('?demo=1').allow, DEMO_ALLOW);
const d = parseDemo('demo=1');
const f = filterDemoParams(new URLSearchParams('demo=1&quality=high&res=2&fx=0&debug=1&bench=1&gpucompare=1&at=1,2,3&save=0'), d);
assert.equal(f.toString(), 'quality=high&res=2&fx=0');
for (const k of ['debug', 'bench', 'gpucompare', 'at', 'save', 'demo']) assert.equal(f.has(k), false, k);
const raw = new URLSearchParams('debug=1');
assert.equal(filterDemoParams(raw, parseDemo('')), raw, 'off = same object');

const mem = new Map();
const base = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const ds = demoStorage(base);
for (let s = 0; s < 3; s++) ds.setItem('slot' + s, '{}');
assert.equal(ds.getItem('slot1'), '{}'); ds.removeItem('slot1'); assert.equal(ds.getItem('slot1'), null);
for (const k of mem.keys()) assert.ok(k.endsWith(':demo'), 'only demo keys: ' + k);
assert.equal(createStorageAdapter(base).readSlot(1).save, null, 'real slots untouched');

const inp = { pressed: (c) => true }; blockFKeys(inp);
assert.equal(inp.pressed('F3'), false); assert.equal(inp.pressed('KeyW'), true);

let r = 0, k = 0;
const card = createEndCard({ onRestart: () => r++, onKeep: () => k++ });
assert.ok(END_CARD_TEXT.length <= 38);
assert.equal(card.trigger(), true); assert.equal(card.trigger(), false);
card.step((c) => c === 'ArrowRight'); card.step((c) => c === 'Enter');
assert.deepEqual([r, k, card.open], [0, 1, false]);
assert.equal(card.trigger(), false, 'once per run');
const cells = []; const c2 = createEndCard({}); c2.trigger();
c2.draw({ cols: 80, rows: 30, setCellRGB: (...a) => cells.push(a) }); assert.ok(cells.length > 0);
console.log('demoMode ok');
