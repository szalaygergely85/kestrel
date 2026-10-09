// CRAFT-VIEW-01: crafting list view against the real crafting sim + real recipes.json.
// Run: node --expose-gc game/js/ui/craftView.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import itemsMod from '../../../design/items.js';
import invStyleMod from '../../../design/models/inventory_ui.js';
import paletteMod from '../../../design/palette.js';
import { ensureInventory, countOf } from '../quest/sim/inventory.js';
import { createCrafting } from '../quest/sim/crafting.js';
import { createCraftView } from './craftView.js';
import { CRAFT_TEXT } from './craftText.js';

paletteMod; itemsMod; invStyleMod;
const A = globalThis.ASSETS, defs = A.items.defs, rgb = A.uiStyle.inventory.rgb;
const recipes = JSON.parse(readFileSync(new URL('../../../content/items/recipes.json', import.meta.url))).recipes;
const crafting = createCrafting(recipes, { items: defs });
const inv = ensureInventory({ components: {} }, { pack: [{ id: 'boar.hide', n: 2 }, { id: 'brass.scrap', n: 1 }], left: null, right: null });
const view = createCraftView({ crafting, recipes, defs, rgb, inventoryOf: () => inv });
const ui = createUiLayer({ cols: 160 });
const keys = new Set();
const input = { pressed: k => keys.has(k), consumePressed: () => keys.clear() };
const press = k => { keys.add(k); view.step(1 / 60, input); };
const rowText = y => { let s = ''; for (let x = 0; x < ui.cols; x++) s += String.fromCharCode(32 + ui.cells.glyphIdx[y * ui.cols + x]); return s; };
const lines = () => { const a = []; for (let y = 0; y < ui.rows; y++) a.push(rowText(y)); return a; };

// text contract: <= 38 chars, ascii
for (const [k, v] of Object.entries(CRAFT_TEXT)) { assert.ok(v.length <= 38, k); assert.match(v, /^[\x20-\x7e]+$/, k); }

// closed: draws nothing and step never opens it
view.draw(ui); assert.ok(!lines().join('').trim());
view.step(1 / 60, input); assert.equal(view.isOpen, false);
view.open(); ui.clear(); view.draw(ui);
const L = lines(), screen = L.join('\n');
for (const r of recipes) assert.ok(screen.includes(defs[r.output.item].name), 'lists ' + r.id);
assert.ok(screen.includes(defs['boar.hide'].name + ' 2/2'), 'have/need shown (met)');
assert.ok(screen.includes(defs['brass.scrap'].name + ' 1/4'), 'missing count shown (scrap 1/4)');

// order is stable: recipes appear top to bottom in data order
const ys = recipes.map(r => L.findIndex(l => l.includes(defs[r.output.item].name)));
assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'list order stable');

// dimmed vs available: torch craftable, shield not; missing ingredient in ember
const fgAt = needle => {
  for (let y = 0; y < L.length; y++) { const x = L[y].indexOf(needle); if (x >= 0) { const i = (y * ui.cols + x) * 4; return [...ui.cells.fg.slice(i, i + 3)]; } }
  return null;
};
assert.deepEqual(fgAt(defs.shield.name), rgb.uiDim, 'unavailable recipe dimmed');
assert.notDeepEqual(fgAt(defs.torch.name), rgb.uiDim, 'available recipe not dimmed');
assert.deepEqual(fgAt(defs['brass.scrap'].name + ' 1/4'), rgb.ember, 'missing ingredient flagged');

// craft with missing inputs -> no-op + reason line
press('KeyS'); assert.equal(view.selected, 1);
const before = JSON.stringify(inv); press('Enter');
assert.equal(JSON.stringify(inv), before); assert.equal(view.resultLine, CRAFT_TEXT.missing);

// selection wraps both ways
press('KeyS'); press('KeyS'); assert.equal(view.selected, 0, 'down wraps');
press('ArrowUp'); assert.equal(view.selected, recipes.length - 1, 'up wraps');
press('ArrowDown'); assert.equal(view.selected, 0);

// craft the torch: consumes inputs, adds output once, via the sim
press('Enter');
assert.equal(countOf(inv, 'boar.hide'), 0); assert.equal(countOf(inv, 'brass.scrap'), 0); assert.equal(countOf(inv, 'torch'), 1);
assert.equal(view.resultLine, CRAFT_TEXT.made.replace('{name}', defs.torch.name));
press('Enter'); assert.equal(countOf(inv, 'torch'), 1, 'second Enter without inputs is a no-op');

press('Escape'); assert.equal(view.isOpen, false);

// zero allocation per frame
view.open(); view.draw(ui);
globalThis.gc?.();
const m0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e4; i++) view.draw(ui);
globalThis.gc?.();
const grew = process.memoryUsage().heapUsed - m0;
assert.ok(grew < 512 * 1024, 'no per-frame allocation, heap grew ' + grew);
console.log('craftView: list, dim + have/need, craft consume/add, no-op reason, wrap, esc, 1e4 draws (+' + grew + ' B) PASS');
