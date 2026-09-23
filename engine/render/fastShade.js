// US-004b fast shading path (architecture.md 9 rules 5-6, 12 item 2, 12.2).
//
// This is a from-scratch re-implementation of `design/palette.js`
// `util.shade` / `util.shadeSky`, built for speed instead of clarity:
//   - materials/sky are resolved to flat records ONCE (lazily, cached by
//     key) instead of a `materials[key]` object lookup + string `charAt`
//     texel/ramp reads per cell;
//   - texture rows are pre-flattened into typed arrays (shade/tint/amount/
//     glyph-override), so sampling a texel is array indexing, not
//     string.charAt twice;
//   - the ramp is pre-flattened to a Uint8Array of char codes, so glyph
//     selection is array indexing, not string.charAt;
//   - the fg-gain curve (`b^0.75`) and the specular curve (`b^3`) - the two
//     Math.pow calls whose exponent isn't 1 and whose result only needs the
//     +-4/channel `?shadetest=1` color tolerance - are 256-entry LUTs.
//     The ramp-index gamma (`b^0.85`) stays an exact `Math.pow` call: the
//     glyph it selects must be EXACTLY equal to the reference (US-004b AC),
//     and it is one cheap call, not the two-Math.pow-plus-string-work the
//     reference does.
//   - `fogFactor` for the interior fog (curve = 1.0, see design/palette.js)
//     is exactly linear, so no LUT/pow is needed there at all - it was never
//     really a curve.
//   - fog early-out (architecture.md 12.2): when the linear fog factor is
//     >= 0.98, the cell is written straight to the fog colour and the
//     ramp's darkest glyph (always ' ' - `validate()` requires every ramp to
//     start with space), skipping texture/ramp/tint work entirely. This is
//     within the shadetest tolerance by construction (see the story notes).
//
// Callers never see a JS string for the glyph (rule 5/7: no strings in hot
// paths) - `fastShade`/`fastShadeSky` write `out.glyphIdx` (0-94, ASCII-32,
// exactly the byte `CellBuffer`/`RenderTarget.setCellRGB` wants), not
// `out.glyph`. `shadeTest.js` (a UI/test path, exempt from the allocation
// rules) turns that back into a character for its printed comparison.

const GAIN_POW_LUT_SIZE = 256;
const SPEC_POW_LUT_SIZE = 256;

// Exported (US-028 rework): `MaterialTable.js`/`detailShade.js` reuse this
// same LUT-builder for the v2 shader's fg-gain curve (tech notes item 4),
// instead of a per-cell `Math.pow`.
export function buildPowLUT(size, gamma) {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = Math.pow(i / (size - 1), gamma);
  return lut;
}

// Module-level, built once (not per material - the exponents are fixed
// constants from design/palette.js `shading`).
let gainLUT = null; // built from shading.fgGamma on first bind
let specLUT = null; // built from exponent 3 (fixed in the reference shader)
let boundShading = null;

export function samplePowLUT(lut, x) {
  if (x < 0) x = 0; else if (x > 1) x = 1;
  return lut[(x * (lut.length - 1) + 0.5) | 0];
}

function ensureLUTs(shading) {
  if (boundShading === shading && gainLUT) return;
  boundShading = shading;
  gainLUT = buildPowLUT(GAIN_POW_LUT_SIZE, shading.fgGamma);
  specLUT = buildPowLUT(SPEC_POW_LUT_SIZE, 3);
}

// --- material / sky record cache -----------------------------------------
// Flat key->record caches (single Map lookup per cell, not a map-of-maps -
// measured to matter: this runs once per shaded cell). Invalidated (cleared)
// only if a different `palette.materials`/`.sky` object identity shows up,
// which never happens in practice (one palette per session) but keeps this
// correct if it ever does.
let materialRecords = new Map();
let boundMaterials = null;
let skyRecord = null;
let boundSkyMaterial = null;

function flattenTexture(tex) {
  const { w, h, scale, key, rows } = tex;
  const n = w * h;
  const shadeArr = new Float32Array(n);
  const hasTint = new Uint8Array(n);
  const tintRGB = new Float32Array(n * 3);
  const amountArr = new Float32Array(n);
  const glyphOverride = new Uint8Array(n); // char code, 0 = none
  const holeArr = new Uint8Array(n);
  for (let tv = 0; tv < h; tv++) {
    const row = rows[h - 1 - tv]; // texel() reads rows[h-1-tv] - bake the flip in here
    for (let tu = 0; tu < w; tu++) {
      const entry = key[row.charAt(tu)];
      const idx = tv * w + tu;
      if (!entry) continue; // validated elsewhere; be defensive, matches texel() returning undefined
      shadeArr[idx] = entry.shade;
      amountArr[idx] = entry.amount == null ? 0.6 : entry.amount;
      if (entry.glyph) glyphOverride[idx] = entry.glyph.charCodeAt(0);
      if (entry.hole) holeArr[idx] = 1;
    }
  }
  return { w, h, scaleU: scale[0], scaleV: scale[1], shadeArr, hasTint, tintRGB, amountArr, glyphOverride, holeArr, rawKey: key };
}

// Tint colors depend on `P.rgb`, resolved separately so flattenTexture stays
// palette-agnostic (texture data itself is shared with the reference).
function resolveTintColors(flat, P) {
  const { rawKey } = flat;
  // Walk the key table once: every entry with a tint gets its rgb resolved.
  for (const ch in rawKey) {
    const entry = rawKey[ch];
    if (entry.tint) entry._tintRGB = P.rgb[entry.tint];
  }
}

function buildTextureRecord(tex, P) {
  const flat = flattenTexture(tex);
  resolveTintColors(flat, P);
  // Second pass: now that entry._tintRGB is resolved, fill hasTint/tintRGB
  // per texel (redo the row walk - simpler than threading state through).
  const { w, h, key, rows } = tex;
  for (let tv = 0; tv < h; tv++) {
    const row = rows[h - 1 - tv];
    for (let tu = 0; tu < w; tu++) {
      const entry = key[row.charAt(tu)];
      if (!entry || !entry.tint) continue;
      const idx = tv * w + tu;
      flat.hasTint[idx] = 1;
      const c = entry._tintRGB;
      flat.tintRGB[idx * 3] = c[0]; flat.tintRGB[idx * 3 + 1] = c[1]; flat.tintRGB[idx * 3 + 2] = c[2];
    }
  }
  return flat;
}

function resolveMaterial(P, key) {
  if (boundMaterials !== P.materials) { materialRecords = new Map(); boundMaterials = P.materials; }
  let rec = materialRecords.get(key);
  if (rec) return rec;

  const m = P.materials[key];
  const ramp = P.ramps[m.ramp];
  const rampCodes = new Uint8Array(ramp.length);
  for (let i = 0; i < ramp.length; i++) rampCodes[i] = ramp.charCodeAt(i);

  const bg = m.bg || { mode: 'black' };
  rec = {
    baseRGB: P.rgb[m.base],
    albedo: m.albedo,
    emissive: m.emissive || 0,
    rampCodes,
    rampLen: ramp.length,
    rampGamma: m.rampGamma || P.shading.rampGamma,
    bgMode: bg.mode || 'black',
    bgK: bg.k || 0,
    bgFixedRGB: bg.mode === 'fixed' ? P.rgb[bg.color] : null,
    textureFade: m.textureFade || null,
    tintBand: m.tintBand || null,
    spec: m.spec || 0,
    texture: m.texture ? buildTextureRecord(m.texture, P) : null,
  };
  materialRecords.set(key, rec);
  return rec;
}

function resolveSky(P) {
  if (boundSkyMaterial === P.materials.sky && skyRecord) return skyRecord;
  const m = P.materials.sky;
  const ramp = P.ramps[m.ramp];
  const rampCodes = new Uint8Array(ramp.length);
  for (let i = 0; i < ramp.length; i++) rampCodes[i] = ramp.charCodeAt(i);
  skyRecord = {
    elevTop: m.elevTop,
    cloudBand: m.cloudBand,
    rampCodes,
    rampLen: ramp.length,
    texture: buildTextureRecord(m.texture, P),
  };
  boundSkyMaterial = P.materials.sky;
  return skyRecord;
}

// --- shared, allocation-free scratch --------------------------------------
// Frame-constant (ambient-only, US-004b scope) light terms, primed once per
// frame by `primeFastShadeFrame` (called from castScene alongside the
// existing `primeAmbientLight`).
let frameLm = 0, frameHr = 1, frameHg = 1, frameHb = 1;

export function primeFastShadeFrame(L) {
  frameLm = Math.max(L[0], L[1], L[2]);
  if (frameLm > 1e-6) {
    frameHr = L[0] / frameLm; frameHg = L[1] / frameLm; frameHb = L[2] / frameLm;
  } else {
    frameHr = frameHg = frameHb = 1;
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function bandFactor(band, z) {
  if (!band) return 1;
  if (z <= band.full) return 1;
  if (z >= band.zero) return 0;
  return 1 - (z - band.full) / (band.zero - band.full);
}
// Interior fog is linear (curve 1.0) - see the module doc. `fogKey` support
// for 'far' (curve 0.7, US-016) is intentionally NOT added here: out of
// scope for this story (interior only, per raycaster.js's INTERIOR_FOG use).
function interiorFogFactor(dist, fog) {
  const f = fog.interior;
  if (dist <= f.start) return 0;
  if (dist >= f.full) return 1;
  return (dist - f.start) / (f.full - f.start);
}

/**
 * Fast replacement for `palette.util.shade` (surfaces only - `m.kind ===
 * 'sky'` materials never reach here, see raycaster.js). Writes
 * `out.glyphIdx` (0-94), `out.fg`/`out.bg` ([r,g,b] 0-255) in place.
 */
export function fastShade(P, matKey, u, v, dist, z, out) {
  ensureLUTs(P.shading);
  const rec = resolveMaterial(P, matKey);
  const fog = P.fog;
  const f = interiorFogFactor(dist, fog);
  const fogRGB = P.rgb[fog.interior.color];

  // --- fog early-out (architecture.md 12.2) -------------------------------
  if (f >= 0.98) {
    out.glyphIdx = 0; // ramps always start with space (validate() enforces this)
    out.fg[0] = fogRGB[0]; out.fg[1] = fogRGB[1]; out.fg[2] = fogRGB[2];
    out.bg[0] = fogRGB[0]; out.bg[1] = fogRGB[1]; out.bg[2] = fogRGB[2];
    return out;
  }

  let s = 1, tr = 0, tg = 0, tb = 0, tintAmt = 0, glyphOverride = 0;
  const tex = rec.texture;
  if (tex) {
    let tu = Math.floor(u * tex.scaleU) % tex.w; if (tu < 0) tu += tex.w;
    let tv = Math.floor(v * tex.scaleV) % tex.h; if (tv < 0) tv += tex.h;
    const idx = tv * tex.w + tu;
    const tfFade = rec.textureFade ? 1 - smoothstep(rec.textureFade[0], rec.textureFade[1], dist) : 1;
    const eShade = tex.shadeArr[idx];
    if (tex.hasTint[idx]) {
      const bf = bandFactor(rec.tintBand, z);
      s = 1 + (eShade - 1) * tfFade * bf;
      tintAmt = tex.amountArr[idx] * tfFade * bf;
      tr = tex.tintRGB[idx * 3]; tg = tex.tintRGB[idx * 3 + 1]; tb = tex.tintRGB[idx * 3 + 2];
    } else {
      // US-004b ARCH CHANGES item 5: the reference applies `s = 1 + (shade
      // - 1) * tf` for ANY texel that exists, including one with
      // `shade: 0.00` (the sky texture already has one) - `if (eShade)`
      // would silently skip that (falsy 0), diverging from the reference.
      // A texel that doesn't exist is a `validate()`-time error, not a
      // runtime case, so there is no longer a distinct "no entry" branch.
      s = 1 + (eShade - 1) * tfFade;
    }
    if (tex.glyphOverride[idx] && tfFade > 0.5) glyphOverride = tex.glyphOverride[idx];
  }

  const b = frameLm * rec.albedo * s + rec.emissive;

  // glyph: exact Math.pow, see module doc.
  const cutoff = P.shading.cutoff;
  const gb = b * (1 - f); // + fog.glyphLevel(0) * f, fog.glyphLevel is always 0
  let glyphCode;
  if (!(gb >= cutoff)) {
    glyphCode = rec.rampCodes[0];
  } else {
    const t = Math.pow(gb > 1 ? 1 : gb, rec.rampGamma);
    let i = Math.floor(t * (rec.rampLen - 1));
    if (i > rec.rampLen - 2) i = rec.rampLen - 2;
    const idx = 1 + i;
    glyphCode = (glyphOverride && idx >= P.shading.glyphOverrideMinIndex) ? glyphOverride : rec.rampCodes[idx];
  }

  // color
  let br = rec.baseRGB[0], bgc = rec.baseRGB[1], bb = rec.baseRGB[2];
  if (tintAmt > 0) {
    br += (tr - br) * tintAmt; bgc += (tg - bgc) * tintAmt; bb += (tb - bb) * tintAmt;
  }
  const k = P.shading.tint;
  const ctr = 1 + (frameHr - 1) * k, ctg = 1 + (frameHg - 1) * k, ctb = 1 + (frameHb - 1) * k;
  const bc = b < 0 ? 0 : b;
  let gain = P.shading.fgMin + (1 - P.shading.fgMin) * samplePowLUT(gainLUT, bc);
  if (bc > 1) gain = Math.min(P.shading.fgMaxGain, gain + (bc - 1) * 0.5);
  let r = br * ctr * gain, g = bgc * ctg * gain, bl = bb * ctb * gain;

  let hot = 0;
  if (rec.spec) hot += rec.spec * samplePowLUT(specLUT, bc);
  if (bc > 1) hot += Math.min(P.shading.overbrightMax, (bc - 1) * P.shading.overbright);
  if (hot > 0) {
    if (hot > 0.8) hot = 0.8;
    const hx = 255 * (0.5 + 0.5 * frameHr), hy = 255 * (0.5 + 0.5 * frameHg), hz = 255 * (0.5 + 0.5 * frameHb);
    r += (hx - r) * hot; g += (hy - g) * hot; bl += (hz - bl) * hot;
  }
  if (r > 255) r = 255; if (g > 255) g = 255; if (bl > 255) bl = 255;

  let xr = 0, xg = 0, xb = 0;
  if (rec.bgMode === 'darken') { xr = r * rec.bgK; xg = g * rec.bgK; xb = bl * rec.bgK; }
  else if (rec.bgMode === 'fixed') { xr = rec.bgFixedRGB[0]; xg = rec.bgFixedRGB[1]; xb = rec.bgFixedRGB[2]; }

  if (f > 0) {
    r += (fogRGB[0] - r) * f; g += (fogRGB[1] - g) * f; bl += (fogRGB[2] - bl) * f;
    xr += (fogRGB[0] - xr) * f; xg += (fogRGB[1] - xg) * f; xb += (fogRGB[2] - xb) * f;
  }

  out.glyphIdx = glyphCode < 32 || glyphCode > 126 ? 0 : glyphCode - 32;
  out.fg[0] = r; out.fg[1] = g; out.fg[2] = bl;
  out.bg[0] = xr; out.bg[1] = xg; out.bg[2] = xb;
  return out;
}

/**
 * Fast replacement for `palette.util.shadeSky`. `az` = compass degrees,
 * `elev` = degrees above horizon. Writes `out.glyphIdx`, `out.fg`/`out.bg`.
 */
export function fastShadeSky(P, az, elev, timeKey, out) {
  const rec = resolveSky(P);
  const T = P.timeOfDay[timeKey || P.defaultTime];
  const stops = T.sky;

  // skyGradient, inlined (no array/string alloc): find the bracketing stops.
  const t = clamp01(elev / rec.elevTop);
  let i = 0;
  for (; i < stops.length - 1; i++) if (t <= stops[i + 1].t) break;
  if (i >= stops.length - 1) i = stops.length - 2;
  const a = P.rgb[stops[i].c], bcol = P.rgb[stops[i + 1].c];
  const kk = (t - stops[i].t) / ((stops[i + 1].t - stops[i].t) || 1);
  const bgR = a[0] + (bcol[0] - a[0]) * kk, bgG = a[1] + (bcol[1] - a[1]) * kk, bgB = a[2] + (bcol[2] - a[2]) * kk;

  const tex = rec.texture;
  let tu = Math.floor(az * tex.scaleU) % tex.w; if (tu < 0) tu += tex.w;
  let tv = Math.floor(elev * tex.scaleV) % tex.h; if (tv < 0) tv += tex.h;
  const idx = tv * tex.w + tu;
  const eShade = tex.shadeArr[idx];
  const cb = rec.cloudBand;
  const d = eShade * smoothstep(0, cb[0], elev) * (1 - smoothstep(cb[1], cb[2], elev));

  // ramp gamma is exactly 1 for sky (`rampIndex(len, d, 1)` in the
  // reference) - no Math.pow needed at all, exact by construction.
  let glyphCode;
  if (!(d >= P.shading.cutoff)) {
    glyphCode = rec.rampCodes[0];
  } else {
    const tt = d > 1 ? 1 : d;
    let gi = Math.floor(tt * (rec.rampLen - 1));
    if (gi > rec.rampLen - 2) gi = rec.rampLen - 2;
    glyphCode = rec.rampCodes[1 + gi];
  }

  const c = P.rgb[T.cloud], kcloud = 0.35 + 0.65 * d;
  out.glyphIdx = glyphCode < 32 || glyphCode > 126 ? 0 : glyphCode - 32;
  out.bg[0] = bgR; out.bg[1] = bgG; out.bg[2] = bgB;
  out.fg[0] = bgR + (c[0] - bgR) * kcloud;
  out.fg[1] = bgG + (c[1] - bgG) * kcloud;
  out.fg[2] = bgB + (c[2] - bgB) * kcloud;
  return out;
}
