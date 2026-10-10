// AUD-30: overworld_far bake() 1-heightAt-per-sample path == the legacy heightAt()+typeAt() per sample (bit-identical).
// Run: node engine/world/bakeParity.test.js   (BAKE_BENCH=1 prints median ms of the new vs legacy 5x3 band bake)
import terrainDef from '../../design/levels/overworld_far.js';
import { makeOk } from '../test/assert.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 };
recipe.structures[0].ringHAt = () => 2.4;
const util = recipe.util;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));

function legacy(x0, y0, cell, w, h) {
  const height = new Float32Array(w * h), type = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
    height[i + j * w] = util.heightAt(x, y); type[i + j * w] = util.typeAt(x, y);
  }
  return { height, type };
}
function same(a, b) {
  for (let i = 0; i < a.height.length; i++) if (a.height[i] !== b.height[i] || a.type[i] !== b.type[i]) return i;
  return -1;
}
const cs = 128, nc = 2, n = cs / nc;  // chunk 128 m, near cell 2 m == slopeEps
for (const [cx0, cy0] of [[9, 7], [0, 0], [3, 12]]) {
  const w = 5 * n, h = 3 * n, x0 = cx0 * cs, y0 = cy0 * cs;
  const bad = same(util.bake(x0, y0, nc, w, h), legacy(x0, y0, nc, w, h));
  ok(`band ${cx0},${cy0} 5x3 bit-identical (first diff ${bad})`, bad === -1);
}
const bf = util.bake(0, 0, 8, 40, 40);                     // cell != slopeEps: old path kept
ok('far-cell bake unchanged', same(bf, legacy(0, 0, 8, 40, 40)) === -1);

if (process.env.BAKE_BENCH) {
  const med = (f) => { const t = []; for (let k = 0; k < 5; k++) { const s = performance.now(); f(); t.push(performance.now() - s); } return t.sort((a, b) => a - b)[2]; };
  const x0 = 9 * cs, y0 = 7 * cs, w = 5 * n, h = 3 * n;
  console.log('bake ms new', med(() => util.bake(x0, y0, nc, w, h)).toFixed(1), 'legacy', med(() => legacy(x0, y0, nc, w, h)).toFixed(1));
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
console.log('ALL PASS');
