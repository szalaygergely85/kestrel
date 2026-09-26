// tools/editor/thumbnails.js - US-067 (docs/backlog.md PC-B QUEUE 3 item 8).
// Pure ASCII thumbnail builder for the Assets tab's model list: plain data
// in (a palette + a model def, both already-loaded content, no DOM/window),
// plain data out (`{ w, h, cells }`), so it is Node-testable with a bare
// fixture and callable from the browser-only DOM code in main.js.
//
// <= 16x8 cells, in the MODEL'S OWN colours (never a fixed UI colour):
//   - sprite/billboard models: the first frame of the "idle" clip (falling
//     back to the model's first declared animation when there is no literal
//     "idle" - the same rule `World.load` itself uses for an unspecified
//     `variant`, engine/world/World.js), cropped/downsampled to fit.
//   - voxel models: a front orthographic view - for each column (x) / row
//     (z) of the model's front face, the first solid voxel scanning from the
//     front (y = 0, design/README.md 4's axis convention: "y0 = the front
//     row, faces north at yaw 0"), that voxel's material `base` colour + a
//     shade glyph picked from the material's own glyph ramp.
//
// No imports (deliberately) - a thumbnail is pure content-shape math, no
// engine/AssetRegistry dependency; callers pass `assets.palette`/
// `assets.model(key)` straight through.

export const THUMB_MAX_W = 16;
export const THUMB_MAX_H = 8;

const DEFAULT_RAMP = ' .:-=+*#%@';

function hexFor(palette, colorName) {
  return (palette && palette.colors && palette.colors[colorName]) || '#888888';
}

/** Nearest-neighbour downsample index: identity when the target is >= the source (never upsamples). */
function srcIndex(t, dst, src) {
  if (dst >= src || src <= 0) return Math.min(t, Math.max(0, src - 1));
  return Math.min(src - 1, Math.floor((t * src) / dst));
}

/**
 * A model's default ("idle") animation clip: `animations.idle` when present,
 * else the first animation in declared key order - the same fallback
 * `World.load` uses for a prop with no `variant` (`animNames[0]`,
 * engine/world/World.js).
 */
export function defaultClip(model) {
  const anims = model && model.animations;
  if (!anims) return null;
  if (anims.idle) return anims.idle;
  const names = Object.keys(anims);
  return names.length ? anims[names[0]] : null;
}

/** The first direction a frame actually has, preferring 'S' (every billboard model in design/ has at least a south frame). */
function frameDirection(frame) {
  if (!frame) return null;
  if (frame.S) return 'S';
  const keys = Object.keys(frame);
  return keys.length ? keys[0] : null;
}

/**
 * Sprite/billboard thumbnail (<= 16x8 cells): the idle clip's first frame,
 * its `glyphs`/`fg` rows resolved through the model's own `keys` map
 * (design/README.md format section 4: `keys[fgChar] = { c: colorName }`) to
 * a palette hex, then nearest-neighbour-sampled down to the cap. A blank
 * glyph (space, or an fg char with no `keys` entry) is a transparent cell
 * (`fg: null`) - the caller draws it as empty/background.
 * @param {Object} palette `assets.palette`
 * @param {Object} model `assets.model(key)`
 * @returns {{w:number, h:number, cells: Array<{ch:string, fg:string|null}>}} `cells` is `h` rows of `w`, row-major
 */
export function buildSpriteThumbnail(palette, model) {
  const clip = defaultClip(model);
  const frame = clip && clip.frames && clip.frames[0];
  const dir = frameDirection(frame);
  const shape = dir ? frame[dir] : null;
  const glyphs = (shape && shape.glyphs) || [];
  const fgRows = (shape && shape.fg) || [];
  const srcH = glyphs.length;
  const srcW = srcH ? Math.max(...glyphs.map((r) => r.length)) : 0;
  const w = Math.max(1, Math.min(THUMB_MAX_W, srcW || 1));
  const h = Math.max(1, Math.min(THUMB_MAX_H, srcH || 1));
  const keys = (model && model.keys) || {};
  const cells = new Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    const sy = srcIndex(ty, h, srcH);
    const gRow = glyphs[sy] || '';
    const fRow = fgRows[sy] || '';
    for (let tx = 0; tx < w; tx++) {
      const sx = srcIndex(tx, w, srcW);
      const ch = gRow[sx] || ' ';
      const fgChar = fRow[sx];
      const key = fgChar ? keys[fgChar] : null;
      const fg = ch !== ' ' && key ? hexFor(palette, key.c) : null;
      cells[ty * w + tx] = { ch, fg };
    }
  }
  return { w, h, cells };
}

/**
 * Voxel model thumbnail (<= 16x8 cells): a front orthographic view. Builds
 * the model's full-resolution front-face grid first (one entry per (x, z):
 * the material char of the first solid voxel scanning `y` from the front,
 * or `null` for a column/row with no solid voxel anywhere along `y`), then
 * nearest-neighbour-samples that down to the cap (same routine as the
 * sprite builder). Image row 0 is the TOP of the model (highest `z`) - `z`
 * is up (design/README.md 4), but a thumbnail is drawn top-to-bottom.
 * @param {Object} palette `assets.palette`
 * @param {Object} model `assets.model(key)` - `model.voxel` = a VoxelModelDef
 *   (`{ size:[sx,sy,sz], mats:{char:matKey}, layers:[z][y] = a length-sx string }`)
 * @param {string} [emptyChar] the voxel grid's "nothing here" character (every design/models/*.js voxel def uses '.')
 */
export function buildVoxelThumbnail(palette, model, emptyChar = '.') {
  const v = model && model.voxel;
  if (!v || !Array.isArray(v.layers) || !Array.isArray(v.size)) {
    return { w: 1, h: 1, cells: [{ ch: ' ', fg: null }] };
  }
  const sx = v.size[0], sz = v.size[2];
  const mats = v.mats || {};
  const materials = (palette && palette.materials) || {};

  // Full-resolution front view: for each (x, z), the first solid voxel
  // scanning y from the front (y = 0).
  const full = new Array(sz);
  for (let rowZ = 0; rowZ < sz; rowZ++) {
    const z = sz - 1 - rowZ; // image row 0 = top = the highest z
    const layer = v.layers[z] || [];
    const row = new Array(sx).fill(null);
    for (let x = 0; x < sx; x++) {
      let matChar = null;
      for (let y = 0; y < layer.length; y++) {
        const c = (layer[y] || '')[x];
        if (c && c !== emptyChar) { matChar = c; break; }
      }
      row[x] = matChar;
    }
    full[rowZ] = row;
  }

  const srcW = sx, srcH = sz;
  const w = Math.max(1, Math.min(THUMB_MAX_W, srcW));
  const h = Math.max(1, Math.min(THUMB_MAX_H, srcH));
  const cells = new Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    const sy = srcIndex(ty, h, srcH);
    const row = full[sy] || [];
    for (let tx = 0; tx < w; tx++) {
      const sx2 = srcIndex(tx, w, srcW);
      const matChar = row[sx2];
      if (!matChar) { cells[ty * w + tx] = { ch: ' ', fg: null }; continue; }
      const matKey = mats[matChar];
      const mat = matKey && materials[matKey];
      const fg = mat ? hexFor(palette, mat.base) : '#888888';
      const ramp = (mat && palette && palette.ramps && palette.ramps[mat.ramp]) || DEFAULT_RAMP;
      const albedo = mat && typeof mat.albedo === 'number' ? mat.albedo : 0.7;
      const idx = Math.max(1, Math.min(ramp.length - 1, Math.round(albedo * (ramp.length - 1))));
      cells[ty * w + tx] = { ch: ramp[idx], fg };
    }
  }
  return { w, h, cells };
}

/** Dispatches to the voxel or sprite builder by the model's own shape (`model.voxel` present -> voxel). */
export function buildModelThumbnail(palette, model) {
  if (model && model.voxel) return buildVoxelThumbnail(palette, model);
  return buildSpriteThumbnail(palette, model);
}

// ---------------------------------------------------------------------------
// Cache (US-067: "built once and cached"). Keyed by the `assets` registry's
// own identity (a fresh registry - e.g. a Node test, or the editor loading a
// different world - never sees another registry's cached thumbnails), then
// by model key.
// ---------------------------------------------------------------------------
const _cacheByAssets = new WeakMap();

/** Builds (once) and returns a model's thumbnail, cached on `assets`. */
export function getModelThumbnail(assets, key) {
  let cache = _cacheByAssets.get(assets);
  if (!cache) { cache = new Map(); _cacheByAssets.set(assets, cache); }
  if (cache.has(key)) return cache.get(key);
  const thumb = buildModelThumbnail(assets.palette, assets.model(key));
  cache.set(key, thumb);
  return thumb;
}
