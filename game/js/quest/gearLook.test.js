import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gearRecipe } from './gearLook.js';
import { composeCharacter, randomRecipe } from '../../../engine/index.js';

const kit = JSON.parse(fs.readFileSync(new URL('../../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const defs = { cloak_1: { equip: { slot: 'cloak', shell: 'cloak', paint: 'walnut' } }, sword: { equip: { slot: 'main' } }, gl: { equip: { slot: 'hands', shell: 'gloves' } } };
const look = { ...kit.defaults };
assert.deepEqual(gearRecipe(look, {}, defs), look);
assert.deepEqual(gearRecipe(look, null, defs), look);
for (let s = 1; s <= 6; s++) { const r = randomRecipe(kit, s); assert.deepEqual(gearRecipe(r, { main: 'sword' }, defs), r); }
const g = gearRecipe(look, { cloak: 'cloak_1', main: 'sword', hands: 'gl' }, defs);
assert.deepEqual(g.cloak, { id: 'cloak', ramp: 'walnut' });
assert.deepEqual(g.hands, { id: 'gloves', ramp: 'undyed' });
assert.equal(look.cloak, undefined);
composeCharacter(kit, g); // valid against the kit
console.log('gearLook.test: ok');
