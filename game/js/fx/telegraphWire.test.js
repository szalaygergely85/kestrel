import assert from 'node:assert/strict';
import { wireTelegraphs, telegraphsEnabled } from './telegraphWire.js';

const mk = () => ({ count: 1, state: new Uint8Array(4), hurtT: new Int32Array(4).fill(9999), entities: [{ id: 'b' }], cfgSteps: { windup: 60 } });
const sim = mk(), bus = { on: () => () => {} };
const w = wireTelegraphs(bus, {}, sim);
const tint = () => sim.entities[0].components && sim.entities[0].components.tint;
w.step(100); assert.equal(tint(), undefined);
sim.state[0] = 3; w.step(200);
assert.equal(tint().name, 'windup'); assert.equal(tint().startMs, 200);
w.step(216); assert.equal(tint().startMs, 200); // no retrigger while staying in windup
sim.hurtT[0] = 0; w.step(300);
assert.equal(tint().name, 'hurt'); assert.equal(tint().startMs, 300);
sim.hurtT[0] = 1; sim.state[0] = 4; w.step(316); sim.state[0] = 5; w.step(332);
assert.equal(tint().name, 'hit');
assert.equal(wireTelegraphs(bus, {}, sim, telegraphsEnabled(new URLSearchParams('fx=0'), false)), null);
assert.equal(telegraphsEnabled(new URLSearchParams(''), true), false);
// zero alloc per step
const before = process.memoryUsage().heapUsed;
for (let k = 0; k < 200000; k++) w.step(k);
assert.ok(process.memoryUsage().heapUsed - before < 2e6, 'step allocates');
console.log('telegraphWire ok');
