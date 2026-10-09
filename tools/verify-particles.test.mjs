import assert from 'node:assert/strict';
import { diffCells, particleCells } from './verify-particles.mjs';
const a = new Uint8Array(16), b = new Uint8Array(16); b[4] = 9; b[15] = 1;
assert.deepEqual(diffCells(a, b), [1, 3]);
assert.deepEqual(particleCells(a, a, a, b), [1, 3]);
assert.deepEqual(diffCells(a, a), []);
console.log('verify-particles pure parts OK');
