// ENV-03b (docs/architecture.md 38.65): biome atmosphere engine math, JS twin. Pure numbers, no design/ import, no biome names.
// Fog -> the existing terrain far-fog record (palette.fog.far, swapped for ONE persistent live record);
// haze -> sky gradient (fastShadeSky / skyLutFromPalette); grade -> per-cell colour op after the sprite composite (gradeCells).
// The WGSL twin of the grade (ENV-03c) is generated from the same constants (ATMOS_GRADE_WGSL).

/** Fog fit: existing shape ((t - 0) / (full - 0))^curve with full = fullK / density, within 0.09 of 1 - exp(-d t) for d t in [0, 3]. */
export const ATMOS_FOG_FIT = { fullK: 2.5, curve: 0.55 };
export const ATMOS_LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709, = look-lib.js L.grade
const LIVE_NEAR = 'liveFogNear', LIVE_FAR = 'liveFogFar';

/** Max |fit - (1 - exp(-d t))| over d t in [0, 3] (test helper). */
export function atmosFogFitError(samples = 3000) {
  let m = 0;
  for (let i = 0; i <= samples; i++) {
    const dt = 3 * i / samples, x = Math.min(1, dt / ATMOS_FOG_FIT.fullK);
    const e = Math.abs(Math.pow(x, ATMOS_FOG_FIT.curve) - (1 - Math.exp(-dt)));
    if (e > m) m = e;
  }
  return m;
}

/** @typedef {{fog:Float32Array,fogDensity:number,haze:Float32Array,hazeAmount:number,lift:Float32Array,gamma:Float32Array,gain:Float32Array,sat:number}} AtmosRec */

/** Preallocated state the engine reads. `on` false = the feature is invisible everywhere. */
export function createAtmosState() {
  return {
    on: false, version: 0,
    fogNear: new Float32Array(3), fogFar: new Float32Array(3), wNone: 1, farSkyW: 0, fogStart: 0, fogFull: 1, fogCurve: 1,
    haze: new Float32Array(3), hazeK: 0,
    lift: new Float32Array(3), invGamma: new Float32Array([1, 1, 1]), gain: new Float32Array([1, 1, 1]), sat: 1,
    gradeId: true,      // grade is exactly the identity (skipped)
    gradeStamp: 0,      // bumps when lift/gamma/gain/sat changed (LUT rebuild key)
    _lut: null, _lutStamp: -1,
    _farBase: null, _applied: false, _live: null,
  };
}

/**
 * Mix the biome records by the driver weights into `out`. table = { n, recs[n*3] } (index e*3 + slot);
 * drv = { w: F32(n), wNone, tod: F32(3), version } or null/undefined (-> off);
 * baseFog = the unmodified palette far-fog { start, full, curve, near: rgb, far: rgb } (identity side).
 * All w = 0 (wNone = 1) gives bit-exact base fog and an identity grade. 0 alloc.
 */
export function mixAtmos(table, drv, baseFog, out) {
  if (!drv) { out.on = false; return out; }
  const n = table.n, w = drv.w, tod = drv.tod, wN = drv.wNone;
  const bn = baseFog.near, bf = baseFog.far;
  let fr = 0, fg = 0, fb = 0, dens = 0;
  let hr = 0, hg = 0, hb = 0, hk = 0;
  let lr = 0, lg = 0, lb = 0, gr = 0, gg = 0, gb = 0, ar = 0, ag = 0, ab = 0, sat = 0, any = 0;
  for (let e = 0; e < n; e++) {
    const we = w[e];
    if (we === 0) continue;
    any += we;
    for (let s = 0; s < 3; s++) {
      const ws = we * tod[s];
      if (ws === 0) continue;
      const r = table.recs[e * 3 + s];
      fr += ws * r.fog[0]; fg += ws * r.fog[1]; fb += ws * r.fog[2]; dens += ws * r.fogDensity;
      hr += ws * r.haze[0]; hg += ws * r.haze[1]; hb += ws * r.haze[2]; hk += ws * r.hazeAmount;
      lr += ws * r.lift[0]; lg += ws * r.lift[1]; lb += ws * r.lift[2];
      gr += ws * r.gamma[0]; gg += ws * r.gamma[1]; gb += ws * r.gamma[2];
      ar += ws * r.gain[0]; ag += ws * r.gain[1]; ab += ws * r.gain[2];
      sat += ws * r.sat;
    }
  }
  if (any === 0) { // identity side only: copy the base exactly (no 1/(1/x) rounding)
    out.fogNear.set(bn); out.fogFar.set(bf); out.fogStart = baseFog.start; out.fogFull = baseFog.full; out.fogCurve = baseFog.curve || 1;
    out.haze.fill(0); out.hazeK = 0;
    setGrade(out, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1);
  } else {
    out.fogNear[0] = fr + wN * bn[0]; out.fogNear[1] = fg + wN * bn[1]; out.fogNear[2] = fb + wN * bn[2];
    out.fogFar[0] = fr + wN * bf[0]; out.fogFar[1] = fg + wN * bf[1]; out.fogFar[2] = fb + wN * bf[2];
    out.fogStart = wN * baseFog.start; // entries start at 0
    out.fogCurve = wN * (baseFog.curve || 1) + any * ATMOS_FOG_FIT.curve;
    const invFull = (wN > 0 ? wN / baseFog.full : 0) + dens / ATMOS_FOG_FIT.fullK; // fog density blends in 1/full space
    out.fogFull = invFull > 0 ? 1 / invFull : baseFog.full;
    out.haze[0] = hr; out.haze[1] = hg; out.haze[2] = hb; out.hazeK = hk;
    setGrade(out, lr, lg, lb, wN + gr, wN + gg, wN + gb, wN + ar, wN + ag, wN + ab, wN + sat);
  }
  out.wNone = any === 0 ? 1 : wN; // OB-209: biome share for the far-fog -> sky-horizon rule (applyAtmosToPalette)
  out.on = true; out.version = drv.version;
  return out;
}

// gm* are the blended gamma values (identity side contributes 1); stores invGamma and the identity flag.
function setGrade(o, lr, lg, lb, gmR, gmG, gmB, gnR, gnG, gnB, sat) {
  const ir = 1 / gmR, ig = 1 / gmG, ib = 1 / gmB;
  const id = lr === 0 && lg === 0 && lb === 0 && ir === 1 && ig === 1 && ib === 1 && gnR === 1 && gnG === 1 && gnB === 1 && sat === 1;
  if (id !== o.gradeId || o.lift[0] !== lr || o.lift[1] !== lg || o.lift[2] !== lb || o.invGamma[0] !== ir || o.invGamma[1] !== ig || o.invGamma[2] !== ib ||
    o.gain[0] !== gnR || o.gain[1] !== gnG || o.gain[2] !== gnB || o.sat !== sat) o.gradeStamp++;
  o.gradeId = id;
  o.lift[0] = lr; o.lift[1] = lg; o.lift[2] = lb; o.invGamma[0] = ir; o.invGamma[1] = ig; o.invGamma[2] = ib;
  o.gain[0] = gnR; o.gain[1] = gnG; o.gain[2] = gnB; o.sat = sat;
}

/**
 * Palette side: keeps P.fog.farBase = P.fog.far and installs ONE persistent live record whose colours live in two synthetic
 * P.rgb/P.hue keys (written in place). Each call bumps P.liveFogVersion; state.on false restores the base (one bump). Also
 * publishes P.atmos = state for the sky haze readers. Never called = palette untouched.
 */
export function applyAtmosToPalette(P, state) {
  if (!state.on) {
    if (state._applied) { P.fog.far = state._farBase; P.atmos = null; state._applied = false; P.liveFogVersion = (P.liveFogVersion | 0) + 1; }
    return;
  }
  if (!state._applied) {
    if (!state._live) state._live = { color: LIVE_NEAR, colorFar: LIVE_FAR, start: 0, full: 1, curve: 1 };
    if (!P.rgb[LIVE_NEAR]) { P.rgb[LIVE_NEAR] = [0, 0, 0]; P.hue[LIVE_NEAR] = [1, 1, 1]; P.rgb[LIVE_FAR] = [0, 0, 0]; P.hue[LIVE_FAR] = [1, 1, 1]; }
    state._farBase = P.fog.far; P.fog.farBase = P.fog.far; state._applied = true;
  }
  const L = state._live;
  L.start = state.fogStart; L.full = state.fogFull; L.curve = state.fogCurve;
  setLive(P, LIVE_NEAR, state.fogNear);
  // OB-209 (far silhouette): the far end of the biome fog converges to the SKY HORIZON colour the sky pass draws (look sky
  // stop t = 0 + this state's haze at t = 0), so fully fogged far hills melt into the sky instead of a pale/green cut-out.
  // Weighted by the biome share (1 - wNone): wNone 1 keeps the base far colour (fogHour) byte-identical.
  const fw = 1 - (state.wNone >= 0 ? state.wNone : 0), ff = state.fogFar;
  // VISQA-02: farSkyW = that share; the shade passes add farSkyW * (sky(elev) - sky(0)) per cell (fogShape.js farSkyShiftJS / WGSL
  // farSkyShift), so a far ridge high above the horizon fogs to the sky at ITS elevation, not one flat horizon cream.
  state.farSkyW = 0;
  if (fw > 0 && skyHorizonRGB(P, state, HZ)) { HZ[0] = ff[0] + (HZ[0] - ff[0]) * fw; HZ[1] = ff[1] + (HZ[1] - ff[1]) * fw; HZ[2] = ff[2] + (HZ[2] - ff[2]) * fw; setLive(P, LIVE_FAR, HZ); state.farSkyW = fw; }
  else setLive(P, LIVE_FAR, ff);
  P.fog.far = L; P.atmos = state;
  P.liveFogVersion = (P.liveFogVersion | 0) + 1;
}
const HZ = new Float64Array(3);
/**
 * OB-209: the sky's horizon colour (t = 0 of the live look's sky gradient, then the atmos haze at t = 0 - the same value
 * skyLutFromPalette / the sky pass bake at the horizon). Writes rgb 0..255 into out; false when the palette has no sky look.
 */
export function skyHorizonRGB(P, state, out) {
  const T = P && P.timeOfDay ? (P.liveLook || P.timeOfDay[P.defaultTime]) : null, st = T && T.sky, c = st && st.length && P.rgb[st[0].c];
  if (!c) return false;
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  if (state) hazeRGB(out, 0, state);
  return true;
}
function setLive(P, key, c) {
  const rgb = P.rgb[key], hue = P.hue[key];
  rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
  const mx = Math.max(c[0], c[1], c[2]) || 1;
  hue[0] = c[0] / mx; hue[1] = c[1] / mx; hue[2] = c[2] / mx;
}

/** Horizon haze on one colour: t = 0 horizon .. 1 elevTop; c = mix(c, haze, hazeK * (1 - t)^2). In place; no-op when off. */
export function hazeRGB(c, t, state) {
  if (!state.on || !(state.hazeK > 0)) return;
  const u = 1 - (t < 0 ? 0 : t > 1 ? 1 : t), k = state.hazeK * u * u, h = state.haze;
  c[0] += (h[0] - c[0]) * k; c[1] += (h[1] - c[1]) * k; c[2] += (h[2] - c[2]) * k;
}
/** Sky LUT haze (n samples, t = i/(n-1), `stride` floats per sample). No-op when off / hazeK 0. */
export function applySkyHaze(lut, n, state, stride = 4) {
  if (!state || !state.on || !(state.hazeK > 0)) return;
  const h = state.haze;
  for (let i = 0; i < n; i++) {
    const u = 1 - i / (n - 1), k = state.hazeK * u * u, o = i * stride;
    lut[o] += (h[0] - lut[o]) * k; lut[o + 1] += (h[1] - lut[o + 1]) * k; lut[o + 2] += (h[2] - lut[o + 2]) * k;
  }
}

/** Grade one colour in place, rgb 0..255 (float out, unrounded). Twin of look-lib.js L.grade (c 0..1). */
export function gradeRGB(rgb, state) {
  if (state.gradeId) return rgb;
  const l = state.lift, g = state.gain, ig = state.invGamma;
  let r = rgb[0] / 255, gg = rgb[1] / 255, b = rgb[2] / 255;
  r = g[0] * (r + l[0] * (1 - r)); gg = g[1] * (gg + l[1] * (1 - gg)); b = g[2] * (b + l[2] * (1 - b));
  r = Math.pow(r > 0 ? r : 0, ig[0]); gg = Math.pow(gg > 0 ? gg : 0, ig[1]); b = Math.pow(b > 0 ? b : 0, ig[2]);
  const y = ATMOS_LUMA[0] * r + ATMOS_LUMA[1] * gg + ATMOS_LUMA[2] * b, s = state.sat;
  rgb[0] = (y + (r - y) * s) * 255; rgb[1] = (y + (gg - y) * s) * 255; rgb[2] = (y + (b - y) * s) * 255;
  return rgb;
}

/** Grade every cell in place; `rt` is a RenderTarget (has .cells, like applySceneDim) or a bare CellBuffer ({ fg, bg }, RGBA bytes, 4/cell); glyphs never change. LUT per channel + sat per cell. */
export function gradeCells(rt, state) {
  if (!state.on || state.gradeId) return;
  const cb = rt.cells || rt; // ENV-GATEFIX: real RenderTarget keeps fg/bg in .cells
  let lut = state._lut;
  if (!lut) lut = state._lut = new Float32Array(768);
  if (state._lutStamp !== state.gradeStamp) {
    state._lutStamp = state.gradeStamp;
    for (let c = 0; c < 3; c++) {
      const l = state.lift[c], g = state.gain[c], ig = state.invGamma[c];
      for (let i = 0; i < 256; i++) { const x = i / 255, v = g * (x + l * (1 - x)); lut[c * 256 + i] = Math.pow(v > 0 ? v : 0, ig); }
    }
  }
  const s = state.sat, a = ATMOS_LUMA[0], b = ATMOS_LUMA[1], d = ATMOS_LUMA[2];
  for (let pass = 0; pass < 2; pass++) {
    const buf = pass ? cb.bg : cb.fg;
    for (let i = 0; i < buf.length; i += 4) {
      const r = lut[buf[i]], g = lut[256 + buf[i + 1]], bl = lut[512 + buf[i + 2]];
      const y = a * r + b * g + d * bl;
      let o = (y + (r - y) * s) * 255 + 0.5; buf[i] = o < 0 ? 0 : o > 255 ? 255 : o;
      o = (y + (g - y) * s) * 255 + 0.5; buf[i + 1] = o < 0 ? 0 : o > 255 ? 255 : o;
      o = (y + (bl - y) * s) * 255 + 0.5; buf[i + 2] = o < 0 ? 0 : o > 255 ? 255 : o;
    }
  }
}

/**
 * WGSL twin of gradeRGB (0..1), generated from ATMOS_LUMA. Per-channel scalar helper + vec3 wrapper (scalar form so the Node probe
 * can evaluate it). Uniform words live at the END of SpritesU (sprites.wgsl.js): atmosLift.xyz + on, atmosInvGamma.xyz + sat, atmosGain.xyz.
 */
export const ATMOS_GRADE_WGSL = `fn atmosGradeCh(x: f32, l: f32, ig: f32, g: f32) -> f32 {
  return pow(max(g * (x + l * (1.0 - x)), 0.0), ig);
}
fn atmosGrade(c: vec3f, lift: vec3f, invGamma: vec3f, gain: vec3f, sat: f32) -> vec3f {
  let r = atmosGradeCh(c.x, lift.x, invGamma.x, gain.x);
  let g = atmosGradeCh(c.y, lift.y, invGamma.y, gain.y);
  let b = atmosGradeCh(c.z, lift.z, invGamma.z, gain.z);
  let y = ${ATMOS_LUMA[0]} * r + ${ATMOS_LUMA[1]} * g + ${ATMOS_LUMA[2]} * b;
  return vec3f(y + (r - y) * sat, y + (g - y) * sat, y + (b - y) * sat);
}
`;
