// Guard (walk5): Loop.update in main.js must reach the world as engine.world - a bare `world.` in the underCreep step threw ReferenceError
// every frame (world is only a local of the boot function), freezing the whole sim (wake never ran, no quest could progress).
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8').split('\n');
const line = src.find((l) => l.includes('underCreep.step('));
assert.ok(line, 'underCreep step line exists');
assert.ok(/engine\.world\.structureAt\(/.test(line), 'underCreep step uses engine.world.structureAt');
assert.ok(!/[^.\w]world\.structureAt\(/.test(line), 'no bare world.structureAt in the update loop');
console.log('mainCreepScope: 3 pass');
