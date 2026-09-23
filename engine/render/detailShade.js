// US-028 derivative + shading passes (docs/backlog.md tech notes items 5-6;
// rework: architect review 1, "MaterialTable flattening", 2026-09-23). Run
// once per frame, over the whole G-buffer, after every structure/terrain
// pass has written into it (`castSectors` no longer shades inline).
//
// Two v2 shading paths live in this file, for two different purposes:
//   - `shadeV2` (below): a line-for-line port of the designer's reference
//     `design/detail-pass.js` `util.shade`, still keyed by strings and
//     reading `DP.materials`/`DP.sets`/`DP.util.*` directly. NOT in the
//     frame path any more (measured 1.1-2.8 ms/frame extra at 160x60,
//     2-3x the budget) - kept only as `?shadetest=1`'s oracle helper
//     (`shadeTest.js`'s `runDetailShadeTest` compares the two).
//   - `shadeDetailFast` (this rework): the actual frame-path shader,
//     reading only `MaterialTable.js`'s flattened `DetailMaterialRec` typed
//     data - no string keys, no `materials[key]`/`Map.get`/`Math.pow` per
//     cell, no `DP.util.*` calls (tech notes item 14). `hash`, `crossLine`,
//     `lineGlyph`, `pickTone`, `fogFactor` are reimplemented here as small
//     numeric functions (item 1: "copy into the engine"); `level()`/
//     `orientClass()` keep the threshold-scan/slope-compare swap from the
//     first pass (item 6).
// `fastShade` (the existing US-004b path, unchanged) still handles every
// v1-only material (iron, grate, ash, rock) and the `?detail=0` A/B switch.

import { fastShade, samplePowLUT } from './fastShade.js';

// --- fast level()/orientClass() (tech notes item 6) -------------------------
const TAN22 = Math.tan(22 * Math.PI / 180);
const TAN68 = Math.tan(68 * Math.PI / 180);
const thresholdsCache = new Map(); // n -> Float64Array(n), keyed by n (gamma is a fixed DP constant)

function getThresholds(n, gamma) {
  let t = thresholdsCache.get(n);
  if (t) return t;
  t = new Float64Array(n);
  for (let k = 1; k < n; k++) t[k] = Math.pow(k / n, 1 / gamma);
  thresholdsCache.set(n, t);
  return t;
}
// Equivalent to the reference `level(n, gb)` (design/detail-pass.js): finds
// the same integer by "count thresholds <= gb" instead of `floor(gb^gamma*n)`.
function levelFast(n, gb, cutoff, gamma) {
  if (!(gb >= cutoff)) return 0;
  const t = getThresholds(n, gamma);
  let i = 0;
  for (let k = 1; k < n; k++) { if (t[k] <= gb) i = k; else break; }
  return 1 + (i > n - 1 ? n - 1 : i);
}
// Equivalent to the reference `orientClass(cx, cy)`, derived from its own
// angle formula (a = atan2(dy,dx) mod 180; h if a<22||a>158; v if
// 68<a<112) rewritten as the slope compares that boundary implies - no
// atan2, no per-cell trig at all.
function orientClassFast(cx, cy, cellAspect) {
  const gy = cy / cellAspect;
  const dx = -gy, dy = cx;
  if (dx === 0 && dy === 0) return 'h';
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (ady <= TAN22 * adx) return 'h';
  if (ady >= TAN68 * adx) return 'v';
  return dx * dy > 0 ? 'd2' : 'd1';
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstepFast(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function coverFast(cx, cy) { return Math.abs(cx) + Math.abs(cy); }
function bandFactorFast(band, z) {
  if (!band || z == null) return 1;
  if (z <= band.full) return 1;
  if (z >= band.zero) return 0;
  return 1 - (z - band.full) / (band.zero - band.full);
}
function pickChar(str, h) { return str.charAt(Math.min(str.length - 1, Math.floor(h * str.length))); }
// Joint/band-edge coverage fallback (design/detail-pass.js `fallbackPeriod`,
// US-028 D1 "joint fallback octaves"): a line whose footprint fails the
// `maxCover * period` test is retested at 2x, then 4x the period before
// being dropped, so distant/oblique surfaces keep some joints instead of
// losing them all. Returns the period to test at, or -1 if none fit.
function fallbackPeriodOracle(cov, maxCover, period) {
  if (cov < maxCover * period) return period;
  if (cov < maxCover * period * 2) return period * 2;
  if (cov < maxCover * period * 4) return period * 4;
  return -1;
}

function setGlyphFast(S, gb, h, alt, s, cellAspect, cutoff, gamma) {
  let lv, str;
  if (S.orient) {
    const nd = S.dark.length, nf = S.fam.h.length;
    lv = levelFast(nd + nf, gb, cutoff, gamma);
    if (lv === 0) return ' ';
    if (lv <= nd) str = S.dark[lv - 1];
    else {
      const cls = S.orient === 'u' ? orientClassFast(s.dudx, s.dudy, cellAspect) : orientClassFast(s.dvdx, s.dvdy, cellAspect);
      str = S.fam[cls][lv - nd - 1];
    }
  } else {
    lv = levelFast(S.length, gb, cutoff, gamma);
    if (lv === 0) return ' ';
    str = S[lv - 1];
  }
  return alt ? pickChar(str, h) : str.charAt(0);
}

/**
 * Port of `design/detail-pass.js` `util.shade`, ALL_ON, with `level`/
 * `orientClass` swapped for the fast versions above. `s` (sample), `L`
 * (light), `out` (glyph/fg/bg/f) are the caller's reused scratch objects -
 * see `shadeSurfaces`. Exported for `?shadetest=1`'s v2 table
 * (`runDetailShadeTest`, engine/render/shadeTest.js), which compares this
 * against `DP.util.shade` directly.
 */
export function shadeV2(DP, rgb, m, s, L, out) {
  const hash = DP.util.hash, crossLine = DP.util.crossLine, lineGlyph = DP.util.lineGlyph;
  const pickTone = DP.util.pickTone, fogFactor = DP.util.fogFactor;
  const shading = DP.shading, faceShade = DP.faceShade, ao = DP.ao, fog = DP.fog, lodGates = DP.lodGates;
  const cellAspect = shading.cellAspect, cutoff = shading.cutoff, gamma = shading.gamma;

  const dist = s.dist || 0, u = s.u, v = s.v;
  const g = m.grid;

  let course = 0, bix = 0, fv = 0.5, uo = u;
  if (g) {
    course = Math.floor(v / g.v);
    uo = u - ((course & 1) ? g.stagger * g.u : 0);
    bix = Math.floor(uo / g.u);
    fv = v / g.v - course;
  }
  // US-028 D1 ("LOD distance" octave, ported from design/detail-pass.js
  // `shade` 2026-09-23): per-cell detail octave, so hA/hC track a texel
  // density that adapts to on-screen footprint (`tpc`), while hB (LOD tier
  // dither + fog stipple) keeps the BASE (non-octave) texel so the tier
  // boundary doesn't move with the octave.
  const base = m.detail || 16;
  const tpcU = Math.abs(s.dudx) + Math.abs(s.dudy), tpcV = Math.abs(s.dvdx) + Math.abs(s.dvdy);
  const tpc = (tpcU > tpcV ? tpcU : tpcV) * base;
  const oct = tpc >= 4 ? -3 : tpc >= 2 ? -2 : tpc >= 1 ? -1 : tpc >= 0.5 ? 0 : tpc >= 0.25 ? 1 : 2;
  const ds = base * POW2[oct + 3], tx = Math.floor(u * ds), ty = Math.floor(v * ds);
  const btx = Math.floor(u * base), bty = Math.floor(v * base);
  // F1 (owner feedback "shimmer when moving", US-028a): hA/hC key on the
  // block/cell id (bix, course) when a grid exists - one alternate glyph
  // per block instead of one per fine texel - else on the texel one octave
  // coarser (`floor(u*ds*0.5)`), so both stop rerolling on sub-cell motion.
  // hB (LOD tier dither + fog stipple) stays on the base texel, unchanged.
  let hA, hC;
  if (g) {
    hA = hash(bix, course, m.seed);
    hC = hash(bix, course, m.seed + 13);
  } else {
    const cx = Math.floor(u * ds * 0.5), cy = Math.floor(v * ds * 0.5);
    hA = hash(cx, cy, m.seed);
    hC = hash(cx, cy, m.seed + 13);
  }
  const hB = hash(btx, bty, m.seed + 7);
  const hBlock = hash(bix, course, m.seed + 3);

  const toneKey = pickTone(m, hBlock);
  const c0 = rgb[toneKey];
  let cr = c0[0], cg = c0[1], cb = c0[2];

  let tier = 0;
  if (m.lod) {
    const dd = dist + (hB - 0.5) * (m.lod.dither || 0);
    tier = dd < m.lod.mid ? 0 : dd < m.lod.far ? 1 : 2;
  }
  let set = tier === 0 ? m.face.set : tier === 1 ? (m.face.mid || m.face.set) : (m.face.far || m.face.set);
  let shadeK = 1, tint = null, tintAmt = 0, bgK = m.bgK, lineG = null, onJoint = false, inBand = false;

  if (g && m.face.bevel && tier <= lodGates.bevel) {
    const bv = m.face.bevel, yv = fv * g.v;
    if (g.v - yv < bv.top) shadeK *= bv.topShade;
    else if (yv < bv.bottom) shadeK *= bv.bottomShade;
  }
  const band = m.band;
  if (band) {
    const bcoord = band.axis === 'u' ? u : v;
    const bcx = band.axis === 'u' ? s.dudx : s.dvdx, bcy = band.axis === 'u' ? s.dudy : s.dvdy;
    const pos = bcoord - Math.floor(bcoord / band.period) * band.period;
    if (pos < band.width) {
      inBand = true;
      if (tier <= lodGates.band) set = band.set;
      shadeK = band.shade;
      if (band.tone) { const bt = rgb[band.tone]; cr = bt[0]; cg = bt[1]; cb = bt[2]; }
      if (band.bgK) bgK = band.bgK;
    }
    if (fallbackPeriodOracle(coverFast(bcx, bcy), 0.5, band.width) > 0) {
      const e0 = crossLine(bcoord, bcx, bcy, band.period, 0), e1 = crossLine(bcoord, bcx, bcy, band.period, band.width);
      const ef = e0 >= 0 ? e0 : e1;
      if (ef >= 0) { lineG = lineGlyph(bcx, bcy, ef); shadeK = band.edgeShade || 0.5; onJoint = true; }
    }
  }
  if (g && g.lines !== false && !inBand && !onJoint) {
    // D1: joint fallback octaves - every line, else every 2nd, else every 4th.
    const periodH = fallbackPeriodOracle(coverFast(s.dvdx, s.dvdy), g.maxCover, g.v);
    const periodV = fallbackPeriodOracle(coverFast(s.dudx, s.dudy), g.maxCover, g.u);
    const okH = periodH > 0;
    const okV = periodV > 0 && (!g.tie || okH);
    const fh = okH ? crossLine(v, s.dvdx, s.dvdy, periodH, 0) : -1;
    const fu = okV ? crossLine(uo, s.dudx, s.dudy, periodV, 0) : -1;
    if (fh >= 0 || fu >= 0) {
      onJoint = true;
      if (g.kind === 'gap') { set = g.set; lineG = null; }
      else if (fh >= 0 && fu >= 0 && g.cross) lineG = g.cross;
      else if (fu >= 0) lineG = lineGlyph(s.dudx, s.dudy, fu);
      else lineG = lineGlyph(s.dvdx, s.dvdy, fh);
      shadeK = g.shade;
      if (g.tint) { tint = g.tint; tintAmt = g.amount == null ? 0.5 : g.amount; }
      if (g.bgK) bgK = g.bgK;
    }
  }
  const ov = m.overlay;
  if (ov && tier <= lodGates.overlay) {
    const bf = ov.band ? bandFactorFast(ov.band, s.z) : 1;
    if (hC < (onJoint ? ov.joint : ov.face) * bf) {
      if (!onJoint) set = ov.set;
      tint = ov.tints[Math.min(ov.tints.length - 1, Math.floor(hA * ov.tints.length))];
      tintAmt = ov.amount;
      shadeK *= ov.shade;
    }
  }
  if (m.speckle && tier <= lodGates.speckle && !onJoint && !inBand && hC > 1 - m.speckle.chance) {
    set = m.speckle.set;
    shadeK *= m.speckle.shade;
  }

  const Lm = Math.max(L[0], L[1], L[2]);
  const fk = faceShade[s.normal] || 1;
  let aok = 1;
  if (s.aoD != null && s.aoD < ao.r) aok = ao.k + (1 - ao.k) * smoothstepFast(0, ao.r, s.aoD);
  const jit = 1 + (m.jitter || 0) * (hA * 2 - 1);
  const b = Lm * m.albedo * shadeK * fk * aok * jit + (m.emissive || 0);
  const lift = shading.lift;
  let gb = b < cutoff ? 0 : lift + (1 - lift) * Math.min(b, 1);

  const f = fogFactor(dist);
  const fogBg = rgb[fog.color], fogFg = rgb[fog.glyph];

  let glyph;
  if (gb <= 0) glyph = ' ';
  else if (lineG) glyph = lineG;
  // Reference change (2026-09-23, "LOD distance"): the hashed alternate is
  // used in EVERY tier now (`F.detail`, unconditionally true under ALL_ON),
  // not gated by `tier === 0` any more - far walls would otherwise collapse
  // to one glyph per level.
  else glyph = setGlyphFast(DP.sets[set], gb, hA, true, s, cellAspect, cutoff, gamma);
  if (f > fog.stipple[0] && hB < smoothstepFast(fog.stipple[0], fog.stipple[1], f)) {
    glyph = pickChar(DP.sets[fog.set][f > fog.sparse ? 0 : 1], hA);
  }

  if (tint && tintAmt > 0) {
    const tc = rgb[tint];
    cr += (tc[0] - cr) * tintAmt; cg += (tc[1] - cg) * tintAmt; cb += (tc[2] - cb) * tintAmt;
  }
  let hr = 1, hg = 1, hb = 1;
  if (Lm > 1e-6) { hr = L[0] / Lm; hg = L[1] / Lm; hb = L[2] / Lm; }
  const k = shading.tint, fgMin = shading.fgMin;
  const bc = b < 0 ? 0 : b;
  let gain = fgMin + (1 - fgMin) * Math.pow(bc > 1 ? 1 : bc, shading.fgGamma);
  if (bc > 1) gain = Math.min(shading.fgMaxGain, gain + (bc - 1) * 0.5);
  let r = cr * (1 + (hr - 1) * k) * gain, gg = cg * (1 + (hg - 1) * k) * gain, bl = cb * (1 + (hb - 1) * k) * gain;
  if (bc > 1) {
    const hot = Math.min(shading.overbrightMax, (bc - 1) * shading.overbright);
    r += (255 * (0.5 + 0.5 * hr) - r) * hot; gg += (255 * (0.5 + 0.5 * hg) - gg) * hot; bl += (255 * (0.5 + 0.5 * hb) - bl) * hot;
  }
  if (r > 255) r = 255; if (gg > 255) gg = 255; if (bl > 255) bl = 255;
  let xr = r * bgK, xg = gg * bgK, xb = bl * bgK;
  if (f > 0) {
    r += (fogFg[0] - r) * f; gg += (fogFg[1] - gg) * f; bl += (fogFg[2] - bl) * f;
    xr += (fogBg[0] - xr) * f; xg += (fogBg[1] - xg) * f; xb += (fogBg[2] - xb) * f;
  }
  out.glyph = glyph;
  out.fg[0] = r; out.fg[1] = gg; out.fg[2] = bl;
  out.bg[0] = xr; out.bg[1] = xg; out.bg[2] = xb;
  out.b = b;
  out.f = f;
  return out;
}

function clampByte(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ===========================================================================
// FAST v2 shader (tech notes item 4/6/14) - reads only `MaterialTable.js`'s
// flattened `DetailMaterialRec`/`SetRec` typed data. No string keys, no
// `Math.pow` (the fg-gain curve reuses `fastShade.js`'s LUT), no `Map.get`,
// no calls into `design/` content. This is the engine's own copy of `hash`/
// `crossLine`/`lineGlyph`/`pickTone`/`fogFactor` (item 1).
// ===========================================================================

// 2^oct for oct in [-3, 2], indexed by oct+3 - avoids a `Math.pow` per cell
// (owner feedback "LOD distance", item 1).
const POW2 = [0.125, 0.25, 0.5, 1, 2, 4];

function hashFast(x, y, s) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Level 0..levels for `levels` density steps, from a per-SetRec threshold
// table baked at bind time (MaterialTable.js `buildThresholds`) - no
// `Math.pow`/cache lookup per cell (equivalent to the reference `level()`
// except at 1-ulp threshold boundaries). Named distinctly from the oracle's
// own `levelFast` above (different signature: a baked threshold array, not
// a cutoff/gamma pair).
function levelFromThresholds(levels, gb, thresholds, cutoff) {
  if (!(gb >= cutoff)) return 0;
  let i = 0;
  for (let k = 1; k < levels; k++) { if (thresholds[k] <= gb) i = k; else break; }
  return 1 + i;
}
// Slope-compare replacement for the reference `orientClass` (atan2),
// returning a class CODE (0 h, 1 v, 2 d1 '/', 3 d2 '\') instead of a string
// (reuses the oracle's own `TAN22`/`TAN68` constants above).
function orientClassCode(cx, cy, cellAspect) {
  const gy = cy / cellAspect;
  const dx = -gy, dy = cx;
  if (dx === 0 && dy === 0) return 0;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (ady <= TAN22 * adx) return 0;
  if (ady >= TAN68 * adx) return 1;
  return dx * dy > 0 ? 3 : 2;
}
// `bandFactor` (oracle, above) takes the raw `band` object; this fast-path
// version takes the two already-unpacked scalars from `DetailMaterialRec`.
function bandFactorNum(full, zero, z) {
  if (z == null) return 1;
  if (z <= full) return 1;
  if (z >= zero) return 0;
  return 1 - (z - full) / (zero - full);
}
// Footprint crossing test (engine copy of the reference `crossLine`).
function crossLineFast(c, cx, cy, period, offset) {
  let hw = 0.5 * (Math.abs(cx) + Math.abs(cy));
  if (!(hw > 1e-7)) hw = 1e-7;
  const k = Math.floor((c + hw - offset) / period);
  const line = offset + k * period;
  if (line < c - hw) return -1;
  const fr = Math.abs(cy) > 1e-9 ? 0.5 + (line - c) / cy : 0.5;
  return fr < 0 ? 0 : fr > 1 ? 1 : fr;
}
const LINE_CODE_DASH = 45 - 32, LINE_CODE_UNDERSCORE = 95 - 32, LINE_CODE_PIPE = 124 - 32, LINE_CODE_SLASH = 47 - 32, LINE_CODE_BACKSLASH = 92 - 32;
function lineGlyphCodeFast(cx, cy, fr, cellAspect) {
  const k = orientClassCode(cx, cy, cellAspect);
  if (k === 0) return fr >= 0.5 ? LINE_CODE_UNDERSCORE : LINE_CODE_DASH;
  return k === 1 ? LINE_CODE_PIPE : k === 2 ? LINE_CODE_SLASH : LINE_CODE_BACKSLASH;
}
// Picks a glyph code (already ASCII-32, ready for `out.glyphIdx`) from a
// flattened `SetRec` (MaterialTable.js) at brightness `gb`. `useAlt` = near
// tier (hashed alternate) vs calm (first alt); `classIdx` only consulted for
// oriented sets, once the level falls in the "fam" (grain-direction) range.
function pickGlyphCodeFast(S, gb, hA, useAlt, classIdx, cutoff) {
  const lv = levelFromThresholds(S.levels, gb, S.thresholds, cutoff);
  if (lv === 0) return -1; // caller substitutes space (glyphIdx 0)
  if (!S.oriented) {
    const li = lv - 1, cnt = S.altCount[li];
    const idx = useAlt ? Math.min(cnt - 1, Math.floor(hA * cnt)) : 0;
    return S.codes[li * S.maxAlt + idx];
  }
  if (lv <= S.nDark) {
    const li = lv - 1, cnt = S.darkAltCount[li];
    const idx = useAlt ? Math.min(cnt - 1, Math.floor(hA * cnt)) : 0;
    return S.darkCodes[li * S.maxAlt + idx];
  }
  const li = lv - S.nDark - 1;
  const f = S.fam[classIdx];
  const cnt = f.altCount[li];
  const idx = useAlt ? Math.min(cnt - 1, Math.floor(hA * cnt)) : 0;
  return f.codes[li * S.maxAlt + idx];
}
function pickCharCodeFast(codes, altCount, maxAlt, h) {
  const idx = Math.min(altCount - 1, Math.floor(h * altCount));
  return codes[idx];
}

/**
 * Frame-path v2 shader (tech notes item 4/6). Reads sample `i` straight out
 * of `gbuf`/`depth` (no intermediate object - architecture.md 9 rule 3),
 * `rec` is `table.records[gbuf.mat[i]].v2` (a `DetailMaterialRec`, non-null
 * - callers only reach here when it is), `table` is the whole bound
 * `MaterialTable` (for `faceK`, `gainLUT`, `fog`, `ao`, `shading`, `sets`).
 * Writes `out.glyphIdx` (0-94), `out.fg`/`out.bg` ([r,g,b] 0-255),
 * `out.f` (fog factor) and `out.onJoint` (bench blank-share metric) in
 * place.
 */
export function shadeDetailFast(table, rec, i, gbuf, dist, light, out) {
  const shading = table.shading, cutoff = shading.cutoff, cellAspect = shading.cellAspect;

  const u = gbuf.u[i], v = gbuf.v[i], z = gbuf.z[i], aoD = gbuf.aoD[i];
  const dudx = gbuf.dudx[i], dvdx = gbuf.dvdx[i], dudy = gbuf.dudy[i], dvdy = gbuf.dvdy[i];
  const face = gbuf.face[i];

  const g = rec.grid;
  let course = 0, bix = 0, fv = 0.5, uo = u;
  if (g) {
    course = Math.floor(v / g.v);
    uo = u - ((course & 1) ? g.stagger * g.u : 0);
    bix = Math.floor(uo / g.u);
    fv = v / g.v - course;
  }
  // Owner feedback (architect 2026-09-23, "LOD distance"): a detail OCTAVE
  // per cell, so near texels stay crisp (finer than `rec.detail`) instead
  // of a fixed detail density making 2m walls look blocky, while far ones
  // stay calm (coarser) - world-anchored either way (still floor(u*ds)).
  // `tpc` = texels-per-screen-cell in the bigger of the two screen axes;
  // `oct` halves/doubles the detail density (clamped +-3/+2 octaves) so it
  // never needs `Math.pow`/`Math.log2` per cell (a 6-way compare ladder,
  // item 1).
  const tpcU = Math.abs(dudx) + Math.abs(dudy), tpcV = Math.abs(dvdx) + Math.abs(dvdy);
  const tpc = (tpcU > tpcV ? tpcU : tpcV) * rec.detail;
  let oct;
  if (tpc >= 4) oct = -3;
  else if (tpc >= 2) oct = -2;
  else if (tpc >= 1) oct = -1;
  else if (tpc >= 0.5) oct = 0;
  else if (tpc >= 0.25) oct = 1;
  else oct = 2;
  const ds = rec.detail * POW2[oct + 3];
  const tx = Math.floor(u * ds), ty = Math.floor(v * ds);
  // Tier dither (hB, below) keeps the BASE (non-octave) texel coords, so
  // the near/mid/far tier boundary does not shift with the detail octave.
  const btx = Math.floor(u * rec.detail), bty = Math.floor(v * rec.detail);
  // F1 (owner feedback "shimmer when moving", US-028a): key hA/hC on the
  // block/cell id (bix, course) when a grid exists (one alternate glyph
  // per block, not per fine texel), else on the texel one octave coarser -
  // both no longer reroll on sub-cell motion. hB stays on the base texel.
  let hA, hC;
  if (g) {
    hA = hashFast(bix, course, rec.seed);
    hC = hashFast(bix, course, rec.seed + 13);
  } else {
    const cx = Math.floor(u * ds * 0.5), cy = Math.floor(v * ds * 0.5);
    hA = hashFast(cx, cy, rec.seed);
    hC = hashFast(cx, cy, rec.seed + 13);
  }
  const hB = hashFast(btx, bty, rec.seed + 7);
  const hBlock = hashFast(bix, course, rec.seed + 3);

  // --- tone (per block), linear scan over <=4 weighted entries -----------
  let x = hBlock * rec.toneTotal, toneIdx = rec.toneW.length - 1;
  for (let t = 0; t < rec.toneW.length; t++) { x -= rec.toneW[t]; if (x < 0) { toneIdx = t; break; } }
  let cr = rec.toneRGB[toneIdx * 3], cg = rec.toneRGB[toneIdx * 3 + 1], cb = rec.toneRGB[toneIdx * 3 + 2];

  let tier = 0;
  if (rec.lod) {
    const dd = dist + (hB - 0.5) * rec.lod.dither;
    tier = dd < rec.lod.mid ? 0 : dd < rec.lod.far ? 1 : 2;
  }
  let setId = tier === 0 ? rec.face.near : tier === 1 ? rec.face.mid : rec.face.far;
  let shadeK = 1, hasTint = false, tr = 0, tg = 0, tb = 0, tintAmt = 0, bgK = rec.bgK, lineCode = -1, onJoint = false, inBand = false;

  if (g && rec.bevel && tier <= rec.bevelGate) {
    const bv = rec.bevel, yv = fv * g.v;
    if (g.v - yv < bv.top) shadeK *= bv.topShade;
    else if (yv < bv.bottom) shadeK *= bv.bottomShade;
  }
  const band = rec.band;
  if (band) {
    const bcoord = band.isU ? u : v;
    const bcx = band.isU ? dudx : dvdx, bcy = band.isU ? dudy : dvdy;
    const pos = bcoord - Math.floor(bcoord / band.period) * band.period;
    if (pos < band.width) {
      inBand = true;
      if (tier <= rec.bandGate) setId = band.setId;
      shadeK = band.shade;
      if (band.hasTone) { cr = band.toneRGB[0]; cg = band.toneRGB[1]; cb = band.toneRGB[2]; }
      if (band.hasBgK) bgK = band.bgK;
    }
    // Owner feedback item 2 applies to band edges too: widen the coverage
    // gate (2x, then 4x) instead of just dropping the edge line far away.
    const bcov = coverFast(bcx, bcy);
    let bandMult = 1;
    if (!(bcov < 0.5 * band.width)) {
      bandMult = 2;
      if (!(bcov < bandMult * 0.5 * band.width)) {
        bandMult = 4;
        if (!(bcov < bandMult * 0.5 * band.width)) bandMult = -1;
      }
    }
    if (bandMult > 0) {
      const e0 = crossLineFast(bcoord, bcx, bcy, band.period, 0), e1 = crossLineFast(bcoord, bcx, bcy, band.period, band.width);
      const ef = e0 >= 0 ? e0 : e1;
      if (ef >= 0) { lineCode = lineGlyphCodeFast(bcx, bcy, ef, cellAspect); shadeK = band.edgeShade; onJoint = true; }
    }
  }
  if (g && g.lines && !inBand && !onJoint) {
    // Owner feedback (architect 2026-09-23, "LOD distance", item 2): a
    // joint that fails its `maxCover` footprint test isn't just dropped -
    // retest at 2x the period (every 2nd course/block - doubling the
    // period IS "every 2nd line", `crossLineFast` needs no parity check),
    // then 4x, before giving up. At most 2 extra (cheap) `coverFast`
    // compares per axis; `crossLineFast` itself still runs at most once.
    const coverV = coverFast(dvdx, dvdy);
    let periodH = g.v;
    if (!(coverV < g.maxCover * periodH)) {
      periodH = g.v * 2;
      if (!(coverV < g.maxCover * periodH)) {
        periodH = g.v * 4;
        if (!(coverV < g.maxCover * periodH)) periodH = -1;
      }
    }
    const okH = periodH > 0;
    const coverU = coverFast(dudx, dudy);
    let periodV = g.u;
    if (!(coverU < g.maxCover * periodV)) {
      periodV = g.u * 2;
      if (!(coverU < g.maxCover * periodV)) {
        periodV = g.u * 4;
        if (!(coverU < g.maxCover * periodV)) periodV = -1;
      }
    }
    const okV = periodV > 0 && (!g.tie || okH);
    const fh = okH ? crossLineFast(v, dvdx, dvdy, periodH, 0) : -1;
    const fu = okV ? crossLineFast(uo, dudx, dudy, periodV, 0) : -1;
    if (fh >= 0 || fu >= 0) {
      onJoint = true;
      if (g.isGap) { setId = g.gapSetId; lineCode = -1; }
      else if (fh >= 0 && fu >= 0 && g.hasCross) lineCode = g.crossCode;
      else if (fu >= 0) lineCode = lineGlyphCodeFast(dudx, dudy, fu, cellAspect);
      else lineCode = lineGlyphCodeFast(dvdx, dvdy, fh, cellAspect);
      shadeK = g.shade;
      if (g.hasTint) { hasTint = true; tr = g.tintRGB[0]; tg = g.tintRGB[1]; tb = g.tintRGB[2]; tintAmt = g.amount; }
      if (g.hasBgK) bgK = g.bgK;
    }
  }
  const ov = rec.overlay;
  if (ov && tier <= rec.overlayGate) {
    const bf = ov.hasBand ? bandFactorNum(ov.bandFull, ov.bandZero, z) : 1;
    if (hC < (onJoint ? ov.joint : ov.face) * bf) {
      if (!onJoint) setId = ov.setId;
      const tIdx = Math.min(ov.k - 1, Math.floor(hA * ov.k));
      hasTint = true; tr = ov.tintRGB[tIdx * 3]; tg = ov.tintRGB[tIdx * 3 + 1]; tb = ov.tintRGB[tIdx * 3 + 2];
      tintAmt = ov.amount;
      shadeK *= ov.shade;
    }
  }
  if (rec.speckle && tier <= rec.speckleGate && !onJoint && !inBand && hC > 1 - rec.speckle.chance) {
    setId = rec.speckle.setId;
    shadeK *= rec.speckle.shade;
  }

  const Lm = Math.max(light[0], light[1], light[2]);
  const fk = table.faceK[face] || 1;
  let aok = 1;
  if (aoD < table.ao.r) aok = table.ao.k + (1 - table.ao.k) * smoothstepFast(0, table.ao.r, aoD);
  const jit = 1 + rec.jitter * (hA * 2 - 1);
  const b = Lm * rec.albedo * shadeK * fk * aok * jit + rec.emissive;
  const lift = shading.lift;
  const gb = b < cutoff ? 0 : lift + (1 - lift) * Math.min(b, 1);

  const fog = table.fog;
  const f = dist <= fog.start ? 0 : dist >= fog.full ? 1 : (dist - fog.start) / (fog.full - fog.start);

  let glyphCode;
  if (gb <= 0) glyphCode = 0;
  else if (lineCode >= 0) glyphCode = lineCode;
  else {
    const S = table.sets[setId];
    const classIdx = S.oriented ? orientClassCode(S.orientAxis === 0 ? dudx : dvdx, S.orientAxis === 0 ? dudy : dvdy, cellAspect) : 0;
    // Owner feedback / reference change: hashed alternates in every tier,
    // not just near (`tier === 0`) - see the oracle's matching change above.
    const code = pickGlyphCodeFast(S, gb, hA, true, classIdx, cutoff);
    glyphCode = code < 0 ? 0 : code;
  }
  if (f > fog.stipple0 && hB < smoothstepFast(fog.stipple0, fog.stipple1, f)) {
    glyphCode = f > fog.sparse ? pickCharCodeFast(fog.sparseCodes, fog.sparseAlt, 2, hA) : pickCharCodeFast(fog.hazeCodes, fog.hazeAlt, 2, hA);
  }

  if (hasTint && tintAmt > 0) {
    cr += (tr - cr) * tintAmt; cg += (tg - cg) * tintAmt; cb += (tb - cb) * tintAmt;
  }
  let hr = 1, hg = 1, hb = 1;
  if (Lm > 1e-6) { hr = light[0] / Lm; hg = light[1] / Lm; hb = light[2] / Lm; }
  const k = shading.tint, fgMin = shading.fgMin;
  const bc = b < 0 ? 0 : b;
  let gain = fgMin + (1 - fgMin) * samplePowLUT(table.gainLUT, bc);
  if (bc > 1) gain = Math.min(shading.fgMaxGain, gain + (bc - 1) * 0.5);
  let r = cr * (1 + (hr - 1) * k) * gain, gg = cg * (1 + (hg - 1) * k) * gain, bl = cb * (1 + (hb - 1) * k) * gain;
  if (bc > 1) {
    const hot = Math.min(shading.overbrightMax, (bc - 1) * shading.overbright);
    r += (255 * (0.5 + 0.5 * hr) - r) * hot; gg += (255 * (0.5 + 0.5 * hg) - gg) * hot; bl += (255 * (0.5 + 0.5 * hb) - bl) * hot;
  }
  if (r > 255) r = 255; if (gg > 255) gg = 255; if (bl > 255) bl = 255;
  let xr = r * bgK, xg = gg * bgK, xb = bl * bgK;
  if (f > 0) {
    const fogFg = fog.fgRGB, fogBg = fog.bgRGB;
    r += (fogFg[0] - r) * f; gg += (fogFg[1] - gg) * f; bl += (fogFg[2] - bl) * f;
    xr += (fogBg[0] - xr) * f; xg += (fogBg[1] - xg) * f; xb += (fogBg[2] - xb) * f;
  }

  out.glyphIdx = glyphCode;
  out.fg[0] = r; out.fg[1] = gg; out.fg[2] = bl;
  out.bg[0] = xr; out.bg[1] = xg; out.bg[2] = xb;
  out.f = f;
  out.onJoint = onJoint;
  return out;
}

/**
 * Texture-space derivatives per cell (backlog item 5), from neighbours on
 * the SAME planeId; analytic fallback otherwise. `cam` = { tanHalfHFov,
 * cols, planeDistY } (the same projection constants castSectors used this
 * frame - see GBuffer.js's `cam` scratch).
 */
export function computeDerivatives(gbuf, depth) {
  const cols = gbuf.cols, rows = gbuf.rows;
  const kind = gbuf.kind, planeId = gbuf.planeId, u = gbuf.u, v = gbuf.v;
  const dudx = gbuf.dudx, dvdx = gbuf.dvdx, dudy = gbuf.dudy, dvdy = gbuf.dvdy;
  const cam = gbuf.cam;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0) continue;
      const pid = planeId[i];

      const l = x > 0 ? i - 1 : -1, r = x < cols - 1 ? i + 1 : -1;
      const okL = l >= 0 && kind[l] !== 0 && planeId[l] === pid;
      const okR = r >= 0 && kind[r] !== 0 && planeId[r] === pid;
      if (okL && okR) { dudx[i] = (u[r] - u[l]) / 2; dvdx[i] = (v[r] - v[l]) / 2; }
      else if (okR) { dudx[i] = u[r] - u[i]; dvdx[i] = v[r] - v[i]; }
      else if (okL) { dudx[i] = u[i] - u[l]; dvdx[i] = v[i] - v[l]; }
      else { dudx[i] = depth[i] * 2 * cam.tanHalfHFov / cam.cols; dvdx[i] = 0; }

      const t = y > 0 ? i - cols : -1, b = y < rows - 1 ? i + cols : -1;
      const okT = t >= 0 && kind[t] !== 0 && planeId[t] === pid;
      const okB = b >= 0 && kind[b] !== 0 && planeId[b] === pid;
      if (okT && okB) { dudy[i] = (u[b] - u[t]) / 2; dvdy[i] = (v[b] - v[t]) / 2; }
      else if (okB) { dudy[i] = u[b] - u[i]; dvdy[i] = v[b] - v[i]; }
      else if (okT) { dudy[i] = u[i] - u[t]; dvdy[i] = v[i] - v[t]; }
      else {
        dudy[i] = 0;
        const isVertKind = kind[i] === 1 || kind[i] === 2 || kind[i] === 3;
        dvdy[i] = (isVertKind ? -1 : 1) * depth[i] / cam.planeDistY;
      }
    }
  }
}

// Reused scratch (architecture.md 9: no per-cell allocation).
const fastV2Out = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0, f: 0, onJoint: false };
const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };

// v1 interior fog (US-004b's own fast fog, duplicated here in numbers only -
// no `P.util.fogFactor` call per cell; matches `fastShade.js`'s
// `interiorFogFactor`, curve = 1 i.e. linear).
function v1FogFactor(dist, fog) {
  const f = fog.interior;
  if (dist <= f.start) return 0;
  if (dist >= f.full) return 1;
  return (dist - f.start) / (f.full - f.start);
}

/**
 * @param {object} fb - { rt, depth, palette }
 * @param {import('./GBuffer.js').GBuffer} gbuf
 * @param {ReturnType<import('./MaterialTable.js').bindShading>} table
 * @param {object|null} DP - `registry.detailPass` (ASSETS.detailPass), or
 *   null to force the v1-only path (`?detail=0`).
 * @param {number[]} light - accumulated [r,g,b], exactly as v1 (US-028
 *   scope: ambient only, `uniform:true` - US-006 replaces this with a
 *   per-cell `LightBuffer`).
 */
export function shadeSurfaces(fb, gbuf, table, DP, light) {
  const rt = fb.rt;
  // US-029: when a GPU cell pipeline owns shading this frame (`rt.gpuActive`,
  // set by GpuCellPipeline - see architecture.md 14.1 section 1/4), this CPU
  // pass is a no-op: the GPU shade pass reads the (unwritten, mask == 0)
  // G-buffer cells directly. Checked on `rt` (not a new parameter) so this
  // file's existing callers - compositor.js (US-025) in particular - need no
  // change at all.
  if (rt.gpuActive) return;
  const cols = gbuf.cols, rows = gbuf.rows;
  const depth = fb.depth.depth;
  const kind = gbuf.kind;
  const P = fb.palette;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0) continue;
      const id = gbuf.mat[i];
      const rec = id ? table.records[id] : null;
      const dist = depth[i];
      let glyphIdx, fg, bg, f, onJoint;

      if (DP && rec && rec.v2) {
        shadeDetailFast(table, rec.v2, i, gbuf, dist, light, fastV2Out);
        glyphIdx = fastV2Out.glyphIdx; fg = fastV2Out.fg; bg = fastV2Out.bg;
        f = fastV2Out.f; onJoint = fastV2Out.onJoint;
      } else {
        const key = rec ? rec.v1Key : 'stone';
        fastShade(P, key, gbuf.u[i], gbuf.v[i], dist, gbuf.z[i], fastOut);
        glyphIdx = fastOut.glyphIdx; fg = fastOut.fg; bg = fastOut.bg;
        f = v1FogFactor(dist, P.fog);
        onJoint = false;
      }

      rt.setCellRGB(x, y, glyphIdx,
        clampByte(fg[0]), clampByte(fg[1]), clampByte(fg[2]),
        clampByte(bg[0]), clampByte(bg[1]), clampByte(bg[2]));
      gbuf.fogF[i] = f;
      gbuf.onJoint[i] = onJoint ? 1 : 0;
    }
  }
}
