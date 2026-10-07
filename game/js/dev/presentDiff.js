// game/js/dev/presentDiff.js - WG-1c2 (docs/architecture.md 38.8a item 12). Page-side half of
// `tools/capture-browser.mjs --mode presentdiff`: the game runs on the CPU path at ?backend=webgl2&gpu=0 (any ?pose=<slug>);
// this copies the live scene + UI cells into a RenderTargetWebGPU on a SECOND canvas with the same reference box
// (resize(1280,720,1)), presents both and compares the pixels. Each canvas is drawn into a 2D canvas in the same task as
// its present() (no await in between: the WebGPU/WebGL drawing buffer is only valid until the task ends).
import { createGpuDevice, RenderTargetWebGPU } from '../../../engine/index.js';

const REF_W = 1280, REF_H = 720, REF_DPR = 1;

/** @returns {Promise<object>} one pose's result: pixel counts, max channel diff, first differing cells */
export async function runPresentDiff(label) {
  const dbg = window.__debug;
  if (!dbg || !dbg.rt || !dbg.engine) throw new Error('presentdiff: window.__debug (game not booted)');
  const rt = dbg.rt, ui = dbg.engine.ui;
  if (rt.backend === 'webgpu') throw new Error('presentdiff: run the game with ?backend=webgl2&gpu=0 (the CPU path is the oracle)');
  const c2 = document.createElement('canvas');
  const device = await createGpuDevice({ backend: 'webgpu', canvas: c2, fallback: false });
  const rt2 = new RenderTargetWebGPU(c2, rt.cols, rt.rows, device);
  rt2.resize(REF_W, REF_H, REF_DPR);
  rt2.setUiLayer(ui);
  const a = document.createElement('canvas'), b = document.createElement('canvas');
  const actx = a.getContext('2d', { willReadFrequently: true }), bctx = b.getContext('2d', { willReadFrequently: true });
  // ---- synchronous section: one task ----
  rt.resize(REF_W, REF_H, REF_DPR);
  rt2.cells.fg.set(rt.cells.fg); rt2.cells.bg.set(rt.cells.bg);
  rt.present();
  a.width = rt.canvas.width; a.height = rt.canvas.height;
  actx.drawImage(rt.canvas, 0, 0);
  rt2.present();
  b.width = c2.width; b.height = c2.height;
  bctx.drawImage(c2, 0, 0);
  // ---- end synchronous section ----
  const W = a.width, H = a.height;
  if (b.width !== W || b.height !== H) throw new Error(`presentdiff: canvas sizes differ ${W}x${H} vs ${b.width}x${b.height}`);
  const A = actx.getImageData(0, 0, W, H).data, B = bctx.getImageData(0, 0, W, H).data;
  let exact = 0, within2 = 0, maxDiff = 0, bigDiff = 0;
  const cw = rt.pxCellW, ch = rt.pxCellH;
  const badCells = new Map();
  for (let i = 0, n = W * H; i < n; i++) {
    const p = i * 4;
    let m = 0;
    for (let k = 0; k < 4; k++) { const d = Math.abs(A[p + k] - B[p + k]); if (d > m) m = d; }
    if (m === 0) exact++;
    if (m <= 2) within2++;
    if (m > maxDiff) maxDiff = m;
    if (m > 2) {
      bigDiff++;
      const cx = Math.floor((i % W) / cw), cy = Math.floor(Math.floor(i / W) / ch);
      const key = cy * rt.cols + cx;
      badCells.set(key, (badCells.get(key) || 0) + 1);
    }
  }
  const pixels = W * H;
  const worst = [...badCells.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => ({ cx: k % rt.cols, cy: Math.floor(k / rt.cols), px: v }));
  // glyph-index census of the scene (a blank scene would pass trivially)
  const glyphs = new Set();
  for (let i = 0; i < rt.cols * rt.rows; i++) glyphs.add(rt.cells.fg[i * 4 + 3]);
  return {
    label, distinctGlyphs: glyphs.size, cols: rt.cols, rows: rt.rows, canvasW: W, canvasH: H, pixels,
    pctExact: +(100 * exact / pixels).toFixed(4), pctWithin2: +(100 * within2 / pixels).toFixed(4),
    maxChannelDiff: maxDiff, pixelsOver2: bigDiff, badCells: badCells.size, worstCells: worst,
    gpuErrors: device.gpuErrors.slice(), adapter: device.adapterInfo,
  };
}
