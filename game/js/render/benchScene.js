// Worst-case benchmark content for `?bench=1` (see main.js): every one of
// the 9600 cells gets a distinct, non-space glyph with a fg/bg color that
// keeps shifting frame to frame (so neither the glyph-tile cache nor any
// future dirty-cell tracking can shortcut the work) - the adversarial case
// the US-001 perf rework was measured against.

const GLYPHS = (() => {
  const chars = [];
  for (let code = 33; code <= 126; code++) chars.push(String.fromCharCode(code)); // skip space: never a "cell to draw"
  return chars;
})();

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

/**
 * Fills every cell with a unique, frame-varying glyph/fg/bg.
 * @param {import('./RenderTarget.js').RenderTarget} rt
 * @param {number} frame - increases every call; keeps colors moving so the
 *   tile cache keeps growing/rotating instead of settling after frame 1.
 */
export function fillWorstCase(rt, frame) {
  const { cols, rows } = rt;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const hue = (frame * 7 + x * 2.3 + y * 3.7) % 360;
      const bg = hslToHex(hue, 55, 20 + ((x + y + frame) % 30));
      const fg = hslToHex((hue + 180) % 360, 70, 55 + ((x * 3 + y) % 20));
      const glyph = GLYPHS[(x + y * 3 + frame) % GLYPHS.length];
      rt.setCell(x, y, glyph, fg, bg);
    }
  }
}
