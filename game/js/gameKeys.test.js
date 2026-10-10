import assert from 'node:assert/strict';
import { createSafeBindings, resolveGameKeys } from './gameKeys.js';
import { readFileSync } from 'node:fs';

// Golden: the codes main.js used before BINDINGS-WIRE-01.
const GOLDEN = { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', run: 'ShiftLeft', run2: 'ShiftRight',
  jump: 'Space', interact: 'KeyE', useLeft: 'Mouse0', useRight: 'Mouse2', swapHands: 'KeyH', map: 'KeyM', mute: 'KeyN', questLog: 'KeyJ' };
const K = resolveGameKeys(createSafeBindings(null));
assert.deepEqual({ ...K }, GOLDEN, 'default table resolves to today\'s keys');
assert.ok(Object.isFrozen(K));
// bad saved snapshots fall back to defaults
for (const bad of [{ version: 2 }, { version: 1, keyboard: { jump: ['KeyW'] } }, { version: 1, keyboard: { nope: ['KeyZ'] } },
  { version: 1, keyboard: { jump: ['Button0'] } }, 'x', []])
  assert.deepEqual({ ...resolveGameKeys(createSafeBindings(bad)) }, GOLDEN, 'fallback ' + JSON.stringify(bad));
// valid saved entry applies; gamepad table stays empty
const b = createSafeBindings({ version: 1, keyboard: { jump: ['KeyU'] } });
assert.equal(resolveGameKeys(b).jump, 'KeyU');
assert.deepEqual(b.get('gamepad', 'jump'), []);
for (const a of ['forward', 'interact', 'map', 'mute']) assert.deepEqual(createSafeBindings(null).get('gamepad', a), []);
// no hard-coded gameplay codes left in main.js input calls (debug F-keys, KeyR ending restart excluded)
const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const left = src.match(/input\.(?:pressed|isDown|down)\('(?:Key[WASDEHMN]|Space|ShiftLeft|ShiftRight|Mouse[02])'\)/g);
assert.equal(left, null, 'main.js gameplay keys go through gameKeys: ' + left);
console.log('gameKeys.test PASS');
