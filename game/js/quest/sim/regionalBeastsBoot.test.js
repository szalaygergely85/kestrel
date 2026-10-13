// WM-12: boot helper calls spawnRegionalBeasts once on the default world, never in legacy (?grid=0) or capture/bench.
import assert from 'node:assert/strict';
import { bootRegionalBeasts } from './regionalBeastsBoot.js';
const P = (s) => new URLSearchParams(s);
const run = (world, params, cap) => { const calls = []; const r = bootRegionalBeasts(world, { g: 1 }, params, cap, (w, g, seed) => calls.push(seed)); return { r, calls }; };
let o = run({ terrainGrid: {} }, P(''), false);
assert.deepEqual(o, { r: true, calls: [12] });
assert.equal(run({ terrainGrid: {} }, P('grid=0'), false).calls.length, 0);
assert.equal(run({ terrainGrid: {} }, P(''), true).calls.length, 0);
assert.equal(run({}, P(''), false).calls.length, 0);
console.log('regionalBeastsBoot.test: PASS');
