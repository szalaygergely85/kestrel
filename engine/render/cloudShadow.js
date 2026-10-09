// engine/render/cloudShadow.js (S8-B2-12a, docs/architecture.md 38.13): cloud-shadow coverage that scales the sun
// term in the light pass. Pure, allocation-free per call - `cloudCov` is the JS twin of common.wgsl.js's
// CLOUD_SHADOW_WGSL (`cloudCov`), `updateCloudShadow` is the once-per-frame CPU drift update `LightSet.update` calls.
// Imports only the existing bit-exact hash (terrainShade.js `hashFast01` - same avalanche mix as
// common.wgsl.js's HASH_FAST_WGSL `hashFast`), so clouds never add a second, drifting hash implementation.
import { hashFast01 } from './terrainShade.js';

// Bit 24..31 of LIGHT.w (gpucompare's decode masks only read bits 0, 8..15, 16..18 - 38.13 "facts"): the quantised
// cloud darkening byte, q = floor(strength * CLOUD_DARK * cov * 255 + 0.5), 0 at strength 0 (bit-identical AC).
export const CLOUD_SHIFT = 24;
// cloudF = 1 - strength * CLOUD_DARK * cov(P), strength/cov in [0,1] -> cloudF in [1 - CLOUD_DARK, 1] = [0.4, 1] (the AC).
export const CLOUD_DARK = 0.6;
// Salts already in use in this codebase: 10 (terrainShade.js close-band jitter), 20+i (terrainShade.js per-feature
// dice, i small), 30 (FOREST_TRUNK_SALT), 57/59/61 (waterLook.js WATER_HASH_SALT/WATER_FLOW_SALT/WATER_FALL_SALT).
// 71/72 (the 2nd octave) are new and distinct from all of them.
export const CLOUD_SALT = 71;

function smoothstep01(t) {
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// Value noise on the 256-periodic integer lattice (JS twin of CLOUD_SHADOW_WGSL's `vnoiseCloud`): bilinear between
// `hashFast01` corners, smoothstep weights. `iu & 255`/`iv & 255` wrap exactly like WGSL's `i32 & 255` (both are
// 32-bit two's complement bitwise-and, so a negative u/v wraps bit-for-bit the same way on both sides).
function vnoise(u, v, s) {
  const iu = Math.floor(u), iv = Math.floor(v);
  const fu = u - iu, fv = v - iv;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const h00 = hashFast01(iu & 255, iv & 255, s);
  const h10 = hashFast01((iu + 1) & 255, iv & 255, s);
  const h01 = hashFast01(iu & 255, (iv + 1) & 255, s);
  const h11 = hashFast01((iu + 1) & 255, (iv + 1) & 255, s);
  const a = h00 + (h10 - h00) * su;
  const b = h01 + (h11 - h01) * su;
  return a + (b - a) * sv;
}

/**
 * Cloud coverage at world point (px, py), in [0, 1]. `c` = any object carrying `{invScale, offU, offV, cover}`
 * (`LightSet.cloud` on the CPU - the WGSL twin reads the same 4 numbers out of the `cloud`/`cloudCover` uniform
 * words). No f32/f64 branching: continuous value noise, so an f32-vs-f64 `floor` coin flip at a lattice line moves
 * `cov` by ~1e-6, never a jump (38.13).
 * @param {number} px @param {number} py
 * @param {{invScale:number, offU:number, offV:number, cover:number}} c
 */
export function cloudCov(px, py, c) {
  const u = px * c.invScale + c.offU;
  const v = py * c.invScale + c.offV;
  const n = 0.65 * vnoise(u, v, CLOUD_SALT) + 0.35 * vnoise(2 * u, 2 * v, CLOUD_SALT + 1);
  return smoothstep01((n - c.cover) / 0.25);
}

function wrap256(x) {
  const m = x % 256;
  return m < 0 ? m + 256 : m;
}

/**
 * Advances `c.offU`/`c.offV` to `timeSec`, drifting with the BASE wind only (no gusts - a gust has no closed-form
 * integral, 38.13): `off = (dirX, dirY) * speed * speedK * t` in world metres, converted to lattice units by
 * `c.invScale` and wrapped into [0, 256) in f64 (so an f32 shader never drifts, however long the session runs).
 * Computed fresh from absolute `timeSec` every call (never accumulated), so it stays correct across frame drops.
 * `windParams` is `world.wind.params` (`{dirX, dirY, speed, ...}`, `createWind`'s unit base direction + speed) or
 * null/undefined (treated as calm: offsets go to 0). Zero allocation; writes `c.offU`/`c.offV` in place.
 * @param {{invScale:number, speedK:number, offU:number, offV:number}} c
 * @param {{dirX:number, dirY:number, speed:number}|null} windParams
 * @param {number} timeSec
 */
export function updateCloudShadow(c, windParams, timeSec) {
  const dirX = windParams ? windParams.dirX : 0;
  const dirY = windParams ? windParams.dirY : 0;
  const speed = windParams ? windParams.speed : 0;
  const k = speed * c.speedK * timeSec * c.invScale;
  c.offU = wrap256(dirX * k);
  c.offV = wrap256(dirY * k);
}
