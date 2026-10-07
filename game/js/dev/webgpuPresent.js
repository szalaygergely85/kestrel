// game/js/dev/webgpuPresent.js - WG-1c1. Page harness for `tools/capture-browser.mjs --mode wgsl` (window.__wgsl: every
// WGSL_MODULES entry through createShaderModule + getCompilationInfo) and `--mode webgpu-present` (window.__webgpuPresent:
// a fixed synthetic cell grid + a UI layer presented by RenderTargetWebGPU; readbackPresent must equal the CPU cells byte
// for byte, and canvas pixels of space-glyph cells must equal the cell bg exactly).
import { createGpuDevice, RenderTargetWebGPU, CellBuffer, WGSL_MODULES, summarizeCompilation } from '../../../engine/index.js';

const out = document.getElementById('out');
const canvas = document.getElementById('c');
const COLS = 40, ROWS = 14, UI_COLS = 20, UI_ROWS = 7; // UI cells are 2x2 scene cells

// Deterministic LCG so the CPU cells are identical on every run.
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/** Scene: rows 0-9 random glyphs/colors (all 95 glyph indices appear), rows 10-13 space glyphs on random bgs. */
function fillScene(cells) {
  const rnd = lcg(12345);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const g = y < 10 ? (y * COLS + x) % 95 : 0;
    const b = () => Math.floor(rnd() * 256);
    cells.setCellRGB(x, y, g, b(), b(), b(), b(), b(), b());
  }
}

/** UI: opaque space cells (blue) at ui rows 5-6 cols 2-9, one glyph-only cell (bg.a=128, space) at (15,5). */
function fillUi(ui) {
  ui.cells.bg.fill(0); ui.cells.fg.fill(0);
  for (let y = 5; y < 7; y++) for (let x = 2; x < 10; x++) ui.cells.setCellRGB(x, y, 0, 255, 255, 255, 10, 40, 200);
  ui.cells.setCellRGB(15, 5, 0, 255, 0, 0, 0, 0, 0);
  ui.cells.bg[(5 * UI_COLS + 15) * 4 + 3] = 128;
}

async function compileCheck(device) {
  const mods = [];
  for (const m of WGSL_MODULES) {
    const sm = device.gpu.createShaderModule({ code: m.code });
    const info = await sm.getCompilationInfo();
    mods.push(summarizeCompilation(m.name, info.messages));
  }
  const errors = mods.reduce((n, m) => n + m.errors, 0);
  return { ok: errors === 0 && mods.length > 0, modules: mods.length, errors, results: mods };
}

async function presentCheck(device) {
  const rt = new RenderTargetWebGPU(canvas, COLS, ROWS, device);
  rt.resize(1280, 720, 1); // fixed ref box: window-size independent
  const ui = { cols: UI_COLS, rows: UI_ROWS, cells: new CellBuffer(UI_COLS, UI_ROWS), sx: COLS / UI_COLS, sy: ROWS / UI_ROWS };
  rt.setUiLayer(ui);
  fillScene(rt.cells); fillUi(ui);
  const expFg = rt.cells.fg.slice(), expBg = rt.cells.bg.slice();
  rt.present();
  // canvas pixels right after present (same task: the drawn texture is still current)
  const px = document.createElement('canvas'); px.width = canvas.width; px.height = canvas.height;
  const pctx = px.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(canvas, 0, 0);
  const img = pctx.getImageData(0, 0, px.width, px.height).data;
  const rb = await rt.readbackPresent();
  let fgBad = 0, bgBad = 0;
  for (let i = 0; i < expFg.length; i++) { if (rb.fg[i] !== expFg[i]) fgBad++; if (rb.bg[i] !== expBg[i]) bgBad++; }
  // space-glyph cells (rows 10-13) must show exactly the cell bg (or the opaque UI bg where the UI layer covers them)
  let spacePx = 0, spaceBad = 0, glyphCellsWithFg = 0, glyphCells = 0;
  const cw = rt.pxCellW, ch = rt.pxCellH;
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    const ci = (cy * COLS + cx) * 4;
    const uiOpaque = cy >= 10 && cy < 14 && cx >= 4 && cx < 20; // ui rows 5-6 cols 2-9 -> scene rows 10-13 cols 4-19
    const bg = uiOpaque ? [10, 40, 200] : [expBg[ci], expBg[ci + 1], expBg[ci + 2]];
    let differs = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = ((cy * ch + y) * px.width + cx * cw + x) * 4;
      const same = img[p] === bg[0] && img[p + 1] === bg[1] && img[p + 2] === bg[2];
      if (cy >= 10) { spacePx++; if (!same) spaceBad++; } else if (!same) differs++;
    }
    if (cy < 10 && (cy * COLS + cx) % 95 !== 0) { glyphCells++; if (differs > 0) glyphCellsWithFg++; }
  }
  const ok = fgBad === 0 && bgBad === 0 && rb.sampledOwnTextures && spaceBad === 0 && glyphCellsWithFg === glyphCells;
  return {
    ok, cols: COLS, rows: ROWS, canvasW: canvas.width, canvasH: canvas.height, bytes: expFg.length * 2,
    fgMismatch: fgBad, bgMismatch: bgBad, sampledOwnTextures: rb.sampledOwnTextures,
    spacePixels: spacePx, spaceMismatch: spaceBad, glyphCells, glyphCellsWithFg, gpuErrors: device.gpuErrors.slice(),
  };
}

try {
  const device = await createGpuDevice({ backend: 'webgpu', canvas, selfTest: false, fallback: false });
  window.__wgsl = await compileCheck(device);
  window.__webgpuPresent = await presentCheck(device);
  out.textContent = JSON.stringify({ wgsl: window.__wgsl, present: window.__webgpuPresent }, null, 2);
  out.className = window.__wgsl.ok && window.__webgpuPresent.ok ? 'ok' : 'error';
} catch (e) {
  const err = { ok: false, error: String(e && e.stack || e) };
  if (!window.__wgsl) window.__wgsl = err;
  window.__webgpuPresent = err;
  out.textContent = err.error;
  out.className = 'error';
}
