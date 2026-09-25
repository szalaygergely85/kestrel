// engine/ui/uiLayer.test.js (OWN-REQ-003). Headless Node ESM, no framework.
// Run: node engine/ui/uiLayer.test.js
import { createUiLayer, clampUiCols, UI_GRID_ASPECT } from './uiLayer.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

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
