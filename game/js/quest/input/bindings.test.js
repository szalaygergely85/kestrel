import assert from 'node:assert/strict';
import { createBindings, DEFAULT_BINDINGS } from './bindings.js';

const bindings = createBindings();
assert.deepEqual(bindings.get('keyboard', 'run'), ['ShiftLeft', 'ShiftRight']);
assert.deepEqual(bindings.get('gamepad', 'jump'), [], 'current host has no gamepad defaults');
const initial = JSON.stringify(bindings.serialize());
assert.deepEqual(bindings.rebind('keyboard', 'jump', 'KeyW'), { ok: false, reason: 'conflict', conflict: 'forward' });
assert.equal(JSON.stringify(bindings.serialize()), initial, 'refusal is atomic');
assert.equal(bindings.conflict('keyboard', 'jump', 'ShiftRight'), 'run', 'secondary key conflicts too');
assert.equal(bindings.rebind('keyboard', 'jump', 'KeyU').ok, true);
assert.deepEqual(bindings.get('keyboard', 'jump'), ['KeyU']);
assert.equal(bindings.conflict('keyboard', 'jump', 'KeyU'), null, 'same action is not a conflict');
assert.equal(bindings.rebind('gamepad', 'jump', 'Button0').ok, true);
assert.equal(bindings.rebind('gamepad', 'interact', 'Button0').conflict, 'jump');
assert.equal(bindings.rebind('gamepad', 'forward', 'Axis1-').ok, true);
assert.equal(bindings.rebind('gamepad', 'backward', 'Axis1+').ok, true, 'signed axis ends distinct');
assert.deepEqual(bindings.get('keyboard', 'forward'), ['KeyW'], 'devices independent');
const snapshot = bindings.serialize(), text = JSON.stringify(snapshot);
const restored = createBindings(JSON.parse(text));
assert.equal(JSON.stringify(restored.serialize()), text, 'byte-stable settings JSON round trip');
snapshot.keyboard.jump[0] = 'KeyZ';
assert.deepEqual(bindings.get('keyboard', 'jump'), ['KeyU'], 'snapshot is detached');
assert.deepEqual(restored.get('keyboard', 'jump'), ['KeyU'], 'restore is detached');
assert.throws(() => bindings.get('keyboard', 'jump').push('KeyZ'), 'query list immutable');
bindings.reset('keyboard');
assert.deepEqual(bindings.serialize().keyboard, DEFAULT_BINDINGS.keyboard);
assert.deepEqual(bindings.get('gamepad', 'jump'), ['Button0'], 'device reset isolated');
bindings.reset();
assert.equal(JSON.stringify(bindings.serialize()), initial, 'reset restores defaults');
bindings.rebind('keyboard', 'forward', null);
assert.equal(bindings.rebind('keyboard', 'jump', 'KeyW').ok, true, 'unbinding releases code');
assert.deepEqual(createBindings({ version: 1, keyboard: { jump: ['KeyU'] } }).get('keyboard', 'forward'), ['KeyW']);
for (const [device, code] of [['keyboard', 'Button0'], ['keyboard', ''], ['gamepad', 'KeyJ'], ['gamepad', 'Button32'], ['gamepad', 'Axis16+'], ['gamepad', 'Axis1']]) {
  const before = JSON.stringify(bindings.serialize());
  assert.throws(() => bindings.rebind(device, 'jump', code));
  assert.equal(JSON.stringify(bindings.serialize()), before, 'invalid rebind changes nothing');
}
assert.throws(() => bindings.rebind('mouse', 'jump', 'Mouse0'));
assert.throws(() => bindings.rebind('keyboard', '__proto__', 'KeyZ'));
for (const saved of [{ version: 2 }, [], { version: 1, gamepad: [] },
  { version: 1, keyboard: { jump: ['KeyW'] } },
  { version: 1, keyboard: { jump: ['KeyU', 'KeyU'] } },
  { version: 1, keyboard: { bogus: ['KeyU'] } }]) assert.throws(() => createBindings(saved));
console.log('bindings.test.js: defaults, atomic conflicts, reset, device isolation and settings round trip PASS');
