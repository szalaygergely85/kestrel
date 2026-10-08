// @ts-check
// engine/mesh/lodDither.js - S8-B2-07: screen-door LOD crossfade (JS oracle of the cull kernel + raster fragment WGSL twins).
// Inside the LOD hysteresis band (cells in [lodLo, lodHi]) a dithered instance is emitted to BOTH LOD lists; every row carries, in its
// flags word (instance word 13, above the team byte): bits 16-24 cov (0..256), bit 25 invert (1 = the LOD1 copy), bit 26 active.
// Fragment keep rule (per raster cell, stable): h = ditherHash(x, y) & 255;  LOD0: h < cov;  LOD1: h >= cov.
// The two copies are exact complements, so every cell shows exactly one of them (no holes, no overlap); cov rises 0..256 across the band
// (f = (cells - lo) / (hi - lo)), so the band edges are continuous with the plain LOD1 (cov 0) / LOD0 (cov 256) draws.
// Off by default (`group.lodDither` / CullU.lodDither = 0): rows keep these bits 0 and nothing changes.

export const LDT_COV_SHIFT = 16;
export const LDT_COV_MASK = 0x1ff << LDT_COV_SHIFT;
export const LDT_INVERT = 1 << 25;
export const LDT_ACTIVE = 1 << 26;

/** Coverage fraction of LOD0 (0 at lodLo, 1 at lodHi) for a projected size `cells`. */
export function lodBandFrac(cells, lo, hi) {
  const f = (cells - lo) / (hi - lo);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Flags-word bits of one copy. @param {number} f lodBandFrac @param {0|1} lod @returns {number} */
export function lodDitherBits(f, lod) {
  const cov = Math.min(Math.floor(f * 256), 256);
  return (LDT_ACTIVE | (cov << LDT_COV_SHIFT) | (lod === 1 ? LDT_INVERT : 0)) >>> 0;
}

/** Per-cell hash (u32 ops only, the same text as raster.wgsl.js `ditherHash`). */
export function ditherHash(x, y) {
  let h = (Math.imul(x >>> 0, 0x45d9f3b) ^ Math.imul(y >>> 0, 0x27d4eb2d)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h;
}

/** True when the fragment at raster cell (x, y) is kept. `d` = (flagsWord >>> 16) & 0x7ff (cov | invert << 9 | active << 10); 0 = not dithered. */
export function ditherKeep(d, x, y) {
  if ((d & 0x400) === 0) return true;
  const h = ditherHash(x, y) & 255, cov = d & 0x1ff;
  return (d & 0x200) !== 0 ? h >= cov : h < cov;
}
