// engine/ui/sceneDim.js (US-015, docs/architecture.md 7.6 item 3). A
// sibling of `engine/ui/fade.js`'s scene fade: multiplies non-mask cells by
// a per-region gain instead of fading them toward black, so a map-card dim
// (whole scene x 0.35) or a hint's soft plate (a small rect x 0.35) can
// coexist with the normal fade/UI without either engine primitive knowing
// about the other. CPU-only here (D-017: the GPU path mirrors this into
// `spritesPass` uniforms - not wired in this pass, see the US-015 story's
// Programmer notes / known limitations).
//
// Allocation rule (9): `applySceneDim` runs at most once per rendered frame
// over every cell - no allocation, no per-cell object.

const MAX_RECTS = 4;
const FIELDS = 5; // x0, y0, x1, y1, mul

/** @typedef {{all:number, n:number, rects:Float32Array}} SceneDim */

/** @returns {SceneDim} */
export function createSceneDim() {
  return { all: 1, n: 0, rects: new Float32Array(MAX_RECTS * FIELDS) };
}

/** Call once per frame before any `pushDimRect`/`all` write this frame. */
export function resetSceneDim(d) {
  d.all = 1;
  d.n = 0;
}

let warnedOverflow = false;

/**
 * Half-open scene-cell rect `[x0,x1) x [y0,y1)` multiplied by `mul`. At most
 * `MAX_RECTS` (4) live at once (warns once beyond that and drops the rect -
 * US-015 never needs more than 2 in the same frame: the map-card plate and a
 * hint plate).
 */
export function pushDimRect(d, x0, y0, x1, y1, mul) {
  if (d.n >= MAX_RECTS) {
    if (!warnedOverflow) { warnedOverflow = true; console.warn('[sceneDim] more than 4 dim rects requested in one frame - dropping the rest'); }
    return;
  }
  const i = d.n * FIELDS;
  d.rects[i] = x0; d.rects[i + 1] = y0; d.rects[i + 2] = x1; d.rects[i + 3] = y1; d.rects[i + 4] = mul;
  d.n++;
}

/** Per-cell gain: `min(d.all, mul of every rect containing (x,y))`. Pure, no allocation. */
function dimAt(d, x, y) {
  let k = d.all;
  for (let i = 0; i < d.n; i++) {
    const b = i * FIELDS;
    if (x >= d.rects[b] && x < d.rects[b + 2] && y >= d.rects[b + 1] && y < d.rects[b + 3]) {
      const m = d.rects[b + 4];
      if (m < k) k = m;
    }
  }
  return k;
}

/**
 * Multiplies `fg.rgb` and `bg.rgb` of every non-mask cell by its dim gain
 * (glyph unchanged - a dim is not a fade). Identity (`all === 1 && n === 0`)
 * is a no-op, same contract as `applySceneFade`. Call right after
 * `applySceneFade` (same call site, CPU path only).
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {SceneDim} d
 */
export function applySceneDim(rt, d) {
  if (d.all >= 1 && d.n === 0) return;
  const cb = rt.cells;
  const cols = cb.cols, rows = cb.rows;
  const mask = cb.mask, fg = cb.fg, bg = cb.bg;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (mask[i]) continue;
      const k = dimAt(d, x, y);
      if (k >= 1) continue;
      const fi = i * 4;
      fg[fi] = (fg[fi] * k) | 0; fg[fi + 1] = (fg[fi + 1] * k) | 0; fg[fi + 2] = (fg[fi + 2] * k) | 0;
      bg[fi] = (bg[fi] * k) | 0; bg[fi + 1] = (bg[fi + 1] * k) | 0; bg[fi + 2] = (bg[fi + 2] * k) | 0;
    }
  }
}
