// @ts-check
// engine/render/waterLook.js - US-055a2b (docs/architecture.md 32.2 look table, 35.3 slot table): the water LOOK data the
// composite binds, resolved to numbers once (never per frame beyond a Float32Array.set per selected slot).
//
// A look (designer data, `assets.waterLooks[name]`; engine default below) is
//   { ramp: '~-=', shallow: [r,g,b], deep: [r,g,b], opaqueAt: 1.5, seeThrough: 0.35, glint: [r,g,b], waveHz: 2, bgK: 0.6 }
// colours are 0..255 bytes, `ramp` is 1..8 printable ASCII glyphs, `opaqueAt` = metres of water path at which the water is opaque,
// `seeThrough` = alpha below which the floor glyph stays visible (tinted), `waveHz` = glyph re-roll rate, `bgK` = bg = rgb * bgK.
//
// Packed row (WL_STRIDE floats, one per water slot; the SAME Float32Array feeds the JS twin and the GPU uniforms):
//   0..3 shallow.rgb, opaqueAt | 4..7 deep.rgb, seeThrough | 8..11 glint.rgb, waveHz | 12 n, 13 bgK, 14..15 unused
//   16..19 ramp codes 0..3 | 20..23 ramp codes 4..7   (codes = ASCII - 32, the glyphIdx units of the cell buffer)

export const WL_STRIDE = 24;
export const WL_RAMP_MAX = 8;
/** Salt of the water glyph hash (`hashFastU(x, y, WATER_HASH_SALT + 31 * tick)`); the shade salt list gets this new one. */
export const WATER_HASH_SALT = 57;
/** Waterfall sheets later take slots 8..11 (35.3). */
export const WL_SLOTS = 12;

/** The engine default look (the designer's `assets.waterLooks.water` overrides it by name). */
export const DEFAULT_WATER_LOOK = Object.freeze({
  ramp: '~-=', shallow: [96, 176, 196], deep: [16, 56, 112], opaqueAt: 1.5, seeThrough: 0.35,
  glint: [235, 245, 255], waveHz: 2, bgK: 0.6,
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
  const r = new Float32Array(WL_STRIDE);
  r[0] = L.shallow[0]; r[1] = L.shallow[1]; r[2] = L.shallow[2]; r[3] = L.opaqueAt;
  r[4] = L.deep[0]; r[5] = L.deep[1]; r[6] = L.deep[2]; r[7] = L.seeThrough;
  r[8] = L.glint[0]; r[9] = L.glint[1]; r[10] = L.glint[2]; r[11] = L.waveHz;
  r[12] = L.ramp.length; r[13] = L.bgK;
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
export function fillWaterSlotTable(sel, world, looks, out) {
  const wt = world.water;
  for (let s = 0; s < sel.count; s++) {
    const name = wt.lookNames[wt.look[sel.region[s]]];
    out.set(looks.byName.get(name) || looks.fallback, s * WL_STRIDE);
  }
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
