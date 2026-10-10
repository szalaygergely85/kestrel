// @ts-check
// engine/render/waterReflect.js - AUD-42: cheap "ASCII reflection" for opaque water (sky tint at the mirrored view elevation +
// Schlick fresnel). JS twin of the reflect block in gpu/wgsl/waterComposite.wgsl.js (same expression order, D-039).
// All numbers live in WATER_REFLECT; the WGSL interpolates them. Zero alloc: results go into a caller scratch (Float64Array(4)).
import { SKY_LUT_N } from './gpu/wgsl/skyLut.js';

export const WATER_REFLECT = Object.freeze({
  f0: 0.06,        // fresnel at normal incidence (looking straight down: mostly see into the water)
  skyMix: 0.85,    // max share of the sky colour at fresnel 1 (grazing view)
  darken: 0.18,    // body darkening at steep view (scaled by 1 - fresnel)
});

/** Flat sky gradient LUT, same bake as WgShadePass._bakeSky (read-only twin; rgb in 0..255, 4 floats per sample). Returns elevTop or 0 (no sky). */
export function skyLutFromPalette(P, out) {
  const rec = P && P.materials && P.materials.sky;
  if (!rec || !P.timeOfDay) return 0;
  const stops = P.timeOfDay[P.defaultTime].sky;
  for (let i = 0; i < SKY_LUT_N; i++) {
    const t = i / (SKY_LUT_N - 1);
    let k = 0;
    for (; k < stops.length - 1; k++) if (t <= stops[k + 1].t) break;
    if (k >= stops.length - 1) k = stops.length - 2;
    const a = P.rgb[stops[k].c], b = P.rgb[stops[k + 1].c];
    const kk = (t - stops[k].t) / ((stops[k + 1].t - stops[k].t) || 1);
    out[i * 4] = a[0] + (b[0] - a[0]) * kk;
    out[i * 4 + 1] = a[1] + (b[1] - a[1]) * kk;
    out[i * 4 + 2] = a[2] + (b[2] - a[2]) * kk;
    out[i * 4 + 3] = 0;
  }
  return rec.elevTop;
}

/**
 * Reflect factors for a water point seen from the eye. out = [fresnel, skyR, skyG, skyB]; fresnel 0 = no reflection data.
 * @param {number} eyeZ @param {number} dx @param {number} dy @param {number} dz eye -> point vector (dz < 0 looking down)
 * @param {Float32Array|Float64Array} lut @param {number} elevTop @param {Float64Array} out
 */
export function waterReflectAt(eyeZ, dx, dy, dz, lut, elevTop, out) {
  out[0] = 0;
  if (!(elevTop > 0)) return out;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let c = len > 1e-6 ? -dz / len : 0; // N.V with N = up
  c = c < 0 ? 0 : c > 1 ? 1 : c;
  const m = 1 - c, m2 = m * m, f0 = WATER_REFLECT.f0;
  out[0] = f0 + (1 - f0) * (m2 * m2 * m); // Schlick
  const elevDeg = Math.asin(c) * (180 / Math.PI); // mirrored: the reflected ray rises by the same angle
  let t = elevDeg / elevTop; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const idx = Math.floor(t * (SKY_LUT_N - 1) + 0.5) * 4;
  out[1] = lut[idx]; out[2] = lut[idx + 1]; out[3] = lut[idx + 2];
  return out;
}

/** Body colour after reflection: body * (1 - darken*(1-F)) * (1-kS) + sky * kS, kS = F*skyMix. @param {number} body @param {number} F @param {number} sky */
export function waterReflectMix(body, F, sky) {
  const kS = F * WATER_REFLECT.skyMix;
  return body * (1 - WATER_REFLECT.darken * (1 - F)) * (1 - kS) + sky * kS;
}
