// RenderTarget: factory that picks the render back-end (D-005). Public API
// is identical either way, so the rest of the game never knows which one is
// active:
//   setCell(x, y, glyph, fg, bg)                    - hex color strings
//   setCellRGB(x, y, glyphIdx, r,g,b, r2,g2,b2)      - allocation-free numeric fast path
//   clear(bg)
//   present()
//   resize()
//   cols, rows, dpr, pxCellW, pxCellH, cellW, cellH, backend ('gl2' | 'c2d-capped')
//
// Primary back-end is WebGL2 (RenderTargetGL.js): one fullscreen-triangle
// draw call, two small texture uploads per frame, GPU does the per-pixel
// work - cost is trivial at any resolution/DPR. Falls back to Canvas2D
// (RenderTargetCanvas2D.js, capped backing resolution) when WebGL2 is
// unavailable, or when `?force2d=1` is set (for testing the fallback path).
// See docs/decisions.md D-005 for the full rationale.
//
// US-030a (docs/architecture.md 14.2 item 5): the grid itself (cols/rows) is
// now a caller choice, but only a REAL gl2 back-end (WebGL2 + a real,
// non-software renderer, and `opts.gpu !== false`) is allowed to run it -
// everything else is forced to `opts.cpuGrid` (default 160x60), the one CPU
// shading/casting has ever been budgeted/tested at. This decision has to
// happen BEFORE `cols`/`rows` reach either back-end constructor (they size
// every per-cell buffer once, at construction).

import { RenderTargetGL } from './RenderTargetGL.js';
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';
import { isSoftwareRenderer } from './gpu/glUtil.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} [cols]
 * @param {number} [rows]
 * @param {{force2d?: boolean, cpuGrid?: {cols:number, rows:number}, gpu?: boolean}} [opts]
 */
export function RenderTarget(canvas, cols = 320, rows = 120, opts = {}) {
  const forceCanvas2D = !!opts.force2d;
  const gpuAllowed = opts.gpu !== false;
  const cpuGrid = opts.cpuGrid || { cols: 160, rows: 60 };

  // Feature-detect (and, when it exists, software-renderer-detect) on a
  // THROWAWAY canvas, never on the real one: calling getContext('webgl2') on
  // the real canvas and having it succeed commits that element to WebGL2
  // forever (a canvas cannot switch context types), so if something failed
  // *after* that (e.g. a shader compile error) we could not cleanly fall
  // back to Canvas2D on the same node. Detecting support first means the
  // real canvas only ever calls getContext() for the back-end we're
  // actually committing to.
  //
  // `opts.gpu` (`?gpu=0`) is deliberately NOT part of this probe: per 14.1's
  // fallback matrix, `?gpu=0` disables the GpuCellPipeline (JS shading
  // instead - main.js's own gate) while STILL using the fast gl2 presenter
  // when one is available; only the GRID falls back to `cpuGrid` for it
  // (14.2 item 5 lists `?gpu=0` among the cpuGrid triggers explicitly).
  const probeGl = !forceCanvas2D ? document.createElement('canvas').getContext('webgl2') : null;
  let realGl2Backend = false;
  if (probeGl) {
    const { isSoftware } = isSoftwareRenderer(probeGl);
    realGl2Backend = !isSoftware;
  }
  const realGpuGrid = realGl2Backend && gpuAllowed;

  const effCols = realGpuGrid ? cols : cpuGrid.cols;
  const effRows = realGpuGrid ? rows : cpuGrid.rows;
  if (!realGpuGrid) {
    // Logged once (this factory call IS "once", per grid-decision time).
    console.log(`[RenderTarget] grid forced to ${effCols}x${effRows} (force2d=${forceCanvas2D} gpu=${gpuAllowed} realGl2Backend=${realGl2Backend})`);
  }

  if (realGl2Backend) {
    try {
      return new RenderTargetGL(canvas, effCols, effRows);
    } catch (err) {
      console.warn('[RenderTarget] WebGL2 back-end failed, falling back to Canvas2D:', err);
      // Rare recovery path: if RenderTargetGL got far enough to obtain a
      // real webgl2 context before failing, this canvas element can never
      // return a '2d' context. Swap in a fresh node with the same id/parent
      // so the Canvas2D back-end gets a clean context.
      if (canvas.getContext('2d') == null) {
        const fresh = canvas.cloneNode(false);
        canvas.parentNode.replaceChild(fresh, canvas);
        canvas = fresh;
      }
      return new RenderTargetCanvas2D(canvas, cpuGrid.cols, cpuGrid.rows);
    }
  }

  return new RenderTargetCanvas2D(canvas, effCols, effRows);
}
