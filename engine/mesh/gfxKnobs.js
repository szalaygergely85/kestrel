// GFX-03: quality knobs of the instanced scatter (trees, ground scatter, detail tufts). Leaf module (no imports).
// All defaults are 1 = today's behaviour bit-for-bit. Applied at bind (world load) time, so a change needs a reload.
//   scatterDensity 0..1      keep fraction of every scatter / detail placement, thinned by a per-instance hash (never RNG order)
//   lodScale       0.25..4   multiplies the LOD0 -> LOD1 switch DISTANCE; groups store lodCells / lodScale (the CPU compact and the
//                            WG-4a GPU cull both read `group.lodCells`, so the two paths cannot disagree). Placed kind-9 meshes have no
//                            LOD (meshGroups.js), their shadow reach is the shadow level's job (resolveShadowLevel).
//   tuftDrawScale  0.25..2   multiplies the detail tufts' draw distance (layer drawM and every placement's r2)

export const GFX_DEFAULTS = Object.freeze({ scatterDensity: 1, lodScale: 1, tuftDrawScale: 1 });
export const GFX_RANGES = Object.freeze({ scatterDensity: [0, 1], lodScale: [0.25, 4], tuftDrawScale: [0.25, 2] });

function clamp(v, key) {
  const [lo, hi] = GFX_RANGES[key];
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : GFX_DEFAULTS[key]; // NaN / non-number = default
}

/** @param {{scatterDensity?:number, lodScale?:number, tuftDrawScale?:number}|null|undefined} user @returns {{scatterDensity:number, lodScale:number, tuftDrawScale:number}} clamped copy */
export function resolveGfxKnobs(user) {
  const u = user || {};
  return { scatterDensity: clamp(u.scatterDensity === undefined ? 1 : u.scatterDensity, 'scatterDensity'),
    lodScale: clamp(u.lodScale === undefined ? 1 : u.lodScale, 'lodScale'),
    tuftDrawScale: clamp(u.tuftDrawScale === undefined ? 1 : u.tuftDrawScale, 'tuftDrawScale') };
}

/** Stable per-placement hash in [0, 1): position (1/256 m grid) + placement index; independent of build/RNG order. */
export function placementHash01(x, y, index) {
  let h = Math.imul(Math.round(x * 256) | 0, 0x9e3779b1) ^ Math.imul(Math.round(y * 256) | 0, 0x85ebca6b) ^ Math.imul((index | 0) + 1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Keep a placement at `density`? 1 keeps all, 0 none; for d1 < d2 the kept set of d1 is a subset of d2's. */
export function keepPlacement(x, y, index, density) {
  return density >= 1 || (density > 0 && placementHash01(x, y, index) < density);
}
