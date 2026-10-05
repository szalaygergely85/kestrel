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
 * @property {number} meshLod0M - ME-15f: instanced casters within this eye distance use LOD0 (also the ALPHA-01e mesh-group LOD option)
 * @property {number} instCastM - ME-15f: instanced casters up to this eye distance use LOD1; none beyond
 * @property {boolean} dirtySkip - ME-15d: skip the depth pass while the input hash is unchanged
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
  meshLod0M: 25, // ME-15f (27.9a amendment 5)
  instCastM: 48,
  dirtySkip: true, // ME-15d: re-render the map only when its inputs changed (false = every frame, the perf worst case)
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
  if (!(o.meshLod0M > 0) || !(o.meshLod0M <= o.instCastM)) throw new Error(`shadows: need 0 < meshLod0M <= instCastM (got ${o.meshLod0M}, ${o.instCastM})`);
  return o;
}

const _fwd = [0, 0];

/** `LIGHT.w` layout (27.9a item 6): bits 0 sunlit, 8..15 litCount, 16..18 the quantised PCF tap count `n`. */
export const SUN_N_SHIFT = 16;
export const SUN_N_MASK = 7;

/**
 * Side output of `sunShadowTaps` (single-threaded scratch, like `lightFlags`): `boundary` = 1 when any tap
 * compares within `2 * biasM` metres of the stored depth, or the tap selection `floor(uv*res - 0.5)` is within
 * 0.01 texel of flipping (27.9a item 10's "boundary set": cells where float32 vs float64 may legitimately differ).
 */
export const sunShadowInfo = { boundary: 0 };

/**
 * Structure/terrain distance cull for the shadow list (27.9a amendment 2 / 15c): the palette's far-fog
 * `full` distance (nothing beyond it is visible), never less than the shadow box. Default 2000 (camera feed).
 * @param {{fog?: {far?: {full?: number}}}|null|undefined} palette
 * @param {{boxM: number}} opts
 */
export function sunShadowFogFar(palette, opts) {
  const f = palette && palette.fog && palette.fog.far;
  return f && /** @type {number} */ (f.full) > 0 ? Math.max(/** @type {number} */ (f.full), opts.boxM) : 2000;
}

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
  sunShadowInfo.boundary = 0;
  const u = (cx + 1) * 0.5, v = (cy + 1) * 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1 || cz < -1 || cz > 1) return 4;
  const res = opts.res;
  const fu = u * res - 0.5, fv = v * res - 0.5;
  const tx0 = Math.floor(fu), ty0 = Math.floor(fv);
  const du = fu - tx0, dv = fv - ty0;
  let boundary = (du < 0.01 || du > 0.99 || dv < 0.01 || dv > 0.99) ? 1 : 0;
  const W = map.W, zb = map.zbuf;
  const tolNdc = 2 * opts.biasM * fl; // metres -> NDC z (fl = |depth row| = 2 / depth range)
  let n = 0;
  for (let j = 0; j < 2; j++) {
    const ty = ty0 + j;
    for (let i = 0; i < 2; i++) {
      const tx = tx0 + i;
      if (tx < 0 || ty < 0 || tx >= W || ty >= W) { n++; continue; }
      const z = zb[ty * W + tx];
      if (cz <= z) n++;
      if (Math.abs(cz - z) <= tolNdc) boundary = 1;
    }
  }
  sunShadowInfo.boundary = boundary;
  return n;
}

// ---- ME-15d: dirty-skip key (27.9a item 12) ---------------------------------
// The shadow map is re-rendered only when what it depends on changed: the snapped matrix M (centre, sunDir, depth
// range), the structure version, and every caster item's mesh identity/version, ranges and matrices (instance
// buffers by content). Two independent 32-bit FNV-style lanes (collision odds ~2^-64 per frame pair). Zero alloc
// once every mesh has an id (WeakMap insert on first sight only).
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
const _meshIds = new WeakMap();
let _nextMeshId = 1;
const _hs = new Int32Array(2); // hash lanes (typed array: module-level `let` doubles would box)

function mix(w) {
  _hs[0] = Math.imul(_hs[0] ^ w, 16777619);
  _hs[1] = Math.imul(_hs[1] ^ ((w << 13) | (w >>> 19)), 0x9e3779b1) + 0x7f4a7c15;
}
function mixF(v) { _f32[0] = v; mix(_u32[0]); }
// Quantised mix: item poses are hashed on a grid (linear part 1/256, translation `_qT` m ~ a quarter texel) so sub-visible
// jitter (idle breathing, physics settling noise) does not re-render a 2048^2 map; the map is then stale by < 1/4 texel.
// An item's own matrix uses a size-scaled linear step (max(256, r / tStepM), r = aabb half-diagonal) so a large rotated
// mesh cannot stay stale by r/512 m > biasM (27.9a amendment 4).
const _qA = 256;
let _qT = 1 / 0.02;
function mixQ(v, inv) { mix(Math.round(v * inv) | 0); }
function mixXform(a, o, invA) { // 12 floats: A (9) then t (3)
  for (let k = 0; k < 9; k++) mixQ(a[o + k], invA);
  for (let k = 9; k < 12; k++) mixQ(a[o + k], _qT);
}

/**
 * Hash of every shadow-map input. Compare `out[0..1]` with the previous frame's; equal = the depth map is
 * still valid. `list` is a `DrawList` (duck-typed: `count`, `items[]`), `M` the Float64Array(16) sun matrix.
 * @param {{count:number, items:any[]}} list
 * @param {Float64Array} M
 * @param {number} structVersion
 * @param {Int32Array} out - 2 lanes (typed so storing them never boxes)
 * @param {number} [tStepM] - pose translation quantum in metres (default 0.02 = ~1/4 texel at the defaults)
 */
export function shadowInputHash(list, M, structVersion, out, tStepM = 0.02) {
  _qT = 1 / tStepM;
  _hs[0] = 0x811c9dc5; _hs[1] = 0x1b873593;
  for (let i = 0; i < 16; i++) mixF(M[i]);
  mix(structVersion | 0);
  mix(list.count);
  for (let i = 0; i < list.count; i++) {
    const it = list.items[i], mesh = it.mesh;
    let id = 0;
    if (mesh) { id = _meshIds.get(mesh); if (id === undefined) { id = _nextMeshId++; _meshIds.set(mesh, id); } }
    mix(id); mix(it.type); mix(it.rangeFirst); mix(it.rangeCount); mix(mesh && mesh.meshVersion ? mesh.meshVersion : 0);
    const bb = it.aabb, ex = bb[3] - bb[0], ey = bb[4] - bb[1], ez = bb[5] - bb[2];
    const r = 0.5 * Math.sqrt(ex * ex + ey * ey + ez * ez);
    mixXform(it.matrix, 0, Math.max(_qA, r * _qT));
    if (it.type === 1 || it.type === 3) { // DRAW_VOXEL / DRAW_INSTANCED: part matrices
      const np = mesh && mesh.ranges ? mesh.ranges.length : 0, pm = it.partMatrices;
      for (let p = 0; p < np; p++) {
        // ED-SCALE-1a (34.6): part-matrix entries are ~cellM * scale (~0.1), so the fixed 256 quantum hid scale changes
        // under ~4 %; size the quantum by the world error q * r / colNorm instead.
        const o = p * 12, cn = Math.sqrt(pm[o] * pm[o] + pm[o + 3] * pm[o + 3] + pm[o + 6] * pm[o + 6]);
        // colNorm is snapped DOWN to a power of two: the quantum is constant within an octave (static props hash stably),
        // at most 2x finer than the unsnapped one, and the world error stays <= tStepM (34.2 item 6).
        mixXform(pm, o, cn > 0 ? Math.max(_qA, r * _qT / Math.pow(2, Math.floor(Math.log2(cn)))) : _qA);
      }
    }
    if (it.type === 3 && it.instBuf) { // instances by content (their count is capped at 2048 x 16 floats)
      const f = it.instBuf.f32;
      mix(it.instCount);
      for (let k = 0, n = it.instCount * 16; k < n; k++) mixQ(f[k], (k & 3) === 3 && (k & 15) < 12 ? _qT : _qA); // row-major 3x4 + translation in col 3
    }
  }
  out[0] = _hs[0]; out[1] = _hs[1];
  return out;
}
