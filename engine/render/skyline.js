// MAP-06a (architecture.md 38.42, Skyline): the look's `haze.skyline` fog cap for FAR terrain texels. Pure, no imports,
// no allocation. Twin of the GLSL/WGSL terrain fog (MAP-06b). Only far texels change: below SKYLINE_FROM_T metres, or
// with no skyline block, the fog factor passes through bit-identical.
//   haze.skyline = { fogMax, fromZ, seaFogMax }: terrain fog f is capped at fogMax where world z > fromZ (peaks) and at
//   seaFogMax for sea-type texels at the sea level (the sea line), so both stay readable against the horizon haze.

/** Terrain type id of sea (overworld_far type table: 2 = water). */
export const SKYLINE_SEA_TYPE = 2;
/** Texels nearer than this (m) are never capped (near pixels unchanged; the uncapped fog is < 0.5 there anyway). */
export const SKYLINE_FROM_T = 300;
/** A sea texel counts as "at sea level" when its draw height is <= seaLevel + this (m). */
export const SKYLINE_SEA_EPS = 0.5;

/** Validates a raw `haze.skyline` block; returns an error string or ''. */
export function skylineError(s) {
  if (!s || typeof s !== 'object') return 'must be an object';
  if (!(s.fogMax > 0 && s.fogMax <= 1)) return `fogMax must be in (0, 1], got ${s.fogMax}`;
  if (!(s.seaFogMax > 0 && s.seaFogMax <= 1)) return `seaFogMax must be in (0, 1], got ${s.seaFogMax}`;
  if (!Number.isFinite(s.fromZ)) return `fromZ must be a finite number, got ${s.fromZ}`;
  return '';
}

/**
 * Terrain fog factor with the skyline cap.
 * @param {number} f uncapped fog factor 0..1
 * @param {number} t camera distance (m)
 * @param {number} type terrain type id
 * @param {number} z world height of the texel (m); NaN = unknown (no cap)
 * @param {{fogMax:number, fromZ:number, seaFogMax:number, seaLevel:number}|null} S resolved skyline (null = off)
 */
export function skylineFogF(f, t, type, z, S) {
  if (S === null || t < SKYLINE_FROM_T) return f;
  if (type === SKYLINE_SEA_TYPE) return z <= S.seaLevel + SKYLINE_SEA_EPS && f > S.seaFogMax ? S.seaFogMax : f;
  return z > S.fromZ && f > S.fogMax ? S.fogMax : f;
}

/**
 * MAP-06b: WGSL twin of `skylineFogF` (spliced into shade.wgsl.js TERRAIN_SHADE_WGSL). `S` = ShadeU.skyline:
 * x fogMax (0 = off, the JS `S === null`), y fromZ, z seaFogMax, w seaLevel. `z` = the texel's world height (GA.z of a
 * kind-7 cell = the interpolated surface z; the JS twin reads gbuf.z, the same value).
 */
export const SKYLINE_FOG_WGSL = `
fn skylineFogF(f: f32, t: f32, typeId: i32, z: f32, S: vec4f) -> f32 {
  if (S.x <= 0.0 || t < ${SKYLINE_FROM_T.toFixed(1)}) { return f; }
  if (typeId == ${SKYLINE_SEA_TYPE}) { return select(f, S.z, z <= S.w + ${SKYLINE_SEA_EPS.toFixed(1)} && f > S.z); }
  return select(f, S.x, z > S.y && f > S.x);
}
`;
