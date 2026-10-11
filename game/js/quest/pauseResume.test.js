// OB-068: pause menu Esc = resume (state machine).
import assert from 'node:assert/strict';
import { createPauseResume } from './pauseResume.js';
const keys = new Set(); const input = { pressed: (c) => keys.has(c) };
let locks = 0; const r = createPauseResume(() => { locks++; });
const pauseUp = (locked) => !locked && !r.active; // mirrors main.js pauseUp()'s new clause
assert.equal(pauseUp(false), true, 'unlocked: pause up');
r.resume(); assert.equal(locks, 1, 'immediate lock attempt'); assert.equal(r.active, true);
r.tick(false, input); assert.equal(pauseUp(false), false, 'resumed-unlocked: no pause menu');
r.click(); assert.equal(locks, 2, 'click requests the lock');
keys.add('Escape'); r.tick(false, input); keys.clear(); assert.equal(pauseUp(false), true, 'second Esc: pause up again');
r.click(); assert.equal(locks, 2, 'click when not resumed: no extra request');
r.resume(); r.tick(true, input); assert.equal(r.active, false, 'lock taken ends resumed state');
const q = createPauseResume(() => { throw new Error('refused'); }); q.resume(); assert.equal(q.active, true, 'throwing lock handled quietly');
console.log('pauseResume.test OK');
