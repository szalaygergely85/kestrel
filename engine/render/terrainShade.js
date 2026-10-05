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
import { KIND_TERRAIN } from './GBuffer.js';
import { packTerrainTextures } from './gpu/TerrainTextures.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { clampByte } from '../core/math.js';
import { sunFromWorld } from './lighting.js';

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
export function perCellHashSize(t, k, handover) {
  if (handover && !(t < handover[1])) return 8;
  return Math.min(2, Math.max(0.125, Math.pow(2, Math.ceil(Math.log2(Math.max(t * k, 1e-6))))));
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
export function shadeTerrain(t, type, b, u, v, timeSec, ctx, out, faceMode = 0) {
  // 23.4 near-detail: inside the near-handover band the world-cell hash is
  // keyed at 2 m (matches the near band's own cell size), else at 8 m (the
  // far grid's cell size) - `nearLOD.rules` ("hash cell 2 m when t < h1,
  // else 8 m"). No `ctx.handover` (old callers/tests, far-only recipes) ->
  // unchanged 8 m behaviour.
  // BUG-RTS-001 (28.11a): a per-frame `ctx.hashCell` > 0 (pitched views) replaces the fixed cell.
  // BUG-FP-002: hashCell < 0 = per-cell mode, k = -hashCell (ground m per column per m of depth): each cell keys
  // its own power-of-two cell from its distance (0.125..2 m near, 8 m past the handover) - no 2 m blocks at the feet.
  const hk = ctx.hashCell < 0 ? -ctx.hashCell : 0;
  const cellSz = hk > 0 ? perCellHashSize(t, hk, ctx.handover)
    : ctx.hashCell > 0 ? ctx.hashCell : (ctx.handover && t < ctx.handover[1] ? 2 : 8);
  const cx = Math.floor(u / cellSz), cy = Math.floor(v / cellSz);
  const hA = hashFast01(cx, cy, type);
  const hB = hashFast01(cx, cy, 7);

  // 23.4 near-detail: close < ctx.closeBand wins over the near/mid/far tier
  // picked below (TLOOK texel 7, fixed) and gets a +-0.08 brightness jitter
  // (own hash salt 10, per-2 m-cell - "shading only, heightAt stays smooth").
  const close = ctx.closeBand != null && t < ctx.closeBand;
  const bEff = close ? b + (hashFast01(cx, cy, 10) * 2 - 1) * 0.08 : b;

  const tier = bEff < 0.45 ? 0 : bEff < 0.8 ? 1 : 2;
  let i = tier + (Math.floor(hA * 3) - 1);
  if (i < 0) i = 0; else if (i > 2) i = 2;

  const TL = ctx.tlook, W = ctx.tlookWidth, base = type * W * 4;
  const colOff = base + i * 4;
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  let fr = TL[colOff] * 255, fg = TL[colOff + 1] * 255, fb = TL[colOff + 2] * 255;
  const gain = gainOf(bEff, ctx.shading);
  fr *= gain; fg *= gain; fb *= gain;
  let br = fr * 0.3, bg = fg * 0.3, bb = fb * 0.3;

  const bandIdx = t < ctx.bands.near ? 0 : t < ctx.bands.mid ? 1 : 2;
  const gOff = close ? base + 7 * 4 : base + (4 + bandIdx) * 4;
  const packedX = TL[gOff], packedCount = TL[gOff + 1];
  let code = pickCodeFromPacked(packedX, packedCount, Math.floor(hB * packedCount));

  // Water glint (item 5): timeSec-keyed, still world-keyed via (cx, cy).
  const albedo = TL[base + 3 * 4], glintFlag = TL[base + 3 * 4 + 1];
  if (glintFlag) {
    const g = hashFast01(cx, cy, Math.floor(timeSec * 1.5) | 0);
    if (g > 0.5) {
      const alt = pickCodeFromPacked(packedX, packedCount, (Math.floor(hB * packedCount) + 1) % Math.max(1, packedCount));
      code = alt;
      const lightOff = base + 2 * 4; // TLOOK[type][2] (the "light" colour) doubles as the glint tint
      const lr = TL[lightOff] * 255 * gain, lg = TL[lightOff + 1] * 255 * gain, lb = TL[lightOff + 2] * 255 * gain;
      fr += (lr - fr) * 0.35; fg += (lg - fg) * 0.35; fb += (lb - fb) * 0.35;
    }
  }

  // 23.4 close-band features (wildflower/pebble): `ctx.features` is a flat
  // list pre-resolved by `makeTerrainShadeCtx` to `{typeId, chance, code0,
  // code1, fg:[r,g,b]}` (own hash salt per list index, 20+idx, so the
  // wildflower/pebble dice never correlate with the tier/glyph hash above or
  // with each other). Deviation flagged for architect review (S5): the doc's
  // "small FEAT texel row per type" describes a GPU-uploadable packing; this
  // JS oracle reads the same data straight off `recipe.nearLOD.features`
  // instead (no GLSL exists yet to port to - S5 designs the real FEAT
  // texture layout against this same recipe list).
  if (close && ctx.features) {
    for (let fi = 0; fi < ctx.features.length; fi++) {
      const feat = ctx.features[fi];
      if (feat.typeId !== type) continue;
      const fh = hashFast01(cx, cy, 20 + fi);
      if (fh >= feat.chance) continue;
      code = fh < feat.chance * 0.5 ? feat.code0 : feat.code1;
      fr = feat.fg[0]; fg = feat.fg[1]; fb = feat.fg[2];
      br = fr * 0.3; bg = fg * 0.3; bb = fb * 0.3;
      break;
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
    const trunk = faceMode === 2 && hashFast01(cx, cy, FOREST_TRUNK_SALT) < FOREST_TRUNK_CHANCE;
    code = trunk ? FOREST_TRUNK_CODE : pickCodeFromPacked(faceX, faceCount, faceMode === 2 ? faceCount - 1 : Math.floor(hB * faceCount));
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
  const f = terrainFogF(t, F);
  const fcr = F.nearRGB[0] + (F.farRGB[0] - F.nearRGB[0]) * f;
  const fcg = F.nearRGB[1] + (F.farRGB[1] - F.nearRGB[1]) * f;
  const fcb = F.nearRGB[2] + (F.farRGB[2] - F.nearRGB[2]) * f;
  fr += (fcr - fr) * f; fg += (fcg - fg) * f; fb += (fcb - fb) * f;
  const fBg = Math.min(1, 1.1 * f);
  br += (fcr - br) * fBg; bg += (fcg - bg) * fBg; bb += (fcb - bb) * fBg;
  if (f > 0.85) code = 0; // space (glyphIdx 0)

  out.glyph = code;
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
    features: buildFeatures(recipe, palette),
  };
}

// ME-19b: deferred terrain-cell shading moved without changing expression order.
const shadeOut = { glyph: 32, fg: new Uint8Array(3), bg: new Uint8Array(3) };
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

/** Lazily (re)builds and caches `terrain`'s shading context, keyed by `farVersion`. */
function terrainShadingFor(matTable, ctx) {
  if (!ctx._paletteShading) ctx._paletteShading = ctx.shading;
  const ms = matTable && matTable.shading;
  if (!ms || !matTable.gainLUT) return ctx._paletteShading;
  if (!ctx._mtShading || ctx._mtShadingSrc !== matTable) {
    ctx._mtShading = { fgMin: ms.fgMin, fgMaxGain: ms.fgMaxGain, fgGamma: ctx._paletteShading.fgGamma, gainLUT: matTable.gainLUT };
    ctx._mtShadingSrc = matTable;
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
 * no terrain shadow rays); `Lc` is `fb.light`'s already-computed per-cell
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
export function shadeTerrainCells(fb, terrain, world, timeSec = 0, hashCell = 0) {
  if (!terrain || !terrain.farReady || !fb.gbuf) return;
  const gbuf = fb.gbuf, palette = fb.palette;
  const ctx = ensureShadeCtx(terrain, palette);
  ctx.hashCell = hashCell; // BUG-RTS-001 (28.11a): per-frame, 0 = fixed 2/8 m cell
  // BUG-GPU-005: the GPU terrain branch takes fgMin/fgMaxGain + the gain LUT
  // from `MaterialTable.shading` (design/detail-pass.js); match it whenever a
  // v2 MaterialTable is bound, else keep `palette.shading` + Math.pow.
  ctx.shading = terrainShadingFor(fb.matTable, ctx);
  const sun = sunFromWorld(world, palette);
  const cells = fb.rt.cells || fb.rt;
  const n = gbuf.cols * gbuf.rows;
  const light = fb.light;
  const sunMapOn = !!(light && !light.uniform && light.sunMapOn);
  const alias = terrainAoAlias(gbuf);
  for (let i = 0; i < n; i++) {
    if (gbuf.kind[i] !== KIND_TERRAIN) continue;
    const u = gbuf.u[i], v = gbuf.v[i], t = fb.depth.depth[i];
    unpackNormalOct(alias[i], shadeNrm);
    const ndotl = shadeNrm[0] * sun.dirX + shadeNrm[1] * sun.dirY + shadeNrm[2] * sun.dirZ;
    // ME-15c (27.9a item 6, US-070b): with the sun shadow map the analytic sun term is scaled by n/4 (light pass PCF taps).
    const b = sun.ambientI + sun.sunI * Math.max(0, ndotl) * (sunMapOn ? light.sunN[i] * 0.25 : 1);
    let lr = 0, lg = 0, lb = 0;
    if (light && !light.uniform) {
      const o = i * 3; lr = light.rgb[o]; lg = light.rgb[o + 1]; lb = light.rgb[o + 2];
    } else if (light && light.uniform) {
      lr = light.rgb[0]; lg = light.rgb[1]; lb = light.rgb[2];
    }
    const bT = b + Math.max(lr, Math.max(lg, lb));
    shadeTerrain(t, gbuf.mat[i], bT, u, v, timeSec, ctx, shadeOut, forestFaceMode(gbuf, alias, ctx, i, t));
    gbuf.fogF[i] = terrainFogF(t, ctx.fog); // edge pass gate (BUG-GPU-005): never a stale value
    shadeOut.fg[0] = clampByte(shadeOut.fg[0] + lr * 0.5 * 255);
    shadeOut.fg[1] = clampByte(shadeOut.fg[1] + lg * 0.5 * 255);
    shadeOut.fg[2] = clampByte(shadeOut.fg[2] + lb * 0.5 * 255);
    const x = i % gbuf.cols, y = (i / gbuf.cols) | 0;
    cells.setCellRGB(x, y, shadeOut.glyph, shadeOut.fg[0], shadeOut.fg[1], shadeOut.fg[2], shadeOut.bg[0], shadeOut.bg[1], shadeOut.bg[2]);
  }
}
