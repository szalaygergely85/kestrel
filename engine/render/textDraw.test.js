// engine/render/textDraw.test.js (OB-051): drawTextScaled + Canvas2D raster. node engine/render/textDraw.test.js
import { drawText, drawTextScaled } from './textDraw.js';
import { CellBuffer } from './CellBuffer.js';
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';
import { createUiLayer, UI_SCALE2_BIT } from '../ui/uiLayer.js';
import { makeOk } from '../test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// fallback: plain CellBuffer has no setCellScaled -> 1x
{
  const cb = new CellBuffer(20, 6);
  drawTextScaled(cb, 2, 1, 'AB', '#ffffff', '#000000');
  ok('fallback writes 1x cells', cb.glyphIdx[1 * 20 + 2] === 33 && cb.glyphIdx[1 * 20 + 3] === 34 && cb.glyphIdx[2 * 20 + 2] === 0);
  ok('fallback has no scale bit', (cb.fg[(1 * 20 + 2) * 4 + 3] & UI_SCALE2_BIT) === 0);
}
// UI layer: 2*len wide, 2 rows, bit set, plain glyph idx
{
  const ui = createUiLayer({ cols: 160 });
  drawTextScaled(ui, 5, 7, 'Hi', '#ffffff', '#000000'); // odd y snaps to 6
  let n = 0, bits = 0;
  for (let i = 0; i < ui.cols * ui.rows; i++) if (ui.cells.mask[i]) { n++; if (ui.cells.fg[i * 4 + 3] & UI_SCALE2_BIT) bits++; }
  ok('4 cells per char, all flagged', n === 8 && bits === 8);
  ok('origin snapped even (4,6)', ui.cells.mask[6 * 160 + 4] === 1 && ui.cells.mask[5 * 160 + 4] === 0 && ui.cells.mask[6 * 160 + 3] === 0);
  ok('glyphIdx stays plain', ui.cells.glyphIdx[6 * 160 + 4] === 'H'.charCodeAt(0) - 32 && ui.cells.glyphIdx[7 * 160 + 7] === 'i'.charCodeAt(0) - 32);
}

// Canvas2D raster: scaled 'I' block == 1x mask upsampled 2x (fake `this`, no DOM)
{
  const pw = 4, ph = 8, cols = 4, rows = 2;
  const mk = (r) => { const m = new Uint8ClampedArray(pw * ph); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) m[y * pw + x] = ((x * 7 + y * 3 + r) % 5) * 60; return m; };
  const mask = mk(1);
  const cells = new CellBuffer(cols, rows);
  const canvasW = pw * cols;
  const fake = {
    cols, rows, pxCellW: pw, pxCellH: ph, cells, canvas: { width: canvasW }, _pixels32: new Uint32Array(canvasW * ph * rows),
    ctx: { putImageData() {} }, _imageData: null, _mergeUiLayer() {}, _buildGlyphMask: () => mask,
  };
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    cells.setCell(cx, cy, 'I', '#ffffff', '#000000');
    cells.fg[(cy * cols + cx) * 4 + 3] |= UI_SCALE2_BIT;
  }
  RenderTargetCanvas2D.prototype.present.call(fake);
  let bad = 0;
  for (let Y = 0; Y < 2 * ph; Y++) for (let X = 0; X < 2 * pw; X++) {
    const a = mask[(Y >> 1) * pw + (X >> 1)];
    const px = fake._pixels32[Y * canvasW + X] & 0xff; // red channel: bg 0 -> fg 255
    if (Math.abs(px - Math.trunc(255 * a / 255)) > 1) bad++;
  }
  ok('scaled block = 1x mask upsampled 2x', bad === 0, 'bad px ' + bad);
}
console.log(`textDraw.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.map((f) => `  FAIL: ${f}`).join('\n')); process.exit(1); }
