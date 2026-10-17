// ED-AI-01: the game's archetype/kind tables (built from content/beasts/*.json) equal the old in-code tables, and the editor
// validator's enum/order mirrors match archetypes.js. Run: node tools/beasts-data.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARCHETYPES, ARCH_NAMES, ARCH_AGGRO, ARCH_ROLES, ARCH_MEDIA, ARCH_WHEN } from '../game/js/quest/sim/archetypes.js';
import { KINDS, KIND_NAMES } from '../game/js/quest/sim/beastKinds.js';
import { ARCH_ENUMS, ARCH_ORDER } from './editor/ai/validate.js';

const base = JSON.parse(readFileSync(new URL('./editor/ai/fixtures/beasts-baseline.json', import.meta.url), 'utf8')); // captured before the move
assert.deepEqual(JSON.parse(JSON.stringify(ARCHETYPES)), base.ARCHETYPES, 'archetype table');
assert.deepEqual([...ARCH_NAMES], base.ARCH_NAMES);
assert.deepEqual(JSON.parse(JSON.stringify(KINDS)), base.KINDS, 'kind table');
assert.deepEqual([...KIND_NAMES], base.KIND_NAMES);
// New kinds append: these saved byte indices predate QD-04.
for (const [id, index] of [['fox', 4], ['grey_wolf', 5], ['skeleton_brute', 32], ['fox_raider', 33]]) assert.equal(KIND_NAMES.indexOf(id), index, 'stable kind index: ' + id);
assert.ok(Object.isFrozen(ARCHETYPES.grazer) && Object.isFrozen(KINDS.boar.attacks[0]) && Object.isFrozen(KINDS.boar.lv) && Object.isFrozen(KINDS.boar.group));
assert.equal(ARCHETYPES.skittish.leashR, 1e9);
assert.deepEqual(ARCH_ENUMS.aggro, [...ARCH_AGGRO]); assert.deepEqual(ARCH_ENUMS.role, [...ARCH_ROLES]);
assert.deepEqual(ARCH_ENUMS.medium, [...ARCH_MEDIA]); assert.deepEqual(ARCH_ENUMS.when, [...ARCH_WHEN]);
assert.deepEqual([...ARCH_ORDER], [...ARCH_NAMES]);
console.log('ED-AI-01 beasts-data.test OK');
