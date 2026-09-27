// tools/voxAutoMap.mjs - OWN-REQ-011 (docs/backlog.md): auto color-to-
// material mapping for the editor's "Import .vox" button. Replaces
// tools/vox-import.mjs's hand-written `map.json` step for v1: for each
// distinct RGBA color actually used in the .vox file, finds the nearest
// design/palette.js material by RGB distance to that material's own `base`
// color, and uses that key automatically.
//
// Pure data in (a `usedPaletteEntries()`-shaped list + a palette-shaped
// object), pure data out - no DOM, no vox-parsing, no engine import, so this
// is plain-object Node-testable without a real palette.js or a real .vox
// file (design/palette.js itself stays a classic script per check-deps rule
// 4 - callers pass `window.ASSETS.palette` through as a normal argument, the
// same convention thumbnails.js/panel.js already use).

/** '#rrggbb' -> [r,g,b], or null for anything else (missing color, bad format). */
export function hexToRgb(hex) {
  const m = typeof hex === 'string' && /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `palette.colors[name]` resolved to `[r,g,b]`, or null. */
function resolveColorRgb(palette, colorName) {
  const hex = palette && palette.colors && palette.colors[colorName];
  return hexToRgb(hex);
}

function sqDist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * The `palette.materials` key whose `base` color is closest (squared RGB
 * distance) to `rgb`. Returns null if the palette has no materials with a
 * resolvable `base` color at all (nothing to match against).
 * @param {[number,number,number]} rgb
 * @param {Object} palette `assets.palette` (`{colors, materials}`)
 * @returns {string|null}
 */
export function nearestMaterialKey(rgb, palette) {
  const materials = (palette && palette.materials) || {};
  let best = null;
  let bestDist = Infinity;
  for (const key of Object.keys(materials)) {
    const matRgb = resolveColorRgb(palette, materials[key].base);
    if (!matRgb) continue; // a material with an unresolvable base color can't be matched against
    const d = sqDist(rgb, matRgb);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  return best;
}

/**
 * Builds a `map.json`-shaped object (palette index decimal-string -> material
 * key) automatically, one entry per `usedPaletteEntries()` result - the
 * editor's replacement for vox-import.mjs's hand-written `--map` file.
 * @param {Array<{index:number, rgba:[number,number,number,number]|null}>} usedEntries `voxParse.js`'s `usedPaletteEntries()`
 * @param {Object} palette `assets.palette`
 * @returns {Object<string,string>}
 * @throws if the palette has no matchable materials, or a used color has no
 *   RGBA (the file had no RGBA chunk - auto-mapping needs a real color to
 *   match against, same as vox-import.mjs's CLI needing a map.json entry).
 */
export function autoMapColors(usedEntries, palette) {
  const map = {};
  for (const { index, rgba } of usedEntries) {
    if (!rgba) {
      throw new Error(`voxAutoMap: palette index ${index} has no RGBA color (the .vox file has no RGBA chunk) - cannot auto-match a material`);
    }
    const key = nearestMaterialKey([rgba[0], rgba[1], rgba[2]], palette);
    if (!key) {
      throw new Error('voxAutoMap: the palette has no materials with a resolvable base color to match against');
    }
    map[String(index)] = key;
  }
  return map;
}
