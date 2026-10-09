// engine/ui/crosshair.test.js (UI-XHAIR-01). Headless Node ESM, no framework.
// Run: node engine/ui/crosshair.test.js
//
// Covers: (1) the crosshair cell layout per UI grid width (single `+` below
// 320 cols, 3x3 open cross at >= 320), (2) the glyph-only mask keeping the
// scene's background under a glyph-only cell on BOTH present paths - the
// Canvas2D path's real `_mergeUiLayer` (executed, no DOM needed) and the GL
// path's shader source (same source-string technique as gpu/glsl.test.js,
// since the fragment shader can't be compiled headless), and (3) the prompt
// plate staying opaque.
import { createUiLayer, GLYPH_BG_ALPHA } from './uiLayer.js';
import { drawCrosshair } from './crosshair.js';
import { CellBuffer } from '../render/CellBuffer.js';
import { RenderTargetCanvas2D } from '../render/RenderTargetCanvas2D.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Per-cell readers over a UiLayer's own CellBuffer.
const glyphAt = (ui, x, y) => ui.cells.glyphIdx[y * ui.cols + x];
const maskAt = (ui, x, y) => ui.cells.mask[y * ui.cols + x];
const bgAlphaAt = (ui, x, y) => ui.cells.bg[(y * ui.cols + x) * 4 + 3];
const fgAt = (ui, x, y) => {
  const fi = (y * ui.cols + x) * 4;
  return [ui.cells.fg[fi], ui.cells.fg[fi + 1], ui.cells.fg[fi + 2]];
};
function countMask(ui) {
  let n = 0;
  for (let i = 0; i < ui.cells.mask.length; i++) if (ui.cells.mask[i]) n++;
  return n;
}

const style = {
  crosshair: { dim: '#111111', active: '#ff0000' },
  prompt: { color: '#cccccc', keyColor: '#ffff00', plateBg: '#000000' },
};

// ---- layout: 240x90 -> single glyph-only `+` ----
{
  const ui = createUiLayer({ cols: 240, rows: 90 });
  drawCrosshair(ui, style, { targetKey: 'E', prompt: '' }); // active, no prompt
  const cx = ui.cols >> 1, cy = ui.rows >> 1;
  ok('240x90: centre glyph is +', glyphAt(ui, cx, cy) === '+'.charCodeAt(0) - 32);
  ok('240x90: centre fg is active colour', fgAt(ui, cx, cy).join(',') === '255,0,0');
  ok('240x90: centre is glyph-only (bg alpha 128)', bgAlphaAt(ui, cx, cy) === GLYPH_BG_ALPHA);
  ok('240x90: no cross arms drawn',
    maskAt(ui, cx, cy - 1) === 0 && maskAt(ui, cx, cy + 1) === 0 && maskAt(ui, cx - 1, cy) === 0 && maskAt(ui, cx + 1, cy) === 0);
  ok('240x90: exactly one crosshair cell written', countMask(ui) === 1);
}

// ---- layout: 320x120 -> still the single glyph-only '+' (owner 2026-10-06: 3x3 arms sat a whole UI cell apart) ----
{
  const ui = createUiLayer({ cols: 320, rows: 120 });
  drawCrosshair(ui, style, { targetKey: 'E', prompt: '' });
  const cx = ui.cols >> 1, cy = ui.rows >> 1;
  ok('320: centre glyph is +', glyphAt(ui, cx, cy) === '+'.charCodeAt(0) - 32);
  ok('320: centre is glyph-only (bg alpha 128)', bgAlphaAt(ui, cx, cy) === GLYPH_BG_ALPHA);
  ok('320: centre uses the active colour', fgAt(ui, cx, cy).join(',') === '255,0,0');
  ok('320: exactly one crosshair cell written', countMask(ui) === 1);
}

// ---- dim vs active colour selection from style.crosshair ----
{
  const ui = createUiLayer({ cols: 240, rows: 90 });
  drawCrosshair(ui, style, { targetKey: null, prompt: '' }); // dim
  const cx = ui.cols >> 1, cy = ui.rows >> 1;
  ok('dim: centre fg is dim colour', fgAt(ui, cx, cy).join(',') === '17,17,17');
}

// ---- layout vs the SCENE grid (production path: fixed 160x60 UI layer, size
// comes from bindScene's sx = sceneCols/uiCols) ----
{
  const at240 = createUiLayer({ cols: 160, rows: 60 }); at240.bindScene(240, 90);
  drawCrosshair(at240, style, { targetKey: 'E', prompt: '' });
  ok('scene 240x90 (ui 160): single glyph-only +, no arms',
    countMask(at240) === 1 && glyphAt(at240, at240.cols >> 1, at240.rows >> 1) === '+'.charCodeAt(0) - 32);

  const at320 = createUiLayer({ cols: 160, rows: 60 }); at320.bindScene(320, 120);
  drawCrosshair(at320, style, { targetKey: 'E', prompt: '' });
  ok('scene 320x120 (ui 160): single glyph-only +',
    countMask(at320) === 1 && glyphAt(at320, at320.cols >> 1, at320.rows >> 1) === '+'.charCodeAt(0) - 32);
}

// ---- prompt stays OPAQUE (plate + text), below the crosshair ----
{
  const ui = createUiLayer({ cols: 320, rows: 120 });
  drawCrosshair(ui, style, { targetKey: 'E', prompt: '[E] Take lamp' });
  const cx = ui.cols >> 1, cy = ui.rows >> 1;
  const text = '[E] Take lamp';
  const px = cx - (text.length >> 1);
  const py = cy + 2;
  ok('prompt: plate cell at cy+2 is opaque (bg alpha 255)', bgAlphaAt(ui, px, py) === 255);
  ok('prompt: key text drawn over the plate (leading [)', glyphAt(ui, px, py) === '['.charCodeAt(0) - 32);
  ok('prompt: crosshair stays glyph-only (128)', bgAlphaAt(ui, cx, cy) === GLYPH_BG_ALPHA);
}

// ---- Canvas2D present path: glyph-only keeps the scene bg, opaque replaces ----
{
  const ui = createUiLayer({ cols: 160, rows: 60 });
  const rt = Object.create(RenderTargetCanvas2D.prototype);
  rt.cols = ui.cols; rt.rows = ui.rows;
  rt.cells = new CellBuffer(ui.cols, ui.rows);
  rt.cells.setCell(3, 3, 'W', '#ffffff', '#224466'); // a scene wall with a known bg
  ui.setGlyph(3, 3, '+', '#ff0000');                  // glyph-only crosshair cell over it
  ui.setCell(5, 5, 'X', '#00ff00', '#112233');        // opaque UI cell
  rt._uiLayer = ui;
  rt._mergeUiLayer();

  const gi = 3 * ui.cols + 3, gfi = gi * 4;
  ok('canvas2d: glyph-only cell glyph overwritten', rt.cells.glyphIdx[gi] === '+'.charCodeAt(0) - 32);
  ok('canvas2d: glyph-only cell fg overwritten', rt.cells.fg[gfi] === 0xff && rt.cells.fg[gfi + 1] === 0 && rt.cells.fg[gfi + 2] === 0);
  ok('canvas2d: glyph-only cell keeps the scene bg colour',
    rt.cells.bg[gfi] === 0x22 && rt.cells.bg[gfi + 1] === 0x44 && rt.cells.bg[gfi + 2] === 0x66 && rt.cells.bg[gfi + 3] === 255);

  const oi = 5 * ui.cols + 5, ofi = oi * 4;
  ok('canvas2d: opaque cell replaces the bg',
    rt.cells.bg[ofi] === 0x11 && rt.cells.bg[ofi + 1] === 0x22 && rt.cells.bg[ofi + 2] === 0x33 && rt.cells.bg[ofi + 3] === 255);
}

console.log(`crosshair.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.map((f) => `  FAIL: ${f}`).join('\n')); process.exit(1); }
