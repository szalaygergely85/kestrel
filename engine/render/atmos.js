// @ts-check
// ENV-03b (arch 38.65 point 2): biome atmosphere, engine side, JS twin. Pure numbers in, no design/game import, no biome names.
//   fog   -> mixAtmos + applyAtmosToPalette: ONE persistent live `P.fog.far` record + `P.liveFogVersion` bump (blendLook liveKey pattern);
//            every existing fog reader (terrain, mesh OB-089, sprites, water, compositor) follows with no code of its own.
//   haze  -> hazeSky()/applySkyHaze(): mixed into the JS sky tables (fastShadeSky = fillSky, skyLutFromPalette = water LUT).
//   grade -> gradeRGB()/applyAtmosGrade(): a per-cell colour op over the frame right after sprites (glyphs never change).
// Atmosphere never applied / off = nothing in the palette or state is read by the sky/grade paths (byte-identical frames).
// Units: colours 0..255 (grade works on 0..1 like design/preview/look-lib.js `L.grade`, Rec.709 luma).

/** Fog fit (arch 38.65): the existing curve ((t-start)/(full-start))^curve with start 0, full = fullK / density approximates 1-exp(-density*t). */
export const ATMOS_FOG_FIT = Object.freeze({ fullK: 2.5, curve: 0.55 });

/**
 * @typedef {{ fog: ArrayLike<number>, fogDensity: number, haze: ArrayLike<number>, hazeAmount: number,
 *   lift: ArrayLike<number>, gamma: ArrayLike<number>, gain: ArrayLike<number>, sat: number }} AtmosRec
 * @typedef {{ n: number, recs: AtmosRec[] }} AtmosTable   index = entry * 3 + slot (day/dusk/night)
 * @typedef {{ w: ArrayLike<number>, wNone: number, tod: ArrayLike<number>, on: boolean }} AtmosDrv
 * @typedef {{ nearRGB: ArrayLike<number>, farRGB: ArrayLike<number>, start: number, full: number, curve: number }} BaseFog
 */

/** The mutable state `mixAtmos` fills; all typed storage is allocated once here. */
export function createAtmosState() {
  return {
    on: false, version: 0,
    fogNear: new Float64Array(3), fogFar: new Float64Array(3), fogStart: 0, fogFull: 1, fogCurve: 1,
    haze: new Float64Array(3), hazeK: 0,
    lift: new Float64Array(3), invGamma: new Float64Array([1, 1, 1]), gain: new Float64Array([1, 1, 1]), sat: 1,
    gradeOn: false,                       // false = exact identity (skip the pass)
    _lut: new Int32Array(768), _luma: new Int32Array(768), _lutF: new Float64Array(768), _lutVer: -1, // byte-indexed grade tables
  };
}

/** Fill the identity grade/haze and copy the base fog (shared by wNone = 1 and the off state). */
function setIdentity(out, base) {
  out.fogNear.set(base.nearRGB); out.fogFar.set(base.farRGB);
  out.fogStart = base.start; out.fogFull = base.full; out.fogCurve = base.curve;
  out.haze[0] = out.haze[1] = out.haze[2] = 0; out.hazeK = 0;
  out.lift[0] = out.lift[1] = out.lift[2] = 0;
  out.invGamma[0] = out.invGamma[1] = out.invGamma[2] = 1;
  out.gain[0] = out.gain[1] = out.gain[2] = 1; out.sat = 1; out.gradeOn = false;
}

/**
 * Blend the driver weights x time-of-day slots of the table into `out` (no allocation). wNone x the identity (fog = baseFog).
 * Fog density mixes in 1/full space; haze colour is premultiplied by hazeAmount so a partial "none" only lowers hazeK.
 * @param {AtmosTable} table @param {AtmosDrv} drv @param {BaseFog} baseFog @param {ReturnType<typeof createAtmosState>} out
 */
export function mixAtmos(table, drv, baseFog, out) {
  out.version++;
  out.on = !!drv.on;
  const w = drv.w, tod = drv.tod, n = table.n, recs = table.recs;
  let sumW = 0;
  for (let e = 0; e < n; e++) sumW += w[e];
  if (!(sumW > 0)) { setIdentity(out, baseFog); return out; }
  const wN = drv.wNone;
  let nr = wN * baseFog.nearRGB[0], ng = wN * baseFog.nearRGB[1], nb = wN * baseFog.nearRGB[2];
  let fr = wN * baseFog.farRGB[0], fg = wN * baseFog.farRGB[1], fb = wN * baseFog.farRGB[2];
  let invFull = wN / baseFog.full, start = wN * baseFog.start, curve = wN * baseFog.curve;
  let hr = 0, hg = 0, hb = 0, hk = 0;
  let l0 = 0, l1 = 0, l2 = 0, g0 = wN, g1 = wN, g2 = wN, k0 = wN, k1 = wN, k2 = wN, sat = wN;
  for (let e = 0; e < n; e++) {
    const we = w[e];
    if (we <= 0) continue;
    for (let s = 0; s < 3; s++) {
      const ws = we * tod[s];
      if (ws <= 0) continue;
      const r = recs[e * 3 + s], f = r.fog, hz = r.haze;
      nr += ws * f[0]; ng += ws * f[1]; nb += ws * f[2];
      fr += ws * f[0]; fg += ws * f[1]; fb += ws * f[2];
      invFull += ws * r.fogDensity / ATMOS_FOG_FIT.fullK; curve += ws * ATMOS_FOG_FIT.curve;
      const ha = ws * r.hazeAmount;
      hr += ha * hz[0]; hg += ha * hz[1]; hb += ha * hz[2]; hk += ha;
      l0 += ws * r.lift[0]; l1 += ws * r.lift[1]; l2 += ws * r.lift[2];
      g0 += ws / r.gamma[0]; g1 += ws / r.gamma[1]; g2 += ws / r.gamma[2];
      k0 += ws * r.gain[0]; k1 += ws * r.gain[1]; k2 += ws * r.gain[2];
      sat += ws * r.sat;
    }
  }
  out.fogNear[0] = nr; out.fogNear[1] = ng; out.fogNear[2] = nb;
  out.fogFar[0] = fr; out.fogFar[1] = fg; out.fogFar[2] = fb;
  out.fogStart = start; out.fogFull = 1 / invFull; out.fogCurve = curve;
  if (hk > 1e-9) { out.haze[0] = hr / hk; out.haze[1] = hg / hk; out.haze[2] = hb / hk; } else { out.haze[0] = out.haze[1] = out.haze[2] = 0; }
  out.hazeK = hk;
  out.lift[0] = l0; out.lift[1] = l1; out.lift[2] = l2;
  out.invGamma[0] = g0; out.invGamma[1] = g1; out.invGamma[2] = g2;
  out.gain[0] = k0; out.gain[1] = k1; out.gain[2] = k2; out.sat = sat;
  out.gradeOn = true;
  return out;
}

/**
 * Install/restore the live far-fog record. State on (fog follows `state`) or off (never-applied palette stays untouched).
 * @param {any} P palette (rgb, hue, fog.far) @param {ReturnType<typeof createAtmosState>|null} state
 */
export function applyAtmosToPalette(P, state) {
  const fog = P.fog;
  if (!state || !state.on) {
    if (fog && fog.farBase && fog.far !== fog.farBase) { fog.far = fog.farBase; P.liveFogVersion = (P.liveFogVersion | 0) + 1; }
    P.atmosLive = null;
    return;
  }
  let live = fog.farLive;
  if (!live) {                                        // first use: keep today's record, create the ONE live record
    fog.farBase = fog.far;
    P.rgb.liveFogNear = [0, 0, 0]; P.hue.liveFogNear = [1, 1, 1];
    P.rgb.liveFogFar = [0, 0, 0]; P.hue.liveFogFar = [1, 1, 1];
    live = fog.farLive = { color: 'liveFogNear', colorFar: 'liveFogFar', start: 0, full: 1, curve: 1 };
  }
  setLive(P, 'liveFogNear', state.fogNear); setLive(P, 'liveFogFar', state.fogFar);
  live.start = state.fogStart; live.full = state.fogFull; live.curve = state.fogCurve;
  fog.far = live;
  P.atmosLive = state;
  P.liveFogVersion = (P.liveFogVersion | 0) + 1;
}
function setLive(P, key, c) {
  const rgb = P.rgb[key], h = P.hue[key];
  rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
  const mx = Math.max(c[0], c[1], c[2]) || 1;
  h[0] = c[0] / mx; h[1] = c[1] / mx; h[2] = c[2] / mx;
}

/** Consumers that cache the fog scalars (terrain shade ctx) re-read them on a `liveFogVersion` change. Returns true when refreshed. */
export function refreshFogCtx(ctx, P, seenVersion) {
  const v = P.liveFogVersion | 0;
  if (v === seenVersion) return false;
  const fr = P.fog.far, f = ctx.fog;
  f.start = fr.start; f.full = fr.full; f.curve = fr.curve; f.nearRGB = P.rgb[fr.color]; f.farRGB = P.rgb[fr.colorFar];
  return true;
}

/** Haze weight at sky LUT position t (0 horizon .. 1 elevTop): hazeK * (1-t)^2 (preview rule). */
export function hazeWeight(state, t) {
  const m = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
  return state.hazeK * m * m;
}

/** Mix the haze colour into one sky colour (0..255, in place) at LUT position t. */
export function hazeSky(state, t, rgb) {
  const k = hazeWeight(state, t);
  if (!(k > 0)) return rgb;
  const h = state.haze;
  rgb[0] += (h[0] - rgb[0]) * k; rgb[1] += (h[1] - rgb[1]) * k; rgb[2] += (h[2] - rgb[2]) * k;
  return rgb;
}

/** Bake the haze into a sky LUT (4 floats per sample, 0..255, sample i at t = i/(n-1)). No-op without haze. */
export function applySkyHaze(lut, n, state) {
  if (!state || !(state.hazeK > 0)) return lut;
  const h = state.haze;
  for (let i = 0; i < n; i++) {
    const k = hazeWeight(state, i / (n - 1)), o = i * 4;
    lut[o] += (h[0] - lut[o]) * k; lut[o + 1] += (h[1] - lut[o + 1]) * k; lut[o + 2] += (h[2] - lut[o + 2]) * k;
  }
  return lut;
}

/** The colour grade of one 0..255 colour, in place (the exact `L.grade` formula; the cell loop uses a LUT of the same maths). */
export function gradeRGB(rgb, state) {
  if (!state || !state.gradeOn) return rgb;
  const g = state.gain, lf = state.lift, ig = state.invGamma;
  let r = rgb[0] / 255, gg = rgb[1] / 255, b = rgb[2] / 255;
  r = Math.pow(Math.max(g[0] * (r + lf[0] * (1 - r)), 0), ig[0]);
  gg = Math.pow(Math.max(g[1] * (gg + lf[1] * (1 - gg)), 0), ig[1]);
  b = Math.pow(Math.max(g[2] * (b + lf[2] * (1 - b)), 0), ig[2]);
  const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b, s = state.sat;
  rgb[0] = (l + (r - l) * s) * 255; rgb[1] = (l + (gg - l) * s) * 255; rgb[2] = (l + (b - l) * s) * 255;
  return rgb;
}

function buildLut(state) {
  const F = state._lutF, lut = state._lut, L = state._luma, g = state.gain, lf = state.lift, ig = state.invGamma;
  for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) {
    const v = i / 255;
    F[c * 256 + i] = Math.pow(Math.max(g[c] * (v + lf[c] * (1 - v)), 0), ig[c]);
  }
  // fixed point x1024: out_c = sat * x_c + (1 - sat) * luma(x), both terms pre-scaled to 0..255 * 1024 (+ half step in lut)
  const sat = state.sat, k = 1 - sat, W = [0.2126, 0.7152, 0.0722];
  for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) {
    L[c * 256 + i] = Math.round(W[c] * F[c * 256 + i] * k * 255 * 1024);
    lut[c * 256 + i] = Math.round(F[c * 256 + i] * sat * 255 * 1024) + 512;
  }
  state._lutVer = state.version;
}

/**
 * JS twin of the GPU grade: grades fg.rgb and bg.rgb of every cell in place (glyph byte fg[i*4+3] untouched). Call right after the
 * sprites, before any overlay/UI cell is written. No allocation; the tables rebuild (768 pow) only when `state.version` changed.
 * @param {{cells:{cols:number,rows:number,fg:Uint8Array,bg:Uint8Array}}} rt
 */
export function applyAtmosGrade(rt, state) {
  if (!state || !state.on || !state.gradeOn) return;
  if (state._lutVer !== state.version) buildLut(state);
  const cb = rt.cells, n = cb.cols * cb.rows, lut = state._lut, L = state._luma;
  for (let p = 0; p < 2; p++) {
    const a = p === 0 ? cb.fg : cb.bg;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const ar = a[o], ag = a[o + 1], ab = a[o + 2];
      const l = L[ar] + L[256 + ag] + L[512 + ab];
      const x = (lut[ar] + l) >> 10, y = (lut[256 + ag] + l) >> 10, z = (lut[512 + ab] + l) >> 10;
      a[o] = x < 0 ? 0 : x > 255 ? 255 : x; a[o + 1] = y < 0 ? 0 : y > 255 ? 255 : y; a[o + 2] = z < 0 ? 0 : z > 255 ? 255 : z;
    }
  }
}
