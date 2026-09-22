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

import { RenderTargetGL } from './RenderTargetGL.js';
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} [cols]
 * @param {number} [rows]
 * @param {{force2d?: boolean}} [opts]
 */
export function RenderTarget(canvas, cols = 160, rows = 60, opts = {}) {
  const forceCanvas2D = !!opts.force2d;

  // Feature-detect on a THROWAWAY canvas, never on the real one: calling
  // getContext('webgl2') on the real canvas and having it succeed commits
  // that element to WebGL2 forever (a canvas cannot switch context types),
  // so if something failed *after* that (e.g. a shader compile error) we
  // could not cleanly fall back to Canvas2D on the same node. Detecting
  // support first means the real canvas only ever calls getContext() for
  // the back-end we're actually committing to.
  const supportsGL2 = !forceCanvas2D && !!document.createElement('canvas').getContext('webgl2');

  if (supportsGL2) {
    try {
      return new RenderTargetGL(canvas, cols, rows);
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
    }
  }

  return new RenderTargetCanvas2D(canvas, cols, rows);
}
