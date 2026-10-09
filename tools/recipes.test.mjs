import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import '../design/items.js';
import { validateContent, loadRecipeFile } from './validate-content.mjs';
import { createCrafting } from '../game/js/quest/sim/crafting.js';
import { ensureInventory, countOf } from '../game/js/quest/sim/inventory.js';

const path = new URL('../content/items/recipes.json', import.meta.url);
const source = JSON.parse(readFileSync(path, 'utf8'));
const items = globalThis.ASSETS.items.defs;
const assets = { items: { defs: items } };
const checked = file => validateContent(assets, { recipeFile: file }).errors;
assert.equal(source.version, 1);
assert.ok(source.recipes.length >= 3 && source.recipes.length <= 5);
assert.deepEqual(checked(source), [], 'production recipes resolve against actual item definitions');
const crafting = createCrafting(source.recipes, { items });
for (const recipe of source.recipes) {
  const empty = ensureInventory({ components: {} }, { pack: [], left: null, right: null });
  const before = JSON.stringify(empty);
  assert.equal(crafting.craft(empty, recipe.id).reason, 'missing-inputs');
  assert.equal(JSON.stringify(empty), before, 'production recipe refuses atomically without ingredients');
  const inv = ensureInventory({ components: {} }, { pack: recipe.inputs.map(row => ({ id: row.item, n: row.n })), left: null, right: null });
  assert.equal(crafting.canCraft(inv, recipe.id), true);
  assert.equal(crafting.craft(inv, recipe.id).ok, true);
  for (const input of recipe.inputs) assert.equal(countOf(inv, input.item), 0, 'exact production quantities consumed');
  assert.equal(countOf(inv, recipe.output.item), recipe.output.n);
  assert.equal(inv.left, null); assert.equal(inv.right, null, 'crafting does not equip');
}
const cases = [
  [file => { file.version = 2; }, 'version 1'],
  [file => { file.recipes = {}; }, 'recipes array'],
  [file => { file.recipes[0].inputs[0].item = 'unknown'; }, 'inputs[0].item'],
  [file => { file.recipes[0].output.item = 'unknown'; }, 'output.item'],
  [file => { file.recipes[0].inputs[0].item = 'cog'; }, 'pending owner'],
  [file => { file.recipes[0].output.item = 'orb.hp'; }, 'usable pack'],
  [file => { file.recipes[0].inputs[0].n = 0; }, 'invalid'],
  [file => { file.recipes[0].output.n = 1.5; }, 'invalid'],
  [file => { file.recipes[0].inputs = []; }, 'empty inputs'],
  [file => { file.recipes[0].inputs.push({ ...file.recipes[0].inputs[0] }); }, 'duplicate input'],
  [file => { file.recipes.push(structuredClone(file.recipes[0])); }, 'duplicate recipe'],
  [file => { file.recipes[0].id = '__proto__'; }, 'invalid'],
];
for (const [breakFile, finding] of cases) {
  const file = structuredClone(source); breakFile(file);
  assert.ok(checked(file).some(error => error.includes(finding)), finding);
}
const before = JSON.stringify(source); checked(source);
assert.equal(JSON.stringify(source), before, 'lint leaves source unchanged');
const dir = mkdtempSync(join(tmpdir(), 'kestrel-recipes-'));
assert.equal(dirname(resolve(dir)), resolve(tmpdir()), 'temporary cleanup stays in the temp directory');
try {
  const file = join(dir, 'recipes.json');
  writeFileSync(file, JSON.stringify(source));
  const loaded = loadRecipeFile(file);
  assert.deepEqual(loaded.errors, []); assert.deepEqual(loaded.recipeFile, source);
  writeFileSync(file, '{'); assert.ok(loadRecipeFile(file).errors[0].includes('read/parse failed'));
  assert.ok(loadRecipeFile(join(dir, 'missing.json')).errors[0].includes('read/parse failed'));
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('recipes: actual item refs, production craft/refuse quantities, lint/schema failures and file diagnostics PASS');
