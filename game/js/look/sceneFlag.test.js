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
