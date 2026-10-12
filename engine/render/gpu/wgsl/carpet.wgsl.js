// OB-073-D2d (architecture.md 38.52): WGSL twin of the grass-carpet trace engine/render/carpet.js (traceCarpetIn). One fullscreen
// fragment pass over the cell grid, after resolve/deriv and before light: it reads the resolved GI/GA/DEPTH, traces the blade lattice
// per cell and writes a kind-10 cell (GI/GA/DEPTH) where a blade is hit, else copies the cell unchanged.
// Constants are interpolated from the JS exports (carpet.js / world/carpet.js): never retype them here. Scalar style on purpose: the
// trace (CARPET_TRACE_WGSL) is evaluated in JS by carpet.wgsl.test.js against traceCarpetIn.
// Pass shape: a RENDER pass with scratch targets, not a compute pass writing the gbuffer in place (GpuDevice computes bind storage
// BUFFERS only; a texture cannot be sampled and rendered in one pass). passCarpet.js aliases the scratch set as t.texGI/GA/Depth for light.
// Depth convention (resolve.wgsl.js): DEPTH.x = f32 bits of `dist` along the NON-unit pitched cell dir (cellDirPitched), so the
// metric hit distance is dist * |dir|; the pass converts both ways with dirLen.
// Bindings: @group(0) 0 GI, 1 GA, 2 DEPTH (resolved, rgba32uint/rgba32uint/r32uint), 3 CLASS (r8uint, classCellM grid), 4 NEARH (r32float
// near-band height, texel = baked cell, manual bilinear = util.gridHeight); @group(1) @binding(0) CarpetU. Targets: GI, GA, DEPTH.
import { defineUniformBlock } from './uniformBlock.js';
import { HASH_FAST_WGSL, CELL_RAY_PITCHED_WGSL, WIND_AT_WGSL, FULLSCREEN_VS_WGSL, OCT_NORMAL_WGSL } from './common.wgsl.js';
import {
  NMAX, ROOT_JITTER, LEAN_CAP, LEAN_PER_MS, PATCH_LO, PATCH_RANGE, GUST_LO, GUST_RANGE, FADE_FP0, FADE_FP1, FADE_R0, FADE_R1, RING,
  SALT_JX, SALT_JY, SALT_RANK, SALT_H, SALT_CJX, SALT_CJY, SALT_PATCH, SALT_GUST, MAX_VARIANTS, SALT_TINT, TINT_AMP,
} from '../../carpet.js';
import { FP_DEFAULT_K, FP_ANISO_T, FP_ANISO_MAX } from '../../terrainShade.js';

import { KIND_GRASS, FACE_U } from '../../GBuffer.js';
export { KIND_GRASS, FACE_U }; // one owner: GBuffer.js (D2c landed)
export const CARPET_VTAB_ROWS = 2;          // vec4 rows per variant: (density, hMin, hMax, bladeW), (swayGain, 0, 0, 0). Ramp/glyphs: D2e table
export const CARPET_KNOTS = 16;             // 64 wind knots as 16 vec4
const f = (v) => { const s = String(v); return /[.e]/.test(s) ? s : s + '.0'; }; // f32 literal text

export const CARPET_BLOCK = defineUniformBlock('CarpetU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'seed', type: 'i32' }, { name: 'windOn', type: 'i32' },
  { name: 'classW', type: 'i32' }, { name: 'classHt', type: 'i32' }, { name: 'nearW', type: 'i32' }, { name: 'nearHt', type: 'i32' },
  { name: 'cellM', type: 'f32' }, { name: 'radiusM', type: 'f32' }, { name: 'patchM', type: 'f32' }, { name: 'classCellM', type: 'f32' },
  { name: 'classJitterM', type: 'f32' }, { name: 'gustM', type: 'f32' }, { name: 'travelM', type: 'f32' }, { name: 'timeSec', type: 'f32' },
  { name: 'classX0', type: 'f32' }, { name: 'classY0', type: 'f32' }, { name: 'nearX0', type: 'f32' }, { name: 'nearY0', type: 'f32' },
  { name: 'nearCell', type: 'f32' }, { name: 'maxH', type: 'f32' }, { name: 'wMax', type: 'f32' }, { name: 'fpK', type: 'f32' }, // fpK: <0 = -k, >0 fixed cell, 0 = default k (shade hashCell)
  { name: 'windP0', type: 'vec4' },   // dirX, dirY, speed, amp
  { name: 'windP1', type: 'vec4' },   // period (ticks), travel, 0, 0
  { name: 'eye', type: 'vec4' },      // x, y, z, 0
  { name: 'pitchA', type: 'vec4' },   // F.xyz, tanHalfX   (same words as the light pass)
  { name: 'pitchB', type: 'vec4' },   // R.xy, U.xy
  { name: 'pitchC', type: 'vec4' },   // U.z, tanHalfY, 0, 0
  { name: 'knots', type: 'vec4', count: CARPET_KNOTS },
  { name: 'vtab', type: 'vec4', count: (MAX_VARIANTS + 1) * CARPET_VTAB_ROWS },
]);

/** sampled-texture kinds for the pipeline bindings, slot order */
export const CARPET_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'uint', 'float']);
export const CARPET_TARGETS = Object.freeze(['rgba32uint', 'rgba32uint', 'r32uint']);

// Pure trace: needs (defined by the including module) `cu` (CarpetU), hashFastU, classTexel(i,j)->u32, nearTexel(i,j)->f32, windKnot(i)->f32, windAt.
export const CARPET_TRACE_WGSL = `
const NMAX: i32 = ${NMAX};
const ROOT_JITTER: f32 = ${f(ROOT_JITTER)};
const LEAN_CAP: f32 = ${f(LEAN_CAP)};
const LEAN_PER_MS: f32 = ${f(LEAN_PER_MS)};
const PATCH_LO: f32 = ${f(PATCH_LO)};
const PATCH_RANGE: f32 = ${f(PATCH_RANGE)};
const GUST_LO: f32 = ${f(GUST_LO)};
const GUST_RANGE: f32 = ${f(GUST_RANGE)};
const FADE_FP0: f32 = ${f(FADE_FP0)};
const FADE_FP1: f32 = ${f(FADE_FP1)};
const FADE_R0: f32 = ${f(FADE_R0)};
const FADE_R1: f32 = ${f(FADE_R1)};
const RING: i32 = ${RING};
const SALT_JX: i32 = ${SALT_JX};
const SALT_JY: i32 = ${SALT_JY};
const SALT_RANK: i32 = ${SALT_RANK};
const SALT_H: i32 = ${SALT_H};
const SALT_CJX: i32 = ${SALT_CJX};
const SALT_CJY: i32 = ${SALT_CJY};
const SALT_PATCH: i32 = ${SALT_PATCH};
const SALT_GUST: i32 = ${SALT_GUST};
const FP_DEFAULT_K: f32 = ${f(FP_DEFAULT_K)};
const FP_ANISO_T: f32 = ${f(FP_ANISO_T)};
const FP_ANISO_MAX: f32 = ${f(FP_ANISO_MAX)};
const BIG: f32 = 1.0e30; // JS Infinity

// the ray under test (set once per cell), the blade under test (sXxx) and the best blade so far (kXxx)
var<private> rEx: f32; var<private> rEy: f32; var<private> rEz: f32;
var<private> rDx: f32; var<private> rDy: f32; var<private> rDz: f32;
var<private> rN2: f32; var<private> rT0: f32; var<private> rT1: f32;
var<private> sLx: f32; var<private> sLy: f32; var<private> sH01: f32; var<private> sZ: f32; var<private> sTb: f32; var<private> sVar: u32; var<private> sTint: f32;
var<private> kLx: f32; var<private> kLy: f32; var<private> kH01: f32; var<private> kZ: f32; var<private> kTb: f32; var<private> kVar: u32; var<private> kTint: f32;

fn hash24(ix: i32, iy: i32, s: i32) -> f32 { return f32(hashFastU(ix, iy, s) >> 8u) * (1.0 / 16777216.0); }

fn classAt(x: f32, y: f32) -> u32 {
  let i = i32(floor((x - cu.classX0) / cu.classCellM));
  let j = i32(floor((y - cu.classY0) / cu.classCellM));
  if (i < 0 || j < 0 || i >= cu.classW || j >= cu.classHt) { return 0u; }
  return classTexel(i, j);
}

// near-band height, bilinear = design util.gridHeight inside the grid; outside the grid the edge value (the JS callback decides there)
fn ground(x: f32, y: f32) -> f32 {
  let fx = (x - cu.nearX0) / cu.nearCell - 0.5;
  let fy = (y - cu.nearY0) / cu.nearCell - 0.5;
  let i = clamp(i32(floor(fx)), 0, cu.nearW - 2);
  let j = clamp(i32(floor(fy)), 0, cu.nearHt - 2);
  let u = clamp(fx - f32(i), 0.0, 1.0);
  let v = clamp(fy - f32(j), 0.0, 1.0);
  let a = nearTexel(i, j); let b = nearTexel(i + 1, j); let c = nearTexel(i, j + 1); let d = nearTexel(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

fn vnoise(x: f32, y: f32, salt: i32) -> f32 {
  let ix = i32(floor(x)); let iy = i32(floor(y));
  var fx = x - f32(ix); var fy = y - f32(iy);
  fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
  let a = hash24(ix, iy, salt); let b = hash24(ix + 1, iy, salt); let c = hash24(ix, iy + 1, salt); let d = hash24(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// lean/h ratio of the blade rooted at (x, y) -> sLx, sLy (capped at LEAN_CAP)
fn leanRatio(x: f32, y: f32, v: u32) {
  if (cu.windOn == 0) { sLx = 0.0; sLy = 0.0; return; }
  let t = cu.timeSec;
  let w = windAt(x, y, t, cu.windP0.x, cu.windP0.y, cu.windP0.z, cu.windP0.w, cu.windP1.x, cu.windP1.y);
  let m = sqrt(w.x * w.x + w.y * w.y);
  if (m < 1.0e-9) { sLx = 0.0; sLy = 0.0; return; }
  let ux = w.x / m; let uy = w.y / m;
  let g = vnoise((x - ux * t * cu.travelM) / cu.gustM, (y - uy * t * cu.travelM) / cu.gustM, cu.seed + SALT_GUST);
  let l = min(m * LEAN_PER_MS * cu.vtab[v * ${CARPET_VTAB_ROWS}u + 1u].x * (GUST_LO + GUST_RANGE * g), LEAN_CAP);
  sLx = ux * l; sLy = uy * l;
}

// blade of lattice cell (ix, iy) vs the ray; true on a hit (tB, h01, z, variant, lean in sXxx)
fn bladeHit(ix: i32, iy: i32) -> bool {
  let c = cu.cellM; let seed = cu.seed;
  let rx = (f32(ix) + 0.5 + (hash24(ix, iy, seed + SALT_JX) * 2.0 - 1.0) * ROOT_JITTER) * c;
  let ry = (f32(iy) + 0.5 + (hash24(ix, iy, seed + SALT_JY) * 2.0 - 1.0) * ROOT_JITTER) * c;
  let cj = cu.classJitterM;
  let v = classAt(rx + (hash24(ix, iy, seed + SALT_CJX) * 2.0 - 1.0) * cj, ry + (hash24(ix, iy, seed + SALT_CJY) * 2.0 - 1.0) * cj);
  if (v == 0u) { return false; }
  let rank = hash24(ix, iy, seed + SALT_RANK);
  let row0 = cu.vtab[v * ${CARPET_VTAB_ROWS}u]; // density, hMin, hMax, bladeW
  if (rank >= row0.x) { return false; }
  let pn = vnoise(rx / cu.patchM, ry / cu.patchM, seed + SALT_PATCH);
  let h = (row0.y + (row0.z - row0.y) * hash24(ix, iy, seed + SALT_H)) * (PATCH_LO + PATCH_RANGE * pn);
  let w = row0.w * 0.5;
  let g = ground(rx, ry);
  leanRatio(rx, ry, v);
  let lx = sLx; let ly = sLy;
  var sh = 0.5 * h; var tc = 0.0;
  for (var k = 0; k < 3; k++) {
    tc = select(0.5 * (rT0 + rT1), ((rx + lx * sh - rEx) * rDx + (ry + ly * sh - rEy) * rDy) / rN2, rN2 > 1.0e-12);
    sh = rEz + tc * rDz - g;
    if (sh < 0.0) { sh = 0.0; } else if (sh > h) { sh = h; }
  }
  if (tc < rT0 || tc > rT1) { return false; }
  let zr = rEz + tc * rDz; let sr = zr - g;
  if (sr < 0.0 || sr > h) { return false; }
  let px = rEx + tc * rDx - (rx + lx * sr); let py = rEy + tc * rDy - (ry + ly * sr);
  if (px * px + py * py >= w * w) { return false; }
  // fade on the density threshold (one fixed disappearing distance per blade)
  let fpk = cu.fpK;
  let a = tc / FP_ANISO_T;
  let fp = select(select(FP_DEFAULT_K, -fpk, fpk < 0.0) * tc * clamp(a, 1.0, FP_ANISO_MAX), fpk, fpk > 0.0);
  let dXY = tc * sqrt(rN2);
  let f1 = clamp((fp / (2.0 * w) - FADE_FP0) / (FADE_FP1 - FADE_FP0), 0.0, 1.0);
  let f2 = clamp((dXY / cu.radiusM - FADE_R0) / (FADE_R1 - FADE_R0), 0.0, 1.0);
  let fade = (1.0 - f1 * f1 * (3.0 - 2.0 * f1)) * (1.0 - f2 * f2 * (3.0 - 2.0 * f2));
  if (rank >= row0.x * fade) { return false; }
  sTint = (hash24(ix, iy, seed + ${SALT_TINT}) * 2.0 - 1.0) * ${f(TINT_AMP)};
  sVar = v; sH01 = sr / h; sZ = zr; sTb = tc; sLx = lx; sLy = ly;
  return true;
}

// loads nothing: the ray globals are set by the caller; returns the lattice steps needed (0 = empty segment)
fn setRay(tHit: f32) -> i32 {
  rN2 = rDx * rDx + rDy * rDy;
  if (!(tHit > 0.0) || tHit >= BIG) { return 0; }
  let zTop = ground(rEx + tHit * rDx, rEy + tHit * rDy) + cu.maxH;
  var t0 = 0.0;
  if (rDz < 0.0 && rEz > zTop) { t0 = (zTop - rEz) / rDz; }
  let hxy = sqrt(rN2);
  var t1 = tHit;
  if (hxy > 1.0e-9) { let tr = cu.radiusM / hxy; if (tr < t1) { t1 = tr; } }
  if (t0 >= t1) { return 0; }
  rT0 = t0; rT1 = t1;
  let c = cu.cellM;
  let i0 = i32(floor((rEx + t0 * rDx) / c)); let j0 = i32(floor((rEy + t0 * rDy) / c));
  let i1 = i32(floor((rEx + t1 * rDx) / c)); let j1 = i32(floor((rEy + t1 * rDy) / c));
  return abs(i1 - i0) + abs(j1 - j0) + 1;
}

// traceCarpetIn twin. Set rEx..rDz first. true on a hit: kTb (metric distance), kH01, kVar, kLx, kLy, kZ.
fn traceCarpet(tHit: f32) -> bool {
  let steps = setRay(tHit);
  if (steps == 0 || steps > NMAX) { return false; }
  let c = cu.cellM;
  let hxy = sqrt(rN2);
  var ix = i32(floor((rEx + rT0 * rDx) / c)); var iy = i32(floor((rEy + rT0 * rDy) / c));
  let sx = select(-1, 1, rDx > 0.0); let sy = select(-1, 1, rDy > 0.0);
  let ddx = select(BIG, c / abs(rDx), abs(rDx) > 1.0e-12); let ddy = select(BIG, c / abs(rDy), abs(rDy) > 1.0e-12);
  var tx = select(BIG, ((select(f32(ix), f32(ix + 1), rDx > 0.0) * c) - rEx) / rDx, abs(rDx) > 1.0e-12);
  var ty = select(BIG, ((select(f32(iy), f32(iy + 1), rDy > 0.0) * c) - rEy) / rDy, abs(rDy) > 1.0e-12);
  var best = BIG; var tEnter = rT0;
  let margin = select(BIG, (f32(RING) + 1.5) * c / hxy, hxy > 1.0e-9);
  let windOn = cu.windOn != 0;
  let rej = ((0.7071 + ROOT_JITTER) * c + cu.wMax + LEAN_CAP * cu.maxH) * hxy;
  var prevCi = 1000000000; var prevCj = 1000000000;
  for (var stp = 0; stp < steps; stp++) {
    if (tEnter - margin > best) { break; }
    let tNext = select(ty, tx, tx < ty);
    var ci = ix; var cj = iy;
    if (windOn) {
      let tm = 0.5 * (tEnter + select(rT1, tNext, tNext < rT1));
      let px = rEx + tm * rDx; let py = rEy + tm * rDy;
      let sh = clamp(rEz + tm * rDz - ground(px, py), 0.0, cu.maxH);
      leanRatio(px, py, 0u);
      ci = i32(floor((px - sLx * sh) / c)); cj = i32(floor((py - sLy * sh) / c));
    }
    for (var j = cj - RING; j <= cj + RING; j++) {
      for (var i = ci - RING; i <= ci + RING; i++) {
        if (i - prevCi <= RING && prevCi - i <= RING && j - prevCj <= RING && prevCj - j <= RING) { continue; }
        if (hxy > 1.0e-9) {
          let cr = ((f32(i) + 0.5) * c - rEx) * rDy - ((f32(j) + 0.5) * c - rEy) * rDx;
          if (cr > rej || cr < -rej) { continue; }
        }
        if (bladeHit(i, j) && sTb < best) { best = sTb; kTb = sTb; kH01 = sH01; kZ = sZ; kVar = sVar; kTint = sTint; kLx = sLx; kLy = sLy; }
      }
    }
    prevCi = ci; prevCj = cj;
    if (tx < ty) { ix += sx; tEnter = tx; tx += ddx; } else { iy += sy; tEnter = ty; ty += ddy; }
  }
  return best < BIG;
}
`;

export const CARPET_WGSL = `${CARPET_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;
@group(0) @binding(1) var uGA: texture_2d<u32>;
@group(0) @binding(2) var uDepth: texture_2d<u32>;
@group(0) @binding(3) var uClass: texture_2d<u32>;
@group(0) @binding(4) var uNearH: texture_2d<f32>;
@group(1) @binding(0) var<uniform> cu: CarpetU;
${HASH_FAST_WGSL}
${WIND_AT_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FULLSCREEN_VS_WGSL}
${OCT_NORMAL_WGSL}
fn classTexel(i: i32, j: i32) -> u32 { return textureLoad(uClass, vec2i(i, j), 0).x; }
fn nearTexel(i: i32, j: i32) -> f32 { return textureLoad(uNearH, vec2i(i, j), 0).x; }
fn windKnot(i: u32) -> f32 { return cu.knots[i >> 2u][i & 3u]; }
const KIND_GRASS: u32 = ${KIND_GRASS}u;
const FACE_U: u32 = ${FACE_U}u;
${CARPET_TRACE_WGSL}
struct FO {
  @location(0) gi: vec4u,
  @location(1) ga: vec4u,
  @location(2) depth: vec4u,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  var o: FO;
  let gi = textureLoad(uGI, cell, 0);
  let ga = textureLoad(uGA, cell, 0);
  let dp = textureLoad(uDepth, cell, 0);
  o.gi = gi; o.ga = ga; o.depth = dp;
  if ((gi.y & 0xffu) == 0u) { return o; } // sky: no hit distance
  let F = vec3f(cu.pitchA.x, cu.pitchA.y, cu.pitchA.z);
  let dir = cellDirPitched(vec2f(f32(cell.x), f32(cell.y)), vec2i(cu.gridCols, cu.gridRows), F, vec2f(cu.pitchB.x, cu.pitchB.y),
    vec3f(cu.pitchB.z, cu.pitchB.w, cu.pitchC.x), vec2f(cu.pitchA.w, cu.pitchC.y));
  let dirLen = sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  rEx = cu.eye.x; rEy = cu.eye.y; rEz = cu.eye.z;
  rDx = dir.x / dirLen; rDy = dir.y / dirLen; rDz = dir.z / dirLen;
  if (!traceCarpet(bitcast<f32>(dp.x) * dirLen)) { return o; }
  // screen right in xy = (dy, -dx) / |d_xy|; lean ratio / LEAN_CAP
  let inv = select(0.0, 1.0 / sqrt(rN2), rN2 > 1.0e-12);
  let lean = clamp((kLx * rDy - kLy * rDx) * inv / LEAN_CAP, -1.0, 1.0);
  let invN = 1.0 / sqrt(kLx * kLx + kLy * kLy + 1.0);
  o.gi = vec4u(gi.x, KIND_GRASS | (FACE_U << 8u) | (gi.y & 0xf000u) | (kVar << 16u), packNormalOct(vec3f(kLx * invN, kLy * invN, invN)), gi.w); // lean-tilted normal (twin: alias in carpetCells)
  o.ga = vec4u(bitcast<u32>(kH01), bitcast<u32>(lean), bitcast<u32>(kZ), bitcast<u32>(kTint)); // GA.w = per-blade colour shift (twin: gbuf.vao)
  o.depth = vec4u(bitcast<u32>(kTb / dirLen), 0u, 0u, 0u);
  return o;
}
`;
