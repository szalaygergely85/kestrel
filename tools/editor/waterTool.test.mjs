import assert from 'node:assert/strict';
import { createStack } from './undo.js';
import { applyEdit, invert } from './commands.js';
import { isEditable, readOnlyReason, GENERATED_TIP, hitTest, hitHandle, handles, resizeRect, moveRect, setRectSize, createWaterTool } from './waterTool.js';

const mk = () => ({ water: [
  { id: 'big', look: 'sea', rect: [0, 0, 100, 100], shape: 'rect', z: 0 },
  { id: 'cellar', look: 'murky', rect: [1485, 995, 1495, 1005], shape: 'rect', z: 2.45 },
  { id: 'noshape', rect: [10, 10, 20, 20], z: 1 },
  { id: 'pond', c: [5, 5], r: 4, shape: 'circle', z: 2 },
  { id: 'braid', path: [[0, 0, 0, 10]], shape: 'river' },
] });
const setup = () => {
  const def = mk(), doc = { files: new Map([['world/m1', { def, dirty: false }]]) }, stack = createStack(); let rebuilds = 0;
  const commit = (rec) => { applyEdit(doc, rec); stack.push(rec); rebuilds++; };
  const tool = createWaterTool({ doc, fileId: 'world/m1', commit });
  return { def, doc, stack, tool, get rebuilds() { return rebuilds; } };
};
const undo = (s) => { const r = s.stack.undo(); applyEdit(s.doc, invert(r)); };
const redo = (s) => { const r = s.stack.redo(); applyEdit(s.doc, r); };

// rect-only rule
const d = mk().water;
assert.ok(isEditable(d[0]) && isEditable(d[2])); assert.ok(!isEditable(d[3]) && !isEditable(d[4]));
assert.equal(readOnlyReason(d[4]), GENERATED_TIP); assert.equal(readOnlyReason(d[0]), '');
// hit-test: smallest wins, read-only skipped
assert.equal(hitTest(d, 1490, 1000).id, 'cellar'); assert.equal(hitTest(d, 15, 15).id, 'noshape'); assert.equal(hitTest(d, 50, 50).id, 'big');
assert.equal(hitTest(d, 5, 5).id, 'big'); assert.equal(hitTest(d, 500, 500), null);
// handles
assert.equal(handles([0, 0, 10, 10]).length, 8);
assert.equal(hitHandle([0, 0, 10, 10], 9.5, 9.8), 'ne'); assert.equal(hitHandle([0, 0, 10, 10], 5, 0.4), 's'); assert.equal(hitHandle([0, 0, 10, 10], 5, 5), null);
// resize math + min size
assert.deepEqual(resizeRect([0, 0, 10, 10], 'e', 14, 99), [0, 0, 14, 10]);
assert.deepEqual(resizeRect([0, 0, 10, 10], 'ne', 14, 12), [0, 0, 14, 12]);
assert.deepEqual(resizeRect([0, 0, 10, 10], 'w', 20, 0), [9, 0, 10, 10]);
assert.deepEqual(resizeRect([0, 0, 10, 10], 'sw', 50, 50), [9, 9, 10, 10]);
assert.deepEqual(resizeRect([0, 0, 10, 10], 'n', 0, -5), [0, 0, 10, 1]);
assert.deepEqual(moveRect([0, 0, 10, 10], 2.5, -1), [2.5, -1, 12.5, 9]);
assert.deepEqual(setRectSize([0, 0, 10, 10], 20, null), [0, 0, 20, 10]); assert.deepEqual(setRectSize([0, 0, 10, 10], 0.2, 3), [0, 0, 1, 3]);

// tool: drag = one undo step, undo/redo, json round trip
const s = setup(); const { tool, def } = s;
const before = JSON.stringify(def);
assert.equal(tool.pick(1490, 1000), 'cellar');
assert.ok(tool.down(1495.2, 1000)); tool.move(1500, 1000); tool.move(1505, 1000); assert.deepEqual(tool.st.preview, [1485, 995, 1505, 1005]);
assert.equal(JSON.stringify(def), before, 'no change before release'); assert.equal(s.rebuilds, 0);
assert.ok(tool.up()); assert.equal(s.stack.size, 1); assert.equal(s.rebuilds, 1);
assert.deepEqual(def.water[1].rect, [1485, 995, 1505, 1005]); assert.ok(s.doc.files.get('world/m1').dirty);
undo(s); assert.equal(JSON.stringify(def), before); redo(s); assert.deepEqual(def.water[1].rect, [1485, 995, 1505, 1005]);
// move by dragging inside
assert.ok(tool.down(1490, 1000)); tool.move(1492, 1001); tool.up(); assert.deepEqual(def.water[1].rect, [1487, 996, 1507, 1006]); assert.equal(s.stack.size, 2);
// z edit, no-op edits create no step
assert.ok(tool.setSurfaceZ(3.1)); assert.equal(def.water[1].z, 3.1); assert.ok(!tool.setSurfaceZ(3.1)); assert.equal(s.stack.size, 3);
assert.ok(tool.setSize(5, 4)); assert.deepEqual(def.water[1].rect, [1487, 996, 1492, 1000]);
assert.ok(tool.down(1490, 998)); tool.move(1490, 998); assert.ok(!tool.up(), 'unchanged rect = no step');
// outside press does nothing
assert.ok(!tool.down(0, 0));
// read-only refuses
tool.select('braid'); assert.ok(!tool.down(0, 0)); assert.ok(!tool.setSurfaceZ(1)); assert.equal(tool.st.msg, GENERATED_TIP);
tool.select('pond'); assert.ok(!tool.setSize(3, 3));
assert.equal(JSON.stringify(def.water[3]), JSON.stringify(mk().water[3]));
// full undo restores byte-identical json; key order kept through a parse round trip
while (s.stack.canUndo) undo(s); assert.equal(JSON.stringify(def), before);
assert.equal(JSON.stringify(JSON.parse(JSON.stringify(def))), before);
// regions list
const rg = tool.regions(); assert.equal(rg.find((r) => r.id === 'cellar').w, 10); assert.equal(rg.find((r) => r.id === 'braid').tip, GENERATED_TIP);
console.log('waterTool tests PASS');
