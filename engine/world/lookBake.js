// engine/world/lookBake.js (ENV-02c, arch 38.63 points 1 + 4): per-texel ground LOOK byte pair, baked next to the type byte.
// cfg = World opt `groundLook` = { lookMap:[{look, ground:[typeId]|null, biomes:[biomeId]|null}, ...] (first match wins), blendM? }.
// The engine never reads names or biomeLook.js: the game passes id arrays (game/js/look/groundLookConfig.js). The biome blend comes from
// `util.biomeBlend(x, y, out{a,b,w})` (content recipe); a recipe without it makes every biome 0 (only ground rules can match).
// Byte pair per texel: r = lo | hi << 4 (look ids 0..15, lo <= hi), g = round(share of hi * 255); both looks equal -> g = 0.
// Hot path (`bakeCell`) allocates nothing: one reused blend object, a flat 256 x 256 lookup (type, biome) -> look.

export const LOOK_FAR_TEXELS_PER_BLEND = 3; // risk (a): blendM must span >= 3 far texels or the far look shows steps

export class LookBaker {
  constructor(cfg, util) {
    if (!cfg || !Array.isArray(cfg.lookMap)) throw new Error('groundLook: cfg.lookMap array required');
    this.cfg = cfg; this.bb = { a: 0, b: 0, w: 0 }; this.canopyType = -1; // VISQA-03: set by Terrain (forest type id)
    this.blendFn = util && typeof util.biomeBlend === 'function' ? util.biomeBlend : null;
    const lut = this.lut = new Uint8Array(256 * 256), m = cfg.lookMap;
    for (let t = 0; t < 256; t++) for (let b = 0; b < 256; b++) {
      let v = 0;
      for (let i = 0; i < m.length; i++) {
        const r = m[i];
        if ((r.ground === null || r.ground.indexOf(t) >= 0) && (r.biomes === null || r.biomes.indexOf(b) >= 0)) { v = r.look; break; }
      }
      if (v < 0 || v > 15) throw new Error('groundLook: look id ' + v + ' out of 0..15');
      lut[t << 8 | b] = v;
    }
  }

  /**
   * Writes the byte pair of the texel at (x, y) with ground `type` into `out[2k], out[2k+1]`. 0 alloc.
   * VISQA-03: `canopy` = this texel draws the +canopy block (far ring always; near band without real trees). A texel of
   * `canopyType` (forest) then gets look 0 (TLOOK canopy greens + face glyphs): its visible surface is the canopy top, not the
   * forest FLOOR look (leaf litter), which read as pale grey-tan flat blocks behind the real-tree line.
   */
  bakeCell(x, y, type, out, k, canopy = false) {
    if (canopy && type === this.canopyType) { const j0 = k << 1; out[j0] = 0; out[j0 + 1] = 0; return; }
    const bb = this.bb, lut = this.lut, f = this.blendFn;
    if (f) f(x, y, bb); else { bb.a = 0; bb.b = 0; bb.w = 0; }
    const la = lut[type << 8 | bb.a], lb = lut[type << 8 | bb.b], j = k << 1;
    if (la === lb) { out[j] = la | la << 4; out[j + 1] = 0; return; }
    const lo = la < lb ? la : lb, hi = la < lb ? lb : la;
    const wHi = lb > la ? bb.w : 1 - bb.w; // bb.w = share of b (the 2nd biome)
    out[j] = lo | hi << 4; out[j + 1] = Math.round(wHi * 255);
  }
}

/** Risk (a) assert: the blend width must cover >= 3 far texels (`texelM` = terrain.mapCell). */
export function assertBlendM(blendM, texelM) {
  if (!(blendM >= LOOK_FAR_TEXELS_PER_BLEND * texelM)) throw new Error('groundLook: blendM ' + blendM + ' m < ' + LOOK_FAR_TEXELS_PER_BLEND + ' x far texel ' + texelM + ' m (visible steps)');
}
