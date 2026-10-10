import assert from 'node:assert/strict';
import { checkHandedness } from './gltf-handedness-check.mjs';
const r = checkHandedness();
// static loadGltf map is (x,y,z)->(x,-z,y): a proper rotation
assert.deepEqual(r.found.left, [1, 0, 0]);
assert.deepEqual(r.found.up, [0, 0, 1]);
assert.deepEqual(r.found.front, [0, -1, 0]);
assert.equal(r.verdict, 'CORRECT');
console.log('gltf-handedness-check: ok (' + r.verdict + ')');
