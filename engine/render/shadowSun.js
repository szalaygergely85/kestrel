// @ts-check
// engine/render/shadowSun.js - ME-15a (docs/architecture.md 27.9, 27.9a). The
// JS core of the sun shadow map: option defaults, the snapped orthographic
// sun matrix (no shimmer/crawl) and the quantised 4-tap PCF lookup the light
// pass twin (`lighting.js`, ME-15c) and the GLSL light pass share.
//
// Imports only engine/mesh/culling.js and engine/core/transform.js (leaves). Zero allocation per call: all
// scratch is module-level; callers own `out`.
import { frustumPlanes } from '../mesh/culling.js';
import { forwardOf } from '../core/transform.js';

/**
 * @typedef {Object} SunShadowOptions
 * @property {'map'|'dda'|false} sun - 'map' = shadow map, 'dda' = legacy sector/voxel ray march, false = sunlit everywhere
 * @property {number} res - shadow map side in texels (even)
 * @property {number} boxM - light-space box side in metres
 * @property {number} aheadM - first-person box centre offset along the horizontal view direction
 * @property {readonly [number, number]} depthBias - polygon offset [factor, units] on the caster side
 * @property {number} biasM - receiver offset toward the sun, metres
 * @property {number} normalOffsetTexels - receiver offset along the surface normal, in texels
 */

/** 27.9a item 1 (frozen; `createEngine({ shadows })` merges over these once). `sun` also depends on the renderer, see `resolveSunShadowOptions`. */
export const SUN_SHADOW_DEFAULTS = Object.freeze({
  sun: /** @type {'map'|'dda'|false} */ ('map'),
  res: 2048,
  boxM: 192,
  aheadM: 64,
  depthBias: Object.freeze(/** @type {[number, number]} */ ([2, 4])),
  biasM: 0.04,
  normalOffsetTexels: 1.5,
});

/**
 * Merges user options over the defaults ONCE (engine creation). `sun`
 * defaults to 'map' on `renderer:'mesh'`, 'dda' on 'dda'/CPU; 'map' + 'dda' throws.
 * @param {Partial<SunShadowOptions>|undefined|null} user
 * @param {string} renderer - 'mesh' | 'dda' | other (CPU path)
 * @returns {SunShadowOptions}
 */
export function resolveSunShadowOptions(user, renderer) {
  const o = { ...SUN_SHADOW_DEFAULTS, ...(user || {}) };
  if (!user || user.sun === undefined) o.sun = renderer === 'mesh' ? 'map' : 'dda';
  if (o.sun === 'map' && renderer !== 'mesh') throw new Error(`shadows.sun 'map' needs renderer 'mesh' (got '${renderer}')`);
  if (!(o.res > 0) || (o.res & 1)) throw new Error(`shadows.res must be a positive even integer (got ${o.res})`);
  return o;
}

const _fwd = [0, 0];

/** Depth-range box centre is snapped to this grid (m) and grown by one quantum, so `M` stays bit-stable under sub-texel eye moves. */
const DEPTH_QUANTUM_M = 8;

/**
 * @typedef {Object} SunShadowMatrix
 * @property {Float64Array} M - 16, column-major world -> clip, ortho, clip z in [-1,1] (rasterJS convention)
 * @property {number} texelM - metres per shadow texel (boxM / res)
 * @property {Float64Array} planes - 24, `frustumPlanes(M)` for culling casters
 */

/** @returns {SunShadowMatrix} preallocated output for `shadowSunMatrix`. */
export function createSunShadowMatrix() {
  return { M: new Float64Array(16), texelM: 0, planes: new Float64Array(24) };
}

/**
 * Box centre (27.9a item 2). Pitched/RTS cameras carry `focusX/Y/Z`; first
 * person uses `eye + Fh * aheadM` (Fh = horizontal forward from compass yaw).
 * @param {{x:number,y:number,z:number,yawDeg?:number,focusX?:number,focusY?:number,focusZ?:number}} cam
 * @param {{aheadM:number}} opts
 * @param {Float64Array|number[]} out3
 */
export function sunShadowCentre(cam, opts, out3) {
  if (typeof cam.focusX === 'number') {
    out3[0] = cam.focusX; out3[1] = /** @type {number} */ (cam.focusY); out3[2] = cam.focusZ || 0;
  } else {
    forwardOf(cam.yawDeg || 0, _fwd);
    out3[0] = cam.x + _fwd[0] * opts.aheadM;
    out3[1] = cam.y + _fwd[1] * opts.aheadM;
    out3[2] = cam.z;
  }
  return out3;
}

/**
 * Snapped orthographic sun matrix (27.9a item 3). Light basis: f = -sunDir,
 * r = normalize(f x up), u = r x f. The centre's r/u coordinates are floored
 * to multiples of `texelM` before building M, so moving the eye by < 1 texel
 * leaves M bit-identical and a 1-texel move shifts every caster by exactly
 * one texel. Depth range covers the 8 corners of the world box
 * `[c +- boxM/2] x [worldZ.min - 1, worldZ.max + 1]` (centre snapped to a
 * coarse grid and grown by one quantum, margin 1 m) so casters upstream of
 * the xy box stay inside the frustum. Not snapped in depth.
 * @param {ArrayLike<number>} sunDir - unit, TOWARD the sun
 * @param {ArrayLike<number>} centre - world xyz of the box centre
 * @param {{res:number, boxM:number}} opts
 * @param {{min:number, max:number}} worldZ
 * @param {SunShadowMatrix} out
 * @returns {SunShadowMatrix}
 */
export function shadowSunMatrix(sunDir, centre, opts, worldZ, out) {
  const fx = -sunDir[0], fy = -sunDir[1], fz = -sunDir[2];
  let ux0 = 0, uy0 = 0, uz0 = 1;
  if (Math.abs(sunDir[2]) > 0.999) { ux0 = 0; uy0 = -1; uz0 = 0; }
  // r = normalize(f x up)
  let rx = fy * uz0 - fz * uy0, ry = fz * ux0 - fx * uz0, rz = fx * uy0 - fy * ux0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // u = r x f
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

  const h = opts.boxM / 2;
  const texelM = opts.boxM / opts.res;
  const cr = Math.floor((centre[0] * rx + centre[1] * ry + centre[2] * rz) / texelM) * texelM;
  const cu = Math.floor((centre[0] * ux + centre[1] * uy + centre[2] * uz) / texelM) * texelM;

  // Depth range over the world box corners (coarse-snapped centre keeps M stable).
  const q = DEPTH_QUANTUM_M;
  const bx = Math.round(centre[0] / q) * q, by = Math.round(centre[1] / q) * q;
  const hb = h + q;
  const z0 = worldZ.min - 1, z1 = worldZ.max + 1;
  let dmin = Infinity, dmax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const d = (bx + ((i & 1) ? hb : -hb)) * fx + (by + ((i & 2) ? hb : -hb)) * fy + ((i & 4) ? z1 : z0) * fz;
    if (d < dmin) dmin = d;
    if (d > dmax) dmax = d;
  }
  // Low sun: casters above the receivers' z range sit further upstream along the light; extend the near plane.
  const sz = sunDir[2];
  dmin -= (z1 - z0) * (1 - sz * sz) / Math.max(sz, 0.05);
  const range = Math.max(dmax - dmin, 1e-6);
  const k = 2 / range;

  const M = out.M;
  M[0] = rx / h; M[4] = ry / h; M[8] = rz / h; M[12] = -cr / h;
  M[1] = ux / h; M[5] = uy / h; M[9] = uz / h; M[13] = -cu / h;
  M[2] = fx * k; M[6] = fy * k; M[10] = fz * k; M[14] = -(2 * dmin / range + 1);
  M[3] = 0; M[7] = 0; M[11] = 0; M[15] = 1;
  out.texelM = texelM;
  frustumPlanes(M, out.planes);
  return out;
}

/**
 * Quantised 4-tap PCF (27.9a item 6): P' = P + N * normalOffsetTexels * texelM
 * + sunDir * biasM, projected with `M`; the 4 nearest texels at
 * `floor(uv*res - 0.5) + {0,1}^2` (no bilinear weights) each count 1 when
 * `depth(P') <= mapDepth`. Receivers outside the box (uv or depth outside
 * [0,1]) and taps outside the map are sunlit. `sunDir` is recovered from the
 * depth row of `M` (the one lookup used by `lighting.js` and the GLSL twin).
 * Compare is in rasterJS NDC z (monotone with depth01 = (z+1)/2).
 * @param {{zbuf: Float64Array, W: number}} map - a depth-only `RasterTarget`
 * @param {Float64Array} M - `shadowSunMatrix(...).M`
 * @param {ArrayLike<number>} P - receiver world position
 * @param {ArrayLike<number>} N - receiver unit normal
 * @param {{res:number, boxM:number, biasM:number, normalOffsetTexels:number}} opts
 * @returns {number} n in 0..4
 */
export function sunShadowTaps(map, M, P, N, opts) {
  const fl = Math.hypot(M[2], M[6], M[10]) || 1;
  const sx = -M[2] / fl, sy = -M[6] / fl, sz = -M[10] / fl; // toward the sun
  const no = opts.normalOffsetTexels * (opts.boxM / opts.res);
  const px = P[0] + N[0] * no + sx * opts.biasM;
  const py = P[1] + N[1] * no + sy * opts.biasM;
  const pz = P[2] + N[2] * no + sz * opts.biasM;
  const cx = M[0] * px + M[4] * py + M[8] * pz + M[12];
  const cy = M[1] * px + M[5] * py + M[9] * pz + M[13];
  const cz = M[2] * px + M[6] * py + M[10] * pz + M[14];
  const u = (cx + 1) * 0.5, v = (cy + 1) * 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1 || cz < -1 || cz > 1) return 4;
  const res = opts.res;
  const tx0 = Math.floor(u * res - 0.5), ty0 = Math.floor(v * res - 0.5);
  const W = map.W, zb = map.zbuf;
  let n = 0;
  for (let j = 0; j < 2; j++) {
    const ty = ty0 + j;
    for (let i = 0; i < 2; i++) {
      const tx = tx0 + i;
      if (tx < 0 || ty < 0 || tx >= W || ty >= W || cz <= zb[ty * W + tx]) n++;
    }
  }
  return n;
}
