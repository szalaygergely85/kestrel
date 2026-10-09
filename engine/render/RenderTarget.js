// RenderTarget: the CPU Canvas2D target factory (WG-5b: WebGL2 is gone, WebGPU targets are built by createRenderer.js).
// Used for `?force2d=1`, tests/capture without WebGPU, and as the placeholder target when WebGPU is missing (the game
// then shows the "WebGPU required" screen). Always runs at the capped `cpuGrid` (default 160x60): CPU shading has only
// ever been budgeted at that size. Public API of the returned target: setCell/setCellRGB/clear/present/resize,
// cols, rows, dpr, pxCellW, pxCellH, cellW, cellH, backend ('c2d-capped').
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} [cols] ignored (kept for call-site compatibility)
 * @param {number} [rows] ignored
 * @param {{force2d?: boolean, cpuGrid?: {cols:number, rows:number}, gpu?: boolean}} [opts]
 */
export function RenderTarget(canvas, cols = 320, rows = 120, opts = {}) {
  const cpuGrid = opts.cpuGrid || { cols: 160, rows: 60 };
  console.log(`[RenderTarget] CPU Canvas2D target ${cpuGrid.cols}x${cpuGrid.rows}`);
  return new RenderTargetCanvas2D(canvas, cpuGrid.cols, cpuGrid.rows);
}
