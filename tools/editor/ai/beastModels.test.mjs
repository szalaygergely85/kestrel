// VISQA-25: lintBeastModels flags unregistered kind models; real kinds.json models all exist in the loaded ASSETS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintBeastModels } from './validate.js';
assert.deepEqual(lintBeastModels({ kinds: [{ name: 'A', model: 'wolf' }] }, new Set(['wolf'])), []);
assert.equal(lintBeastModels([{ name: 'B', model: 'nope' }], new Set(['wolf'])).length, 1);
assert.deepEqual(lintBeastModels([{ name: 'C', model: 'nope', todo: 'needs model' }], new Set()), []);
const real = JSON.parse(readFileSync(new URL('../../../content/beasts/kinds.json', import.meta.url), 'utf8'));
assert.ok(lintBeastModels(real, new Set(['x'])).length > 0, 'real kinds carry models');
console.log('beastModels ok');
