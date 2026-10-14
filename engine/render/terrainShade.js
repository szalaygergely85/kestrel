// US-016 (docs/architecture.md 14.4 item 5), renamed `shadeTerrain` by
// US-026a 23.4 (near-detail close band folded in) - the JS twin
// of the GLSL terrain shader (`glsl/terrain.frag.js`, included by
// `shade.frag.js`). Pure function - no allocation on the hot path (`out` is
// caller-owned, architecture.md 9). Inputs: t (camera distance, m), type id,
// b (lighting, ambientI + sunI*max(0,N.L)), u, v (world metres), timeSec.
//
// world-keyed hashing only (never screen-keyed, item 10 "do not" list) -
// `hashFastU`/`hashFast01` below are the bit-exact JS twin of
// `glsl/common.js`'s `HASH_FAST` (same avalanche constants), so a cell's
// colour/glyph pick never drifts between the two languages.

import { samplePowLUT } from './fastShade.js';
import { KIND_TERRAIN, KIND_GRASS } from './GBuffer.js';
import { packTerrainTextures } from './gpu/TerrainTextures.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { clampByte } from '../core/math.js';
import { sunFromWorld } from './lighting.js';
import { WET_DARK, wetGain } from './detailShade.js';
import { LEVEL_NONE, LEVEL_ANIM } from './temporalStable.js';
import { STEP } from '../core/loop.js';
import { skylineFogF } from './skyline.js';
import { resolveLook } from './look.js';
import { shadeLookCell, packLookTable, makeGroundLook, LOOK_TABLE_WORDS } from './groundLook.js'; // ENV-02b (38.63); circular with this file but only called at runtime

// US-026a (23.4): exported so terrainCaster.js's near-sampling dither uses
// the SAME avalanche mix (never a second, drifting copy) - the dither must
// be world-cell keyed, exactly like every other hash in this file.
export function hashFastU(x, y, s) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
/** hashFastU >>> 8 (24 bit, always a Smi: a non-inlined call returning the u32 itself would box it). hashFast01 = this * 2^-24. */
export function hashFast24(x, y, s) {
  return hashFastU(x, y, s) >>> 8;
}
export function hashFast01(x, y, s) {
  return (hashFastU(x, y, s) >>> 8) * (1 / 16777216);
}

// ME-06b background canopy face: rules from overworld_far.js nearLOD ('Surface
// vs face' 0.8x, 'Forest near LOD' trunk `|` 1 cell in 3). FOREST_FACE_NZ:
// forest grows only where slope <= 0.5 (N.z >= 0.894 on real ground); the
// canopy ramp (+10 m over one 8 m cell, normals from an 8 m central
// difference) measures N.z 0.67-0.9 (probe on overworld_far), so 0.9 splits
// them. GLSL literals come from these exports.
export const FOREST_FACE_NZ = 0.9;
// OB-104b (38.55): terrain faces steeper than 60 degrees (N.z < 0.5) shade as the recipe's `rock` type, texture laid along the wall + its height.
export const CLIFF_NZ = 0.5;
export const FOREST_FACE_K = 0.8;
export const FOREST_TRUNK_CHANCE = 1 / 3;
export const FOREST_TRUNK_SALT = 30;
export const FOREST_TRUNK_CODE = 124 - 32; // '|' as glyphIdx

function toByte(v255) {
  const c = v255 < 0 ? 0 : v255 > 255 ? 255 : v255;
  return Math.floor(c + 0.5);
}

/**
 * @param {Object} shading - `palette.shading` ({cutoff, fgMin, fgGamma, fgMaxGain, ...}).
 */
function gainOf(bc, shading) {
  const bcc = bc < 0 ? 0 : bc;
  // BUG-GPU-005: with `shading.gainLUT` (the MaterialTable's, see
  // `shadeTerrainCells`) use the same pow LUT the GPU shade pass samples.
  const p = shading.gainLUT ? samplePowLUT(shading.gainLUT, bcc > 1 ? 1 : bcc) : Math.pow(bcc > 1 ? 1 : bcc, shading.fgGamma);
  let gain = shading.fgMin + (1 - shading.fgMin) * p;
  if (bcc > 1) gain = Math.min(shading.fgMaxGain, gain + (bcc - 1) * 0.5);
  return gain;
}

// Returns a `glyphIdx` (ASCII code - 32, 0..94 - `CellBuffer.setCellRGB`'s
// convention), NOT a raw ASCII code - `TerrainTextures.js` packs codes the
// same way (`packGlyphCodes`), so this is a straight unpack, no `+32`.
function pickCodeFromPacked(x, count, idx) {
  const i = idx >= count ? count - 1 : idx;
  return (x >> (8 * i)) & 0xff;
}

/**
 * BUG-FP-002: per-cell look-hash size (m) for depth `t` and k = ground m per column per m of depth.
 * Power of two clamped 0.125..2; 8 m once past the handover's far edge (near band absent). GLSL twin: terrain.frag.js.
 * @param {number} t @param {number} k @param {number[]} [handover]
 */
// OB-073 (replaces the OB-054/067 hard 1 m / 4 m cells): patch colour = world-anchored SMOOTH value noise (bilinear, smoothstep
// weights, NOISE_CELLS octaves, power-of-two cells so u*inv is exact in f32 and f64), thresholded into the tier colours with a
// 0.25 m dither -> soft organic blobs, no square edges. Each octave fades out by the cell's ground footprint `fp` (mip-like band
// limit: full when cell >= 3 fp, gone at 1.5 fp), so far ground calms down instead of strobing; nothing keys on a distance-sized cell.
// Glyph: a calm per-point hash near the eye; each point switches ONCE (per-point threshold) to a glyph that follows the
// noise contours when its footprint outgrows the cell. WGSL twin: TERRAIN_SHADE_WGSL (same constants).
export const NOISE_CELLS = [8, 2, 0.5], NOISE_W = [0.2, 0.3, 0.5], NOISE_SALT = 40; // fine octave dominates near the feet (largest one-tier square ~1.5 m)
export const PATCH_K = 3.5, FP_DEFAULT_K = 0.01, FP_ANISO_T = 8, FP_ANISO_MAX = 4;
// FAR_GLYPH_CELL: background canopy face / trunk cell (>= bands.near only, unchanged from OB-067's calm cell).
export const FAR_GLYPH_CELL = 4.0; // OB-073 dead-code cleanup: GLYPH_CELL / PATCH_DITHER / GLINT_RATE / ctx.features removed (nothing read them)
// OB-081: ground footprint (m) where the far tier-colour blend starts / is full (hard tiers below FP0).
export const FAR_BLEND_FP0 = 2.0, FAR_BLEND_FP1 = 8.0; // OB-085: was 0.5 -> 2 m (~20-50 m): tier contours on rock slopes morphed while walking closer
/** OB-103: per-metre cell size k of a perspective view (groundFootprint hashCell = -k): 2 * tan(hfovX / 2) / cols. */
export function footprintK(tanHalfX, cols) { return 2 * tanHalfX / cols; }
/** OB-073: ground footprint (m) of one screen cell at depth t; hashCell as in shadeTerrain (<0 = -k, >0 = fixed ortho cell, 0 = default k). */
export function groundFootprint(t, hashCell) {
  if (hashCell > 0) return hashCell;
  const k = hashCell < 0 ? -hashCell : FP_DEFAULT_K;
  const a = t / FP_ANISO_T;
  return k * t * (a < 1 ? 1 : a > FP_ANISO_MAX ? FP_ANISO_MAX : a); // grazing view: depth footprint grows ~t^2 (capped anisotropy)
}
/** smoothstep weight of a lattice cell vs footprint: 1 when cell >= 3 fp, 0 when cell <= 1.5 fp. */
export function octaveFade(cell, fp) {
  let s = (cell / Math.max(fp, 1e-6) - 1.5) / 1.5;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return s * s * (3 - 2 * s);
}
/** bilinear value noise 0..1 at lattice coords (x, y), smoothstep weights, hashFast01 corners. */
export function valueNoise(x, y, salt) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hashFast01(ix, iy, salt), b = hashFast01(ix + 1, iy, salt), c = hashFast01(ix, iy + 1, salt), d = hashFast01(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** OB-073: band-limited patch field, roughly -2..2 (0 = calm/mid tier). fu, fv = f32-rounded world metres. */
// v8 = the unfaded 8 m octave (valueNoise at NOISE_CELLS[0]), computed once by the caller (also drives the far glyph).
/** MASK-c: patch tier offset -1..1 of a ground point (the `off` of shadeTerrain): q[0], q[1] = world metres, q[2] = ground footprint. Int result. */
// One fully inlined body (no helper takes or returns a double: those box a heap number per call in V8); twin of patchNoise + valueNoise.
export function groundTierOffset(q) { // q = Float64Array [u, v, fp]: an array, so no double crosses the call (alloc rule of carpetCells)
  const fu = Math.fround(q[0]), fv = Math.fround(q[1]), fp = q[2], fpc = fp > 1e-6 ? fp : 1e-6;
  let ws = 0, n = 0;
  for (let o = 0; o < 3; o++) {
    const cell = NOISE_CELLS[o];
    let sf = (cell / fpc - 1.5) / 1.5;
    sf = sf < 0 ? 0 : sf > 1 ? 1 : sf;
    const wgt = NOISE_W[o] * (sf * sf * (3 - 2 * sf));
    if (o > 0 && sf <= 0) continue;
    const x = fu * (1 / cell), y = fv * (1 / cell), salt = o === 0 ? NOISE_SALT : NOISE_SALT + o;
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hashFast24(ix, iy, salt) * (1 / 16777216), b = hashFast24(ix + 1, iy, salt) * (1 / 16777216), c = hashFast24(ix, iy + 1, salt) * (1 / 16777216), d = hashFast24(ix + 1, iy + 1, salt) * (1 / 16777216);
    n += wgt * ((a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1); ws += wgt;
  }
  const off = Math.floor(n / (ws > 0.55 ? ws : 0.55) * PATCH_K + 0.5);
  return off < -1 ? -1 : off > 1 ? 1 : off;
}
/**
 * MASK-c: calm ground colour of terrain type `type` at tier index `ti` (0..2 = 1 + tier offset), unlit, no fog, bytes 0..255 -> out[0..2].
 * Same TLOOK colour texel shadeTerrain picks on calm ground (hard tier, no far blend).
 */
export function groundAlbedo(type, ti, ctx, out) {
  const TL = ctx.tlook, o = type * ctx.tlookWidth * 4 + ti * 4;
  out[0] = TL[o] * 255; out[1] = TL[o + 1] * 255; out[2] = TL[o + 2] * 255;
  return out;
}
export function patchNoise(fu, fv, fp, v8) {
  const f0 = octaveFade(NOISE_CELLS[0], fp);
  let ws = NOISE_W[0] * f0, n = ws * (v8 * 2 - 1);
  for (let o = 1; o < 3; o++) {
    const c = NOISE_CELLS[o], f = octaveFade(c, fp);
    if (f <= 0) continue;
    const w = NOISE_W[o] * f;
    n += w * (valueNoise(fu * (1 / c), fv * (1 / c), NOISE_SALT + o) * 2 - 1); ws += w;
  }
  return n / (ws > 0.55 ? ws : 0.55);
}
export function perCellHashSize(t, k, handover) {
  if (handover && !(t < handover[1])) return 8;
  return Math.min(2, Math.max(0.125, Math.pow(2, Math.ceil(Math.log2(Math.max(t * k, 1e-6))))));
}

// ---- G2 + P3 (D-075 step 4): far grass tier on the terrain shade -------------------------------------------------------------
// Beyond the carpet radius the grass ground types get the carpet ramp's mid colour (soft, low contrast) and a calm glyph tier
// `, " '` picked by the band-limited patch noise (+ a slow travelling gust), so the carpet edge hands over to the horizon without a ring.
// Colour/glyph only, no depth. Cells with a non-zero weight carry stable level 254 (LEVEL_ANIM: the glyph can move with the gust).
// Data: farGrassFill(rec, cfg, typeNames, quality, windParams) -> rec.types (16 x [r, g, b, strength]) + on/startM/fadeM + wind phase.
// WGSL twin: shade.wgsl.js shadeTerrain (same constants; uniforms fgP / fgW / fgT). Off (rec.on = 0 / no rec) = bit-identical to before.
export const FG_MIX = 0.55, FG_GUST = 0.3, FG_FADE_MIN_M = 4, FG_FADE_K = 0.5, FG_SLOPE = 1.5, FG_MOD = 0.2;
export const FG_CODES = [12, 2, 7]; // ascii - 32 of `,` `"` `'`
export const FG_TYPES = 16;
export function makeFarGrass() { return { on: 0, under: 0, startM: 12, fadeM: 6, mix: FG_MIX, dirX: 1, dirY: 0, cyc: 0, invTravel: 0, types: new Float32Array(FG_TYPES * 4), _cfg: null, _names: null }; }
/** Fill (no alloc) the far-grass record of a carpet config. Per ground type the variant with the most `areas` wins (no areas = everywhere = wins); colour = ramp middle.
 *  quality = world.carpetQuality (on, radiusScale, farGrass !== false); windParams = world.wind.params or null (calm: no gust). */
export function farGrassFill(rec, cfg, typeNames, quality, windParams) {
  const vs = cfg ? cfg.variants || [] : [], T = rec.types;
  rec.on = cfg && quality && quality.on !== false && quality.farGrass !== false ? 1 : 0;
  const radius = (cfg && cfg.radiusM ? cfg.radiusM : 12) * (quality && quality.radiusScale ? quality.radiusScale : 1);
  // OB-121b: near underlay = min far-grass weight everywhere (also inside the close band); 0 = off = bit-identical. WGSL carries it as fgP.x = on * (1 + under).
  rec.under = cfg && cfg.underlay > 0 ? Math.min(1, cfg.underlay) : 0;
  rec.startM = radius; rec.fadeM = Math.max(FG_FADE_MIN_M, radius * FG_FADE_K);
  if (windParams) { rec.dirX = windParams.dirX; rec.dirY = windParams.dirY; rec.cyc = 1 / (STEP * windParams.P); rec.invTravel = windParams.travel > 0 ? 1 / windParams.travel : 0; }
  else { rec.dirX = 1; rec.dirY = 0; rec.cyc = 0; rec.invTravel = 0; }
  if (rec._cfg === cfg && rec._names === typeNames) return rec;
  rec._cfg = cfg; rec._names = typeNames; T.fill(0);
  if (!cfg || !typeNames) return rec;
  // G2: WGSL clamps the type index to FG_TYPES-1, JS would index past the table - fail loudly at load (runs once per cfg/names change)
  if (typeNames.length > FG_TYPES) throw new Error(`farGrassFill: ${typeNames.length} ground types > FG_TYPES (${FG_TYPES})`);
  for (let t = 0; t < typeNames.length && t < FG_TYPES; t++) {
    let best = -1, bestScore = -1;
    for (let k = 0; k < vs.length; k++) {
      if (vs[k].ground.indexOf(typeNames[t]) < 0) continue;
      const sc = vs[k].areas ? vs[k].areas.length : 1e9;
      if (sc >= bestScore) { best = k; bestScore = sc; }
    }
    if (best < 0) continue;
    const r = vs[best].ramp, n = r.length, x = 0.5 * (n - 1), i0 = Math.floor(x), i1 = i0 + 1 < n ? i0 + 1 : i0, f = x - i0;
    for (let c = 0; c < 3; c++) T[t * 4 + c] = r[i0][c] + (r[i1][c] - r[i0][c]) * f;
    T[t * 4 + 3] = 1;
  }
  return rec;
}

/**
 * @param {number} t - camera distance (m)
 * @param {number} type - terrain type id
 * @param {number} b - lighting (ambientI + sunI*N.L)
 * @param {number} u - world x (m)
 * @param {number} v - world y (m)
 * @param {number} timeSec
 * @param {{
 *   tlook: Float32Array, tlookWidth: number,          // TerrainTextures.js packTerrainTextures() output
 *   bands: {near:number, mid:number},                  // recipe.bands
 *   fog: {start:number, full:number, curve:number, nearRGB:number[], farRGB:number[]},
 *   shading: Object,                                   // palette.shading
 *   closeBand?: number,                                 // recipe.nearLOD.bands.close (23.4 near-detail); omitted = no close band
 *   hashCell?: number,                                  // <0 = per-cell mode, value = -k ground m per column per m depth; 0 = 2/8 m bands; >0 = fixed cell size (m)
 *   handover?: number[],                                // recipe.nearLOD.handover [h0, h1] - picks the 2 m vs 8 m hash cell
 * }} ctx
 * @param {{glyph:number, fg:Uint8Array|number[], bg:Uint8Array|number[]}} out - written in place (fg/bg length 3)
 */
// ENV-02b: lookLo / lookHi / lookW = the cell's look byte pair (ids 0..15, w = weight of hi 0..1); 0/0 or no ctx.groundLook = the old output, bit-exact.
export function shadeTerrain(t, type, b, u, v, timeSec, ctx, out, faceMode = 0, z = NaN, nx = 0, ny = 0, nz = 1, lookLo = 0, lookHi = 0, lookW = 0) {
  // OB-104b (38.55) cliff: steep cell (N.z < CLIFF_NZ) of a type without forest-face glyphs (TLOOK row 3 .w == 0) -> rock type,
  // biplanar (u, v) = (horizontal axis along the wall, z). Defaults nz = 1 / cliffType unset = off. WGSL twin: same 4 lines.
  const ct = ctx.cliffType;
  if (ct >= 0 && nz < CLIFF_NZ && !(ctx.tlook[type * ctx.tlookWidth * 4 + 3 * 4 + 3] > 0)) {
    type = ct;
    const wy = v; // world y
    v = z === z ? z : 0; // NaN z (old callers) -> 0
    u = (nx < 0 ? -nx : nx) > (ny < 0 ? -ny : ny) ? wy : u;
  }
  // 23.4 near-detail: inside the near-handover band the world-cell hash is
  // keyed at 2 m (matches the near band's own cell size), else at 8 m (the
  // far grid's cell size) - `nearLOD.rules` ("hash cell 2 m when t < h1,
  // else 8 m"). No `ctx.handover` (old callers/tests, far-only recipes) ->
  // unchanged 8 m behaviour.
  // BUG-RTS-001 (28.11a): a per-frame `ctx.hashCell` > 0 (pitched views) replaces the fixed cell.
  // BUG-FP-002: hashCell < 0 = per-cell mode, k = -hashCell (ground m per column per m of depth): each cell keys
  // its own power-of-two cell from its distance (0.125..2 m near, 8 m past the handover) - no 2 m blocks at the feet.
  // OB-073: no distance-sized cell any more (perCellHashSize stays exported for the old callers/tests only).
  // f32-robust: round u,v to f32 first (WGSL receives f32); every cell below is a power of two, so the lattice coords are exact in both twins.
  const fu = Math.fround(u), fv = Math.fround(v);
  // Alloc rule (arch 38.61): groundFootprint / valueNoise / patchNoise are inlined here (twins of the exported helpers, same arithmetic):
  // helpers that take or return a double box a heap number per call whenever V8 does not inline them.
  const hcl = ctx.hashCell || 0;
  let fp;
  if (hcl > 0) fp = hcl;
  else { const k = hcl < 0 ? -hcl : FP_DEFAULT_K, an = t / FP_ANISO_T; fp = k * t * (an < 1 ? 1 : an > FP_ANISO_MAX ? FP_ANISO_MAX : an); }
  const fpc = fp > 1e-6 ? fp : 1e-6; // octaveFade uses max(fp, 1e-6)
  let nWs = 0, nN = 0;
  // ENV-02b: a look cell replaces the 3-octave loop by the look tone (nP := 2 tone - 1); the look shade runs once, results in GLq
  const GL = ctx.groundLook, lookOn = GL ? (lookLo | lookHi) !== 0 : false, GLq = lookOn ? GL.q : null;
  if (lookOn) { GLq[0] = fu; GLq[1] = fv; GLq[2] = fp; GLq[3] = t; GLq[4] = timeSec; GLq[5] = lookW; shadeLookCell(GL, lookLo, lookHi, GLq); }
  for (let o = 0; o < 3; o++) {
    if (lookOn) break;
    const cell = NOISE_CELLS[o];
    let sf = (cell / fpc - 1.5) / 1.5;
    sf = sf < 0 ? 0 : sf > 1 ? 1 : sf;
    const fade = sf * sf * (3 - 2 * sf);
    if (o > 0 && fade <= 0) continue;
    const wgt = NOISE_W[o] * fade;
    const lx = fu * (1 / cell), ly = fv * (1 / cell), ix = Math.floor(lx), iy = Math.floor(ly), salt = o === 0 ? NOISE_SALT : NOISE_SALT + o;
    let wx = lx - ix, wy = ly - iy;
    wx = wx * wx * (3 - 2 * wx); wy = wy * wy * (3 - 2 * wy);
    const ca = hashFast24(ix, iy, salt) * (1 / 16777216), cb = hashFast24(ix + 1, iy, salt) * (1 / 16777216), cc2 = hashFast24(ix, iy + 1, salt) * (1 / 16777216), cd = hashFast24(ix + 1, iy + 1, salt) * (1 / 16777216);
    nN += wgt * ((ca + (cb - ca) * wx + (cc2 - ca) * wy + (ca - cb - cc2 + cd) * wx * wy) * 2 - 1); nWs += wgt;
  }
  const nP = lookOn ? 2 * GLq[6] - 1 : nN / (nWs > 0.55 ? nWs : 0.55);
  // OB-073 calm ground: colour tier only from the smooth noise (no per-cell dither dice); ONE glyph per type (no hash, no band/close/glint).
  let off = Math.floor(nP * PATCH_K + 0.5);
  off = off < -1 ? -1 : off > 1 ? 1 : off;

  // S8-B2-14b wetness (follow-up to S8-B2-14): `ctx.shading.wetness` 0..1
  // (absent = 0) darkens the lit term entering the tier/gain pick - same
  // WET_DARK constant detailShade.js uses (terrain has no emissive term to
  // keep separate, so the whole incoming `b` is the "lit term" here).
  const wet = ctx.shading.wetness || 0;
  let bWet = b * (1 - WET_DARK * wet);
  const flo = ctx.shading.floorLum; if (flo > 0 && bWet < flo) bWet = flo; // DN-02 night floor (WGSL twin: shadeTerrain)

  // 23.4 near-detail: close < ctx.closeBand wins over the near/mid/far tier
  // picked below (TLOOK texel 7, fixed) and gets a +-0.08 brightness jitter
  // (own hash salt 10, per-2 m-cell - "shading only, heightAt stays smooth").
  const close = ctx.closeBand != null && t < ctx.closeBand;
  // OB-054: jitter amplitude fades smoothstep to 0 over closeBand/2..closeBand (no brightness step at the band edge). WGSL twin: same expression.
  let bEff = bWet;
  if (close) {
    const q = Math.min(1, Math.max(0, (t - ctx.closeBand * 0.5) / (ctx.closeBand * 0.5)));
    bEff = bWet + nP * 0.05 * (1 - q * q * (3 - 2 * q)); // OB-073: smooth noise, not a per-cell dice
  }

  const tier = bEff < 0.45 ? 0 : bEff < 0.8 ? 1 : 2;
  let i = tier + off;
  if (i < 0) i = 0; else if (i > 2) i = 2;
  // OB-081: far ground blends the tier colours continuously (sub-cell normal changes no longer flip a whole colour step
  // near the horizon). farW 0 below FAR_BLEND_FP0 m footprint (hard tiers, bit-identical), 1 above FAR_BLEND_FP1.
  let sc = 0.5 + (bEff - 0.45) * (1 / 0.35) + off;
  sc = sc < 0 ? 0 : sc > 2 ? 2 : sc;
  let fw = (fp - FAR_BLEND_FP0) * (1 / (FAR_BLEND_FP1 - FAR_BLEND_FP0));
  fw = fw < 0 ? 0 : fw > 1 ? 1 : fw;
  fw = fw * fw * (3 - 2 * fw);
  const xf = i + (sc - i) * fw;
  const i0 = Math.floor(xf), i1 = i0 < 2 ? i0 + 1 : 2, fx = xf - i0;

  const TL = ctx.tlook, W = ctx.tlookWidth, base = type * W * 4;
  const colOff = base + i0 * 4, colOff1 = base + i1 * 4;
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  let fr = (TL[colOff] + (TL[colOff1] - TL[colOff]) * fx) * 255, fg = (TL[colOff + 1] + (TL[colOff1 + 1] - TL[colOff + 1]) * fx) * 255, fb = (TL[colOff + 2] + (TL[colOff1 + 2] - TL[colOff + 2]) * fx) * 255;
  // gainOf + wetGain inlined (alloc rule, see above); twins of the helpers.
  const SH = ctx.shading, bcc = bEff < 0 ? 0 : bEff, bc1 = bcc > 1 ? 1 : bcc;
  const gp = SH.gainLUT ? SH.gainLUT[(bc1 * (SH.gainLUT.length - 1) + 0.5) | 0] : Math.pow(bc1, SH.fgGamma);
  let gain = SH.fgMin + (1 - SH.fgMin) * gp;
  if (bcc > 1) gain = Math.min(SH.fgMaxGain, gain + (bcc - 1) * 0.5);
  if (wet > 0) gain = wetGain(gain, bEff, wet, SH.fgMaxGain); // wet ground only: a rare path
  fr *= gain; fg *= gain; fb *= gain;
  let br = fr * 0.3, bg = fg * 0.3, bb = fb * 0.3;

  // OB-073: the calm glyph = middle entry of the NEAR glyph set (TLOOK texel 4), same at every distance/time/point.
  const gOff = base + 4 * 4;
  const packedX = TL[gOff], packedCount = TL[gOff + 1];
  const pcn = packedCount | 0; let pci = pcn >> 1; if (pci >= pcn) pci = pcn - 1; // pickCodeFromPacked inlined: its double arg would box per call
  let code = (packedX >> (8 * pci)) & 0xff;
  if (lookOn) { // ENV-02b: look colours / glyph x the same lighting gain (wet, floorLum, fog unchanged); bg = bg ramp x gain (not fg * 0.3)
    fr = GLq[7] * 255 * gain; fg = GLq[8] * 255 * gain; fb = GLq[9] * 255 * gain;
    br = GLq[10] * 255 * gain; bg = GLq[11] * 255 * gain; bb = GLq[12] * 255 * gain;
    code = GLq[13] | 0;
  }
  // G2 + P3: far grass tier (WGSL twin: shadeTerrain, same lines). fgw = weight 0..1, > 0 = stable level 254.
  let fgw = 0, fgAnim = false;
  const FGR = ctx.farGrass;
  if (FGR !== undefined && FGR.on !== 0 && (!close || FGR.under > 0)) {
    const st = FGR.types[type * 4 + 3];
    if (st > 0) {
      let w = (t - FGR.startM) / FGR.fadeM; w = w < 0 ? 0 : w > 1 ? 1 : w;
      w = w * w * (3 - 2 * w);
      // OB-121b: max(under, ramp); OB-154: where the underlay wins the cell is STATIC (no gust phase, no time), animated only by the ramp weight
      const stat = FGR.under > w; fgw = (stat ? FGR.under : w) * st;
      if (fgw > 0) {
        let tri = 0.5;
        if (!stat) {
          let ph = (timeSec - (fu * FGR.dirX + fv * FGR.dirY) * FGR.invTravel) * FGR.cyc; ph -= Math.floor(ph);
          tri = 1 - Math.abs(2 * ph - 1); tri = tri * tri * (3 - 2 * tri);
        }
        fgAnim = !stat;
        let sg = nP * FG_SLOPE + (tri - 0.5) * FG_GUST; sg = sg < -1 ? -1 : sg > 1 ? 1 : sg;
        if (fgw > 0.5 - 0.4 * sg) code = lookOn ? GLq[18 + (sg < -0.33 ? 0 : sg > 0.33 ? 2 : 1)] | 0 : FG_CODES[sg < -0.33 ? 0 : sg > 0.33 ? 2 : 1];
        const km = fgw * FGR.mix * (1 + FG_MOD * sg), o4 = type * 4;
        if (lookOn) { // tint target = the look's ramp(0.6); the bg keeps the look bg ramp
          fr += (GLq[15] * 255 * gain - fr) * km; fg += (GLq[16] * 255 * gain - fg) * km; fb += (GLq[17] * 255 * gain - fb) * km;
        } else {
          fr += (FGR.types[o4] * gain - fr) * km; fg += (FGR.types[o4 + 1] * gain - fg) * km; fb += (FGR.types[o4 + 2] * gain - fb) * km;
          br = fr * 0.3; bg = fg * 0.3; bb = fb * 0.3;
        }
      }
    }
  }

  // ME-06b: background canopy FACE look (overworld_far nearLOD 'Surface vs
  // face' + 'Forest near LOD'): only for a type whose TLOOK row carries face
  // glyphs (forest), never in the close band. faceMode 1 = face row, 2 = the
  // foot row (lowest face row of the run, `forestFaceMode`): trunk `|` in
  // woodDark for 1 cell in 3, else dark foliage; above the foot the face
  // glyphs; all at 0.8x brightness.
  const faceCount = TL[base + 3 * 4 + 3];
  if (faceMode !== 0 && faceCount > 0 && !close && t >= ctx.bands.near) {
    const faceX = TL[base + 3 * 4 + 2];
    const fx4 = Math.floor(fu / FAR_GLYPH_CELL), fy4 = Math.floor(fv / FAR_GLYPH_CELL);
    // OB-081: once a screen cell covers half a 4 m face cell the hash would re-roll every frame -> fixed face glyph, no trunks
    const hc = ctx.hashCell || 0, fpH = hc > 0 ? hc : (hc < 0 ? -hc : FP_DEFAULT_K) * t; // faces stand upright: cell WIDTH, no depth stretch
    const calm = fpH > FAR_GLYPH_CELL * 0.5;
    const trunk = !calm && faceMode === 2 && hashFast01(fx4, fy4, FOREST_TRUNK_SALT) < FOREST_TRUNK_CHANCE;
    code = trunk ? FOREST_TRUNK_CODE : pickCodeFromPacked(faceX, faceCount, faceMode === 2 ? faceCount - 1 : calm ? faceCount >> 1 : Math.floor(hashFast01(fx4, fy4, 7) * faceCount));
    if (trunk) {
      const tOff = base + 16 * 4;
      fr = TL[tOff] * 255 * gain; fg = TL[tOff + 1] * 255 * gain; fb = TL[tOff + 2] * 255 * gain;
    }
    const dOff = base; // forestDark bg (TLOOK texel 0), gained
    br = TL[dOff] * 255 * gain * 0.3; bg = TL[dOff + 1] * 255 * gain * 0.3; bb = TL[dOff + 2] * 255 * gain * 0.3;
    fr *= FOREST_FACE_K; fg *= FOREST_FACE_K; fb *= FOREST_FACE_K;
    br *= FOREST_FACE_K; bg *= FOREST_FACE_K; bb *= FOREST_FACE_K;
  }

  // Fog (item 5 + overworld_far.js "fog" section): 50 -> 1500 m, curve 0.7.
  const F = ctx.fog;
  // MAP-06a (38.42 Skyline): optional far-texel fog cap (`ctx.skyline` from the look's haze.skyline, `z` = texel height); absent = unchanged.
  let f = (t - F.start) / (F.full - F.start); // = terrainFogF, inlined
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  f = Math.pow(f, F.curve || 1);
  if (ctx.skyline) f = skylineFogF(f, t, type, z, ctx.skyline);
  const fcr = F.nearRGB[0] + (F.farRGB[0] - F.nearRGB[0]) * f;
  const fcg = F.nearRGB[1] + (F.farRGB[1] - F.nearRGB[1]) * f;
  const fcb = F.nearRGB[2] + (F.farRGB[2] - F.nearRGB[2]) * f;
  fr += (fcr - fr) * f; fg += (fcg - fg) * f; fb += (fcb - fb) * f;
  const fBg = Math.min(1, 1.1 * f);
  br += (fcr - br) * fBg; bg += (fcg - bg) * fBg; bb += (fcb - bb) * fBg;
  if (f > 0.85) code = 0; // space (glyphIdx 0)

  out.glyph = code;
  // 38.25 amendment C.1: stable-pass level byte of a terrain cell (twin of shade.wgsl's terrain splice): 254 = the shimmer branch (glyph can change next tick), else 255
  out.level = fgAnim || (lookOn && GLq[14] > 0) ? LEVEL_ANIM : LEVEL_NONE; // OB-073: no glint branch; G2: far-grass cells animate (gust)
  // toByte inlined (a non-inlined call returning a double boxes it); same clamp + round
  const ofg = out.fg, obg = out.bg;
  ofg[0] = Math.floor((fr < 0 ? 0 : fr > 255 ? 255 : fr) + 0.5); ofg[1] = Math.floor((fg < 0 ? 0 : fg > 255 ? 255 : fg) + 0.5); ofg[2] = Math.floor((fb < 0 ? 0 : fb > 255 ? 255 : fb) + 0.5);
  obg[0] = Math.floor((br < 0 ? 0 : br > 255 ? 255 : br) + 0.5); obg[1] = Math.floor((bg < 0 ? 0 : bg > 255 ? 255 : bg) + 0.5); obg[2] = Math.floor((bb < 0 ? 0 : bb > 255 ? 255 : bb) + 0.5);
  return out;
}


// ---- OB-073 D2c (38.52 item 7): kind-10 grass carpet shade branch -----------------------------------------
export const GRASS_AO_LO = 0.55;      // ambient AO = mix(0.55, 1, h01): dark blade base
export const GRASS_TIP_H = 0.75, GRASS_BASE_H = 0.2, GRASS_LEAN_G = 0.35;
const GRASS_GLYPHS = [',', '|', "'", '\\', '/']; // base, mid, tip, leanL, leanR: v < 0 = tip leans screen-left = a backslash stroke (arch review 2026-10-12c)
// MASK-c: packed per-blade word (gbuf.grassX / GA.w): tint byte | back-light byte << 8 | ground type << 16 | (tier offset + 1) << 24 | GRASS_GX_HAS.
export const GRASS_TINT_AMP = 0.08;     // ramp position shift = (tintByte / 255 * 2 - 1) * AMP
export const GRASS_GX_HAS = 67108864;   // 1 << 26: the cell below was terrain, the type + tier offset are valid (else no ground blend)
export const GRASS_GROUND_TINT = 0.6;   // default variant groundTint: blade colour = ground at the root, full ramp colour from h01 >= groundTint
export const GRASS_BACKLIGHT_K = 0.3;   // back-light warm boost cap (x bl x h01^2 x min(sunI, 1))
export const GRASS_LEVELS = 15.999;   // stable level byte of a kind-10 cell = floor(ramp position x * 15.999) = 0..15 (same in the grass shade WGSL)
export const GRASS_ROWS = 5;          // vec4 rows per variant in the GPU table: ramp k=0..3 (rgb; row0.w = n, row1..3.w = base/mid/tip glyph code), row 4 = (leanL, leanR, groundTint)
/** Pack a grassTableFor() table into the GPU uniform layout (16 variants x GRASS_ROWS vec4) into `out` (Float32Array(80*4)); no alloc. */
export function packGrassTable(tab, out) {
  out.fill(0);
  const nv = Math.min(15, tab.n.length - 1);
  for (let id = 1; id <= nv; id++) {
    const o = id * GRASS_ROWS * 4, n = tab.n[id];
    for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) out[o + k * 4 + c] = tab.ramp[id * 12 + Math.min(k, n - 1) * 3 + c];
    out[o + 3] = n; out[o + 7] = tab.glyph[id * 5]; out[o + 11] = tab.glyph[id * 5 + 1]; out[o + 15] = tab.glyph[id * 5 + 2];
    out[o + 16] = tab.glyph[id * 5 + 3]; out[o + 17] = tab.glyph[id * 5 + 4]; out[o + 18] = tab.gtint[id];
  }
  return out;
}
const _grassTabs = new WeakMap();
const _gnd = new Float64Array(3);
/**
 * Per-variant shade table of a carpet config (built once per cfg, then cached): ramp = RGB bytes (0..255) base -> tip,
 * glyph indices (ASCII - 32) base/mid/tip/leanL/leanR. Variant ids are 1-based (index 0 unused).
 * @param {{variants:Array}} cfg  variants[].ramp must already be RGB triplets (the game resolves palette keys)
 */
export function grassTableFor(cfg) {
  let tab = _grassTabs.get(cfg);
  if (tab) return tab;
  const vs = cfg.variants || [];
  const n = vs.length + 1;
  tab = { n: new Uint8Array(n), ramp: new Float64Array(n * 12), glyph: new Uint8Array(n * 5), gtint: new Float64Array(n).fill(GRASS_GROUND_TINT) };
  for (let id = 1; id < n; id++) {
    const v = vs[id - 1], r = v.ramp;
    if (!r || r.length < 2 || r.length > 4 || !Array.isArray(r[0])) throw new Error(`carpet.variants[${id - 1}].ramp: 2..4 RGB triplets expected`);
    tab.n[id] = r.length;
    tab.gtint[id] = v.groundTint == null ? GRASS_GROUND_TINT : v.groundTint;
    for (let k = 0; k < r.length; k++) for (let c = 0; c < 3; c++) tab.ramp[id * 12 + k * 3 + c] = r[k][c];
    const g = v.glyphs || {}, names = ['base', 'mid', 'tip', 'leanL', 'leanR'];
    for (let k = 0; k < 5; k++) tab.glyph[id * 5 + k] = (g[names[k]] || GRASS_GLYPHS[k]).charCodeAt(0) - 32;
  }
  _grassTabs.set(cfg, tab);
  return tab;
}

/**
 * Shade one grass blade cell. `b` = the lit term already holding the AO-scaled ambient + sun (shadeTerrainCells).
 * Colour = ramp(h01 + tint) * terrain gain, terrain fog; glyph by h01 / lean (leanL/leanR win when |lean| > 0.35).
 * Writes `out` (glyph idx, fg, bg, level) like shadeTerrain.
 */
// ENV-02b: lookLo / lookHi / lookW + wu / wv (world m of the blade root) route the root colour through the ground look function (needs ctx.groundLook).
// Bit budget note: the packed gx word has only bits 27..31 (+ the 2 tier bits, unused for look cells) free = 7 bits, fewer than lo + hi + w need: ASK ARCHITECT for the GPU packing (ENV-02d).
export function shadeGrass(t, variant, h01, lean, tint, b, tab, ctx, out, gx = 0, sunI = 0, lookLo = 0, lookHi = 0, lookW = 0, wu = 0, wv = 0) {
  const wet = ctx.shading.wetness || 0;
  let bE = b * (1 - WET_DARK * wet);
  const flo = ctx.shading.floorLum; if (flo > 0 && bE < flo) bE = flo;
  let gain = gainOf(bE, ctx.shading);
  gain = wetGain(gain, bE, wet, ctx.shading.fgMaxGain);
  let x = h01 + tint; x = x < 0 ? 0 : x > 1 ? 1 : x;
  const n = tab.n[variant], xf = x * (n - 1);
  let i0 = Math.floor(xf); if (i0 > n - 2) i0 = n - 2;
  const fx = xf - i0, o0 = variant * 12 + i0 * 3, o1 = o0 + 3, R = tab.ramp;
  let cr = R[o0] + (R[o1] - R[o0]) * fx, cg = R[o0 + 1] + (R[o1 + 1] - R[o0 + 1]) * fx, cb = R[o0 + 2] + (R[o1 + 2] - R[o0 + 2]) * fx;
  // MASK-c: base = the calm ground under the root (groundAlbedo), tip = the variant ramp; w = h01 / groundTint (twin: shade.wgsl.js shadeGrass)
  if ((gx & GRASS_GX_HAS) !== 0) {
    const GL = ctx.groundLook;
    if (GL && (lookLo | lookHi) !== 0) {
      const hcl = ctx.hashCell || 0, gk = hcl < 0 ? -hcl : FP_DEFAULT_K, ga = t / FP_ANISO_T, GLq = GL.q;
      GLq[0] = Math.fround(wu); GLq[1] = Math.fround(wv); GLq[2] = hcl > 0 ? hcl : gk * t * (ga < 1 ? 1 : ga > FP_ANISO_MAX ? FP_ANISO_MAX : ga); GLq[3] = t; GLq[4] = 0; GLq[5] = lookW;
      shadeLookCell(GL, lookLo, lookHi, GLq);
      _gnd[0] = GLq[7] * 255; _gnd[1] = GLq[8] * 255; _gnd[2] = GLq[9] * 255;
    } else groundAlbedo((gx >>> 16) & 255, ((gx >>> 24) & 3), ctx, _gnd);
    let w = h01 / tab.gtint[variant]; w = w < 0 ? 0 : w > 1 ? 1 : w;
    cr = _gnd[0] + (cr - _gnd[0]) * w; cg = _gnd[1] + (cg - _gnd[1]) * w; cb = _gnd[2] + (cb - _gnd[2]) * w;
  }
  let fr = cr * gain, fg = cg * gain, fb = cb * gain;
  // MASK-c back-light: sun behind the blade (bl = dot(view, sun) byte) warm-brightens the upper part, capped
  const bl = ((gx >>> 8) & 255) * (1 / 255);
  if (bl > 0) {
    const gl = GRASS_BACKLIGHT_K * bl * h01 * h01 * (sunI < 1 ? sunI : 1);
    fr *= 1 + gl; fg *= 1 + gl * 0.75; fb *= 1 + gl * 0.25;
  }
  let br = fr * 0.3, bg = fg * 0.3, bb = fb * 0.3;
  const gb = variant * 5;
  let code = h01 > GRASS_TIP_H ? tab.glyph[gb + 2] : h01 < GRASS_BASE_H ? tab.glyph[gb] : tab.glyph[gb + 1];
  if (lean < -GRASS_LEAN_G) code = tab.glyph[gb + 3]; else if (lean > GRASS_LEAN_G) code = tab.glyph[gb + 4];
  const F = ctx.fog, f = terrainFogF(t, F);
  const fcr = F.nearRGB[0] + (F.farRGB[0] - F.nearRGB[0]) * f, fcg = F.nearRGB[1] + (F.farRGB[1] - F.nearRGB[1]) * f, fcb = F.nearRGB[2] + (F.farRGB[2] - F.nearRGB[2]) * f;
  fr += (fcr - fr) * f; fg += (fcg - fg) * f; fb += (fcb - fb) * f;
  const fBg = Math.min(1, 1.1 * f);
  br += (fcr - br) * fBg; bg += (fcg - bg) * fBg; bb += (fcb - bb) * fBg;
  if (f > 0.85) code = 0;
  out.glyph = code; out.level = Math.floor(x * GRASS_LEVELS); // D2e: stable level = ramp position bucket
  out.fg[0] = toByte(fr); out.fg[1] = toByte(fg); out.fg[2] = toByte(fb);
  out.bg[0] = toByte(br); out.bg[1] = toByte(bg); out.bg[2] = toByte(bb);
  return out;
}

/**
 * Terrain fog factor for distance `t` (50 -> 1500 m, curve 0.7). Shared by
 * `shadeTerrain` and `shadeTerrainCells` (which stores it in `gbuf.fogF` so
 * the edge pass gates terrain cells on the TERRAIN fog, not a stale value;
 * GLSL twin: `terrainFogF` in glsl/edge.frag.js - BUG-GPU-005).
 */
export function terrainFogF(t, F) {
  let f = (t - F.start) / (F.full - F.start);
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  return Math.pow(f, F.curve || 1);
}

function packFeatureCode(str, idx) {
  const i = idx >= str.length ? str.length - 1 : idx;
  return str.charCodeAt(i) - 32;
}

/**
 * `recipe.nearLOD.features` (design shape, `{id, on, bands, chance, glyphs,
 * colors}`) -> the flat `{typeId, chance, code0, code1, fg}` list
 * `shadeTerrain`'s close band reads (23.4). Only features whose `bands`
 * includes `'close'` are kept - `nearWater`/`nearBank` proximity gating is
 * out of scope for this pass (2 of 5 features per 23.8 PO routing note).
 * Returns `null` when the recipe has no `nearLOD.features` (old/far-only
 * recipes - `shadeTerrain`'s `close` branch is then simply never reached
 * since `closeBand` is also omitted).
 *
 * US-026a S5: exported so `TerrainTextures.js`'s `packTerrainTextures` packs
 * the SAME flat list (same order, so a feature's index here is the same
 * `fi` the GLSL hash salt `20 + fi` uses - never a second, drifting copy).
 */
export function buildFeatures(recipe, palette) {
  const nearLOD = recipe.nearLOD;
  if (!nearLOD || !nearLOD.features || !recipe.terrain) return null;
  const list = [];
  for (const f of nearLOD.features) {
    if (!f.bands || f.bands.indexOf('close') < 0) continue;
    const typeDef = recipe.terrain[f.on];
    if (!typeDef) continue;
    const colorKey = f.colors && f.colors[0];
    const rgb = colorKey && palette.rgb ? palette.rgb[colorKey] : null;
    if (!rgb) continue;
    list.push({
      typeId: typeDef.id, chance: f.chance || 0,
      code0: packFeatureCode(f.glyphs || ' ', 0), code1: packFeatureCode(f.glyphs || ' ', 1),
      fg: [rgb[0], rgb[1], rgb[2]],
    });
  }
  return list.length ? list : null;
}

/** Convenience: builds the `ctx.fog`/`ctx.bands` shape from a loaded recipe + palette (shared by the JS oracle and TerrainTextures consumers). */
export function makeTerrainShadeCtx(recipe, tlookPacked, palette) {
  const fogRec = palette.fog.far;
  const nearLOD = recipe.nearLOD;
  return {
    tlook: tlookPacked.tlook, tlookWidth: tlookPacked.tlookWidth,
    bands: recipe.bands,
    fog: {
      start: fogRec.start, full: fogRec.full, curve: fogRec.curve,
      nearRGB: palette.rgb[fogRec.color], farRGB: palette.rgb[fogRec.colorFar],
    },
    shading: palette.shading,
    // 23.4 near-detail (omitted -> `shadeTerrain`'s close/jitter/feature
    // branches never engage, identical to pre-US-026a behaviour): the close
    // band threshold and the near-handover band (also the 2 m/8 m hash-cell
    // switch), both from `recipe.nearLOD` - never literal in engine code.
    closeBand: nearLOD && nearLOD.bands ? nearLOD.bands.close : undefined,
    handover: nearLOD && nearLOD.handover ? nearLOD.handover : undefined,
    cliffType: recipe.terrain && recipe.terrain.rock ? recipe.terrain.rock.id : -1, // OB-104b: -1 = cliff look off
  };
}

// ME-19b: deferred terrain-cell shading moved without changing expression order.
const shadeOut = { glyph: 32, level: 255, fg: new Uint8Array(3), bg: new Uint8Array(3) };
const shadeNrm = new Float64Array(3);
const _terrainAoAliasCache = new WeakMap();
function terrainAoAlias(gbuf) {
  let alias = _terrainAoAliasCache.get(gbuf);
  if (!alias || alias.buffer !== gbuf.aoD.buffer) {
    alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
    _terrainAoAliasCache.set(gbuf, alias);
  }
  return alias;
}

const faceNrm = new Float32Array(3);
/**
 * ME-06b: 0 = normal surface look, 1 = background canopy FACE cell, 2 = the
 * foot (lowest face row of the run: the cell below is not a face cell, or
 * off-grid). Face cell = kind-7 cell of a type whose TLOOK row has face
 * glyphs (forest) with a steep normal (N.z < FOREST_FACE_NZ). GLSL twin: the
 * `forestFaceMode` helper in shade.frag.js. Zero allocation.
 */
export function forestFaceMode(gbuf, alias, ctx, i, t) {
  const type = gbuf.mat[i];
  const TL = ctx.tlook, base = type * ctx.tlookWidth * 4;
  if (!(TL[base + 3 * 4 + 3] > 0) || t < ctx.bands.near) return 0;
  unpackNormalOct(alias[i], faceNrm);
  if (!(faceNrm[2] < FOREST_FACE_NZ)) return 0;
  const j = i + gbuf.cols;
  if (j >= gbuf.cols * gbuf.rows || gbuf.kind[j] !== KIND_TERRAIN || gbuf.mat[j] !== type) return 2;
  unpackNormalOct(alias[j], faceNrm);
  return faceNrm[2] < FOREST_FACE_NZ ? 1 : 2;
}

/**
 * MAP-06a: the look's `haze.skyline` + the recipe's `geo.seaLevel`, cached per (look record, terrain). null = off (no block, no sea level).
 * The edge-pass gate `gbuf.fogF` stays the UNCAPPED terrain fog (far pixels only; edges there are fog-suppressed as before).
 * MAP-06b: exported so the WebGPU shade pass (passShade.js) writes the SAME record into ShadeU.skyline.
 * @returns {{fogMax:number, fromZ:number, seaFogMax:number, seaLevel:number}|null}
 */
export function skylineFor(terrain, palette) {
  const geo = terrain.recipe && terrain.recipe.geo;
  if (!geo || !Number.isFinite(geo.seaLevel)) return null; // checked first: worlds without a sea never touch the look
  const lk = resolveLook(palette), sk = lk && lk.haze ? lk.haze.skyline : null;
  if (!sk) return null;
  const c = terrain._skylineCache;
  if (c && c.src === sk && c.seaLevel === geo.seaLevel) return c.S;
  const S = { fogMax: sk.fogMax, fromZ: sk.fromZ, seaFogMax: sk.seaFogMax, seaLevel: geo.seaLevel };
  terrain._skylineCache = { src: sk, seaLevel: geo.seaLevel, S };
  return S;
}

/** Lazily (re)builds and caches `terrain`'s shading context, keyed by `farVersion`. */
function terrainShadingFor(matTable, ctx) {
  if (!ctx._paletteShading) ctx._paletteShading = ctx.shading;
  const ms = matTable && matTable.shading;
  if (!ms || !matTable.gainLUT) return ctx._paletteShading;
  if (!ctx._mtShading || ctx._mtShadingSrc !== matTable) {
    ctx._mtShading = { fgMin: ms.fgMin, fgMaxGain: ms.fgMaxGain, fgGamma: ctx._paletteShading.fgGamma, gainLUT: matTable.gainLUT, wetness: ms.wetness, floorLum: ms.floorLum };
    ctx._mtShadingSrc = matTable;
  } else {
    // S8-B2-14b: wetness is a per-frame value (rain), same `table.shading.wetness`
    // slot detailShade.js reads every frame - refresh it even when the cached
    // object (built once per MaterialTable instance) is reused.
    ctx._mtShading.wetness = ms.wetness;
    ctx._mtShading.floorLum = ms.floorLum; // DN-02
  }
  return ctx._mtShading;
}

function ensureShadeCtx(terrain, palette) {
  if (terrain._shadeCtx && terrain._shadeCtxVersion === terrain.farVersion) return terrain._shadeCtx;
  const packed = packTerrainTextures(terrain, palette);
  terrain._shadeCtx = makeTerrainShadeCtx(terrain.recipe, packed, palette);
  terrain._shadeCtxVersion = terrain.farVersion;
  return terrain._shadeCtx;
}

/**
 * Shades every `KIND_TERRAIN` cell `castTerrain` wrote this frame - a
 * separate pass from `shadeSurfaces` (`detailShade.js`) because terrain
 * looks up colour/glyph through `TLOOK` (recipe-driven), never through a
 * `MaterialTable`. Call right after `shadeSurfaces`, before `edgePass` (same
 * ordering requirement: the edge pass reads the just-shaded `rt.cells`).
 * No-op when the world has no terrain or nothing was cast this frame.
 * US-026a 23.4 "Lighting"/"Shade pass" rework: `N` is now decoded from the
 * packed normal `castTerrain` wrote (`aoD`, via `FACE_PACKED`) instead of
 * being re-derived by a central difference here - exact for a near hit (the
 * old code always used the c=8 far difference, even inside the near band).
 * `b = ambientI + sunI*max(0,N.sunDir)` stays analytic/shadow-free (D-007:
 * no terrain shadow rays), now also scaled by the per-cell cloud factor `cF`
 * (S8-B2-12b, 38.13: `light.cloudQ[i]`, 1 at strength 0 - bit-identical);
 * `Lc` is `fb.light`'s already-computed per-cell
 * point-light contribution (`lightSurfaces` runs before this in
 * `compositor.js` and now skips the sun term for kind 7 - lighting.js -
 * so `Lc` never double-counts the sun `b` already adds). `bT = b +
 * max(Lc.r,Lc.g,Lc.b)` picks the tier/gain; the lamp then tints `fg`
 * directly (`+= Lc*0.5`, clamped) - a lit patch of grass reads warmer, not
 * just brighter.
 * @param {{rt, gbuf, palette, light}} fb
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {import('../world/World.js').World} world
 * @param {number} [timeSec]
 * @param {number} [hashCell] BUG-RTS-001: pitched-view hash cell (m), 0 = off
 */
// ENV-02d: look bytes of the texel the type comes from (twin of the raster's terrainLookAt: near band when inside, else far grid, else 0).
// Results in module scratch (no object / array per cell); w is the GPU's f32(w8) * f32(1/255).
let lkLo = 0, lkHi = 0, lkW = 0;
const F32_1_255 = Math.fround(1 / 255);
function lookAtXY(terrain, x, y) {
  lkLo = 0; lkHi = 0; lkW = 0;
  let L = null, k = 0;
  const g = terrain.nearReady ? terrain.near : null;
  if (g && g.look) {
    const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
    if (i >= 0 && j >= 0 && i < g.w && j < g.h) { L = g.look; k = (i + j * g.w) * 2; }
  }
  if (!L) {
    L = terrain.farLook; if (!L) return;
    const i = Math.floor((x - terrain.mapX0) / terrain.mapCell), j = Math.floor((y - terrain.mapY0) / terrain.mapCell);
    if (i < 0 || j < 0 || i >= terrain.mapW || j >= terrain.mapH) return;
    k = (j * terrain.mapW + i) * 2;
  }
  const bt = L[k]; lkLo = bt & 15; lkHi = bt >> 4; lkW = Math.fround(L[k + 1] * F32_1_255);
}
// ctx.groundLook for a world with `terrain.groundLook`: packed table cached per cfg object; wind01 as the GPU host (world.wind.params.amp clamped 0..1).
function ensureGroundLookCtx(ctx, terrain, world) {
  const cfg = terrain.groundLook ? terrain.groundLook.cfg : null;
  if (!cfg) { ctx.groundLook = null; ctx._glCfg = null; return null; }
  if (ctx._glCfg !== cfg) { ctx.groundLook = makeGroundLook(packLookTable(cfg, new Float32Array(LOOK_TABLE_WORDS))); ctx._glCfg = cfg; }
  const wp = world && world.wind && world.wind.params;
  ctx.groundLook.wind01 = wp && wp.amp > 0 ? (wp.amp < 1 ? wp.amp : 1) : 0;
  return ctx.groundLook;
}

export function shadeTerrainCells(fb, terrain, world, timeSec = 0, hashCell = 0) {
  if (!terrain || !terrain.farReady || !fb.gbuf) return;
  const gbuf = fb.gbuf, palette = fb.palette;
  const ctx = ensureShadeCtx(terrain, palette);
  const GLK = ensureGroundLookCtx(ctx, terrain, world); // ENV-02d: null (groundLook off) = the old path, bit-exact
  ctx.hashCell = hashCell; // BUG-RTS-001 (28.11a): per-frame, 0 = fixed 2/8 m cell
  // BUG-GPU-005: the GPU terrain branch takes fgMin/fgMaxGain + the gain LUT
  // from `MaterialTable.shading` (design/detail-pass.js); match it whenever a
  // v2 MaterialTable is bound, else keep `palette.shading` + Math.pow.
  ctx.shading = terrainShadingFor(fb.matTable, ctx);
  ctx.skyline = skylineFor(terrain, palette);
  const sun = sunFromWorld(world, palette);
  const cells = fb.rt.cells || fb.rt;
  const n = gbuf.cols * gbuf.rows;
  const light = fb.light;
  const sunMapOn = !!(light && !light.uniform && light.sunMapOn);
  const alias = terrainAoAlias(gbuf);
  const grassTab = world && world.carpet && world.carpet.cfg ? grassTableFor(world.carpet.cfg) : null;
  if (grassTab !== null && terrain.typeNames) { // G2 + P3: far grass record (ctx-owned, filled in place)
    if (!ctx.farGrass) ctx.farGrass = makeFarGrass();
    farGrassFill(ctx.farGrass, world.carpet.cfg, terrain.typeNames, world.carpetQuality, world.wind && world.wind.params ? world.wind.params : null);
  } else if (ctx.farGrass) ctx.farGrass.on = 0;
  for (let i = 0; i < n; i++) {
    const kd = gbuf.kind[i];
    if (kd !== KIND_TERRAIN && !(kd === KIND_GRASS && grassTab !== null)) continue; // OB-073 D2c: kind 10 only with a carpet table
    const isG = kd === KIND_GRASS;
    const u = gbuf.u[i], v = gbuf.v[i], t = fb.depth.depth[i];
    unpackNormalOct(alias[i], shadeNrm);
    const ndotl = shadeNrm[0] * sun.dirX + shadeNrm[1] * sun.dirY + shadeNrm[2] * sun.dirZ;
    // ME-15c (27.9a item 6, US-070b): with the sun shadow map the analytic sun term is scaled by n/4 (light pass PCF taps).
    // S8-B2-12b (38.13): cloud-darkening byte (`light.cloudQ[i]`, the JS-side copy of LIGHT.w bits 24..31, 0 at
    // strength 0 or when the light set carries no per-cell byte at all) scales the whole analytic sun term too.
    const cF = (light && !light.uniform && light.cloudQ) ? 1 - light.cloudQ[i] * (1 / 255) : 1;
    const b = sun.ambientI * (isG ? GRASS_AO_LO + (1 - GRASS_AO_LO) * u : 1) + sun.sunI * Math.max(0, ndotl) * (sunMapOn ? light.sunN[i] * 0.25 : 1) * cF;
    let lr = 0, lg = 0, lb = 0;
    if (light && !light.uniform) {
      const o = i * 3; lr = light.rgb[o]; lg = light.rgb[o + 1]; lb = light.rgb[o + 2];
    } else if (light && light.uniform) {
      lr = light.rgb[0]; lg = light.rgb[1]; lb = light.rgb[2];
    }
    const bT = b + Math.max(lr, Math.max(lg, lb));
    if (isG) shadeGrass(t, gbuf.mat[i], u, v, gbuf.vao[i], bT, grassTab, ctx, shadeOut, gbuf.grassX[i], sun.sunI);
    else if (GLK) { lookAtXY(terrain, u, v); shadeTerrain(t, gbuf.mat[i], bT, u, v, timeSec, ctx, shadeOut, forestFaceMode(gbuf, alias, ctx, i, t), gbuf.z[i], shadeNrm[0], shadeNrm[1], shadeNrm[2], lkLo, lkHi, lkW); } // ENV-02d: u,v = world x,y of a terrain cell
    else shadeTerrain(t, gbuf.mat[i], bT, u, v, timeSec, ctx, shadeOut, forestFaceMode(gbuf, alias, ctx, i, t), gbuf.z[i], shadeNrm[0], shadeNrm[1], shadeNrm[2]); // MAP-06b: z = the rasterised surface height (kind 7: zBase/zRef 0), same value as the GPU's GA.z
    gbuf.fogF[i] = terrainFogF(t, ctx.fog); // edge pass gate (BUG-GPU-005): never a stale value
    shadeOut.fg[0] = clampByte(shadeOut.fg[0] + lr * 0.5 * 255);
    shadeOut.fg[1] = clampByte(shadeOut.fg[1] + lg * 0.5 * 255);
    shadeOut.fg[2] = clampByte(shadeOut.fg[2] + lb * 0.5 * 255);
    const x = i % gbuf.cols, y = (i / gbuf.cols) | 0;
    cells.setCellRGB(x, y, shadeOut.glyph, shadeOut.fg[0], shadeOut.fg[1], shadeOut.fg[2], shadeOut.bg[0], shadeOut.bg[1], shadeOut.bg[2]);
  }
}
