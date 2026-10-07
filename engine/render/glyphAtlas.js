// WG-1c1 (docs/architecture.md 38.2): the glyph atlas build, extracted from RenderTargetGL so both render targets
// (WebGL2, WebGPU) rasterize the identical 95 x 1 strip (printable ASCII 32-126, white on transparent; coverage in
// alpha). Pure Canvas2D work, no GPU API here.

import { FONT_STACK } from './glyphMetrics.js';

export const GLYPH_COUNT = 95; // printable ASCII 32-126

/**
 * Rasterizes the atlas strip into `canvas` (resized to pxCellW*95 x pxCellH) through its 2D context `ctx`.
 * Space (idx 0) is left fully transparent. Returns `canvas`.
 * @param {HTMLCanvasElement} canvas @param {CanvasRenderingContext2D} ctx
 * @param {{pxCellW: number, pxCellH: number, fontPx: number, ascent: number}} m
 */
export function rasterizeGlyphAtlas(canvas, ctx, m) {
  const w = m.pxCellW * GLYPH_COUNT;
  const h = m.pxCellH;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${m.fontPx}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  for (let code = 32; code <= 126; code++) {
    const idx = code - 32;
    if (code === 32) continue; // space: leave fully transparent
    ctx.fillText(String.fromCharCode(code), idx * m.pxCellW, m.ascent);
  }
  return canvas;
}

/** The rasterized strip as tightly packed RGBA8 rows (WebGPU `writeTexture` source). @param {HTMLCanvasElement} canvas @param {CanvasRenderingContext2D} ctx */
export function glyphAtlasPixels(canvas, ctx) {
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}
