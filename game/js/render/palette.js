// Placeholder palette interface (US-001 scope).
//
// `design/palette.js` (US-002) sets `window.ASSETS.palette` and is loaded as
// a classic <script> in index.html, before main.js, so it is normally
// already present by the time any of this runs. This module's placeholder
// mirrors that file's real shape (format v1, see design/README.md):
//   { version, colors: {...}, ramps: { default: '...', stone: '...', ... }, ... }
// so `getPalette()` / `getDefaultRamp()` behave identically whether the real
// file loaded or not - nothing downstream needs to branch on which one it got.

const PLACEHOLDER_PALETTE = {
  version: 0, // 0 marks this as the placeholder, never the real US-002 file (version 1+)
  colors: {
    ambient: '#2a3550',
    sun: '#fff2d0',
    torch: '#ff9a3c',
    lantern: '#ffd27a',
    fog: '#1a2030',
    skyTop: '#0e1830',
    skyHorizon: '#5a7aa0',
    stoneLight: '#9a8f7a',
    stoneMid: '#5f574a',
    stoneDark: '#2c2822',
    moss: '#3d5a34',
    wood: '#6b4a2a',
    iron: '#4a4d52',
    brass: '#b8933f',
    ash: '#3a3a3a',
    straw: '#c2a24a',
  },
  ramps: {
    // Same base ramp as D-002 ` .:-=+*#%@`; the real palette.js's `ramps.default`
    // is a 14-step superset of this in the same order.
    default: ' .:-=+*#%@',
  },
};

/**
 * Returns the active palette: `design/palette.js`'s `window.ASSETS.palette`
 * (format v1: `{ version, colors, ramps, materials, lights, fog, ... }`) if
 * that script has been loaded on the page, otherwise the placeholder above,
 * which is a minimal subset of the same shape.
 */
export function getPalette() {
  if (typeof window !== 'undefined' && window.ASSETS && window.ASSETS.palette) {
    return window.ASSETS.palette;
  }
  return PLACEHOLDER_PALETTE;
}

/**
 * Returns the default brightness ramp string (index 0 = darkest/space).
 */
export function getDefaultRamp() {
  const palette = getPalette();
  return (palette.ramps && palette.ramps.default) || PLACEHOLDER_PALETTE.ramps.default;
}
