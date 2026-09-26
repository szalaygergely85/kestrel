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
 *
 * BUG-PERF-001 (c) (docs/backlog.md row 25w): while `d.all === 1` (no
 * whole-scene dim active - the common case, e.g. a single hint's small
 * plate rect, never the map card), every cell OUTSIDE the pushed rects is
 * unaffected by definition (`dimAt` can only return < 1 for a cell inside
 * at least one rect) - scanning the full `cols x rows` grid to discover
 * that was the actual per-frame cost here (measured: ~0.14 ms at 320x120,
 * ~0.31 ms at 480x180, entirely inside this one full-grid double loop, for
 * a rect that is typically a few dozen cells). Bounding the scan to the
 * union of the (at most 4, `MAX_RECTS`) rects' own bounding boxes instead
 * keeps the exact same per-cell result (still routed through `dimAt`, which
 * already takes the min over every overlapping rect - no double-multiply
 * even where two pushed rects overlap) while touching only the cells that
 * can possibly change. A real whole-scene dim (`d.all < 1`, the map card)
 * still needs every cell, so that case is untouched.
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {SceneDim} d
 */
export function applySceneDim(rt, d) {
  if (d.all >= 1 && d.n === 0) return;
  const cb = rt.cells;
  const cols = cb.cols, rows = cb.rows;
  const mask = cb.mask, fg = cb.fg, bg = cb.bg;

  let y0 = 0, y1 = rows, x0 = 0, x1 = cols;
  if (d.all >= 1) {
    // Only rects are live - bound the scan to their union (clamped to the
    // grid; a rect may have been pushed with UI-cell coords scaled larger
    // than the scene grid, or with x1<=x0/y1<=y0 - either way the clamp
    // below makes an out-of-range or degenerate rect scan zero cells, not
    // throw/underflow).
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (let i = 0; i < d.n; i++) {
      const b = i * FIELDS;
      if (d.rects[b] < ux0) ux0 = d.rects[b];
      if (d.rects[b + 1] < uy0) uy0 = d.rects[b + 1];
      if (d.rects[b + 2] > ux1) ux1 = d.rects[b + 2];
      if (d.rects[b + 3] > uy1) uy1 = d.rects[b + 3];
    }
    x0 = Math.max(0, Math.floor(ux0)); y0 = Math.max(0, Math.floor(uy0));
    x1 = Math.min(cols, Math.ceil(ux1)); y1 = Math.min(rows, Math.ceil(uy1));
  }

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
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
