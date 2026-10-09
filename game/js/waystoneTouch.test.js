import assert from 'node:assert/strict';
import { createGameHooks } from './gameHooks.js';
import { createWaystoneTouch } from './waystoneTouch.js';

const hooks = createGameHooks();
const got = [];
hooks.register({ onEvent(n, d) { if (n === 'prop:touched') got.push({ ...d }); } });
const wt = createWaystoneTouch(hooks);
hooks.register(wt);
const player = { transform: { x: 50, y: 50, z: 0 } };
const world = { get: (id) => (id === 'endMarker' ? { data: { transform: { x: 10, y: 20, z: 3 } } } : null) };
hooks.boot(world, player, { on() {} }, null, null);
const st = hooks.ctx.state;
const at = (x, y, e = false) => { player.transform.x = x; player.transform.y = y; st.interactPressed = e; hooks.tick(1 / 60); };

at(30, 20); assert.equal(got.length, 0);
at(12, 20); assert.equal(got.length, 1);                       // walk in fires once
assert.deepEqual([got[0].id, got[0].kind, got[0].x, got[0].y, got[0].z], ['waystone', 'waystone', 10, 20, 3]);
at(11, 20); at(12, 20); at(10.5, 20); assert.equal(got.length, 1); // staying does not repeat
at(14, 20); assert.equal(got.length, 1);                       // inside hysteresis band: still armed-off
at(20, 20); at(12, 20); assert.equal(got.length, 2);           // leave + re-enter fires again
at(12, 20, true); assert.equal(got.length, 3);                 // E press in reach fires
at(30, 20, true); assert.equal(got.length, 3);                 // E press far away does not
at(20, 20); at(13, 20, true); assert.equal(got.length, 4);     // E press at 3 m (outside walk radius, inside use reach) fires
st.ending = true; at(20, 20); at(11, 20); assert.equal(got.length, 4); // no walk-in during ending
console.log('waystoneTouch OK');
