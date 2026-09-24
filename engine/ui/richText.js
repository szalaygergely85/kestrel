// engine/ui/richText.js (US-015, docs/architecture.md 7.6 item 1). Generic:
// no strings, no `ASSETS` - callers (game/js/quest/hints.js, titleCard.js,
// endCard.js, mapCard.js) hand in plain text + resolved hex colors. Compiled
// once at load (per distinct hint/line), never per frame (rule 9): a
// `RichLine` is a flat per-glyph color table plus the ASCII codes, so
// `drawRichLine` is a tight loop with no string ops.

/** @typedef {{n:number, codes:Uint8Array, rgb:Uint8Array}} RichLine */

import { fadeGlyph } from './fade.js';

const BLACK = [0, 0, 0];

/** "#rgb" / "#rrggbb" -> [r,g,b] (0-255). Not cached: call at load time only. */
export function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return [255, 255, 255];
  if (hex.length === 7) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  if (hex.length === 4) {
    return [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)];
  }
  return [255, 255, 255];
}

/**
 * Compiles `text` into a flat glyph/color table: every occurrence of each
 * `keys` substring gets `keyRgb`, everything else `baseRgb`.
 * @param {string} text
 * @param {[number,number,number]} baseRgb
 * @param {[number,number,number]} keyRgb
 * @param {string[]} [keys]
 * @returns {RichLine}
 */
export function compileRichLine(text, baseRgb, keyRgb, keys) {
  const n = text.length;
  const codes = new Uint8Array(n);
  const rgb = new Uint8Array(n * 3);
  const isKey = new Uint8Array(n);
  if (keys) {
    for (const k of keys) {
      if (!k) continue;
      let idx = text.indexOf(k);
      while (idx !== -1) {
        for (let j = 0; j < k.length; j++) isKey[idx + j] = 1;
        idx = text.indexOf(k, idx + k.length);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    codes[i] = text.charCodeAt(i);
    const src = isKey[i] ? keyRgb : baseRgb;
    rgb[i * 3] = src[0]; rgb[i * 3 + 1] = src[1]; rgb[i * 3 + 2] = src[2];
  }
  return { n, codes, rgb };
}

/**
 * Draws a compiled `RichLine`, glyph by glyph, through `rt.setCellRGB`
 * (allocation-free). `a < 1` steps every glyph down the fade ramp (`lut`
 * required - see engine/ui/fade.js) and scales its color by the same gain
 * `applySceneFade` uses, so UI text fades exactly like a scene glyph would.
 * `count` is a typewriter prefix (end-card "line1 types on" use); glyphs
 * past `count` are simply not drawn (no allocation, no blank overwrite).
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {number} x @param {number} y
 * @param {RichLine} line
 * @param {number} [a] @param {import('./fade.js').FadeLut|null} [lut]
 * @param {number} [count] @param {[number,number,number]} [bgRgb]
 */
export function drawRichLine(rt, x, y, line, a = 1, lut = null, count = line.n, bgRgb = BLACK) {
  const n = count < line.n ? count : line.n;
  const fgGain = lut ? lut.minGain + (1 - lut.minGain) * a : a;
  for (let i = 0; i < n; i++) {
    const code = line.codes[i];
    if (code === 32) continue; // a space glyph is nothing to draw (no bg plate write here - see panel/sceneDim for that)
    const ri = i * 3;
    let outCode = code, r = line.rgb[ri], g = line.rgb[ri + 1], b = line.rgb[ri + 2];
    if (a < 1) {
      outCode = lut ? fadeGlyph(code, a, lut) : code;
      r = (r * fgGain) | 0; g = (g * fgGain) | 0; b = (b * fgGain) | 0;
    }
    if (outCode <= 32) continue; // faded to (or already) a space - nothing to draw
    rt.setCellRGB(x + i, y, outCode - 32, r, g, b, bgRgb[0], bgRgb[1], bgRgb[2]);
  }
}
