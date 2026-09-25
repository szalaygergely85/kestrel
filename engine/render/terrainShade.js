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

function toByte(v255) {
  const c = v255 < 0 ? 0 : v255 > 255 ? 255 : v255;
  return Math.floor(c + 0.5);
}

/**
 * @param {Object} shading - `palette.shading` ({cutoff, fgMin, fgGamma, fgMaxGain, ...}).
 */
function gainOf(bc, shading) {
  const bcc = bc < 0 ? 0 : bc;
  let gain = shading.fgMin + (1 - shading.fgMin) * Math.pow(bcc > 1 ? 1 : bcc, shading.fgGamma);
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
 *   handover?: number[],                                // recipe.nearLOD.handover [h0, h1] - picks the 2 m vs 8 m hash cell
 * }} ctx
 * @param {{glyph:number, fg:Uint8Array|number[], bg:Uint8Array|number[]}} out - written in place (fg/bg length 3)
 */
export function shadeTerrain(t, type, b, u, v, timeSec, ctx, out) {
  // 23.4 near-detail: inside the near-handover band the world-cell hash is
  // keyed at 2 m (matches the near band's own cell size), else at 8 m (the
  // far grid's cell size) - `nearLOD.rules` ("hash cell 2 m when t < h1,
  // else 8 m"). No `ctx.handover` (old callers/tests, far-only recipes) ->
  // unchanged 8 m behaviour.
  const cellSz = ctx.handover && t < ctx.handover[1] ? 2 : 8;
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

  // Fog (item 5 + overworld_far.js "fog" section): 50 -> 1500 m, curve 0.7.
  const F = ctx.fog;
  let f = (t - F.start) / (F.full - F.start);
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  f = Math.pow(f, F.curve || 1);
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
