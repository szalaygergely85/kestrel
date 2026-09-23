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

// US-030a (docs/architecture.md 7.2 amendment / 14.2 item 2): the ao "relief"
// bit masks the CPU caster keeps on `level._relief028` (engine/render/
// sectorCaster.js's `ensureRelief`/`planeAoDFast`) are duplicated here as a
// packed-layout field so the GPU DDA can read them straight out of the
// `FLAGS` atlas (`g = floorRise | ceilDrop << 4`) with no `sectorAt` calls.
// This is a SEPARATE array from the CPU caster's own cache - the CPU path is
// unchanged (AC: "nothing else changes in the CPU caster") - so the two are
// computed independently, from the same rule, and may briefly disagree only
// in the same way `ensureRelief` itself would (never queried mid-recompute).
const RELIEF_W = 1, RELIEF_E = 2, RELIEF_N = 4, RELIEF_S = 8;
function computeRelief(level, w, h) {
  const floorRise = new Uint8Array(w * h);
  const ceilDrop = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const own = level.sectorAt(cx + 0.5, cy + 0.5);
      const i = cy * w + cx;
      if (!own) continue;
      const ownFloorH = own.floorH, ownCeilH = own.ceilH;
      let fb = 0, cb = 0;
      const west = level.sectorAt(cx - 1 + 0.5, cy + 0.5);
      const east = level.sectorAt(cx + 1 + 0.5, cy + 0.5);
      const north = level.sectorAt(cx + 0.5, cy - 1 + 0.5);
      const south = level.sectorAt(cx + 0.5, cy + 1 + 0.5);
      if (!west || west.floorH > ownFloorH + 0.01) fb |= RELIEF_W;
      if (!east || east.floorH > ownFloorH + 0.01) fb |= RELIEF_E;
      if (!north || north.floorH > ownFloorH + 0.01) fb |= RELIEF_N;
      if (!south || south.floorH > ownFloorH + 0.01) fb |= RELIEF_S;
      if (ownCeilH !== 'sky') {
        const rises = (q) => !q || q.solid || (q.ceilH !== 'sky' && q.ceilH < ownCeilH - 0.01);
        if (rises(west)) cb |= RELIEF_W;
        if (rises(east)) cb |= RELIEF_E;
        if (rises(north)) cb |= RELIEF_N;
        if (rises(south)) cb |= RELIEF_S;
      }
      floorRise[i] = fb;
      ceilDrop[i] = cb;
    }
  }
  return { floorRise, ceilDrop };
}
function packRelief(relief, w, h) {
  const out = new Uint8Array(w * h);
  const { floorRise, ceilDrop } = relief;
  for (let i = 0; i < w * h; i++) out[i] = (floorRise[i] & 0xf) | ((ceilDrop[i] & 0xf) << 4);
  return out;
}

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

  // US-030a: `relief` is the packed floorRise/ceilDrop nibbles (7.2
  // amendment) the GPU DDA reads for ambient-occlusion depth (`aoD`) on
  // plane samples - the `FLAGS` texture's `g` channel is `packRelief`'s
  // output, uploaded by `WorldTextures.js`, never reshaped here.
  const relief = packRelief(computeRelief(level, w, h), w, h);

  // `dirtyY0`/`dirtyY1` (item 4, architect review #1): the row range touched
  // since the last time an uploader (US-030) consumed this packed layout.
  // `packLevel` itself is a full (re)build, so there is nothing dirty yet;
  // `updateAnimatedSector` below is what advances them.
  return { w, h, geom, mats, flags, relief, tagIds, version: 1, dirtyY0: -1, dirtyY1: -1 };
}

/**
 * US-030a integration fix: `World.placeStructure` calls `packLevel(level,
 * null)` (matTable doesn't exist yet at world-load time), so `packed.mats`
 * is all-zero until something re-packs it against the REAL, now-bound
 * table. `bindLevel(matTable, level)` (MaterialTable.js) already bakes ids
 * onto the level's own legend sectors for the CPU caster's benefit; this is
 * its packed-array counterpart for `WorldTextures.js` - same values, same
 * `ceilSky -> 0` rule as `packLevel`'s own mats section, called once right
 * after `bindLevel` (see game/js/main.js). Does not touch geom/flags/relief
 * or `tagIds`; bumps `version` and marks every row dirty so an atlas built
 * BEFORE this call (there shouldn't be one, in practice) would still pick
 * it up.
 * @param {import('../../docs/architecture.md').PackedLevel} packed
 * @param {import('./Level.js').Level} level
 * @param {import('../render/MaterialTable.js').MaterialTable} matTable
 */
export function repackMaterials(packed, level, matTable) {
  const w = packed.w, h = packed.h, mats = packed.mats;
  for (let cy = 0; cy < h; cy++) {
    const row = level.rows[cy];
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      const s = level.legend[row[cx]];
      if (!s) continue;
      const ceilSky = s.ceilH === 'sky';
      const gi = i * 4;
      mats[gi] = matTable.idFor(s.wallMat);
      mats[gi + 1] = matTable.idFor(s.floorMat);
      mats[gi + 2] = ceilSky ? 0 : matTable.idFor(s.ceilMat);
      mats[gi + 3] = matTable.idFor(s.upperMat || s.wallMat);
    }
  }
  packed.version++;
  packed.dirtyY0 = 0; packed.dirtyY1 = h - 1;
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
    // US-030a: a changed ceilH can flip the ceilDrop relief bit of the
    // neighbouring cells on every side (`computeRelief`'s `rises()` reads
    // the changed sector), not just the touched cells themselves - so the
    // relief array is recomputed in full (cheap: this only runs on a
    // dynamic-sector animation step, not per frame) and the dirty row range
    // grows by one on each side to cover those neighbours too.
    packed.relief = packRelief(computeRelief(level, w, h), w, h);
    packed.dirtyY0 = packed.dirtyY0 < 0 ? Math.max(0, y0 - 1) : Math.min(packed.dirtyY0, Math.max(0, y0 - 1));
    packed.dirtyY1 = Math.max(packed.dirtyY1, Math.min(h - 1, y1 + 1));
    packed.version++;
  }
}
