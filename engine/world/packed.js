// engine/world/packed.js (US-025, docs/architecture.md 7.2, D-009). Flattens
// a `Level`'s legend-keyed sectors into the GPU-ready packed layout: flat
// typed arrays whose layout equals the eventual texture layout, so US-030
// uploads with texImage2D/texSubImage2D and never reshapes. Built once per
// placed structure (`World.placeStructure`) and rebuilt (fully - this is not
// a hot path) by `World.animateSector` whenever a legend entry's `ceilH`
// changes, so it always mirrors the authoring-side `Level`.

export const SKY_H = 1e30; // sentinel written in place of 'sky' - never Infinity/NaN in a texture-bound array.

const FLAG_SOLID = 1;
const FLAG_CEIL_SKY = 2;
const FLAG_TOP_SKY = 4;
const FLAG_DYNAMIC = 8;

/**
 * @param {import('./Level.js').Level} level
 * @param {import('../render/MaterialTable.js').MaterialTable|null} matTable - optional; material ids are left 0 (unresolved) when omitted.
 * @returns {import('../../docs/architecture.md').PackedLevel}
 */
export function packLevel(level, matTable) {
  const w = level.width, h = level.height, n = w * h;
  const geom = new Float32Array(4 * n); // floorH, ceilH, topH, ceilOpenH
  const mats = new Uint16Array(4 * n);  // wallMatId, floorMatId, ceilMatId, upperMatId
  const flags = new Uint8Array(n);
  const tagIds = {};
  let nextTag = 0;

  for (let cy = 0; cy < h; cy++) {
    const row = level.rows[cy];
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      const ch = row[cx];
      const s = level.legend[ch];
      if (!s) continue; // unreachable for a validated level, but defensive

      const ceilSky = s.ceilH === 'sky';
      const topSky = s.topH === 'sky' || (s.topH === undefined && ceilSky);
      const ceilHVal = ceilSky ? SKY_H : s.ceilH;
      const topHVal = topSky ? SKY_H : (s.topH !== undefined ? s.topH : ceilHVal);
      const ceilOpenH = (s.dynamic && typeof s.dynamic.ceilOpen === 'number') ? s.dynamic.ceilOpen : ceilHVal;

      const gi = i * 4;
      geom[gi] = s.floorH;
      geom[gi + 1] = ceilHVal;
      geom[gi + 2] = topHVal;
      geom[gi + 3] = ceilOpenH;

      mats[gi] = matTable ? matTable.idFor(s.wallMat) : 0;
      mats[gi + 1] = matTable ? matTable.idFor(s.floorMat) : 0;
      mats[gi + 2] = (!ceilSky && matTable) ? matTable.idFor(s.ceilMat) : 0;
      mats[gi + 3] = matTable ? matTable.idFor(s.upperMat || s.wallMat) : 0;

      let f = 0;
      if (s.solid) f |= FLAG_SOLID;
      if (ceilSky) f |= FLAG_CEIL_SKY;
      if (topSky) f |= FLAG_TOP_SKY;
      if (s.dynamic) {
        f |= FLAG_DYNAMIC;
        const tag = s.tag || '(default)';
        if (!(tag in tagIds)) tagIds[tag] = nextTag++;
        f |= (tagIds[tag] & 0xF) << 4;
      }
      flags[i] = f;
    }
  }

  // `dirtyY0`/`dirtyY1` (item 4, architect review #1): the row range touched
  // since the last time an uploader (US-030) consumed this packed layout.
  // `packLevel` itself is a full (re)build, so there is nothing dirty yet;
  // `updateAnimatedSector` below is what advances them.
  return { w, h, geom, mats, flags, tagIds, version: 1, dirtyY0: -1, dirtyY1: -1 };
}

/**
 * (Item 4, architect review #1) In-place update for a single dynamic legend
 * character after `World.animateSector` has already written the new
 * `sector.ceilH`/`topH` onto the Level's legend entry: rewrites only the
 * cells using `ch` (never reallocates the typed arrays - a full `packLevel`
 * rebuild for a 1-2 s grate animation was 3 fresh typed arrays PER SIM STEP),
 * bumps `packed.version` so an uploader can detect the change, and tracks the
 * touched row range in `packed.dirtyY0`/`dirtyY1` (inclusive; -1/-1 means
 * "nothing dirty"). `packLevel` remains the only place that builds a fresh
 * `PackedLevel` from scratch.
 * @param {import('../../docs/architecture.md').PackedLevel} packed
 * @param {import('./Level.js').Level} level
 * @param {string} ch - the legend character whose sector just changed.
 */
export function updateAnimatedSector(packed, level, ch) {
  const s = level.legend[ch];
  if (!s) return;
  const w = packed.w, h = packed.h;

  const ceilSky = s.ceilH === 'sky';
  const topSky = s.topH === 'sky' || (s.topH === undefined && ceilSky);
  const ceilHVal = ceilSky ? SKY_H : s.ceilH;
  const topHVal = topSky ? SKY_H : (s.topH !== undefined ? s.topH : ceilHVal);

  const geom = packed.geom;
  let y0 = Infinity, y1 = -1;
  for (let cy = 0; cy < h; cy++) {
    const row = level.rows[cy];
    let touched = false;
    for (let cx = 0; cx < w; cx++) {
      if (row[cx] !== ch) continue;
      touched = true;
      const i = cy * w + cx;
      const gi = i * 4;
      geom[gi + 1] = ceilHVal;
      geom[gi + 2] = topHVal;
      let f = packed.flags[i];
      f = ceilSky ? (f | FLAG_CEIL_SKY) : (f & ~FLAG_CEIL_SKY);
      f = topSky ? (f | FLAG_TOP_SKY) : (f & ~FLAG_TOP_SKY);
      packed.flags[i] = f;
    }
    if (touched) { if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; }
  }
  if (y1 >= y0) {
    packed.dirtyY0 = packed.dirtyY0 < 0 ? y0 : Math.min(packed.dirtyY0, y0);
    packed.dirtyY1 = Math.max(packed.dirtyY1, y1);
    packed.version++;
  }
}
