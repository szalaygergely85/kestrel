// BEAST-07b determinism: the same seed + region run twice (fresh World, nav, sim, wire; 600 steps each) must end in the identical hash.
import assert from 'node:assert/strict';
import { roamScene, simulate } from './beastRoutesKit.js';

const A = simulate(roamScene('downs'), 600), B = simulate(roamScene('downs'), 600);
assert.ok(A.hash.length > 4 && A.gs.length >= 2, 'hash has content: ' + A.hash.length);
assert.equal(A.hash, B.hash, 'deterministic over 2 runs');
console.log('beastRoutes.det.e2e.test: PASS');
