// OB-073 D2b (architecture.md 38.52): JS reference trace of the near-field grass carpet.
// World-anchored blade lattice, one ray per screen cell. Pure JS twin that the WGSL pass (D2d) copies:
// share the constants below, keep the order of operations. No Math.random, no time except the wind clock,
// zero allocation per trace (all scratch lives in the ctx). Alloc rule: no double crosses a non-inlined call as
// argument or return value (V8 boxes it), so doubles travel through ctx.r / ctx.s / ctx.q and calls take ints only.
//
// The class/variant lookup is a plain data shape (D2a builds it in engine/world/carpet.js):
//   carpet = { cfg: CarpetConfig, classMap: Uint8Array, x0, y0, w, h }   (classMap cell = cfg.classCellM, 0 = none, id 1..15 = cfg.variants[id-1])
import { hashFast01, FP_DEFAULT_K, FP_ANISO_T, FP_ANISO_MAX } from './terrainShade.js';

export const NMAX = 24;                 // max lattice steps per trace; more = past the fade, draw nothing (never truncate)
export const CARPET_DEFAULTS = Object.freeze({ cellM: 0.10, radiusM: 12, patchM: 3, classCellM: 2, classJitterM: 0.6, gustM: 4, travelM: 1, bladeW: 0.06, swayGain: 1 });
export const ROOT_JITTER = 0.4;         // root offset +-0.4 cell
export const LEAN_CAP = 0.6;            // |lean| <= 0.6 * h (ratio lean/h)
export const LEAN_PER_MS = 0.12;        // lean/h per m/s of world wind (before swayGain and gust)
export const PATCH_LO = 0.75, PATCH_RANGE = 0.5;   // height * (0.75 + 0.5 * valueNoise)
export const GUST_LO = 0.6, GUST_RANGE = 0.4;      // lean * (0.6 + 0.4 * valueNoise)
export const FADE_FP0 = 0.5, FADE_FP1 = 1.0;       // fade = 1 - smoothstep(FP0, FP1, fp / (2w))
export const FADE_R0 = 0.8, FADE_R1 = 1.0;         // times 1 - smoothstep(R0, R1, dXY / radiusM)
export const RING = 1;                  // lattice cells searched around the (lean-shifted) DDA cell: 3x3
// salts added to cfg.seed (hash streams)
export const SALT_JX = 101, SALT_JY = 102, SALT_RANK = 103, SALT_H = 104, SALT_CJX = 105, SALT_CJY = 106, SALT_PATCH = 110, SALT_GUST = 111;
export const MAX_VARIANTS = 15;
// ctx.r: the ray under test; ctx.s: the blade under test; both Float64Array scratch
const R_EX = 0, R_EY = 1, R_EZ = 2, R_DX = 3, R_DY = 4, R_DZ = 5, R_N2 = 6, R_T0 = 7, R_T1 = 8, R_TIME = 9;
// ctx.inp: the call input of the alloc-free entry points (eye, dir, terrain hit distance, wind clock)
export const IN_EX = 0, IN_EY = 1, IN_EZ = 2, IN_DX = 3, IN_DY = 4, IN_DZ = 5, IN_THIT = 6, IN_TIME = 7;
const S_H = 2, S_VAR = 4, S_LX = 5, S_LY = 6, S_H01 = 9, S_Z = 10, S_TB = 11, S_N = 16;

function smooth(a, b, x) {
  let s = (x - a) / (b - a);
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return s * s * (3 - 2 * s);
}

/**
 * Build the trace context (allocates once).
 * @param {{cfg:object, classMap:Uint8Array, x0:number, y0:number, w:number, h:number}} carpet 38.52 data shape
 * @param {(q:Float64Array)=>void} ground near-band height: reads q[0]=x, q[1]=y, writes q[2]=z
 * @param {((q:Float64Array)=>void)|null} wind world wind: reads q[0]=x, q[1]=y, q[2]=timeSec, writes q[3]=vx, q[4]=vy (m/s); null = calm
 */
export function makeCarpetCtx(carpet, ground, wind) {
  const cfg = carpet.cfg, D = CARPET_DEFAULTS;
  const n = MAX_VARIANTS + 1;
  const ctx = {
    seed: cfg.seed | 0,
    cellM: cfg.cellM || D.cellM, radiusM: cfg.radiusM || D.radiusM, patchM: cfg.patchM || D.patchM,
    classCellM: cfg.classCellM || D.classCellM, classJitterM: cfg.classJitterM == null ? D.classJitterM : cfg.classJitterM,
    gustM: cfg.gustM || D.gustM, travelM: cfg.travelM == null ? D.travelM : cfg.travelM,
    classMap: carpet.classMap, cx0: carpet.x0, cy0: carpet.y0, cw: carpet.w, ch: carpet.h,
    dens: new Float64Array(n), hMin: new Float64Array(n), hMax: new Float64Array(n), bw: new Float64Array(n), sway: new Float64Array(n),
    maxH: 0, ground, wind: wind || null, fpK: 0, // fpK = groundFootprint hashCell arg (<0 = -k, >0 = fixed cell, 0 = default k)
    q: new Float64Array(8), inp: new Float64Array(8), r: new Float64Array(10), s: new Float64Array(S_N), keep: new Float64Array(S_N),
  };
  ctx.sway[0] = 1;
  const vs = cfg.variants || [];
  for (let i = 0; i < vs.length && i < MAX_VARIANTS; i++) {
    const v = vs[i], id = i + 1;
    ctx.dens[id] = v.density; ctx.hMin[id] = v.heightM[0]; ctx.hMax[id] = v.heightM[1];
    ctx.bw[id] = v.bladeW || D.bladeW; ctx.sway[id] = v.swayGain == null ? D.swayGain : v.swayGain;
    if (v.heightM[1] * (PATCH_LO + PATCH_RANGE) > ctx.maxH) ctx.maxH = v.heightM[1] * (PATCH_LO + PATCH_RANGE);
  }
  return ctx;
}

/** class map value at q[0], q[1] (world xy); outside the map = 0. */
function classAt(ctx) {
  const i = Math.floor((ctx.q[0] - ctx.cx0) / ctx.classCellM), j = Math.floor((ctx.q[1] - ctx.cy0) / ctx.classCellM);
  if (i < 0 || j < 0 || i >= ctx.cw || j >= ctx.ch) return 0;
  return ctx.classMap[j * ctx.cw + i];
}

/** bilinear value noise (same maths as terrainShade.valueNoise) at lattice coords q[0], q[1] -> q[2]. */
function vnoise(ctx, salt) {
  const q = ctx.q, x = q[0], y = q[1];
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hashFast01(ix, iy, salt), b = hashFast01(ix + 1, iy, salt), c = hashFast01(ix, iy + 1, salt), d = hashFast01(ix + 1, iy + 1, salt);
  q[2] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** lean/h ratio of the blade rooted at q[0], q[1] (variant v selects swayGain) -> ctx.s[S_LX..S_LY]. Capped at LEAN_CAP. Keeps q[0..1]. */
function leanRatio(ctx, v) {
  const s = ctx.s, q = ctx.q;
  if (ctx.wind === null) { s[S_LX] = 0; s[S_LY] = 0; return; }
  const x = q[0], y = q[1], timeSec = ctx.r[R_TIME];
  q[2] = timeSec;
  ctx.wind(q);
  const wx = q[3], wy = q[4];
  const m = Math.sqrt(wx * wx + wy * wy);
  if (m < 1e-9) { s[S_LX] = 0; s[S_LY] = 0; return; }
  const ux = wx / m, uy = wy / m;
  q[0] = (x - ux * timeSec * ctx.travelM) / ctx.gustM; q[1] = (y - uy * timeSec * ctx.travelM) / ctx.gustM;
  vnoise(ctx, ctx.seed + SALT_GUST);
  let r = m * LEAN_PER_MS * ctx.sway[v] * (GUST_LO + GUST_RANGE * q[2]);
  if (r > LEAN_CAP) r = LEAN_CAP;
  s[S_LX] = ux * r; s[S_LY] = uy * r;
  q[0] = x; q[1] = y;
}

/**
 * Blade of lattice cell (ix, iy) vs the ray in ctx.r. Everything but the fade is eye independent.
 * Returns 1 on a hit (tB in ctx.s[S_TB], plus variant, h01, z, lean), else 0 (Smi result on purpose).
 */
function bladeHit(ctx, ix, iy) {
  const r = ctx.r, ex = r[R_EX], ey = r[R_EY], ez = r[R_EZ], dx = r[R_DX], dy = r[R_DY], dz = r[R_DZ], n2 = r[R_N2], t0 = r[R_T0], t1 = r[R_T1];
  const s = ctx.s, q = ctx.q, c = ctx.cellM, seed = ctx.seed;
  const rx = (ix + 0.5 + (hashFast01(ix, iy, seed + SALT_JX) * 2 - 1) * ROOT_JITTER) * c;
  const ry = (iy + 0.5 + (hashFast01(ix, iy, seed + SALT_JY) * 2 - 1) * ROOT_JITTER) * c;
  const cj = ctx.classJitterM;
  q[0] = rx + (hashFast01(ix, iy, seed + SALT_CJX) * 2 - 1) * cj; q[1] = ry + (hashFast01(ix, iy, seed + SALT_CJY) * 2 - 1) * cj;
  const v = classAt(ctx);
  if (v === 0) return 0;
  const rank = hashFast01(ix, iy, seed + SALT_RANK);
  if (rank >= ctx.dens[v]) return 0;
  q[0] = rx / ctx.patchM; q[1] = ry / ctx.patchM;
  vnoise(ctx, seed + SALT_PATCH);
  const h = (ctx.hMin[v] + (ctx.hMax[v] - ctx.hMin[v]) * hashFast01(ix, iy, seed + SALT_H)) * (PATCH_LO + PATCH_RANGE * q[2]);
  const w = ctx.bw[v] * 0.5;
  q[0] = rx; q[1] = ry;
  ctx.ground(q);
  const g = q[2];
  q[0] = rx; q[1] = ry;
  leanRatio(ctx, v);
  const lx = s[S_LX], ly = s[S_LY];
  // closest xy approach of the ray to the leaning axis; 3 passes (the axis point depends on the height)
  let sh = 0.5 * h, tc = 0;
  for (let k = 0; k < 3; k++) {
    tc = n2 > 1e-12 ? ((rx + lx * sh - ex) * dx + (ry + ly * sh - ey) * dy) / n2 : 0.5 * (t0 + t1);
    sh = ez + tc * dz - g;
    if (sh < 0) sh = 0; else if (sh > h) sh = h;
  }
  if (tc < t0 || tc > t1) return 0;
  const zr = ez + tc * dz, sr = zr - g;
  if (sr < 0 || sr > h) return 0;
  const px = ex + tc * dx - (rx + lx * sr), py = ey + tc * dy - (ry + ly * sr);
  if (px * px + py * py >= w * w) return 0;
  // fade on the density threshold: one fixed disappearing distance per blade, no re-roll
  const fpk = ctx.fpK;
  let fp;
  if (fpk > 0) fp = fpk; // = groundFootprint(t, hashCell) of terrainShade.js, inlined (no double through a call)
  else { const a = tc / FP_ANISO_T; fp = (fpk < 0 ? -fpk : FP_DEFAULT_K) * tc * (a < 1 ? 1 : a > FP_ANISO_MAX ? FP_ANISO_MAX : a); }
  const dXY = tc * Math.sqrt(n2);
  const fade = (1 - smooth(FADE_FP0, FADE_FP1, fp / (2 * w))) * (1 - smooth(FADE_R0, FADE_R1, dXY / ctx.radiusM));
  if (rank >= ctx.dens[v] * fade) return 0;
  s[S_VAR] = v; s[S_H01] = sr / h; s[S_Z] = zr; s[S_H] = h; s[S_TB] = tc;
  return 1;
}

/**
 * Load the ray into ctx.r and find the segment [t0, t1] that can touch blades.
 * Returns the lattice steps it needs (0 = empty segment); the trace draws nothing when that exceeds NMAX.
 */
function setRay(ctx) {
  const r = ctx.r, q = ctx.q, c = ctx.cellM, inp = ctx.inp;
  const ex = inp[IN_EX], ey = inp[IN_EY], ez = inp[IN_EZ], dx = inp[IN_DX], dy = inp[IN_DY], dz = inp[IN_DZ], tHit = inp[IN_THIT], timeSec = inp[IN_TIME];
  r[R_EX] = ex; r[R_EY] = ey; r[R_EZ] = ez; r[R_DX] = dx; r[R_DY] = dy; r[R_DZ] = dz; r[R_N2] = dx * dx + dy * dy; r[R_TIME] = timeSec;
  if (!(tHit > 0) || tHit === Infinity) return 0;
  q[0] = ex + tHit * dx; q[1] = ey + tHit * dy;
  ctx.ground(q);
  const zTop = q[2] + ctx.maxH;
  let t0 = 0;
  if (dz < 0 && ez > zTop) t0 = (zTop - ez) / dz;
  const hxy = Math.sqrt(r[R_N2]);
  let t1 = tHit;
  if (hxy > 1e-9) { const tr = ctx.radiusM / hxy; if (tr < t1) t1 = tr; }
  if (t0 >= t1) return 0;
  r[R_T0] = t0; r[R_T1] = t1;
  const i0 = Math.floor((ex + t0 * dx) / c), j0 = Math.floor((ey + t0 * dy) / c);
  const i1 = Math.floor((ex + t1 * dx) / c), j1 = Math.floor((ey + t1 * dy) / c);
  return Math.abs(i1 - i0) + Math.abs(j1 - j0) + 1;
}

/** copy a call's eye/dir/tHit/time into ctx.inp (convenience for tests and cold callers). */
export function loadInput(ctx, eye, dir, tHit, timeSec) {
  const a = ctx.inp;
  a[IN_EX] = eye[0]; a[IN_EY] = eye[1]; a[IN_EZ] = eye[2]; a[IN_DX] = dir[0]; a[IN_DY] = dir[1]; a[IN_DZ] = dir[2]; a[IN_THIT] = tHit; a[IN_TIME] = timeSec;
}

/** Fresh result record (allocate once, reuse). hit: 1/0; lean: signed screen lean -1..1 (+ = right). */
export function makeCarpetHit() {
  return { hit: 0, t: 0.5, h01: 0.5, variant: 0, lean: 0.5, z: 0.5, ix: 0, iy: 0, steps: 0 }; // non-Smi initial values keep the double fields in-place mutable
}

function setOut(out, ctx, ix, iy) {
  const s = ctx.s, r = ctx.r, dx = r[R_DX], dy = r[R_DY], n2 = r[R_N2];
  out.hit = 1; out.t = s[S_TB]; out.h01 = s[S_H01]; out.variant = s[S_VAR]; out.z = s[S_Z]; out.ix = ix; out.iy = iy;
  // screen right in xy = (dy, -dx) / |d|; lean ratio / LEAN_CAP
  const inv = n2 > 1e-12 ? 1 / Math.sqrt(n2) : 0;
  out.lean = (s[S_LX] * dy - s[S_LY] * dx) * inv / LEAN_CAP;
}

/**
 * Trace one screen-cell ray against the blade lattice (38.52 item 4), front to back with a 2D DDA.
 * @param {ArrayLike<number>} eye [x,y,z]  @param {ArrayLike<number>} dir unit [x,y,z]
 * @param {number} tHit terrain hit distance (Infinity/0 = none -> no carpet)
 * @returns {number} 1 when a blade is hit (details in out), else 0
 */
export function traceCarpet(eye, dir, tHit, ctx, timeSec, out) {
  loadInput(ctx, eye, dir, tHit, timeSec);
  return traceCarpetIn(ctx, out);
}

/** Same trace with the input already in ctx.inp (IN_* slots). The per-cell loops use this: doubles passed as call arguments would be boxed (alloc). */
export function traceCarpetIn(ctx, out) {
  out.hit = 0;
  const steps = setRay(ctx);
  out.steps = steps;
  if (steps === 0 || steps > NMAX) return 0;
  const r = ctx.r, bs = ctx.s, keep = ctx.keep, q = ctx.q;
  const ex = r[R_EX], ey = r[R_EY], ez = r[R_EZ], dx = r[R_DX], dy = r[R_DY], dz = r[R_DZ], t0 = r[R_T0], t1 = r[R_T1], c = ctx.cellM;
  const hxy = Math.sqrt(r[R_N2]);
  let ix = Math.floor((ex + t0 * dx) / c), iy = Math.floor((ey + t0 * dy) / c);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = Math.abs(dx) > 1e-12 ? c / Math.abs(dx) : Infinity, ddy = Math.abs(dy) > 1e-12 ? c / Math.abs(dy) : Infinity;
  let tx = Math.abs(dx) > 1e-12 ? (((dx > 0 ? ix + 1 : ix) * c) - ex) / dx : Infinity;
  let ty = Math.abs(dy) > 1e-12 ? (((dy > 0 ? iy + 1 : iy) * c) - ey) / dy : Infinity;
  let best = Infinity, bi = 0, bj = 0, tEnter = t0;
  const margin = hxy > 1e-9 ? (RING + 1.5) * c / hxy : Infinity; // blades of later cells can still be nearer by this much
  const windOn = ctx.wind !== null;
  for (let step = 0; step < steps; step++) {
    if (tEnter - margin > best) break;
    const tNext = tx < ty ? tx : ty;
    let ci = ix, cj = iy;
    if (windOn) { // shift the search cell upwind by the lean offset at the ray height (the lean field is smooth)
      const tm = 0.5 * (tEnter + (tNext < t1 ? tNext : t1));
      const px = ex + tm * dx, py = ey + tm * dy;
      q[0] = px; q[1] = py;
      ctx.ground(q);
      let sh = ez + tm * dz - q[2];
      if (sh < 0) sh = 0; else if (sh > ctx.maxH) sh = ctx.maxH;
      q[0] = px; q[1] = py;
      leanRatio(ctx, 0);
      ci = Math.floor((px - bs[S_LX] * sh) / c); cj = Math.floor((py - bs[S_LY] * sh) / c);
    }
    for (let j = cj - RING; j <= cj + RING; j++) for (let i = ci - RING; i <= ci + RING; i++) {
      if (bladeHit(ctx, i, j) === 1 && bs[S_TB] < best) { best = bs[S_TB]; bi = i; bj = j; for (let k = 0; k < S_N; k++) keep[k] = bs[k]; }
    }
    if (tx < ty) { ix += sx; tEnter = tx; tx += ddx; } else { iy += sy; tEnter = ty; ty += ddy; }
  }
  if (best === Infinity) return 0;
  for (let k = 0; k < S_N; k++) bs[k] = keep[k];
  setOut(out, ctx, bi, bj);
  return 1;
}

/**
 * Brute-force reference (every lattice cell within the eye disc) with the same NMAX rule and blade test.
 * Test/oracle only; far too slow for a frame.
 */
export function traceCarpetBrute(eye, dir, tHit, ctx, timeSec, out) {
  loadInput(ctx, eye, dir, tHit, timeSec);
  out.hit = 0;
  const steps = setRay(ctx);
  out.steps = steps;
  if (steps === 0 || steps > NMAX) return 0;
  const bs = ctx.s, keep = ctx.keep, c = ctx.cellM, ex = eye[0], ey = eye[1];
  const R = ctx.radiusM + c;
  const i0 = Math.floor((ex - R) / c), i1 = Math.floor((ex + R) / c), j0 = Math.floor((ey - R) / c), j1 = Math.floor((ey + R) / c);
  let best = Infinity, bi = 0, bj = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (bladeHit(ctx, i, j) === 1 && bs[S_TB] < best) { best = bs[S_TB]; bi = i; bj = j; for (let k = 0; k < S_N; k++) keep[k] = bs[k]; }
  }
  if (best === Infinity) return 0;
  for (let k = 0; k < S_N; k++) bs[k] = keep[k];
  setOut(out, ctx, bi, bj);
  return 1;
}

/** Blade identity of a lattice cell (no ray): out Float64Array(4) = rootX, rootY, height, variant (0 = none). */
export function bladeAtCell(ctx, ix, iy, out) {
  const c = ctx.cellM, seed = ctx.seed, q = ctx.q;
  const rx = (ix + 0.5 + (hashFast01(ix, iy, seed + SALT_JX) * 2 - 1) * ROOT_JITTER) * c;
  const ry = (iy + 0.5 + (hashFast01(ix, iy, seed + SALT_JY) * 2 - 1) * ROOT_JITTER) * c;
  const cj = ctx.classJitterM;
  q[0] = rx + (hashFast01(ix, iy, seed + SALT_CJX) * 2 - 1) * cj; q[1] = ry + (hashFast01(ix, iy, seed + SALT_CJY) * 2 - 1) * cj;
  const v = classAt(ctx);
  out[0] = rx; out[1] = ry; out[3] = v;
  q[0] = rx / ctx.patchM; q[1] = ry / ctx.patchM;
  vnoise(ctx, seed + SALT_PATCH);
  out[2] = v === 0 ? 0 : (ctx.hMin[v] + (ctx.hMax[v] - ctx.hMin[v]) * hashFast01(ix, iy, seed + SALT_H)) * (PATCH_LO + PATCH_RANGE * q[2]);
}

// ---- OB-073 D2c (38.52 items 7-8): the carpet cell pass of the JS frame (after resolve, before lighting) --------
import { KIND_GRASS, FACE_U } from './GBuffer.js';
import { packNormalOct } from '../voxel/octNormal.js';
import { STEP } from '../core/loop.js';

export const SALT_TINT = 107;          // per-blade colour shift stream (cfg.seed + SALT_TINT)
export const TINT_AMP = 0.08;          // ramp position shift +-0.08
const _cellHit = makeCarpetHit();
const _aoAlias = new WeakMap();
const _worldCtx = new WeakMap();
const _windTmp = new Float64Array(3);

/**
 * Frame trace context of a World's carpet (cached per world; the class map fields are refreshed every call, since a band
 * rebake may swap the array). Returns null when the world has no carpet / class map / terrain.
 */
export function carpetCtxFor(world) {
  const c = world && world.carpet;
  if (!c || !c.classMap || !world.terrain) return null;
  let ctx = _worldCtx.get(world);
  if (!ctx || ctx.cfgRef !== c.cfg) {
    const terrain = world.terrain;
    ctx = makeCarpetCtx(c, (q) => { q[2] = terrain.groundAt(q[0], q[1]); },
      (q) => { world.wind.sampleInto(q[0], q[1], 0, q[2] / STEP, _windTmp); q[3] = _windTmp[0]; q[4] = _windTmp[1]; });
    ctx.cfgRef = c.cfg;
    _worldCtx.set(world, ctx);
  }
  ctx.classMap = c.classMap; ctx.cx0 = c.x0; ctx.cy0 = c.y0; ctx.cw = c.w; ctx.ch = c.h;
  return ctx;
}

/**
 * Write carpet cells into the G-buffer (shear projection only; the caller skips pitched frames). For every written cell
 * (any non-sky cell with a blade in front of its depth): kind = KIND_GRASS, mat = variant id, u = h01, v = signed screen lean,
 * face = U, z = world z, depth = blade distance; the lean-tilted normal is packed in aoD and the colour shift in vao (kind 10 only
 * reads them). objectId / planeId stay those of the cell underneath (blades are never pickable). Zero alloc per frame.
 * @param {import('./GBuffer.js').GBuffer} gbuf  @param {{depth:{depth:Float32Array}}} fb
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 * @param {ReturnType<typeof makeCarpetCtx>} ctx  @param {number} timeSec
 * @returns {number} cells written
 */
export function carpetCells(gbuf, fb, cam, ctx, timeSec) {
  const cols = gbuf.cols, rows = gbuf.rows, depth = fb.depth.depth, kind = gbuf.kind;
  let alias = _aoAlias.get(gbuf);
  if (!alias || alias.buffer !== gbuf.aoD.buffer) { alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length); _aoAlias.set(gbuf, alias); }
  const yawRad = cam.yawDeg * Math.PI / 180, dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
  const tanH = gbuf.cam.tanHalfHFov, planeX = -dirY * tanH, planeY = dirX * tanH, planeDistY = gbuf.cam.planeDistY;
  const horizonRow = rows / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY;
  const inp = ctx.inp, s = ctx.s, out = _cellHit, tintSalt = ctx.seed + SALT_TINT;
  inp[IN_EX] = cam.x; inp[IN_EY] = cam.y; inp[IN_EZ] = cam.z; inp[IN_TIME] = timeSec;
  ctx.q[0] = cam.x; ctx.q[1] = cam.y; ctx.ground(ctx.q);
  const eyeAbove = cam.z > ctx.q[2] + ctx.maxH; // rays level or upward from above the blade volume can never reach it
  let written = 0;
  for (let y = 0; y < rows; y++) {
    const slope = -(y - horizonRow) / planeDistY;
    if (slope >= 0 && eyeAbove) continue;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const k = kind[i];
      if (k === 0 || k === KIND_GRASS) continue;
      const d = depth[i];
      if (!(d > 0) || d === Infinity) continue;
      const cameraX = (2 * (x + 0.5)) / cols - 1;
      inp[IN_DX] = dirX + planeX * cameraX; inp[IN_DY] = dirY + planeY * cameraX; inp[IN_DZ] = slope; inp[IN_THIT] = d;
      if (traceCarpetIn(ctx, out) === 0) continue;
      kind[i] = KIND_GRASS; gbuf.mat[i] = out.variant; gbuf.u[i] = out.h01; gbuf.v[i] = out.lean; gbuf.face[i] = FACE_U;
      gbuf.z[i] = out.z; depth[i] = out.t;
      const lx = s[S_LX], ly = s[S_LY], inv = 1 / Math.sqrt(lx * lx + ly * ly + 1);
      alias[i] = packNormalOct(lx * inv, ly * inv, inv);
      gbuf.vao[i] = (hashFast01(out.ix, out.iy, tintSalt) * 2 - 1) * TINT_AMP;
      written++;
    }
  }
  return written;
}
