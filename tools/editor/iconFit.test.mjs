import assert from 'node:assert/strict';
import { createPitchedTerms, pitchedTerms, worldToCell } from '../../engine/index.js';
import { modelBounds, fitIconCamera, iconCacheKey, createIconQueue, createIconCache } from './iconFit.js';
let tests = 0;
function test(name, fn) { fn(); tests++; console.log(`PASS ${name}`); }
for (const size of [0.2, 2, 20]) test(`all corners fit with 5% margin: ${size}m`, () => {
  const bounds = { w: size, d: size, h: size }, grid = { cols: 160, rows: 60, pxCellW: 8, pxCellH: 16 };
  const cam = fitIconCamera(bounds, 75, grid.cols * grid.pxCellW / (grid.rows * grid.pxCellH));
  const terms = pitchedTerms(cam, grid, createPitchedTerms()), cell = new Float64Array(3);
  for (const x of [-size / 2, size / 2]) for (const y of [-size / 2, size / 2]) for (const z of [0, size]) {
    worldToCell(terms, x, y, z, cell);
    assert.ok(cell[2] > 0.05);
    assert.ok(cell[0] >= grid.cols * 0.05 && cell[0] <= grid.cols * 0.95, `column ${cell[0]}`);
    assert.ok(cell[1] >= grid.rows * 0.05 && cell[1] <= grid.rows * 0.95, `row ${cell[1]}`);
  }
});
test('voxel dimensions include cell size and scale', () => {
  const b = modelBounds({ voxel: { size: [2, 4, 6], cellM: 0.1 }, scale: 2 });
  assert.equal(b.w, 0.4); assert.equal(b.d, 0.8); assert.ok(Math.abs(b.h - 1.2) < 1e-12);
});
test('sprite uses world dimensions', () => assert.deepEqual(modelBounds({ world: { w: 3, h: 7 } }), { w: 3, d: 3, h: 7 }));
test('invalid shapes fail rather than inventing a size', () => assert.throws(() => modelBounds({})));
test('changed voxel changes definition hash', () => {
  const a = { voxel: { layers: [['x']] } }, b = { voxel: { layers: [['.']] } };
  assert.notEqual(iconCacheKey('prop', a), iconCacheKey('prop', b));
  assert.equal(iconCacheKey('prop', a), iconCacheKey('prop', structuredClone(a)));
});
test('queue dedupes and enforces one per frame', () => {
  const q = createIconQueue(); q.enqueue('a'); q.enqueue('a'); q.enqueue('b');
  assert.equal(q.size, 2); assert.equal(q.next(), 'a'); assert.equal(q.next(), null);
  q.tick(); assert.equal(q.next(), 'b'); assert.equal(q.next(), null);
});
test('queue prioritizes a changed/imported model without duplicate work', () => {
  const q = createIconQueue(2); q.enqueue('a'); q.enqueue('b'); q.enqueue('c'); q.enqueue('c', true);
  assert.equal(q.size, 3); assert.equal(q.next(), 'c'); assert.equal(q.next(), 'a'); assert.equal(q.next(), null);
  q.tick(); assert.equal(q.next(), 'b');
});
test('cache persists and hydrates in a fresh memory cache', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const c = createIconCache(storage), model = { voxel: { layers: [['x']] } }, key = c.key('a', model);
  c.set(key, 'data:image/png;base64,abc');
  assert.equal(createIconCache(storage).get(key), 'data:image/png;base64,abc');
  const changed = c.key('a', { voxel: { layers: [['.']] } });
  assert.notEqual(changed, key); assert.equal(c.get(changed), null); assert.equal(c.get(key), null);
  assert.equal(data.size, 0);
});
test('storage failures preserve memory and do not block invalidation', () => {
  const fail = () => { throw new Error('denied'); };
  const c = createIconCache({ getItem: fail, setItem: fail, removeItem: fail }), key = c.key('a', {});
  assert.equal(c.get(key), null); c.set(key, 'data:image/png;base64,a'); assert.equal(c.get(key), 'data:image/png;base64,a');
  c.key('a', { changed: true }); assert.equal(c.get(key), null);
});
test('corrupt storage values do not replace fallback', () => {
  assert.equal(createIconCache({ getItem: () => 'invalid' }).get('a'), null);
});
console.log(`iconFit: ${tests} PASS`);
