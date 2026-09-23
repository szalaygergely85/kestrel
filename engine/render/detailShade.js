// US-028 derivative + shading passes (docs/backlog.md tech notes items 5-6).
// Run once per frame, over the whole G-buffer, after every structure/terrain
// pass has written into it (`castSectors` no longer shades inline).
//
// `shadeSurfaces`' v2 path (`shadeV2` below) is a line-for-line port of the
// designer's reference `design/detail-pass.js` `util.shade` (feature flags
// removed - the engine always renders with every proposed feature on, so
// every `if (F.x)` in the reference is unconditionally true here), with
// exactly the two substitutions the tech notes call out (item 6): `level()`
// (a `Math.pow` call) becomes a small threshold-array scan, and
// `orientClass()` (an `atan2` call) becomes the same slope-compare the
// reference derives it from. First cut (calling `DP.util.shade` directly,
// reused sample/out, still allocation-free) measured 2-3 ms/frame extra at
// 160x60 - these two swaps are what the reference oracle itself flags as
// the intended fast-path optimization; everything else here is verbatim,
// so parity with the reference/preview is unaffected (only float rounding
// at threshold boundaries can differ, and only by 1 ulp - see item 4).
// `fastShade` (the existing US-004b path, unchanged) still handles every
// v1-only material (iron, grate, ash, rock) and the `?detail=0` A/B switch.

import { fastShade } from './fastShade.js';

const KIND_STR = [null, 'wall', 'step', 'upper', 'floor', 'top', 'ceil'];
const FACE_STR = [null, 'N', 'E', 'S', 'W', 'U', 'D'];

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
  const shading = DP.shading, faceShade = DP.faceShade, ao = DP.ao, fog = DP.fog;
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
  const ds = m.detail || 16, tx = Math.floor(u * ds), ty = Math.floor(v * ds);
  const hA = hash(tx, ty, m.seed), hB = hash(tx, ty, m.seed + 7), hC = hash(tx, ty, m.seed + 13);
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

  if (g && m.face.bevel && tier < 2) {
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
      if (tier < 2) set = band.set;
      shadeK = band.shade;
      if (band.tone) { const bt = rgb[band.tone]; cr = bt[0]; cg = bt[1]; cb = bt[2]; }
      if (band.bgK) bgK = band.bgK;
    }
    if (coverFast(bcx, bcy) < 0.5 * band.width) {
      const e0 = crossLine(bcoord, bcx, bcy, band.period, 0), e1 = crossLine(bcoord, bcx, bcy, band.period, band.width);
      const ef = e0 >= 0 ? e0 : e1;
      if (ef >= 0) { lineG = lineGlyph(bcx, bcy, ef); shadeK = band.edgeShade || 0.5; onJoint = true; }
    }
  }
  if (g && g.lines !== false && !inBand && !onJoint) {
    const okH = coverFast(s.dvdx, s.dvdy) < g.maxCover * g.v;
    const okV = coverFast(s.dudx, s.dudy) < g.maxCover * g.u && (!g.tie || okH);
    const fh = okH ? crossLine(v, s.dvdx, s.dvdy, g.v, 0) : -1;
    const fu = okV ? crossLine(uo, s.dudx, s.dudy, g.u, 0) : -1;
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
  if (ov && tier < 2) {
    const bf = ov.band ? bandFactorFast(ov.band, s.z) : 1;
    if (hC < (onJoint ? ov.joint : ov.face) * bf) {
      if (!onJoint) set = ov.set;
      tint = ov.tints[Math.min(ov.tints.length - 1, Math.floor(hA * ov.tints.length))];
      tintAmt = ov.amount;
      shadeK *= ov.shade;
    }
  }
  if (m.speckle && tier === 0 && !onJoint && !inBand && hC > 1 - m.speckle.chance) {
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
  else glyph = setGlyphFast(DP.sets[set], gb, hA, tier === 0, s, cellAspect, cutoff, gamma);
  if (f > fog.stipple[0] && hB < smoothstepFast(fog.stipple[0], fog.stipple[1], f)) {
    glyph = pickChar(DP.sets[fog.set][f > 0.8 ? 0 : 1], hA);
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
const sample = {
  kind: 'wall', mat: 'stone', normal: 'N', planeId: 0,
  u: 0, v: 0, dudx: 0, dvdx: 0, dudy: 0, dvdy: 0, z: 0, aoD: Infinity, dist: 0,
};
const shadeOut = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };

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
  const cols = gbuf.cols, rows = gbuf.rows;
  const depth = fb.depth.depth;
  const kind = gbuf.kind;
  const P = fb.palette;
  const rgb = P.rgb;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0) continue;
      const id = gbuf.mat[i];
      const rec = id ? table.records[id] : null;
      const dist = depth[i];
      let glyphIdx, fg, bg, f;

      if (DP && rec && rec.v2Key) {
        sample.kind = KIND_STR[kind[i]];
        sample.mat = rec.v2Key;
        sample.normal = FACE_STR[gbuf.face[i]];
        sample.planeId = gbuf.planeId[i];
        sample.u = gbuf.u[i]; sample.v = gbuf.v[i];
        sample.dudx = gbuf.dudx[i]; sample.dvdx = gbuf.dvdx[i];
        sample.dudy = gbuf.dudy[i]; sample.dvdy = gbuf.dvdy[i];
        sample.z = gbuf.z[i]; sample.aoD = gbuf.aoD[i]; sample.dist = dist;
        const m = DP.materials[rec.v2Key];
        shadeV2(DP, rgb, m, sample, light, shadeOut);
        const code = shadeOut.glyph.charCodeAt(0);
        glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
        fg = shadeOut.fg; bg = shadeOut.bg; f = shadeOut.f;
      } else {
        const key = rec ? rec.v1Key : 'stone';
        fastShade(P, key, gbuf.u[i], gbuf.v[i], dist, gbuf.z[i], fastOut);
        glyphIdx = fastOut.glyphIdx; fg = fastOut.fg; bg = fastOut.bg;
        f = P.util.fogFactor(dist, 'interior');
      }

      rt.setCellRGB(x, y, glyphIdx,
        clampByte(fg[0]), clampByte(fg[1]), clampByte(fg[2]),
        clampByte(bg[0]), clampByte(bg[1]), clampByte(bg[2]));
      gbuf.fogF[i] = f;
    }
  }
}
