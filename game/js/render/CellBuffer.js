// Typed-array cell storage shared by both render back-ends (D-005).
//
// glyphIdx: Uint8Array(cols*rows)   - ASCII code - 32 (0 = space)
// fg:       Uint8Array(cols*rows*4) - (r, g, b, glyphIdx) per cell, i.e.
//           already exactly the byte layout RenderTargetGL uploads as the
//           `uFg` RGBA8 texture (alpha channel doubles as the glyph index,
//           per D-005 item 2) - no repacking needed at present() time.
// bg:       Uint8Array(cols*rows*4) - (r, g, b, 255) per cell, exactly the
//           `uBg` texture layout.
//
// `setCell` keeps accepting hex color strings (unchanged public API) and
// resolves them through a small color cache into bytes. `setCellRGB` is an
// allocation-free numeric fast path for hot callers (the raycaster, US-004).

export class CellBuffer {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;

    const n = cols * rows;
    this.glyphIdx = new Uint8Array(n);
    this.fg = new Uint8Array(n * 4);
    this.bg = new Uint8Array(n * 4);
    // Default: fg = white (glyphIdx 0 = space, so invisible until setCell is
    // called), bg = opaque black.
    for (let i = 0; i < this.fg.length; i += 4) {
      this.fg[i] = 255; this.fg[i + 1] = 255; this.fg[i + 2] = 255;
    }
    for (let i = 3; i < this.bg.length; i += 4) this.bg[i] = 255;

    this._colorCache = new Map(); // "#rrggbb"/"#rgb" -> [r,g,b]
  }

  // Parses a "#rgb" / "#rrggbb" string to [r,g,b], caching the result since
  // the same palette colors recur across many cells and frames.
  _parseColor(str) {
    let rgb = this._colorCache.get(str);
    if (rgb) return rgb;

    let r = 255, g = 255, b = 255;
    if (str && str[0] === '#') {
      if (str.length === 7) {
        r = parseInt(str.slice(1, 3), 16);
        g = parseInt(str.slice(3, 5), 16);
        b = parseInt(str.slice(5, 7), 16);
      } else if (str.length === 4) {
        r = parseInt(str[1] + str[1], 16);
        g = parseInt(str[2] + str[2], 16);
        b = parseInt(str[3] + str[3], 16);
      }
    }
    rgb = [r, g, b];
    this._colorCache.set(str, rgb);
    return rgb;
  }

  setCell(x, y, glyph, fgHex, bgHex) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    const code = glyph && glyph.length ? glyph.charCodeAt(0) : 32;
    const glyphIdx = code < 32 || code > 126 ? 0 : code - 32;

    const [fr, fgg, fb] = this._parseColor(fgHex);
    const [br, bgg, bb] = this._parseColor(bgHex);

    this.glyphIdx[i] = glyphIdx;
    const fi = i * 4;
    this.fg[fi] = fr; this.fg[fi + 1] = fgg; this.fg[fi + 2] = fb; this.fg[fi + 3] = glyphIdx;
    this.bg[fi] = br; this.bg[fi + 1] = bgg; this.bg[fi + 2] = bb; this.bg[fi + 3] = 255;
  }

  // Allocation-free numeric fast path: glyphIdx is 0-94 (ASCII code - 32,
  // already resolved by the caller), r/g/b/r2/g2/b2 are 0-255 fg/bg bytes.
  setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyphIdx[i] = glyphIdx;
    const fi = i * 4;
    this.fg[fi] = r; this.fg[fi + 1] = g; this.fg[fi + 2] = b; this.fg[fi + 3] = glyphIdx;
    this.bg[fi] = r2; this.bg[fi + 1] = g2; this.bg[fi + 2] = b2; this.bg[fi + 3] = 255;
  }

  clear(bgHex = '#000000') {
    const [br, bgg, bb] = this._parseColor(bgHex);
    this.glyphIdx.fill(0);
    for (let i = 0; i < this.fg.length; i += 4) {
      this.fg[i] = 255; this.fg[i + 1] = 255; this.fg[i + 2] = 255; this.fg[i + 3] = 0;
    }
    for (let i = 0; i < this.bg.length; i += 4) {
      this.bg[i] = br; this.bg[i + 1] = bgg; this.bg[i + 2] = bb; this.bg[i + 3] = 255;
    }
  }
}
