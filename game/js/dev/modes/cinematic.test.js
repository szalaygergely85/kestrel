import assert from 'node:assert/strict';
import { validatePath, evaluatePath, createPlayback } from './cinematic.js';

const key = (t, x, yawDeg, ease = 'linear') => ({ t, x, y: x * 2, z: x * 3, yawDeg, pitchDeg: x * 20, ease });
const path = validatePath({ version: 1, id: 'probe', fps: 30, keys: [key(0, 0, 350), key(1, 1, 10), key(2, 2, 30, 'smooth')] });
const out = {};
for (const k of path.keys) {
  evaluatePath(path, k.t, out);
  assert.equal(out.x, k.x); assert.equal(out.y, k.y); assert.equal(out.z, k.z); assert.equal(out.yawDeg, k.yawDeg);
}
assert.equal(evaluatePath(path, 0.5, out).yawDeg, 0);
assert.equal(evaluatePath(path, -1, out).x, 0);
assert.equal(evaluatePath(path, 4, out).x, 2);
const smooth = { ...path, keys: [key(0, 0, 350, 'smooth'), key(1, 1, 10)] };
assert.equal(evaluatePath(smooth, 0, out).x, 0);
assert.equal(evaluatePath(smooth, 1, out).x, 1);
assert.ok(evaluatePath(smooth, 0.25, out).x < evaluatePath(path, 0.25, {}).x);
assert.equal(evaluatePath({ ...path, keys: [key(0, 0, 0), key(1, 10, 0)] }, 1, out).pitchDeg, 60);
for (const bad of [{ ...path, fps: 24 }, { ...path, keys: [path.keys[0]] }, { ...path, keys: [key(1, 0, 0), key(0, 1, 0)] }, { ...path, timeOfDay: { startH: 12, endH: 18 } }]) assert.throws(() => validatePath(bad));
let ticks = 0, renders = 0;
const playback = createPlayback(path, (dt) => { assert.equal(dt, 1 / 60); ticks++; }, () => renders++);
assert.equal(playback.frames, 61);
await playback.step(0); assert.equal(ticks, 0);
await playback.step(1); await playback.step(2);
assert.equal(ticks, 4); assert.equal(renders, 3);
await assert.rejects(() => playback.step(2));
await assert.rejects(() => playback.step(4));
console.log('cinematic: 33 assertions PASS');
