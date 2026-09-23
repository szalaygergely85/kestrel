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

  return { w, h, geom, mats, flags, tagIds, version: 1 };
}
