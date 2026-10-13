import assert from 'node:assert/strict';
import { World } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { createVitals } from './sim/vitals.js';
import { VITALS_DEFAULTS as CFG } from './sim/vitalsConfig.js';
import { createSwimVitals } from './swimVitals.js';

const { assets } = await loadTestAssets();
const ev = { h: {}, on() { return () => {}; }, emit() {} };
const w = World.load({ name: 't', terrain: null, structures: [], entities: [{ id: 'player', type: 'player', x: 0, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } }], state: {} }, assets, {});
const pl = w.get('player').data, body = pl.components.body;
const v = createVitals(w, ev, CFG, {}); v.step(pl, false);
const sv = createSwimVitals(v);
const tick = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { sv.step(body, 1 / 60); v.step(pl, false); } };

body.swimming = true; tick(11.5);
assert.equal(v.dead, false); assert.ok(v.hp === 30 && sv.state.stamina > 0);
tick(2.2); assert.equal(v.hp, 20, 'first drown tick = 1 heart (10 hp)'); // ~13.1 s: empty at 12 + 1.5
tick(3.1); assert.equal(v.dead, true); assert.equal(v.deathCause, 'drown');
// reset on respawn: die, then respawn -> full stamina, no cause
assert.equal(v.dead, true);
for (let i = 0; i < 600 && !v.cardReady; i++) v.step(pl, false);
v.step(pl, true); // [E] on the death card respawns
assert.equal(v.dead, false); assert.equal(v.deathCause, null); assert.equal(v.hp, 30);
body.swimming = true; tick(0.1); assert.ok(sv.state.stamina > 90, 'full after respawn');
// refill on land
body.swimming = false; sv.state.stamina = 10; tick(0.5); assert.ok(sv.state.stamina > 20);
body.swimming = false; tick(6); assert.equal(sv.state.stamina, 100);
// diving drains twice as fast; drown ignores the invuln window
body.diving = true; body.swimming = false; tick(6.1); assert.equal(sv.state.stamina, 0); body.diving = false;
// 0 alloc
if (global.gc) { const m0 = process.memoryUsage().heapUsed; body.swimming = true; for (let i = 0; i < 20000; i++) sv.step(body, 1 / 60); assert.ok(process.memoryUsage().heapUsed - m0 < 2e5); }
console.log('swimVitals.test OK');
