import assert from 'node:assert/strict';
import { sceneOf, HOLD } from './sceneFlag.js';
// fake tower: one 4x4 level at origin (10,10), ceiling 3 m above z 0
const sec = { ceilH: 3 };
const world = { structVersion: 1, structures: [{ level: { width: 4, height: 4, sectorAt: () => sec }, origin: { x: 10, y: 10, z: 0 }, packed: { version: 1, ceilH: 3 } }] };
// buildRoofMap reads packed data; use a real-shaped probe via the module
const sc = {}; const p = { x: 50, y: 50, z: 0 };
assert.equal(sceneOf(world, p, sc), 'outdoor');
const roof = sc.roof; assert.ok(roof);
// stamp ceiling data directly so the test does not depend on packed internals
if (roof.count < 1) { roof.count = 1; roof.box.set([10, 10, 4, 4]); roof.yOff[0] = 0; roof.atlasW = 4; roof.atlasH = 4; roof.data = new Float32Array(16).fill(3); }
const step = (pos, n) => { let s; for (let i = 0; i < n; i++) s = sceneOf(null, pos, sc); return s; };
p.x = 11; p.y = 11; assert.equal(step(p, 10), 'outdoor', 'not flipped before HOLD');
assert.equal(step(p, Math.ceil(HOLD * 60) + 2), 'interior', 'inside tower -> interior');
p.x = 50; assert.equal(step(p, 10), 'interior', 'brief exit holds');
assert.equal(step(p, 40), 'outdoor', 'outside -> outdoor');
// doorway jitter: alternate every 5 ticks -> never flips
let flips = 0, prev = sc.scene;
for (let i = 0; i < 600; i++) { p.x = ((i / 5) | 0) % 2 ? 11 : 50; const s = sceneOf(null, p, sc); if (s !== prev) { flips++; prev = s; } }
assert.equal(flips, 0, 'doorway jitter no flicker');
// 0 alloc (heap delta tiny over many calls)
if (global.gc) { for (let i = 0; i < 1e5; i++) sceneOf(null, p, sc); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 1e5; i++) sceneOf(null, p, sc); const d = process.memoryUsage().heapUsed - h0; assert.ok(d < 200000, 'alloc ' + d); }
console.log('sceneFlag OK');
// SCENE-INTERIOR-2: mesh cover / canopy / underwater (fake supportAtOut: ceiling height by x-range)
{
  const mk = (ceilFn) => ({ structVersion: 1, structures: [], supportAtOut(g, o, io) { io[9] = ceilFn(io[0], io[1]); } });
  const run = (w, body, n = 90) => { const s = {}, q = { x: 50, y: 50, z: 0 }; let r; for (let i = 0; i < n; i++) r = sceneOf(i === 0 ? w : null, q, s, 1 / 60, body); return r; };
  assert.equal(run(mk(() => 3.5), null), 'interior', 'mesh roof 3.5 m up -> interior');
  assert.equal(run(mk(() => NaN), null), 'outdoor', 'open sky');
  assert.equal(run(mk((x, y) => (x === 50 && y === 50 ? 5 : NaN)), null), 'outdoor', 'canopy over 1 of 5 points -> outdoor');
  assert.equal(run(mk(() => 30), null), 'outdoor', 'far overhead (cliff/bridge) -> outdoor');
  assert.equal(run(mk(() => NaN), { diving: true }), 'underwater', 'diving -> underwater');
  assert.equal(run(mk(() => 3), { diving: true }), 'underwater', 'underwater wins');
  if (global.gc) { const w = { structVersion: 1, structures: [], supportAtOut(g, o, io) { io[9] = 3.5; } }, s = {}, q = { x: 1, y: 1, z: 0 }, b = { diving: false }; sceneOf(w, q, s, 1 / 60, b); for (let i = 0; i < 3e5; i++) sceneOf(null, q, s, 1 / 60, b); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 3e5; i++) sceneOf(null, q, s, 1 / 60, b); const d = process.memoryUsage().heapUsed - h0; assert.ok(d < 200000, 'cover alloc ' + d); }
}
console.log('sceneFlag2 OK');
