// AA-15 (OB-208): folDiceJS - leaf-card glyph dice keyed on a world block (twin of WGSL folDice in shade.wgsl.js).
import assert from 'node:assert/strict';
import { fogShapeCtx, folDiceJS, setFoliageDice } from './fogShape.js';
import { SHADE_WGSL } from './gpu/wgsl/shade.wgsl.js';

// shear terms: 40 cols looking +y (dirX 0, dirY 1), plane along x, horizon row 10.
const terms = { cols: 40, rows: 20, dirX: 0, dirY: 1, planeX: 1, planeY: 0, horizonRow: 10, planeDistY: 20 };
Object.assign(fogShapeCtx, { on: true, mode: 0, terms, camX: 100, camY: 200, camZ: 1.5 });

// 1) deterministic, in [0,1)
const a = folDiceJS(20, 10, 10, 601 + 977);
assert.equal(a, folDiceJS(20, 10, 10, 601 + 977));
assert.ok(a >= 0 && a < 1);
// 2) world-anchored: the camera steps 2 cm forward and the cell sees the same world point 2 cm closer -> same die (block 0.5 m < 16 m)
fogShapeCtx.camY = 200.02;
assert.equal(folDiceJS(20, 10, 9.98, 601 + 977), a, 'same world point -> same die after a small step');
// 3) a point several blocks away re-rolls for at least one of a few samples (dice vary across the canopy)
let differs = false;
for (let k = 1; k <= 6; k++) if (folDiceJS(20, 10, 9.98 + k * 0.6, 601 + 977) !== a) differs = true;
assert.ok(differs, 'different blocks give different dice');
// 4) switch: default on, setFoliageDice toggles the ctx flag the twin + passShade read
assert.equal(fogShapeCtx.aaFol, true);
setFoliageDice(false); assert.equal(fogShapeCtx.aaFol, false); setFoliageDice(true);
// 5) WGSL twin present and gated on fogView.w + F_SOFT_EDGE (65536)
assert.ok(/fn folDice\(/.test(SHADE_WGSL) && /su\.fogView\.w > 0\.5/.test(SHADE_WGSL) && /& 65536\) != 0/.test(SHADE_WGSL));
console.log('folDice.test: ALL PASS');
