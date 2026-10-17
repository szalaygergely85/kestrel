// OB-184 part 4: forest floor look = mossy leaf litter (variant D); other looks unchanged. Run: node game/js/look/forestFloor.test.js
import assert from 'node:assert/strict';
import { buildGroundLookConfig, resolveLook } from './groundLookConfig.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
import terrainDef from '../../../design/levels/overworld_far.js';
globalThis.window = globalThis.window || globalThis;
terrainDef; biomeLookMod;
const BL = globalThis.BIOME_LOOK, recipe = globalThis.ASSETS.levels.overworld_far;
const T = {}; for (const [k, v] of Object.entries(recipe.terrain)) T[k] = v.id;
const cfg = buildGroundLookConfig(BL, T);
const fid = BL.order.indexOf('forest') + 1;
assert.equal(BL.biomes.forest.pick.ground, 'D');
for (const b of [1, 2, 3]) assert.equal(resolveLook(cfg, T.forest, b), fid, 'forest ground in biome ' + b + ' -> forest look');
const L = cfg.looks[fid - 1];
assert.equal(L.glyphs.length, 4); assert.ok(L.accents.length <= 2);
// non-forest looks byte-identical to the pre-change pick (their pick/ground data untouched)
for (const [name, pick] of [['meadow', 'A'], ['glade', 'A'], ['fields', 'A'], ['foothills', 'A'], ['shore', 'A']]) assert.equal(BL.biomes[name].pick.ground, pick, name);
assert.equal(resolveLook(cfg, T.grass, 0), BL.order.indexOf('meadow') + 1, 'meadow unchanged');
console.log('forestFloor tests ok');
