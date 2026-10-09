// @ts-check
// engine/mesh/sway.js - S8-B2-06: foliage sway. Instances flagged INST_FLAG_SWAY (instance flags word 13, bit 1) have their vertices move by
//   d = wind(instance base x, y, t) * (h^2 * SWAY_K),  h = height above the instance base (trunk base fixed),
// the horizontal vector length capped at SWAY_MAX. The wind is the WORLD wind (engine/world/wind.js `createWind` field, base vector without zones;
// ground axes x east / y south, z up). It is sampled once per instance (coherent crown, no per-vertex trig). Zero wind speed = no displacement,
// bit-identical to before. WGSL twin: `SWAY_WGSL` (raster.wgsl.js) over `WIND_AT_WGSL` (common.wgsl.js).
// The cull and shadow-cull bounds must grow by SWAY_MAX while sway is on (compactGroup / fillShadowBands `swayPad`, `swayPad` uniform of cull / cullShadow).
import { STEP } from '../core/loop.js';
import { WIND_K_SIZE } from '../world/wind.js';

export const INST_FLAG_SWAY = 2;
export const SWAY_K = 0.004;
export const SWAY_MAX = 1.0;

/** @typedef {{params: {dirX:number, dirY:number, speed:number, amp:number, P:number, travel:number, K:Float64Array}, _baseInto: (x:number,y:number,tick:number,out:number[]|Float32Array) => any}} SwayWind */

/** True when the field blows (base speed > 0): sway is active and the cull bounds need `SWAY_MAX` of padding. @param {SwayWind|null|undefined} field */
export function windSwayOn(field) { return !!(field && field.params && field.params.speed > 0); }

/** Sun-shadow dirty key lane for sway: 0 while calm, else the wind clock quantised to SWAY_SHADOW_HZ (the map re-renders on change). */
export const SWAY_SHADOW_HZ = 10;
export function windShadowKey(field, seconds) { return windSwayOn(field) ? (Math.floor(seconds * SWAY_SHADOW_HZ) + 1) | 0 : 0; }

const _w = [0, 0];
/**
 * Sway displacement of one vertex (the JS twin of the instanced vertex stage; the shader runs it in f32).
 * @param {number} baseX instance base world x @param {number} baseY instance base world y @param {number} h vertex height above the base
 * @param {number} t seconds (tick = t / STEP) @param {SwayWind} field @param {{x:number,y:number}} out
 */
export function swayOffset(baseX, baseY, h, t, field, out) {
  out.x = 0; out.y = 0;
  if (!windSwayOn(field) || !(h > 0)) return out;
  field._baseInto(baseX, baseY, t / STEP, _w);
  const k = h * h * SWAY_K;
  let dx = _w[0] * k, dy = _w[1] * k;
  const dl = Math.hypot(dx, dy);
  if (dl > SWAY_MAX) { const s = SWAY_MAX / dl; dx *= s; dy *= s; }
  out.x = dx; out.y = dy;
  return out;
}

/**
 * Uniform values for the raster / shadow-pass blocks (RASTER_BLOCK `wind`, `windT`, `windK`): wind = (dirX, dirY, speed, amp),
 * windT = (seconds, period ticks, travel, 0), windK = the 64-knot gust table (f32). A null field writes zeros (sway off).
 * @param {SwayWind|null} field @param {number} seconds @param {Float32Array|number[]} wind4 @param {Float32Array|number[]} windT4 @param {Float32Array|number[]} windK64
 */
export function packWindUniforms(field, seconds, wind4, windT4, windK64) {
  if (!windSwayOn(field)) { for (let i = 0; i < 4; i++) { wind4[i] = 0; windT4[i] = 0; } for (let i = 0; i < WIND_K_SIZE; i++) windK64[i] = 0; return; }
  const p = /** @type {SwayWind} */ (field).params;
  wind4[0] = p.dirX; wind4[1] = p.dirY; wind4[2] = p.speed; wind4[3] = p.amp;
  windT4[0] = seconds; windT4[1] = p.P; windT4[2] = p.travel; windT4[3] = 0;
  for (let i = 0; i < WIND_K_SIZE; i++) windK64[i] = p.K[i];
}
