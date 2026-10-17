// RND-NIGHT-RIM-03 MOON-RIM: a small cool rim lift on surfaces that face the moon at their silhouette edge.
// ONE rule applied in the LIGHT pass (JS lightSurfaces + WGSL fs_main, same place the contact AO lands), so terrain, voxels and
// meshes get it identically and the shade pass needs no change (SUN-COL-LIVE consistency; a mesh-only floor was rejected).
// rim = k * max(0, N.Lmoon) * (1 - max(0, N.V))^2 * fade(dist); added to L along MOON_RIM_COL (max component 1 = exact luminance).
//  - k = RIM_K * night * moonVis (syncMoonRim): 0 by day (night = 1 - smoothstep(sunI)), 0 when the moon light is off/below the horizon.
//  - back-facing the moon: N.L <= 0 -> 0.  Far terrain: fade hits 0 at MOON_RIM_FAR_M, so it never outshines the sky (OB-209).
// Off with ?moonrim=0 (setMoonRimEnabled(false)) -> k stays 0, the light pass is bit-identical to before.
export const MOON_RIM_K = 0.45;       // peak luminance added at a grazing, moon-facing edge under a full moon sky
export const MOON_RIM_FAR_M = 150;    // rim is exactly 0 from here out; smoothstep fade from half of it
export const MOON_RIM_COL = Object.freeze([0.62, 0.78, 1.0]);

let enabled = true;
export function setMoonRimEnabled(on) { enabled = !!on; }
export function moonRimEnabled() { return enabled; }

const sstep = (a, b, x) => { const t = (x - a) / (b - a); return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };

/** Per-frame strength k (0..MOON_RIM_K) from the live look + the sun/moon light. Pure. */
export function moonRimK(sunI, moonOn, moonDirZ) {
  if (!enabled || !moonOn) return 0;
  const night = 1 - sstep(0.25, 0.8, sunI);       // same window as look.js floorEff: full at night, 0 by dusk
  const vis = sstep(0.02, 0.35, moonDirZ);        // moon elevation: fades in over the first ~20 deg above the horizon
  return MOON_RIM_K * night * vis;
}

/** Per-cell rim luminance. N, V (surface -> eye) and Ld (toward the moon) are unit vectors; dist = view depth (m). */
export function moonRimAmount(nx, ny, nz, vx, vy, vz, lx, ly, lz, dist, k, farM) {
  if (!(k > 0)) return 0;
  const ndl = nx * lx + ny * ly + nz * lz;
  if (ndl <= 0) return 0;
  let ndv = nx * vx + ny * vy + nz * vz; if (ndv < 0) ndv = 0;
  const f = 1 - ndv;
  return k * ndl * f * f * (1 - sstep(farM * 0.5, farM, dist));
}

/** WGSL twin (spliced into light.wgsl.js). u.rimA = (k, farM, 0, 0). */
export const MOON_RIM_WGSL = `
fn moonRimAmount(N: vec3f, V: vec3f, Ld: vec3f, dist: f32, k: f32, farM: f32) -> f32 {
  let ndl = dot(N, Ld);
  if (!(k > 0.0) || ndl <= 0.0) { return 0.0; }
  let f = 1.0 - max(dot(N, V), 0.0);
  let t = clamp((dist - farM * 0.5) / (farM * 0.5), 0.0, 1.0);
  return k * ndl * f * f * (1.0 - t * t * (3.0 - 2.0 * t));
}
const MOON_RIM_COL = vec3f(${MOON_RIM_COL.map((v) => v.toFixed(4)).join(', ')});
`;
