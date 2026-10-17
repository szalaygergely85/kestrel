// FD-05 (OB-198/208): coarse world-stable alt-glyph dice. A 1/4-cell camera shift over a surface re-rolls clearly fewer alt choices
// than the old dice (non-grid texel dice and leaf-card world blocks); `aaAlt` off = old formula byte for byte.
// Run: node engine/render/aaAlt.test.js
import assert from 'node:assert/strict';
import { bindShading, bindLevel } from './MaterialTable.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import paletteModule from '../../design/palette.js';
import detailPassModule from '../../design/detail-pass.js';
import { loadLevel } from '../world/Level.js';
import { shadeCore } from './detailShade.js';
import { fogShapeCtx, folDiceJS, setAltDice, foliageBits, fogCellDirJS } from './fogShape.js';
import { SHADE_WGSL } from './gpu/wgsl/shade.wgsl.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));
let rec = null;
for (let i = 1; i < table.records.length; i++) { const r = table.records[i] && table.records[i].v2; if (r && r.grid) { rec = { ...r, grid: { ...r.grid, texel: true } }; break; } }
assert.ok(rec, 'fixture: a grid v2 material (texel dice = the non-grid branch)');
const terms = { cols: 40, rows: 20, dirX: 0, dirY: 1, planeX: 1, planeY: 0, horizonRow: 10, planeDistY: 20 };
Object.assign(fogShapeCtx, { on: true, mode: 0, terms, camX: 100, camY: 200, camZ: 1.5 });
const light = [0.8, 0.75, 0.7];
// footprint d texels per cell (tpc ~ 0.7 -> octave 0), 1/4-cell shift = d/4 in u
const run = (u, v, d) => shadeCore(table, rec, u, v, 1, 1e30, d, 0, 0, d, 4, 1, 2, light, {}).hA;
const d = 0.7 / rec.detail;
function flips() { let n = 0, tot = 4000; for (let i = 0; i < tot; i++) { const u = i * d, v = 3.1; if (run(u, v, d) !== run(u + d / 4, v, d)) n++; } return n / tot; }
setAltDice(false); const offFlip = flips();
// off = old formula (hash of the octave cell), checked against a second pass with fogShape off
fogShapeCtx.on = false; const offB = flips(); fogShapeCtx.on = true;
assert.equal(offFlip, offB, 'aaAlt off == fog ctx off (old dice)');
setAltDice(true); const onFlip = flips();
assert.ok(onFlip < offFlip * 0.75, `non-grid dice: 1/4-cell shift flips ${onFlip} vs old ${offFlip}`);
// leaf cards: world block x3 -> fewer flips for a 1/4-cell strafe
function leafFlips() {
  const dist = 10; let n = 0, tot = 0;
  const w = dist * Math.abs(fogCellDirJS(21, 10)[0] - fogCellDirJS(20, 10)[0]);
  for (let col = 0; col < 40; col++) for (let k = 0; k < 20; k++) {
    fogShapeCtx.camX = 100 + k * 0.37; const a = folDiceJS(col, 10, dist + k * 0.01, 1578);
    fogShapeCtx.camX += w / 4; const b = folDiceJS(col, 10, dist + k * 0.01, 1578); tot++; if (a !== b) n++;
  }
  fogShapeCtx.camX = 100; return n / tot;
}
setAltDice(false); const leafOff = leafFlips(); setAltDice(true); const leafOn = leafFlips();
assert.ok(leafOn < leafOff, `leaf dice: ${leafOn} vs ${leafOff}`);
// switch + WGSL twin
assert.equal(foliageBits() & 4, 4); setAltDice(false); assert.equal(foliageBits() & 4, 0); setAltDice(true);
assert.ok(/& 4u\) != 0u\) \{ hA = hashFast\(i32\(floor\(u \* ds \* 0\.25\)\)/.test(SHADE_WGSL) && /select\(1\.0, 3\.0, \(u32/.test(SHADE_WGSL), 'WGSL twin present');
console.log(`aaAlt.test: ALL PASS (non-grid flips ${(offFlip * 100).toFixed(1)}% -> ${(onFlip * 100).toFixed(1)}%, leaf ${(leafOff * 100).toFixed(1)}% -> ${(leafOn * 100).toFixed(1)}%)`);
