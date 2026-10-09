import assert from 'node:assert/strict';
import { motionSeries, runRow, stableRatio } from './flickerMeasure.js';

const cols = 4, rows = 2, n = cols * rows;
// frame generator: all cells kind 1; glyph byte = f(cam, cell)
const mk = (glyphOf) => (cam) => {
  const GI = new Uint32Array(4 * n), fg = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) { GI[i * 4] = 7; GI[i * 4 + 1] = 1; fg[i * 4 + 3] = glyphOf(cam, i); }
  return { GI, fg };
};
const base = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 };
const d = { dx: 1, dy: 0, dyaw: 0 };

let r = await motionSeries(mk(() => 5), base, d, 3, cols, rows);
assert.equal(r.total, 0, 'static glyphs -> 0 %');
// half the cells flip every step (cells 0..3 toggle with parity of x) -> 50 %
r = await motionSeries(mk((c, i) => (i < 4 ? c.x % 2 : 0)), base, d, 4, cols, rows);
assert.equal(r.total, 50);
// async castFrame + onStart called once per series; N vs N-1 (not vs base)
let starts = 0;
const calls = [];
const cast = async (cam) => { calls.push(cam.x); return mk((c) => c.x >= 2 ? 9 : 1)(cam); };
r = await motionSeries(cast, base, d, 3, cols, rows, { onStart: () => starts++ });
assert.equal(starts, 1); assert.deepEqual(calls, [0, 1, 2, 3]);
assert.ok(Math.abs(r.total - 100 / 3) < 1e-9, 'only the 1->2 step changes all cells: ' + r.total);
// collect
const col = []; await motionSeries(mk(() => 1), base, d, 2, cols, rows, { collect: col });
assert.equal(col.length, 2); assert.equal(col[1].x, 2);
// row = mean of three series
const row = await runRow(mk((c, i) => (i < 4 ? Math.round(c.x + c.y + c.yawDeg) % 2 : 0)), base,
  { fwd: d, strafe: { dx: 0, dy: 1, dyaw: 0 }, yaw: { dx: 0, dy: 0, dyaw: 0 } }, 4, cols, rows);
assert.equal(row.fwd, 50); assert.equal(row.strafe, 50); assert.equal(row.yaw, 0);
assert.ok(Math.abs(row.avg - 100 / 3) < 1e-9);
assert.equal(stableRatio(3, 10), 0.3); assert.ok(Number.isNaN(stableRatio(1, 0)));
console.log('flickerMeasure.test.js ok');
