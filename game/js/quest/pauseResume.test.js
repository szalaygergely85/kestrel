// OB-068 / OB-072: pause menu Esc = resume (state machine), gesture re-lock, retry, keyboard-lock soft pause.
import assert from 'node:assert/strict';
import { createPauseResume, RETRY_MS } from './pauseResume.js';
const keys = new Set(); const input = { pressed: (c) => keys.has(c) };
let locks = 0; const pending = []; const timers = { set: (f, ms) => { pending.push({ f, ms }); return pending.length; }, clear: (t) => { pending[t - 1] = null; } };
const r = createPauseResume(() => { locks++; }, timers);
const pauseUp = (locked) => (!locked || r.soft) && !r.active; // mirrors main.js pauseUp()
assert.equal(pauseUp(false), true, 'unlocked: pause up');
r.resume(); assert.equal(locks, 1, 'immediate lock attempt'); assert.equal(r.active, true);
assert.equal(pending.length, 1); assert.equal(pending[0].ms, RETRY_MS, 'one retry scheduled ~1.1 s later');
r.tick(false, input); assert.equal(pauseUp(false), false, 'resumed-unlocked: no pause menu');
r.click(); assert.equal(locks, 2, 'click requests the lock');
// gesture: pointerdown / non-Esc keydown retries; Esc never; refused request keeps waiting
assert.equal(r.gesture('KeyW'), true); assert.equal(locks, 3, 'key gesture requests the lock');
assert.equal(r.gesture('Escape'), false); assert.equal(locks, 3, 'Esc is not a gesture');
r.tick(false, input); assert.equal(r.active, true, 'lock refused (no change event): stays waiting');
assert.equal(r.gesture('Mouse0'), true); assert.equal(locks, 4, 'retry on the next gesture');
pending[0].f(); assert.equal(locks, 5, 'timed retry while still waiting');
// second Esc: pause up again, and that Esc is consumed
let consumed = 0; const inp2 = { pressed: (c) => c === 'Escape', consumePressed: () => { consumed++; } };
r.tick(false, inp2); assert.equal(pauseUp(false), true, 'second Esc: pause up again'); assert.equal(consumed, 1, 'that Esc is consumed');
assert.equal(r.gesture('KeyW'), false, 'no gesture lock when not resumed'); r.click(); assert.equal(locks, 5, 'click when not resumed: no extra request');
// lock taken ends resumed state and cancels the timer
r.resume(); const n = pending.length; r.tick(true, input); assert.equal(r.active, false, 'lock taken ends resumed state');
assert.equal(pending[n - 1], null, 'timer cleared');
// timer after the state ended does nothing
const r2 = createPauseResume(() => { locks++; }, { set: (f) => { r2f = f; return 1; }, clear: () => {} }); let r2f; r2.resume(); r2.reset(); const b = locks; r2f(); assert.equal(locks, b, 'stale retry is a no-op');
// keyboard-lock path: Esc keydown while locked toggles pause WITHOUT unlocking
const k = createPauseResume(() => { locks++; }, timers); const before = locks;
k.softPause(); k.tick(true, input); assert.equal(k.soft, true, 'soft pause survives a locked tick'); assert.equal(k.active, false);
k.resume(); assert.equal(k.soft, false, 'Esc again closes the soft pause'); assert.equal(k.active, false, 'no resumed-unlocked state'); assert.equal(locks, before, 'no lock request needed');
k.softPause(); k.tick(false, input); assert.equal(k.soft, false, 'lock lost for another reason: soft pause ends');
// requestLock throwing is handled quietly
const q = createPauseResume(() => { throw new Error('refused'); }, timers); q.resume(); assert.equal(q.active, true, 'throwing lock handled quietly'); assert.equal(q.gesture('Enter'), true);
console.log('pauseResume.test OK');
