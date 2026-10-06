// engine/ui/uiLayer.test.js (OWN-REQ-003). Headless Node ESM, no framework.
// Run: node engine/ui/uiLayer.test.js
import { createUiLayer, clampUiCols, UI_GRID_ASPECT } from './uiLayer.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- clampUiCols ----
{
  ok('below min -> clamped to 96', clampUiCols(50) === 96);
  ok('above max -> clamped to 320', clampUiCols(999) === 320);
  ok('in range -> unchanged (rounded)', clampUiCols(160.4) === 160);
}

// ---- createUiLayer: default 160x60 ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  ok('cols = 160', ui.cols === 160);
  ok('rows = round(160*3/8) = 60', ui.rows === Math.round(160 * UI_GRID_ASPECT) && ui.rows === 60);
  ok('cells is a real CellBuffer sized to cols x rows', ui.cells.fg.length === 160 * 60 * 4);
  ok('sx/sy default to 1 before bindScene', ui.sx === 1 && ui.sy === 1);
}

// ---- bindScene: sx/sy at 160/240/320-wide scenes over a 160x60 UI grid ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  ui.bindScene(160, 60);
  ok('160x60 scene: sx=sy=1', ui.sx === 1 && ui.sy === 1);
  ui.bindScene(240, 90);
  ok('240x90 scene: sx=sy=1.5', Math.abs(ui.sx - 1.5) < 1e-9 && Math.abs(ui.sy - 1.5) < 1e-9);
  ui.bindScene(320, 120);
  ok('320x120 scene: sx=sy=2', ui.sx === 2 && ui.sy === 2);
}

// ---- clear(): mask -> 0 (transparent), not 1 (unlike a scene CellBuffer.clear()) ----
{
  const ui = createUiLayer({ cols: 96, rows: 36 }); // exercises the [96,320] clamp floor exactly
  ok('96 cols kept (clamp floor, not below it)', ui.cols === 96);
  ui.setCell(2, 3, 'A', '#ff00ff', '#000000');
  ok('setCell -> mask 1 at the written cell', ui.cells.mask[3 * ui.cols + 2] === 1);
  ok('setCell -> bg alpha 255 (doubles as the GPU mask channel)', ui.cells.bg[(3 * ui.cols + 2) * 4 + 3] === 255);
  ui.clear();
  ok('clear() -> mask all 0', ui.cells.mask.every((m) => m === 0));
  ok('clear() -> glyphIdx all 0', ui.cells.glyphIdx.every((g) => g === 0));
  ok('clear() -> bg alpha all 0 (transparent on the GPU upload)', ui.cells.bg[(3 * ui.cols + 2) * 4 + 3] === 0);
}

// ---- setCellRGB: allocation-free numeric path, same contract as CellBuffer's ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  ui.setCellRGB(1, 1, 5, 10, 20, 30, 40, 50, 60);
  const i = 1 * ui.cols + 1, fi = i * 4;
  ok('glyphIdx written', ui.cells.glyphIdx[i] === 5);
  ok('fg rgb written', ui.cells.fg[fi] === 10 && ui.cells.fg[fi + 1] === 20 && ui.cells.fg[fi + 2] === 30);
  ok('bg rgb written + alpha 255 (mask)', ui.cells.bg[fi] === 40 && ui.cells.bg[fi + 1] === 50 && ui.cells.bg[fi + 2] === 60 && ui.cells.bg[fi + 3] === 255);
  ok('mask set', ui.cells.mask[i] === 1);
}

// ---- setGlyph: glyph-only cell (UI-XHAIR-01): glyph + fg, bg alpha 128 ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  ui.setGlyph(4, 5, '|', '#aabbcc');
  const i = 5 * ui.cols + 4, fi = i * 4;
  const gIdx = '|'.charCodeAt(0) - 32;
  ok('setGlyph -> glyphIdx', ui.cells.glyphIdx[i] === gIdx);
  ok('setGlyph -> fg rgb', ui.cells.fg[fi] === 0xaa && ui.cells.fg[fi + 1] === 0xbb && ui.cells.fg[fi + 2] === 0xcc);
  ok('setGlyph -> fg alpha = glyphIdx', ui.cells.fg[fi + 3] === gIdx);
  ok('setGlyph -> bg alpha 128 (glyph-only mask)', ui.cells.bg[fi + 3] === 128);
  ok('setGlyph -> mask 1', ui.cells.mask[i] === 1);
  // out of bounds is a no-op (same contract as setCell)
  ui.setGlyph(-1, 0, '+', '#ffffff');
  ui.setGlyph(0, 999, '+', '#ffffff');
  ok('setGlyph out-of-bounds -> no write', ui.cells.mask[0] === 0);
}

// ---- clear() also zeroes a glyph-only cell (128 -> 0) ----
{
  const ui = createUiLayer({ cols: 96, rows: 36 });
  ui.setGlyph(1, 1, '+', '#ffffff');
  const i = 1 * ui.cols + 1;
  ok('pre-clear: glyph-only bg alpha 128', ui.cells.bg[i * 4 + 3] === 128);
  ui.clear();
  ok('clear() -> glyph-only cell bg alpha 0', ui.cells.bg[i * 4 + 3] === 0);
  ok('clear() -> glyph-only cell mask 0', ui.cells.mask[i] === 0);
  ok('clear() -> glyph-only cell glyphIdx 0', ui.cells.glyphIdx[i] === 0);
}

// ---- setCell/setCellRGB still write bg alpha 255, never 128 ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  ui.setCell(2, 2, 'A', '#ff0000', '#000000');
  ui.setCellRGB(3, 3, 10, 1, 2, 3, 4, 5, 6);
  ok('setCell -> bg alpha 255', ui.cells.bg[(2 * ui.cols + 2) * 4 + 3] === 255);
  ok('setCellRGB -> bg alpha 255', ui.cells.bg[(3 * ui.cols + 3) * 4 + 3] === 255);
}

// ---- no per-frame allocation in clear() (rule 9) ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  const before = { glyphIdx: ui.cells.glyphIdx, fg: ui.cells.fg, bg: ui.cells.bg, mask: ui.cells.mask };
  ui.clear(); ui.clear(); ui.clear();
  ok('clear() reuses the same typed arrays (no allocation)',
    ui.cells.glyphIdx === before.glyphIdx && ui.cells.fg === before.fg && ui.cells.bg === before.bg && ui.cells.mask === before.mask);
}

console.log(`uiLayer.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.map((f) => `  FAIL: ${f}`).join('\n')); process.exit(1); }
