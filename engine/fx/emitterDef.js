// engine/fx/emitterDef.js (US-053a, docs/architecture.md 32.1).
//
// Load-time compile of an EmitterDef (plain JSON-able content) into the flat
// numbers the sim reads. This file may allocate and may use Math.tan (it is
// NOT in the check-deps rule 15 scope); particles.js never allocates in step.
import { STEP } from '../core/loop.js';
import { DEG2RAD } from '../core/transform.js';

export const MAX_RAMP = 16;
export const HZ = Math.round(1 / STEP); // rate accumulator unit: rate is added once per step, one spawn per HZ

// Record layout (Float64, DEF_STRIDE per def).
export const D = {
  RATE: 0, LIFE_MIN: 1, LIFE_MAX: 2, SPEED_MIN: 3, SPEED_MAX: 4,
  DIR_X: 5, DIR_Y: 6, DIR_Z: 7, SPREAD_TAN: 8,
  A_X: 9, A_Y: 10, A_Z: 11, B_X: 12, B_Y: 13, B_Z: 14,
  BOX_X: 15, BOX_Y: 16, BOX_Z: 17,
  ACCEL_Z: 18, DRAG_K: 19, WIND: 20, MAX_LIVE: 21, KILL_BELOW: 22, BURST: 23,
  EMISSIVE: 24, EMISSIVE_FOG: 25, RAMP_LEN: 26,
  SIZE_M: 27, // world diameter of one particle in metres (0 = one cell); read by render/particleLayer.js
};
export const DEF_STRIDE = 28;

/** Orthonormal basis (a, b) of the unit axis (dx,dy,dz), written to out[o..o+5]. No trig. */
export function basisInto(dx, dy, dz, out, o) {
  // helper = x axis unless the axis is nearly parallel to it
  let hx = 1, hy = 0, hz = 0;
  if (Math.abs(dx) > 0.9) { hx = 0; hy = 1; }
  // a = normalize(axis x helper)
  let ax = dy * hz - dz * hy, ay = dz * hx - dx * hz, az = dx * hy - dy * hx;
  const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  ax /= al; ay /= al; az /= al;
  // b = axis x a
  out[o] = ax; out[o + 1] = ay; out[o + 2] = az;
  out[o + 3] = dy * az - dz * ay; out[o + 4] = dz * ax - dx * az; out[o + 5] = dx * ay - dy * ax;
}

function fail(key, prop, msg) {
  throw new Error(`defineEmitter("${key}"): "${prop}" ${msg}`);
}
function num(key, def, prop, dflt, min, max) {
  const v = def[prop] === undefined ? dflt : def[prop];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(key, prop, 'must be a finite number');
  if (min !== undefined && v < min) fail(key, prop, `must be >= ${min}`);
  if (max !== undefined && v > max) fail(key, prop, `must be <= ${max}`);
  return v;
}
function pair(key, def, prop, min) {
  const v = def[prop];
  if (!Array.isArray(v) || v.length !== 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) fail(key, prop, 'must be [min, max] numbers');
  if (v[0] < min) fail(key, prop, `min must be >= ${min}`);
  if (v[1] < v[0]) fail(key, prop, 'max must be >= min');
  return v;
}
function vec3(key, def, prop, dflt) {
  const v = def[prop] === undefined ? dflt : def[prop];
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) fail(key, prop, 'must be [x, y, z] numbers');
  return v;
}

/**
 * Validates + compiles one EmitterDef. Throws naming the def key and property.
 * @returns {{rec:Float64Array, glyphs:Uint16Array, colors:Uint8Array, len:number}}
 */
export function compileEmitterDef(key, def) {
  if (!def || typeof def !== 'object') throw new Error(`defineEmitter("${key}"): def must be an object`);
  const rec = new Float64Array(DEF_STRIDE);
  rec[D.RATE] = num(key, def, 'rate', 0, 0);
  rec[D.BURST] = Math.floor(num(key, def, 'burst', 0, 0));
  const life = pair(key, def, 'life', 0);
  rec[D.LIFE_MIN] = Math.max(1, Math.round(life[0] / STEP));
  rec[D.LIFE_MAX] = Math.max(rec[D.LIFE_MIN], Math.round(life[1] / STEP));
  const speed = pair(key, def, 'speed', 0);
  rec[D.SPEED_MIN] = speed[0]; rec[D.SPEED_MAX] = speed[1];
  const dir = vec3(key, def, 'dir', [0, 0, 1]);
  const dl = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  if (!(dl > 0)) fail(key, 'dir', 'must be non-zero');
  rec[D.DIR_X] = dir[0] / dl; rec[D.DIR_Y] = dir[1] / dl; rec[D.DIR_Z] = dir[2] / dl;
  const spreadDeg = num(key, def, 'spreadDeg', 0, 0, 88.999);
  rec[D.SPREAD_TAN] = Math.tan(spreadDeg * DEG2RAD);
  const ab = new Float64Array(6);
  basisInto(rec[D.DIR_X], rec[D.DIR_Y], rec[D.DIR_Z], ab, 0);
  for (let i = 0; i < 6; i++) rec[D.A_X + i] = ab[i];
  const box = vec3(key, def, 'box', [0, 0, 0]);
  if (box.some((b) => b < 0)) fail(key, 'box', 'half-extents must be >= 0');
  rec[D.BOX_X] = box[0]; rec[D.BOX_Y] = box[1]; rec[D.BOX_Z] = box[2];
  rec[D.ACCEL_Z] = num(key, def, 'accelZ', 0);
  rec[D.DRAG_K] = Math.min(1, num(key, def, 'drag', 0, 0) * STEP);
  rec[D.WIND] = num(key, def, 'wind', 0, 0, 1);
  rec[D.MAX_LIVE] = Math.floor(num(key, def, 'maxLive', 64, 1));
  rec[D.KILL_BELOW] = def.killBelow === undefined || def.killBelow === null ? NaN : num(key, def, 'killBelow', 0, 0);
  rec[D.EMISSIVE] = def.emissive ? 1 : 0;
  rec[D.EMISSIVE_FOG] = num(key, def, 'emissiveFog', 0, 0, 1);
  rec[D.SIZE_M] = num(key, def, 'sizeM', 0, 0, 1);

  if (typeof def.glyphs !== 'string' || def.glyphs.length < 1) fail(key, 'glyphs', 'must be a non-empty string');
  const cps = Array.from(def.glyphs);
  if (cps.length > MAX_RAMP) fail(key, 'glyphs', `ramp longer than ${MAX_RAMP}`);
  if (!Array.isArray(def.colors) || def.colors.length < 1) fail(key, 'colors', 'must be a non-empty array of [r,g,b]');
  if (def.colors.length > MAX_RAMP) fail(key, 'colors', `ramp longer than ${MAX_RAMP}`);
  const len = Math.max(cps.length, def.colors.length);
  rec[D.RAMP_LEN] = len;
  const glyphs = new Uint16Array(len);
  const colors = new Uint8Array(len * 3);
  // Both ramps are stretched to `len` steps (nearest-earlier index; stepped, no lerp).
  for (let i = 0; i < len; i++) {
    const g = cps[Math.floor(i * cps.length / len)];
    const code = g.codePointAt(0);
    if (code > 0xffff) fail(key, 'glyphs', 'glyph outside the BMP');
    glyphs[i] = code;
    const c = def.colors[Math.floor(i * def.colors.length / len)];
    if (!Array.isArray(c) || c.length < 3 || !c.every((x, j) => j > 2 || (Number.isFinite(x) && x >= 0 && x <= 255))) {
      fail(key, 'colors', 'entries must be [r,g,b] bytes 0..255');
    }
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  return { rec, glyphs, colors, len };
}
