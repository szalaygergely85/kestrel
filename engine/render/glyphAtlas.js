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
  if (m.softRows && ctx.putImageData) softenRows(canvas, ctx, m.pxCellW, m.pxCellH);
  return canvas;
}

/**
 * OB-189: at tiny cells (<= SOFT_ROWS_MAX_H px) every glyph ink band sits at the same y of every row, so a flat surface shows one
 * light line per cell row. Vertical [1 2 1]/4 blur of the coverage (inside each cell, no bleed across cells) halves the
 * stripe contrast; backgrounds are untouched. Pure alpha work on the already rasterized strip.
 */
export const SOFT_ROWS_MAX_H = 8;
export function softenAlpha(a, cw, ch, count = GLYPH_COUNT) {
  const stride = cw * count; const out = new Uint8ClampedArray(a.length);
  for (let y = 0; y < ch; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(ch - 1, y + 1);
    for (let x = 0; x < stride; x++) out[y * stride + x] = (a[y0 * stride + x] + 2 * a[y * stride + x] + a[y1 * stride + x] + 2) >> 2;
  }
  return out;
}
function softenRows(canvas, ctx, cw, ch) {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = img.data, n = canvas.width * canvas.height;
  const a = new Uint8ClampedArray(n); for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3];
  const b = softenAlpha(a, cw, ch);
  for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = b[i]; }
  ctx.putImageData(img, 0, 0);
}

/**
 * ATLAS-GUARD (OB-175): codes whose atlas cell has max alpha 0 (rasterised blank, e.g. font not ready yet). Pure, one pass.
 * `codes` defaults to every printable glyph except space (space is intentionally empty).
 * @param {ArrayLike<number>} alphaData tightly packed RGBA8 of the whole strip
 * @param {{pxCellW: number, pxCellH: number}} layout @param {number[]} [codes]
 * @returns {number[]}
 */
export function blankGlyphs(alphaData, layout, codes) {
  const { pxCellW: cw, pxCellH: ch } = layout;
  const stride = cw * GLYPH_COUNT * 4;
  const list = codes || Array.from({ length: GLYPH_COUNT - 1 }, (_, i) => 33 + i);
  const blank = [];
  for (const code of list) {
    if (code === 32) continue;
    const x0 = (code - 32) * cw;
    let seen = false;
    for (let y = 0; y < ch && !seen; y++) {
      const row = y * stride + x0 * 4 + 3;
      for (let x = 0; x < cw; x++) if (alphaData[row + x * 4] > 0) { seen = true; break; }
    }
    if (!seen) blank.push(code);
  }
  return blank;
}

/** The rasterized strip as tightly packed RGBA8 rows (WebGPU `writeTexture` source). @param {HTMLCanvasElement} canvas @param {CanvasRenderingContext2D} ctx */
export function glyphAtlasPixels(canvas, ctx) {
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}
