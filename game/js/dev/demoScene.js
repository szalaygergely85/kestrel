// US-001 demo screen: proves per-cell fg/bg color with an animated gradient,
// plus a strip showing every glyph of the base ramp ` .:-=+*#%@`.
// This is throwaway scaffolding for this story only - later stories replace
// it with the real raycast render.

// US-024: `render/palette.js`'s placeholder is gone (the AssetRegistry
// requires a real palette, architecture.md section 6) - the ramp now comes
// from whatever palette main.js's AssetRegistry loaded, passed in below.

// RenderTarget expects "#rrggbb" hex (see its perf note - hex parses far
// cheaper per cell than letting the browser resolve an hsl()/rgb() string),
// so the animated gradient is generated directly as hex via a small HSL to
// RGB conversion.
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

/**
 * Draws the animated gradient + glyph-ramp strip into a RenderTarget.
 * @param {import('../../../engine/render/RenderTarget.js').RenderTarget} rt
 * @param {number} t - elapsed seconds, used to animate the gradient
 * @param {string} [ramp] - brightness ramp string; defaults to the D-002 base ramp
 */
export function drawDemoScene(rt, t, ramp) {
  const RAMP = ramp || ' .:-=+*#%@';
  rt.clear('#000000');

  const { cols, rows } = rt;

  // Animated color gradient filling most of the grid: hue scrolls with time
  // and sweeps across x, lightness ramps with y - a cheap way to show every
  // cell gets an independent fg AND bg color.
  const gradientRows = rows - 6; // leave room for the glyph strip + margin
  for (let y = 0; y < gradientRows; y++) {
    for (let x = 0; x < cols; x++) {
      const hue = (t * 30 + (x / cols) * 360 + (y / gradientRows) * 60) % 360;
      const bgL = 18 + (y / gradientRows) * 22;
      const fgL = bgL + 30;
      const bg = hslToHex(hue, 55, bgL);
      const fg = hslToHex((hue + 40) % 360, 70, fgL);
      const glyphIndex = Math.floor(((x + y + t * 20) % RAMP.length + RAMP.length) % RAMP.length);
      rt.setCell(x, y, RAMP[glyphIndex], fg, bg);
    }
  }

  // Glyph ramp strip: every glyph of the base ramp, large, one per few
  // columns, over a dark background - proves per-cell fg/bg independent of
  // the gradient above.
  const stripY = gradientRows + 2;
  const label = 'RAMP  ' + RAMP.split('').join(' ');
  for (let x = 0; x < cols; x++) {
    const ch = x < label.length ? label[x] : ' ';
    rt.setCell(x, stripY, ch, '#ffffff', '#111111');
  }

  // A second strip showing the ramp swept through brightness-driven color,
  // like a material ramp would be used later.
  const swatchY = stripY + 2;
  for (let x = 0; x < cols; x++) {
    const brightness = x / (cols - 1);
    const idx = Math.min(RAMP.length - 1, Math.floor(brightness * RAMP.length));
    const l = 10 + brightness * 60;
    rt.setCell(x, swatchY, RAMP[idx], hslToHex(35, 60, l), hslToHex(35, 40, l * 0.4));
  }
}
