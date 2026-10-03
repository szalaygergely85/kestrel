// @ts-check
// engine/render/waterLook.js - US-055a2b (docs/architecture.md 32.2 look table, 35.3 slot table): the water LOOK data the
// composite binds, resolved to numbers once (never per frame beyond a Float32Array.set per selected slot).
//
// A look (designer data, `assets.waterLooks[name]`; engine default below) is
//   { ramp: '~-=', shallow: [r,g,b], deep: [r,g,b], opaqueAt: 1.5, seeThrough: 0.35, glint: [r,g,b], waveHz: 2, bgK: 0.6 }
// Additional surface keys: cellM, glintP, drift, tintDepth, shoreW, rim, foamRamp, foamDepth, foamFar (36.1).
// colours are 0..255 bytes, `ramp` is 1..8 printable ASCII glyphs, `opaqueAt` = metres of water path at which the water is opaque,
// `seeThrough` = alpha below which the floor glyph stays visible (tinted), `waveHz` = glyph re-roll rate, `bgK` = bg = rgb * bgK.
//
// Packed row (WL_STRIDE floats, one per water slot; the SAME Float32Array feeds the JS twin and the GPU uniforms):
//   0..3 shallow.rgb, opaqueAt | 4..7 deep.rgb, seeThrough | 8..11 glint.rgb, waveHz | 12 n, 13 bgK, 14 cellM, 15 glintP
//   16..19 ramp codes 0..3 | 20..23 ramp codes 4..7   (codes = ASCII - 32, the glyphIdx units of the cell buffer)
//   US-141a (35.4) 24 streak code, 25 streakLen L, 26 streakW W, 27 streakK   (look; defaults '-', 1.0, 0.35, 0.7)
//                  28..29 fhat (unit flow dir), 30 |f| (m/s; radial: |s|), 31 o = (signed speed * t) mod (1024 L)   (per slot, f64 -> f32)
//                  32 mode (0 still, 1 linear, 2 radial), 33..34 circle centre, 35 nAng (radial angular streak count)
//   36.1: 36 ou (packed drift until fill), 37 wavePhase, 38 tintDepth, 39 shoreW; 40..43 shape (rect bounds or circle centre/radius)
//         44..46 foam codes, 47 foamN, 48..50 rim.rgb, 51 shapeKind (0 rect, 1 circle), 52 foamDepth, 53 foamFar, 54..55 reserved

import { hashFastU } from './terrainShade.js';

export const WL_STRIDE = 56;
export const WL_RAMP_MAX = 8;
/** Salt of the water glyph hash (`hashFastU(x, y, WATER_HASH_SALT + 31 * tick)`); the shade salt list gets this new one. */
export const WATER_HASH_SALT = 57;
/** Salt of the flow streak hash (`hashFastU(ia & 1023, ib & 1023, WATER_FLOW_SALT)`, 35.4). */
export const WATER_FLOW_SALT = 59;
/** Flow below this speed (m/s) is still water: the 32.2 time-bucket hash, no streaks. */
export const FLOW_MIN = 0.05;
/** Waterfall sheets later take slots 8..11 (35.3). */
export const WL_SLOTS = 12;

/** The engine default look (the designer's `assets.waterLooks.water` overrides it by name). */
export const DEFAULT_WATER_LOOK = Object.freeze({
  ramp: '~-=', shallow: [96, 176, 196], deep: [16, 56, 112], opaqueAt: 1.5, seeThrough: 0.35,
  glint: [235, 245, 255], waveHz: 2, bgK: 0.6,
  cellM: 0.25, glintP: 0.04, drift: 0.12, tintDepth: 1.2, shoreW: 0.6, rim: [200, 220, 215],
  foamRamp: '*o.', foamDepth: 0.3, foamFar: 40,
  streak: '-', streakLen: 1.0, streakW: 0.35, streakK: 0.7, // US-141a (35.4)
});

function bad(name, msg) { throw new Error(`waterLook "${name}": ${msg}`); }
function rgb3(name, key, v) {
  if (!Array.isArray(v) || v.length !== 3 || v.some((c) => typeof c !== 'number' || !(c >= 0 && c <= 255))) bad(name, `"${key}" must be [r,g,b] in 0..255`);
}

/**
 * Validates one look (throws naming it) and packs it into a fresh row. Load-time only (allocates).
 * @param {string} name @param {any} look @returns {Float32Array}
 */
export function packWaterLook(name, look) {
  const L = { ...DEFAULT_WATER_LOOK, ...(look || {}) };
  if (typeof L.ramp !== 'string' || L.ramp.length < 1 || L.ramp.length > WL_RAMP_MAX) bad(name, `"ramp" must be 1..${WL_RAMP_MAX} glyphs`);
  for (let i = 0; i < L.ramp.length; i++) { const c = L.ramp.charCodeAt(i); if (c < 33 || c > 126) bad(name, '"ramp" glyphs must be printable ASCII (no space)'); }
  rgb3(name, 'shallow', L.shallow); rgb3(name, 'deep', L.deep); rgb3(name, 'glint', L.glint);
  if (!(L.opaqueAt > 0)) bad(name, '"opaqueAt" must be > 0');
  if (!(L.seeThrough >= 0 && L.seeThrough <= 1)) bad(name, '"seeThrough" must be 0..1');
  if (!(L.waveHz >= 0)) bad(name, '"waveHz" must be >= 0');
  if (!(L.bgK >= 0 && L.bgK <= 1)) bad(name, '"bgK" must be 0..1');
  if (typeof L.streak !== 'string' || L.streak.length !== 1 || L.streak.charCodeAt(0) < 33 || L.streak.charCodeAt(0) > 126) bad(name, '"streak" must be one printable ASCII glyph (no space)');
  if (!(L.streakLen > 0)) bad(name, '"streakLen" must be > 0');
  if (!(L.streakW > 0)) bad(name, '"streakW" must be > 0');
  if (!(L.streakK >= 0 && L.streakK <= 1)) bad(name, '"streakK" must be 0..1');
  for (const key of ['cellM', 'tintDepth', 'shoreW', 'foamDepth', 'foamFar']) {
    if (typeof L[key] !== 'number' || !Number.isFinite(L[key]) || !(L[key] > 0)) bad(name, `"${key}" must be finite and > 0`);
  }
  if (typeof L.drift !== 'number' || !Number.isFinite(L.drift) || L.drift < 0) bad(name, '"drift" must be finite and >= 0');
  if (typeof L.glintP !== 'number' || !(L.glintP >= 0 && L.glintP <= 1)) bad(name, '"glintP" must be 0..1');
  rgb3(name, 'rim', L.rim);
  if (typeof L.foamRamp !== 'string' || L.foamRamp.length < 1 || L.foamRamp.length > 3) bad(name, '"foamRamp" must be 1..3 glyphs');
  for (let i = 0; i < L.foamRamp.length; i++) {
    const c = L.foamRamp.charCodeAt(i);
    if (c < 33 || c > 126) bad(name, '"foamRamp" glyphs must be printable ASCII (no space)');
  }
  const r = new Float32Array(WL_STRIDE);
  r[24] = L.streak.charCodeAt(0) - 32; r[25] = L.streakLen; r[26] = L.streakW; r[27] = L.streakK;
  r[0] = L.shallow[0]; r[1] = L.shallow[1]; r[2] = L.shallow[2]; r[3] = L.opaqueAt;
  r[4] = L.deep[0]; r[5] = L.deep[1]; r[6] = L.deep[2]; r[7] = L.seeThrough;
  r[8] = L.glint[0]; r[9] = L.glint[1]; r[10] = L.glint[2]; r[11] = L.waveHz;
  r[12] = L.ramp.length; r[13] = L.bgK; r[14] = L.cellM; r[15] = L.glintP;
  // Slot 36 starts as drift m/s; fillWaterSlotTable folds it to the live phase.
  r[36] = L.drift; r[38] = L.tintDepth; r[39] = L.shoreW;
  for (let i = 0; i < L.foamRamp.length; i++) r[44 + i] = L.foamRamp.charCodeAt(i) - 32;
  r[47] = L.foamRamp.length; r[48] = L.rim[0]; r[49] = L.rim[1]; r[50] = L.rim[2];
  r[52] = L.foamDepth; r[53] = L.foamFar;
  for (let i = 0; i < L.ramp.length; i++) r[16 + i] = L.ramp.charCodeAt(i) - 32;
  return r;
}

/**
 * @typedef {Object} WaterLooks
 * @property {Map<string, Float32Array>} byName - packed rows by look name
 * @property {Float32Array} fallback - the packed engine default (any region whose look name is not in `byName`)
 */

/** Resolves the designer table (`{name: look}`, may be absent) once. @param {Record<string, any>|null|undefined} table @returns {WaterLooks} */
export function resolveWaterLooks(table) {
  const byName = new Map();
  const names = table ? Object.keys(table) : [];
  for (const n of names) byName.set(n, packWaterLook(n, table[n]));
  return { byName, fallback: packWaterLook('(default)', null) };
}

const _defaultLooks = resolveWaterLooks(null);
export function defaultWaterLooks() { return _defaultLooks; }

/**
 * Copies the packed row of every selected slot's look into `out` (WL_SLOTS * WL_STRIDE floats). Zero allocation.
 * @param {{count:number, region:Int32Array}} sel @param {{water:any}} world @param {WaterLooks} looks @param {Float32Array} out
 */
export function fillWaterSlotTable(sel, world, looks, out, timeSec = 0) {
  const wt = world.water;
  for (let s = 0; s < sel.count; s++) {
    const ri = sel.region[s];
    const name = wt.lookNames[wt.look[ri]];
    const b = s * WL_STRIDE;
    out.set(looks.byName.get(name) || looks.fallback, b);
    // Fold both surface phases in f64 before the shared f32 upload (36.1b).
    out[b + 36] = (out[b + 36] / out[b + 14] * timeSec) % 1024;
    out[b + 37] = (timeSec * out[b + 11]) % 1024;
    // US-141a flow block (35.4): the streak offset is folded in f64 here, so the f32 side only sees a small phase.
    const period = 1024 * out[b + 25];
    const fx = wt.flow[ri * 2], fy = wt.flow[ri * 2 + 1], fr = wt.flowR[ri];
    out[b + 28] = 0; out[b + 29] = 0; out[b + 30] = 0; out[b + 31] = 0; out[b + 32] = 0; out[b + 33] = 0; out[b + 34] = 0; out[b + 35] = 0;
    if (fr !== 0 && wt.kind[ri] === 1 && Math.abs(fr) >= FLOW_MIN) { // radial wins when set (v1)
      out[b + 30] = Math.abs(fr); out[b + 31] = (fr * timeSec) % period;
      out[b + 32] = 2; out[b + 33] = wt.cx[ri]; out[b + 34] = wt.cy[ri];
      const rad = Math.sqrt(wt.r2[ri]);
      out[b + 35] = Math.max(1, Math.round(4 * rad / out[b + 26]));
    } else {
      const m = Math.sqrt(fx * fx + fy * fy);
      if (m >= FLOW_MIN) {
        out[b + 28] = fx / m; out[b + 29] = fy / m; out[b + 30] = m; out[b + 31] = (m * timeSec) % period; out[b + 32] = 1;
      }
    }
  }
}

// Rotated brick lattice, advected in surface space with staggered cell re-rolls (36.1b).
// GLSL repeats these expressions in the same order.
export function waterSurfaceHash(t, lb, px, py) {
  // Match shader float precision before discontinuous floor/hash decisions.
  const f = Math.fround, x = f(px), y = f(py), c = f(0.8776), s = f(0.4794);
  const u = f(f(f(f(x * c) + f(y * s)) / t[lb + 14]) - t[lb + 36]);
  const v = f(f(f(-x * s) + f(y * c)) / t[lb + 14]);
  const iu = Math.floor(u), iv = Math.floor(v + 0.5 * (iu & 1));
  const h0 = hashFastU(iu & 1023, iv & 1023, WATER_HASH_SALT);
  const tick = Math.floor(t[lb + 37] + (h0 & 255) / 256);
  return hashFastU(iu & 1023, iv & 1023, WATER_HASH_SALT + 31 * tick);
}

// ---- own fog (35.3 "the water itself is fogged with its own distance") ----
/** Floats in the packed fog block: 5 vec4. */
export const WFOG_LEN = 20;

/**
 * The water's fog parameters, one block shared by the JS twin and the GPU uniforms.
 *   [0..3] start, full, curve, bgScale | [4..6] fgNear | [8..10] fgFar | [12..14] bgNear | [16..18] bgFar   (rgb in 0..255)
 * With a terrain world and `palette.fog.far` it is the terrain fog (curve, bg x1.1, near -> far colour by f, as `shadeTerrain`);
 * otherwise the interior fog of the material table (linear, fg/bg fog colours). Load/bind-time and per-frame cheap; zero allocation.
 * @param {any} table - MaterialTable (`table.fog`) @param {any} palette @param {boolean} hasTerrain @param {Float32Array} out
 */
export function waterFogParams(table, palette, hasTerrain, out) {
  const far = palette && palette.fog && palette.fog.far;
  if (hasTerrain && far && palette.rgb && palette.rgb[far.color] && palette.rgb[far.colorFar]) {
    const n = palette.rgb[far.color], f = palette.rgb[far.colorFar];
    out[0] = far.start; out[1] = far.full; out[2] = far.curve || 1; out[3] = 1.1;
    for (let k = 0; k < 3; k++) { out[4 + k] = n[k]; out[8 + k] = f[k]; out[12 + k] = n[k]; out[16 + k] = f[k]; }
    return out;
  }
  const fog = table && table.fog;
  if (!fog) { out.fill(0); out[0] = 1e30; out[1] = 2e30; out[2] = 1; out[3] = 1; return out; } // no fog: f = 0 everywhere
  out[0] = fog.start; out[1] = fog.full; out[2] = 1; out[3] = 1;
  for (let k = 0; k < 3; k++) { out[4 + k] = out[8 + k] = fog.fgRGB[k]; out[12 + k] = out[16 + k] = fog.bgRGB[k]; }
  return out;
}

// ---- US-141a flow streaks (35.4): the JS half; glsl/waterComposite.frag.js repeats these expressions in the same order ----
/** Diamond angle of (dx, dy) in [0, 4) (no atan); 0 at the origin. */
export function diamondAngle(dx, dy) {
  const d = Math.abs(dx) + Math.abs(dy);
  if (d < 1e-9) return 0;
  const p = dy / d;
  return dx < 0 ? 2 - p : (dy < 0 ? 4 + p : p);
}

/**
 * Does the surface point (px, py) of a slot whose packed row starts at `lb` show a flow streak? False for still water (mode 0).
 * Streak cells are L x W metres in flow space, advected by the row's phase `o`; the key hash wraps every 1024 cells (no time bucket).
 * @param {Float32Array} t @param {number} lb @param {number} px @param {number} py
 */
export function flowStreakHit(t, lb, px, py) {
  const mode = t[lb + 32];
  if (mode === 0) return false;
  const L = t[lb + 25], W = t[lb + 26], o = t[lb + 31];
  let a, ib;
  if (mode === 1) {
    a = px * t[lb + 28] + py * t[lb + 29];
    const b = -px * t[lb + 29] + py * t[lb + 28];
    ib = Math.floor(b / W);
  } else {
    const dx = px - t[lb + 33], dy = py - t[lb + 34];
    a = Math.sqrt(dx * dx + dy * dy);
    const n = t[lb + 35];
    ib = Math.floor(diamondAngle(dx, dy) * 0.25 * n);
    if (ib > n - 1) ib = n - 1;
  }
  const ia = Math.floor((a - o) / L);
  return (hashFastU(ia & 1023, ib & 1023, WATER_FLOW_SALT) >>> 8) * (1 / 16777216) > t[lb + 27];
}
