// engine/render/tuftAtlas.js - TUFT-01a part 1 (docs/architecture.md "38.52 amendment (tuft atlas)").
// Deterministic 2-channel tuft silhouettes + the exact ray/sheared-plane solve + texel lookup.
// Integer maths only (hashFast24, int fixed point, arithmetic shifts): no Math.random, no float rounding in the generator.
// Texel layout: row 0 = blade base, row h-1 = top; col 0 = left. 2 bytes per texel, layer = shape:
//   r = 0 empty, else 1 + round(253 * yFrac) (height fraction along THAT blade; short blades get their own tips)
//   g = |texel centre - blade centre line| in 1/32 texel (0..255), for the per-stroke screen-width cap.
import { hashFast24 } from './terrainShade.js';

export const TUFT_ATLAS_DEFAULTS = Object.freeze({ n: 8, w: 16, h: 24, blades: [5, 9], curl: 1, widthTex: 1 });
const SALT = 7100; // generator hash salt (own value, never shared with carpet.js salts)

/**
 * Build the atlas. Same (seed, opts) -> byte-identical `data`.
 * @returns {{data: Uint8Array, n: number, w: number, h: number, strokes: Uint8Array}} strokes[k] = blade count of shape k
 */
export function buildTuftAtlas(seed = 1, opts = {}) {
  const n = opts.n ?? TUFT_ATLAS_DEFAULTS.n, w = opts.w ?? TUFT_ATLAS_DEFAULTS.w, h = opts.h ?? TUFT_ATLAS_DEFAULTS.h;
  const bl = opts.blades ?? TUFT_ATLAS_DEFAULTS.blades;
  const curlK = Math.round((opts.curl ?? TUFT_ATLAS_DEFAULTS.curl) * 16) | 0;   // 16 = 1.0
  const widK = Math.round((opts.widthTex ?? TUFT_ATLAS_DEFAULTS.widthTex) * 16) | 0;
  const data = new Uint8Array(n * w * h * 2), strokes = new Uint8Array(n);
  const sd = seed | 0, W16 = w * 16;
  for (let k = 0; k < n; k++) {
    const hs = (a, b) => hashFast24(sd + k * 131 + a, b, SALT);
    const nb = bl[0] + hs(0, 0) % (bl[1] - bl[0] + 1);
    strokes[k] = nb;
    const base = k * w * h * 2, slot = (W16 / nb) | 0;
    for (let i = 0; i < nb; i++) {
      const hi = 10 + i * 7;
      // centre-line origin: evenly spread slots + jitter, kept inside the tile
      let x0 = (((i * W16 / nb) | 0) + (slot >> 1) + (((hs(hi, 1) % slot) - (slot >> 1)) >> 1)) | 0;
      x0 = Math.max(24, Math.min(W16 - 24, x0));
      // taller towards the middle, varied per blade (rows)
      const mid = ((Math.abs(2 * i + 1 - nb) * 4 / nb) | 0);                        // 0 centre .. ~4 edge
      const hb = Math.max(8, Math.min(h, 12 + (hs(hi, 2) % (h - 11)) - mid * 2));
      const lean = (hs(hi, 3) % 97) - 48;                                           // total tip offset, 1/16 texel (+-3 texel)
      const curl = (((hs(hi, 4) % 61) - 30) * curlK) >> 4;                          // quadratic bend, 1/16 texel
      const wb = ((26 + (hs(hi, 5) % 14)) * widK) >> 4;                             // base half-width, 1/16 texel (~1.6-2.4)
      for (let ry = 0; ry < hb && ry < h; ry++) {
        const t = (((ry * 2 + 1) * 256) / (2 * hb)) | 0;                            // 0..255 stroke fraction (int)
        const xc = x0 + ((lean * t) >> 8) + ((curl * ((t * t) >> 8)) >> 8);
        // thicker at the base, tapering to a thin tip (never below 5/16 texel)
        const hw = Math.max(5, (wb * (256 - t)) >> 8);
        const rv = 1 + ((253 * t + 128) >> 8);
        for (let c = 0; c < w; c++) {
          const d = Math.abs(c * 16 + 8 - xc);
          if (d > hw) continue;
          const o = base + (ry * w + c) * 2, g = Math.min(255, d * 2);
          if (data[o] === 0 || g < data[o + 1]) { data[o] = rv; data[o + 1] = g; }  // nearer centre line wins
        }
      }
    }
  }
  return { data, n, w, h, strokes };
}

/**
 * Packed texel (r | g << 8) for shape k at (u, v) in [0,1) x [0,1) (v = 0 base). Clamped, no allocation.
 * Split with texelR / texelG.
 */
export function tuftLookup(atlas, shape, u, v) {
  const w = atlas.w, h = atlas.h;
  let c = (u * w) | 0, r = (v * h) | 0;
  if (c < 0) c = 0; else if (c >= w) c = w - 1;
  if (r < 0) r = 0; else if (r >= h) r = h - 1;
  const o = ((shape * h + r) * w + c) * 2;
  return atlas.data[o] | (atlas.data[o + 1] << 8);
}
export const texelR = (p) => p & 255;
export const texelG = (p) => p >> 8;

/**
 * Exact ray / lean-sheared vertical plane solve (no loop). Plane: nrm . (p.xy - root.xy - L * (p.z - gz)) = 0.
 * Ray p = e + t d. Returns t, or NaN when the ray is (near) parallel to the plane (|denominator| < 1e-6).
 */
export function tuftPlaneT(ex, ey, ez, dx, dy, dz, rx, ry, gz, lx, ly, nx, ny) {
  const den = nx * (dx - lx * dz) + ny * (dy - ly * dz);
  if (den < 1e-6 && den > -1e-6) return NaN;
  const lz = ez - gz;
  return (nx * (rx + lx * lz - ex) + ny * (ry + ly * lz - ey)) / den;
}
