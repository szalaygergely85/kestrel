import assert from 'node:assert/strict';
import { createStack } from './undo.js';
import { applyEdit, invert } from './commands.js';
import { isEditable, readOnlyReason, GENERATED_TIP, hitTest, hitHandle, handles, resizeRadius, circleHandles, frameCamera, resizeRect, moveRect, setRectSize, createWaterTool, maxDepth, makePool } from './waterTool.js';

const mk = () => ({ water: [
  { id: 'big', look: 'sea', rect: [0, 0, 100, 100], shape: 'rect', z: 0 },
  { id: 'cellar', look: 'murky', rect: [1485, 995, 1495, 1005], shape: 'rect', z: 2.45 },
  { id: 'noshape', rect: [10, 10, 20, 20], z: 1 },
  { id: 'pond', c: [5, 5], r: 4, shape: 'circle', z: 2 },
  { id: 'braid', path: [[0, 0, 0, 10]], shape: 'river' },
] });
const setup = (floor = () => 1) => {
  const def = mk(), doc = { files: new Map([['world/m1', { def, dirty: false }]]) }, stack = createStack(); let rebuilds = 0;
  const commit = (rec) => { applyEdit(doc, rec); stack.push(rec); rebuilds++; };
  const tool = createWaterTool({ doc, fileId: 'world/m1', commit, floorAt: floor });
  return { def, doc, stack, tool, get rebuilds() { return rebuilds; } };
};
const undo = (s) => { const r = s.stack.undo(); applyEdit(s.doc, invert(r)); };
const redo = (s) => { const r = s.stack.redo(); applyEdit(s.doc, r); };

// rect-only rule
const d = mk().water;
assert.ok(isEditable(d[0]) && isEditable(d[2]) && isEditable(d[3])); assert.ok(!isEditable(d[4]));
assert.equal(readOnlyReason(d[4]), GENERATED_TIP); assert.equal(readOnlyReason(d[0]), '');
// hit-test: smallest wins, read-only skipped
assert.equal(hitTest(d, 1490, 1000).id, 'cellar'); assert.equal(hitTest(d, 15, 15).id, 'noshape'); assert.equal(hitTest(d, 50, 50).id, 'big');
assert.equal(hitTest(d, 5, 5).id, 'pond'); assert.equal(hitTest(d, 9.5, 5).id, 'big', 'outside the circle'); assert.equal(hitTest(d, 500, 500), null);
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
tool.select('pond'); assert.ok(!tool.setSize(3, 3), 'size is for rects');
// circle: move, radius handle, min 1 m, z, one undo step each
const n0 = s.stack.size;
assert.ok(tool.down(5, 5)); tool.move(7, 6); assert.ok(tool.up()); assert.deepEqual([def.water[3].c, def.water[3].r], [[7, 6], 4]); assert.equal(s.stack.size, n0 + 1);
assert.ok(tool.down(11.2, 6)); tool.move(13, 6); assert.ok(tool.up()); assert.equal(def.water[3].r, 6); assert.equal(s.stack.size, n0 + 2);
assert.ok(tool.down(13, 6)); tool.move(7.2, 6); tool.up(); assert.equal(def.water[3].r, 1, 'min radius');
assert.ok(tool.setRadius(2.5)); assert.equal(def.water[3].r, 2.5); assert.ok(!tool.setRadius(2.5)); assert.ok(tool.setSurfaceZ(2.2));
assert.ok(!tool.down(40, 40)); assert.equal(resizeRadius([0, 0], 0.2, 0), 1);
assert.equal(circleHandles({ c: [1, 2], r: 3 })[0].x, 4);
// framing
const fc = frameCamera([0, 0, 10, 10], 2, 90); assert.equal(fc.x, 5); assert.ok(fc.y > 5 && fc.z > 2); // yaw 0 looks toward -y: camera on the +y side
assert.deepEqual(tool.bounds('pond'), [7 - 2.5, 6 - 2.5, 7 + 2.5, 6 + 2.5]);
// full undo restores byte-identical json; key order kept through a parse round trip
while (s.stack.canUndo) undo(s); assert.equal(JSON.stringify(def), before);
assert.equal(JSON.stringify(JSON.parse(JSON.stringify(def))), before);
// regions list
const rg = tool.regions(); assert.equal(rg.find((r) => r.id === 'cellar').w, 10); assert.equal(rg.find((r) => r.id === 'braid').tip, GENERATED_TIP);
// ED-WATER-02: new pool / delete / look / depth
{
  const s2 = setup((x, y) => (x > 50 ? 3 : 1)); const t = s2.tool, dw = s2.def.water, b0 = JSON.stringify(s2.def), n = dw.length;
  assert.deepEqual(makePool('rect', 10, 20, 1, 'p'), { id: 'p', look: 'pond', z: 1.4, shape: 'rect', rect: [7, 17, 13, 23] });
  assert.equal(t.createPool(10, 20), 'pond_6'); assert.equal(dw.length, n + 1); assert.equal(t.st.sel, 'pond_6'); assert.equal(s2.stack.size, 1);
  const np = dw[n]; assert.deepEqual([np.rect, np.z, np.look], [[7, 17, 13, 23], 1.4, 'pond']);
  assert.equal(t.depth(), 0.4); assert.equal(t.createPool(80, 0, 'circle'), 'pond_7'); assert.deepEqual([dw[n + 1].c, dw[n + 1].r, dw[n + 1].z], [[80, 0], 3, 3.4]);
  assert.equal(s2.stack.size, 2); undo(s2); assert.equal(dw.length, n + 1); redo(s2); assert.equal(dw.length, n + 2); undo(s2); undo(s2); assert.equal(JSON.stringify(s2.def), b0);
  // read-only + unknown ground refused
  t.select('braid'); assert.ok(!t.deleteSelected()); assert.ok(!t.deleteSelected()); assert.ok(!t.setLook('x')); assert.equal(dw.length, n); assert.equal(t.depth(), null);
  assert.equal(setup(() => NaN).tool.createPool(1, 1), '');
  // delete: needs 2 calls, one undo step, selection cleared, other select disarms
  t.select('cellar'); assert.ok(!t.deleteSelected()); assert.equal(t.st.armed, 'cellar'); assert.equal(dw.length, n); t.select('big'); assert.equal(t.st.armed, null);
  t.select('cellar'); t.deleteSelected(); assert.ok(t.deleteSelected()); assert.equal(dw.length, n - 1); assert.equal(t.st.sel, null); assert.equal(s2.stack.size, 1);
  undo(s2); assert.equal(JSON.stringify(s2.def), b0); assert.equal(s2.def.water[1].id, 'cellar'); redo(s2); assert.equal(dw.length, n - 1); undo(s2);
  // look
  assert.deepEqual(t.looks(), ['sea', 'murky']); t.select('cellar'); assert.ok(t.setLook('sea')); assert.equal(dw[1].look, 'sea'); assert.ok(!t.setLook('sea')); undo(s2); assert.equal(dw[1].look, 'murky');
  // depth: floating pool (surface at/below floor) and circle sampling
  t.select('big'); assert.equal(t.depth(), -1); assert.equal(maxDepth({ rect: [0, 0, 4, 4], z: 5 }, () => 2), 3); assert.equal(maxDepth({ c: [0, 0], r: 2, z: 1, shape: 'circle' }, (x) => (x > 2.5 ? -50 : 1)), 0);
}
console.log('waterTool tests PASS');
