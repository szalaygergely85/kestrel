import assert from 'node:assert/strict';
import '../../../design/levels/world_geo.js';
import { SEA_EDGE_CONFIG as C, createShore, createSeaEdgeOut, seaEdgeState, inSea } from './seaEdge.js';

const G = globalThis.ASSETS.levels.world_geo;
const shore = createShore(G.coast);
const out = createSeaEdgeOut();
// Strand shore segment (1450,1760)->(1600,1780): sea lies south (+y). Probe straight south of its midpoint.
const mx = 1525, my = 1770;
const at = (dy) => seaEdgeState({ x: mx, y: my + dy }, shore, out);

assert.equal(at(-30).name, 'safe', 'on the beach');
assert.equal(at(10).name, 'safe', 'shallows');
assert.equal(at(70).name, 'warn', 'warn band');
assert.ok(at(70).dist >= C.warnM && at(70).dist < C.killM);
assert.equal(at(100).name, 'kill', 'kill band');
assert.equal(out.strike, true);

// hysteresis: warn border
at(0); assert.equal(at(C.warnM + 2).state, 1);
assert.equal(at(C.warnM - 2).state, 1, 'stays warn inside the hysteresis band');
assert.equal(at(C.warnM - C.hysteresisM - 3).state, 0, 'drops below it');
assert.equal(at(C.warnM - 2).state, 0, 'safe does not re-enter until the border');
// kill border
at(C.killM + 5); assert.equal(out.state, 2);
assert.equal(at(C.killM - 2).state, 2);
assert.equal(at(C.killM - C.hysteresisM - 3).state, 1);

// spawn point: in the water, beyond the player (farther from shore), on the open-sea side
at(70);
const px = mx, py = my + 70;
assert.ok(inSea(shore, out.spawnX, out.spawnY), 'spawn in water');
assert.ok(out.spawnY > py && Math.hypot(out.spawnX - mx, out.spawnY - my) > Math.hypot(px - mx, py - my), 'further out than the player');

// 0 alloc: object identity
assert.equal(seaEdgeState({ x: mx, y: my + 70 }, shore, out), out);
console.log('seaEdge ok');
