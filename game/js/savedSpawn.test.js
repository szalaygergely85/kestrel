// AUD2-03: Continue passes the saved player xy as World.load `spawn` (one band bake). Run: node game/js/savedSpawn.test.js
import assert from 'node:assert/strict';
import { savedSpawn } from './saveRelay.js';
assert.deepEqual(savedSpawn({ world: { entities: [{ id: 'x', transform: { x: 1, y: 2 } }, { id: 'player', transform: { x: 1495.5, y: 40, z: 3 } }] } }), { x: 1495.5, y: 40 });
assert.equal(savedSpawn({ world: { entities: [] } }), null);
assert.equal(savedSpawn({ world: { entities: [{ id: 'player', transform: { x: NaN, y: 1 } }] } }), null);
assert.equal(savedSpawn(null), null);
// fake world: band choice follows opts.spawn, so a spawn-aware load bakes once, a spawn-less load bakes zone 0 then ensureBandFor bakes again
function fakeLoad(opts) { const w = { bakes: 0, cur: -1, bandOf: (x) => (x > 1000 ? 1 : 0) };
  w.cur = opts.spawn ? w.bandOf(opts.spawn.x) : 0; w.bakes++;
  w.ensureBandFor = (x) => { const b = w.bandOf(x); if (b !== w.cur) { w.cur = b; w.bakes++; } }; return w; }
const save = { world: { entities: [{ id: 'player', transform: { x: 1495.5, y: 40 } }] } };
const a = fakeLoad({}); a.ensureBandFor(1495.5); assert.equal(a.bakes, 2);
const b = fakeLoad({ spawn: savedSpawn(save) }); b.ensureBandFor(1495.5); assert.equal(b.bakes, 1);
console.log('savedSpawn: ok');
