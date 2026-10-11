// engine/ui/uiScale.js (OB-051, docs/architecture.md 38.48). Pure JS twin of the
// WGSL present shader's scaled-glyph math, used by the Canvas2D raster tests.
// A scaled glyph is a 2x2 block of UI cells (even origin) whose fg alpha has bit 7.
import { UI_SCALE2_BIT } from './uiLayer.js';

/**
 * Atlas-cell fraction for a pixel: raw = fg alpha byte, (cx, cy) = cell, (fx, fy) = fract inside the cell.
 * Writes out[0..1]; returns the plain glyph index (raw & 127).
 */
export function scaledFrac(raw, cx, cy, fx, fy, out) {
  const scaled = (raw & UI_SCALE2_BIT) !== 0;
  if (scaled) { out[0] = (fx + (cx & 1)) * 0.5; out[1] = (fy + (cy & 1)) * 0.5; }
  else { out[0] = fx; out[1] = fy; }
  return raw & 127;
}
