// @ts-check
// engine/render/look.js (ART-01a, docs/architecture.md 37.18 item 2). The
// time-of-day "look" resolver + validator. A look is a `palette.timeOfDay[key]`
// record plus three OPTIONAL blocks (`hemi`/`haze`/`clouds`) the designer
// (ART-02a) adds on top of the base record; when a block is absent, `resolveLook`
// returns it as `null`, which is the exact "today's code path" signal the later
// ART steps branch on. This module imports NOTHING from design/ or game/ - the
// palette is passed in (engine rule 3) and every colour is resolved to a number
// here so hot paths (and `setLook`) never touch the palette again.
//
// `resolveLook(P, key)` is cached per (P, key) identity (a WeakMap on P, a Map
// on the key string), so repeated calls - including every `buildLightSet` and
// the future per-frame `sunFromWorld`/haze/cloud lookups - return the same
// record without re-resolving or allocating. Resolution is load-time only;
// nothing here runs per frame.
//
// Resolved shapes (all colours are fresh Float32Array(3); colour keys hold
// 0..255 bytes, `hue x I` products hold energy):
//   LookRec {
//     key: string,
//     sun: Float32Array(3),        // hue(sun) * sunI  (setLook's sunFromLook source)
//     hemi: null | { sky: F32(3) = hue(sky)*skyI, ground: F32(3) = hue(ground)*groundI,
//                    tint: F32(3) = rgb(shadowTint)/max (or [1,1,1] when shadowTint null),
//                    tintK: number = shadowK, sunFromLook: boolean, terrainTintK: number },
//     haze: null | { near: F32(3), far: F32(3), start, full, curve, max, bgK,
//                    blank, thin0, thinK, edgeMax },
//     clouds: null | { lit: F32(3), shade: F32(3), ramp: string (resolved glyph ramp),
//                    scale, bias, cover, puffK, wispCover, wispK, wind: F32(2),
//                    litK, litDy, bodyK, seed },
//   }
import { AO_DEFAULTS } from './horizonAo.js'; // S8-B2-20b (pure module, no further imports)


/**
 * @typedef {Object} ResolvedHemi
 * @property {Float32Array} sky  hue(sky) * skyI
 * @property {Float32Array} ground hue(ground) * groundI
 * @property {Float32Array} tint rgb(shadowTint) / max(rgb), or [1,1,1] when shadowTint is null
 * @property {number} tintK shadowK
 * @property {boolean} sunFromLook
 * @property {number} terrainTintK
 */

/**
 * @typedef {Object} ResolvedHaze
 * @property {Float32Array} near  0..255
 * @property {Float32Array} far   0..255
 * @property {number} start
 * @property {number} full
 * @property {number} curve
 * @property {number} max
 * @property {number} bgK
 * @property {number} blank
 * @property {number} thin0
 * @property {number} thinK
 * @property {number} edgeMax
 */

/**
 * @typedef {Object} ResolvedClouds
 * @property {Float32Array} lit    0..255
 * @property {Float32Array} shade  0..255
 * @property {string} ramp  resolved glyph ramp string (from P.ramps)
 * @property {number} scale
 * @property {number} bias
 * @property {number} cover
 * @property {number} puffK
 * @property {number} wispCover
 * @property {number} wispK
 * @property {Float32Array} wind  [x, y] deck units per second
 * @property {number} litK
 * @property {number} litDy
 * @property {number} bodyK
 * @property {number} seed
 */

/**
 * @typedef {Object} LookRec
 * @property {string} key
 * @property {Float32Array} sun  hue(sun) * sunI
 * @property {ResolvedHemi|null} hemi
 * @property {ResolvedHaze|null} haze
 * @property {ResolvedClouds|null} clouds
 */

const lookCache = new WeakMap(); // P -> Map<key, LookRec>

/** `hue[key] * I` -> fresh Float32Array(3). `hue` is rgb normalised to max channel 1. */
function hueI(P, key, I) {
  const h = P.hue[key];
  const out = new Float32Array(3);
  out[0] = h[0] * I; out[1] = h[1] * I; out[2] = h[2] * I;
  return out;
}

/** `rgb[key]` (0..255) -> fresh Float32Array(3). */
function rgb3(P, key) {
  const c = P.rgb[key];
  const out = new Float32Array(3);
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

/**
 * Resolves one look record to numbers, cached per (P, key). `key` defaults to
 * `P.defaultTime`. Returns `null` when `P`/`P.timeOfDay`/the record is absent;
 * the `hemi`/`haze`/`clouds` fields are `null` when their block is absent.
 * @param {any} P - the palette (`P.rgb`, `P.hue`, `P.timeOfDay`, `P.ramps`)
 * @param {string} [key]
 * @returns {LookRec|null}
 */
export function resolveLook(P, key = P.defaultTime) {
  if (!P || !P.timeOfDay) return null;
  const td = P.timeOfDay[key];
  if (!td) return null;
  let byKey = lookCache.get(P);
  if (!byKey) { byKey = new Map(); lookCache.set(P, byKey); }
  let rec = byKey.get(key);
  if (rec) return rec;

  rec = {
    key,
    sun: hueI(P, td.sun, td.sunI),
    hemi: null,
    haze: null,
    clouds: null,
    ao: null, // S8-B2-20b (38.16): null | {strength, radiusM, bias, maxCells}
  };

  if (td.hemi) {
    const h = td.hemi;
    rec.hemi = {
      sky: hueI(P, h.sky, h.skyI),
      ground: hueI(P, h.ground, h.groundI),
      // tint = rgb/max(rgb) == P.hue[shadowTint]; null -> identity (tintK is 0 there anyway).
      tint: h.shadowTint != null ? new Float32Array(P.hue[h.shadowTint]) : new Float32Array([1, 1, 1]),
      tintK: h.shadowK,
      sunFromLook: !!h.sunFromLook,
      terrainTintK: h.terrainTintK,
    };
  }

  if (td.haze) {
    const h = td.haze;
    rec.haze = {
      near: rgb3(P, h.near), far: rgb3(P, h.far),
      start: h.start, full: h.full, curve: h.curve, max: h.max, bgK: h.bgK,
      blank: h.blank, thin0: h.thin0, thinK: h.thinK, edgeMax: h.edgeMax,
    };
  }

  if (td.clouds) {
    const c = td.clouds;
    rec.clouds = {
      lit: rgb3(P, c.lit), shade: rgb3(P, c.shade), ramp: P.ramps[c.ramp],
      scale: c.scale, bias: c.bias, cover: c.cover, puffK: c.puffK, wispCover: c.wispCover, wispK: c.wispK,
      wind: Float32Array.from(c.wind), litK: c.litK, litDy: c.litDy, bodyK: c.bodyK, seed: c.seed,
      // S8-B2-12c (38.13): optional cloud-shadow block, null when absent (strength defaults 0, deckH 300).
      shadow: c.shadow ? {
        strength: c.shadow.strength === undefined ? 0 : c.shadow.strength, scale: c.shadow.scale, cover: c.shadow.cover,
        soft: c.shadow.soft, deckH: c.shadow.deckH === undefined ? 300 : c.shadow.deckH,
      } : null,
    };
  }

  // S8-B2-20b (38.16): optional look.ao with defaults (strength 0 = off).
  if (td.ao) {
    const D = AO_DEFAULTS, a = td.ao;
    rec.ao = {
      strength: a.strength === undefined ? D.strength : a.strength,
      radiusM: a.radiusM === undefined ? D.radiusM : a.radiusM,
      bias: a.bias === undefined ? D.bias : a.bias,
      maxCells: D.maxCells,
    };
  }

  byKey.set(key, rec);
  return rec;
}

/**
 * Validates one look record (architecture.md 37.18 item 2). Returns the list of
 * errors (empty when valid); emits warnings through `onWarn` (defaults to
 * `console.warn`) rather than the return value. Never throws.
 * @param {any} P - the palette
 * @param {string} key - the timeOfDay key to check
 * @param {(msg: string) => void} [onWarn]
 * @returns {string[]}
 */
export function validateLook(P, key, onWarn) {
  const errors = [];
  const warn = typeof onWarn === 'function' ? onWarn : (m) => console.warn(m);
  const rgb = P && P.rgb ? P.rgb : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(rgb, k);
  const path = `timeOfDay.${key}`;
  const td = P && P.timeOfDay && P.timeOfDay[key];
  if (!td) { errors.push(`${path}: missing timeOfDay record`); return errors; }

  // Base record colour keys (same coverage as palette.util.validate, so a look
  // the designer touched is checked even when no ART block is present).
  for (const f of ['ambient', 'sun', 'cloud', 'fog']) {
    if (typeof td[f] === 'string' && !has(td[f])) errors.push(`${path}.${f}: unknown color key "${td[f]}"`);
  }
  if (!Array.isArray(td.sky) || td.sky.length === 0) {
    errors.push(`${path}.sky: must be a non-empty array of {t, c} stops`);
  } else {
    for (let i = 0; i < td.sky.length; i++) {
      const s = td.sky[i];
      if (!s || !has(s.c)) errors.push(`${path}.sky[${i}].c: unknown color key "${s && s.c}"`);
    }
  }

  if (td.hemi) {
    const h = td.hemi;
    if (typeof h.sky === 'string' && !has(h.sky)) errors.push(`${path}.hemi.sky: unknown color key "${h.sky}"`);
    if (typeof h.ground === 'string' && !has(h.ground)) errors.push(`${path}.hemi.ground: unknown color key "${h.ground}"`);
    if (h.shadowTint != null && !has(h.shadowTint)) errors.push(`${path}.hemi.shadowTint: unknown color key "${h.shadowTint}"`);
    if (!(h.skyI >= 0 && h.skyI <= 2)) errors.push(`${path}.hemi.skyI: must be in [0, 2], got ${h.skyI}`);
    if (!(h.groundI >= 0 && h.groundI <= 2)) errors.push(`${path}.hemi.groundI: must be in [0, 2], got ${h.groundI}`);
    if (!(h.shadowK >= 0 && h.shadowK <= 1)) errors.push(`${path}.hemi.shadowK: must be in [0, 1], got ${h.shadowK}`);
  }

  if (td.haze) {
    const h = td.haze;
    if (!has(h.near)) errors.push(`${path}.haze.near: unknown color key "${h.near}"`);
    if (!has(h.far)) errors.push(`${path}.haze.far: unknown color key "${h.far}"`);
    if (!(h.start >= 0 && h.start < h.full)) errors.push(`${path}.haze: 0 <= start < full required (start ${h.start}, full ${h.full})`);
    if (!(h.curve > 0)) errors.push(`${path}.haze.curve: must be > 0, got ${h.curve}`);
    if (!(h.max > 0 && h.max < 1)) errors.push(`${path}.haze.max: must be in (0, 1), got ${h.max}`);
    if (!(h.bgK >= 0 && h.bgK <= 1)) errors.push(`${path}.haze.bgK: must be in [0, 1], got ${h.bgK}`);
    if (!(h.blank > 0 && h.blank <= 2)) errors.push(`${path}.haze.blank: must be in (0, 2], got ${h.blank}`);
    if (!(h.thin0 >= 0 && h.thin0 <= 1)) errors.push(`${path}.haze.thin0: must be in [0, 1], got ${h.thin0}`);
    if (!(h.thinK >= 0)) errors.push(`${path}.haze.thinK: must be >= 0, got ${h.thinK}`);
    if (!(h.edgeMax > 0 && h.edgeMax <= 1)) errors.push(`${path}.haze.edgeMax: must be in (0, 1], got ${h.edgeMax}`);
    const sky0 = td.sky && td.sky[0] && td.sky[0].c;
    if (sky0 && h.far !== sky0) warn(`${path}.haze.far ("${h.far}") !== sky[0].c ("${sky0}") - the horizon colour must equal the far haze (architecture.md 37.18)`);
  }

  if (td.ao !== undefined && td.ao !== null) {
    const a = td.ao, ap = `${path}.ao`;
    if (typeof a !== 'object') errors.push(`${ap}: must be an object, got ${JSON.stringify(a)}`);
    else {
      if (a.strength !== undefined && !(a.strength >= 0 && a.strength <= 1)) errors.push(`${ap}.strength: must be in [0, 1], got ${a.strength}`);
      if (a.radiusM !== undefined && !(a.radiusM > 0 && a.radiusM <= 5)) errors.push(`${ap}.radiusM: must be in (0, 5], got ${a.radiusM}`);
      if (a.bias !== undefined && !(a.bias >= 0 && a.bias < 1)) errors.push(`${ap}.bias: must be in [0, 1), got ${a.bias}`);
    }
  }
  if (td.clouds) {
    const c = td.clouds;
    if (!has(c.lit)) errors.push(`${path}.clouds.lit: unknown color key "${c.lit}"`);
    if (!has(c.shade)) errors.push(`${path}.clouds.shade: unknown color key "${c.shade}"`);
    if (!(c.scale > 0)) errors.push(`${path}.clouds.scale: must be > 0, got ${c.scale}`);
    if (!(c.bias > 0)) errors.push(`${path}.clouds.bias: must be > 0, got ${c.bias}`);
    if (!(c.cover >= 0 && c.cover <= 1)) errors.push(`${path}.clouds.cover: must be in [0, 1], got ${c.cover}`);
    if (!Array.isArray(c.wind) || c.wind.length !== 2 || !Number.isFinite(c.wind[0]) || !Number.isFinite(c.wind[1])) {
      errors.push(`${path}.clouds.wind: must be [x, y] with finite numbers, got ${JSON.stringify(c.wind)}`);
    }
    const ramp = P && P.ramps ? P.ramps[c.ramp] : undefined;
    if (typeof c.ramp !== 'string' || ramp === undefined) {
      errors.push(`${path}.clouds.ramp: unknown ramp key "${c.ramp}"`);
    } else {
      for (let i = 0; i < ramp.length; i++) {
        const cc = ramp.charCodeAt(i);
        if (cc < 32 || cc > 126) { errors.push(`${path}.clouds.ramp: non-printable-ASCII glyph at index ${i}`); break; }
      }
    }
    if (c.shadow !== undefined && c.shadow !== null) {
      const s = c.shadow, sp = `${path}.clouds.shadow`;
      if (typeof s !== 'object') errors.push(`${sp}: must be an object, got ${JSON.stringify(s)}`);
      else {
        if (s.strength !== undefined && !(s.strength >= 0 && s.strength <= 1)) errors.push(`${sp}.strength: must be in [0, 1], got ${s.strength}`);
        if (!(s.scale > 0)) errors.push(`${sp}.scale: must be > 0, got ${s.scale}`);
        if (!(s.cover >= 0 && s.cover <= 1)) errors.push(`${sp}.cover: must be in [0, 1], got ${s.cover}`);
        if (!(s.soft > 0)) errors.push(`${sp}.soft: must be > 0, got ${s.soft}`);
        if (s.deckH !== undefined && !(s.deckH > 0)) errors.push(`${sp}.deckH: must be > 0, got ${s.deckH}`);
      }
    }
  }

  return errors;
}

// ---- DN-01 (docs/architecture.md 38.39): live day/night look ----------------
// `blendLook(P, hour, schedule, out)` lerps the two schedule neighbours of `hour`
// into ONE reusable record `out` (same shape as `P.timeOfDay[key]`, so every
// reader that takes a timeOfDay record takes it unchanged) and publishes it as
// `P.liveLook`, bumping `P.liveLookVersion`. Colours are written as synthetic
// palette keys ('$live.ambient' ...) into P.rgb / P.hue, so readers that do
// `P.rgb[T.ambient]` or `P.rgb[stops[i].c]` need no change. Allocation-free after
// the first call for a given `out`. `P.nightFloor` (data) clamps ambientI; the
// glyph-luminance floor is exposed as `out.floorLum` for the shaders.
const LIVE_PREFIX = '$live.';
function liveKey(P, out, slot) {
  const k = LIVE_PREFIX + slot;
  if (!P.rgb[k]) { P.rgb[k] = [0, 0, 0]; P.hue[k] = [1, 1, 1]; }
  return k;
}
function setLiveColor(P, key, ra, rb, f) {
  const c = P.rgb[key], h = P.hue[key];
  c[0] = ra[0] + (rb[0] - ra[0]) * f; c[1] = ra[1] + (rb[1] - ra[1]) * f; c[2] = ra[2] + (rb[2] - ra[2]) * f;
  const mx = Math.max(c[0], c[1], c[2]) || 1;
  h[0] = c[0] / mx; h[1] = c[1] / mx; h[2] = c[2] / mx;
}

/**
 * @param {any} P palette (needs rgb, hue, timeOfDay)
 * @param {number} hour 0..24 (wraps)
 * @param {Array<{h:number,key:string}>} schedule ascending hours; wraps last -> first (+24)
 * @param {any} [out] reusable record (default: P.liveLook or a new one)
 * @returns {any} out (also P.liveLook)
 */
export function blendLook(P, hour, schedule, out) {
  const n = schedule.length;
  const h = ((hour % 24) + 24) % 24;
  // segment i = [schedule[i], schedule[i+1]); the last wraps to the first + 24.
  let i = n - 1;
  for (let k = 0; k < n; k++) { if (schedule[k].h > h) { i = k - 1; break; } }
  let h0, h1, a, b;
  if (i < 0) { i = n - 1; h0 = schedule[i].h - 24; } else h0 = schedule[i].h;
  a = schedule[i]; b = schedule[(i + 1) % n];
  h1 = (i + 1 < n) ? b.h : b.h + 24;
  const span = h1 - h0;
  const f = span > 0 ? (h - h0) / span : 0;
  const A = P.timeOfDay[a.key], B = P.timeOfDay[b.key];

  if (!out) out = P.liveLook;
  if (!out) out = {};
  if (!out.sky) {
    out.key = 'live';
    out.ambient = liveKey(P, out, 'ambient'); out.sun = liveKey(P, out, 'sun');
    out.cloud = liveKey(P, out, 'cloud'); out.fog = liveKey(P, out, 'fog');
    out.sky = [];
    for (let s = 0; s < A.sky.length; s++) out.sky.push({ t: 0, c: liveKey(P, out, 'sky' + s) });
    out.floorLum = 0;
  }
  const near = f < 0.5 ? A : B;
  out.ambientI = A.ambientI + (B.ambientI - A.ambientI) * f;
  out.sunI = A.sunI + (B.sunI - A.sunI) * f;
  out.sunElev = A.sunElev + (B.sunElev - A.sunElev) * f;
  const nf = P.nightFloor;
  if (nf) {
    if (out.ambientI < nf.ambientI) out.ambientI = nf.ambientI;
    out.floorLum = nf.lum || 0;
  }
  setLiveColor(P, out.ambient, P.rgb[A.ambient], P.rgb[B.ambient], f);
  setLiveColor(P, out.sun, P.rgb[A.sun], P.rgb[B.sun], f);
  setLiveColor(P, out.cloud, P.rgb[A.cloud], P.rgb[B.cloud], f);
  setLiveColor(P, out.fog, P.rgb[A.fog], P.rgb[B.fog], f);
  // sky stops: lerp only when both records have the same stop count (else the nearer one wins).
  const same = A.sky.length === B.sky.length && A.sky.length === out.sky.length;
  for (let s = 0; s < out.sky.length; s++) {
    const sa = same ? A.sky[s] : near.sky[Math.min(s, near.sky.length - 1)];
    const sb = same ? B.sky[s] : sa;
    out.sky[s].t = sa.t + (sb.t - sa.t) * f;
    setLiveColor(P, out.sky[s].c, P.rgb[sa.c], P.rgb[sb.c], f);
  }
  P.liveLook = out;
  P.liveLookVersion = (P.liveLookVersion | 0) + 1;
  return out;
}
