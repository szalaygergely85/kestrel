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
import { HASH_FAST_WGSL, GBUF_UNPACK_WGSL, CELL_RAY_PITCHED_WGSL, WIND_AT_WGSL, FULLSCREEN_VS_WGSL, OCT_NORMAL_WGSL } from './common.wgsl.js';
import {
  NMAX, ROOT_JITTER, LEAN_CAP, LEAN_PER_MS, PATCH_LO, PATCH_RANGE, GUST_LO, GUST_RANGE, MINW_CELLS, LOD_CUT, RING,
  SALT_JX, SALT_JY, SALT_RANK, SALT_SHAPE, SALT_ROT, SALT_H, SALT_TUFT, SALT_W, WMAX_CELLS, W_JIT_LO, W_JIT_RANGE, SALT_CJX, SALT_CJY, SALT_PATCH, SALT_GUST, MAX_VARIANTS, SALT_TINT, MASK_CELL, MASK_MIN,
} from '../../carpet.js';
import { NOISE_CELLS, NOISE_SALT, PATCH_K, GRASS_GX_HAS, GRASS_LOOK_SALT } from '../../terrainShade.js';
import { TS_PATCH_NOISE_WGSL } from './shade.wgsl.js';
import { FP_DEFAULT_K, FP_ANISO_T, FP_ANISO_MAX } from '../../terrainShade.js';

import { KIND_GRASS, KIND_TERRAIN, FACE_U } from '../../GBuffer.js';
export { KIND_GRASS, FACE_U }; // one owner: GBuffer.js (D2c landed)
export const CARPET_VTAB_ROWS = 2;          // vec4 rows per variant: (density, hMin, hMax, bladeW), (swayGain, tuftP, tuftMul, 0). Ramp/glyphs: D2e table
export const CARPET_KNOTS = 16;             // 64 wind knots as 16 vec4
const f = (v) => { const s = String(v); return /[.e]/.test(s) ? s : s + '.0'; }; // f32 literal text

export const CARPET_BLOCK = defineUniformBlock('CarpetU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'seed', type: 'i32' }, { name: 'windOn', type: 'i32' },
  { name: 'classW', type: 'i32' }, { name: 'classHt', type: 'i32' }, { name: 'nearW', type: 'i32' }, { name: 'nearHt', type: 'i32' },
  { name: 'cellM', type: 'f32' }, { name: 'radiusM', type: 'f32' }, { name: 'patchM', type: 'f32' }, { name: 'classCellM', type: 'f32' },
  { name: 'classJitterM', type: 'f32' }, { name: 'gustM', type: 'f32' }, { name: 'travelM', type: 'f32' }, { name: 'timeSec', type: 'f32' },
  { name: 'classX0', type: 'f32' }, { name: 'classY0', type: 'f32' }, { name: 'nearX0', type: 'f32' }, { name: 'nearY0', type: 'f32' },
  { name: 'nearCell', type: 'f32' }, { name: 'maxH', type: 'f32' }, { name: 'wMax', type: 'f32' }, { name: 'fpK', type: 'f32' }, // fpK: <0 = -k, >0 fixed cell, 0 = default k (shade hashCell)
  { name: 'maxHNear', type: 'f32' }, { name: 'tFade', type: 'f32' }, { name: 'leanMaxR', type: 'f32' }, // TUFT-PERF-01b exact culls (carpet.js setCarpetBounds, packed per frame by passCarpet); windOn = lean on (leanMaxR * maxHNear > 0)
  { name: 'windP0', type: 'vec4' },   // dirX, dirY, speed, amp
  { name: 'windP1', type: 'vec4' },   // period (ticks), travel, 0, 0
  { name: 'eye', type: 'vec4' },      // x, y, z, 0
  { name: 'pitchA', type: 'vec4' },   // F.xyz, tanHalfX   (same words as the light pass)
  { name: 'pitchB', type: 'vec4' },   // R.xy, U.xy
  { name: 'pitchC', type: 'vec4' },   // U.z, tanHalfY, 0, 0
  { name: 'knots', type: 'vec4', count: CARPET_KNOTS },
  { name: 'vtab', type: 'vec4', count: (MAX_VARIANTS + 1) * CARPET_VTAB_ROWS },
  // PREC-01a (D2e): lattice origin = floor(eye / cellM) as i32 + its world position; `eye` holds eye - origin (camera-relative, small), so the ray / DDA /
  // blade-vs-ray maths never sees a ~1500 m f32. World lookups (class, near height, noise, wind) add the origin back (grid-relative, accuracy ~1e-4 m is plenty).
  { name: 'ix0', type: 'i32' }, { name: 'iy0', type: 'i32' }, { name: 'orgX', type: 'f32' }, { name: 'orgY', type: 'f32' },
  // MASK-c: density mask window (r8unorm texel i = world x0 + (i + 0.5) * MASK_CELL; maskOn 0 = no mask) and the sun for the back-light (xyz unit toward the sun, w = on)
  { name: 'maskX0', type: 'f32' }, { name: 'maskY0', type: 'f32' }, { name: 'maskW', type: 'i32' }, { name: 'maskHt', type: 'i32' }, { name: 'maskOn', type: 'i32' },
  { name: 'sun', type: 'vec4' },
  // TUFT-01b: tuft atlas (rg8uint, shape k = rows k*atlasH .. k*atlasH+atlasH-1). tufts 0 = single blades (old path)
  { name: 'tufts', type: 'i32' }, { name: 'atlasN', type: 'i32' }, { name: 'atlasW', type: 'i32' }, { name: 'atlasH', type: 'i32' },
  { name: 'tuftR', type: 'f32' }, { name: 'rootJit', type: 'f32' },
  // OB-103: far grass: density scale + min on-screen stroke width (cells) from world.setCarpetQuality (radiusM above holds the scaled radius); fadeStart from content
  { name: 'densScale', type: 'f32' }, { name: 'minWCells', type: 'f32' }, { name: 'fadeStart', type: 'f32' },
]);

/** sampled-texture kinds for the pipeline bindings, slot order */
export const CARPET_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'uint', 'float', 'uint', 'uint']); // slot 5 = density mask (r8ui, value / 255), 6 = tuft atlas (rg8ui)
export const CARPET_TARGETS = Object.freeze(['rgba32ui', 'rgba32ui', 'r32ui']); // device format names (webgpuFormats.js), not the WebGPU ones

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
const LOD_CUT: f32 = ${f(LOD_CUT)};
const RING: i32 = ${RING};
const SALT_JX: i32 = ${SALT_JX};
const SALT_JY: i32 = ${SALT_JY};
const SALT_RANK: i32 = ${SALT_RANK};
const SALT_H: i32 = ${SALT_H};
const SALT_CJX: i32 = ${SALT_CJX};
const SALT_CJY: i32 = ${SALT_CJY};
const SALT_PATCH: i32 = ${SALT_PATCH};
const SALT_GUST: i32 = ${SALT_GUST};
const SALT_TUFT: i32 = ${SALT_TUFT};
const SALT_W: i32 = ${SALT_W};
const SALT_SHAPE: i32 = ${SALT_SHAPE};
const SALT_ROT: i32 = ${SALT_ROT};
const PI: f32 = 3.14159265358979;
const WMAX_CELLS: f32 = ${f(WMAX_CELLS)};
const MINW_CELLS: f32 = ${f(MINW_CELLS)}; // default of cu.minWCells (JS carpet.js export; the uniform is what the shader reads)
const W_JIT_LO: f32 = ${f(W_JIT_LO)};
const W_JIT_RANGE: f32 = ${f(W_JIT_RANGE)};
const FP_DEFAULT_K: f32 = ${f(FP_DEFAULT_K)};
const FP_ANISO_T: f32 = ${f(FP_ANISO_T)};
const FP_ANISO_MAX: f32 = ${f(FP_ANISO_MAX)};
const BIG: f32 = 1.0e30; // JS Infinity

// the ray under test (set once per cell), the blade under test (sXxx) and the best blade so far (kXxx)
var<private> rEx: f32; var<private> rEy: f32; var<private> rEz: f32;
var<private> rDx: f32; var<private> rDy: f32; var<private> rDz: f32;
var<private> rN2: f32; var<private> rT0: f32; var<private> rT1: f32;
var<private> sLx: f32; var<private> sLy: f32; var<private> sH01: f32; var<private> sZ: f32; var<private> sTb: f32; var<private> sVar: u32; var<private> sTint: u32; var<private> sRx: f32; var<private> sRy: f32; var<private> sFp: f32;
var<private> kLx: f32; var<private> kLy: f32; var<private> kH01: f32; var<private> kZ: f32; var<private> kTb: f32; var<private> kVar: u32; var<private> kTint: u32; var<private> kRx: f32; var<private> kRy: f32; var<private> kFp: f32;
const MASK_CELL: f32 = ${f(MASK_CELL)};
const MASK_MIN: f32 = ${f(MASK_MIN)};

fn hash24(ix: i32, iy: i32, s: i32) -> f32 { return f32(hashFastU(ix, iy, s) >> 8u) * (1.0 / 16777216.0); }

// MASK-c: density mask 0..1 at world (x, y): 4-tap bilerp of cell-centre texels (textureLoad, no sampler = twin of carpet.js maskAt); outside the window = 1 (no mask)
fn maskAt(x: f32, y: f32) -> f32 {
  if (cu.maskOn == 0) { return 1.0; }
  let fx = (x - cu.maskX0) / MASK_CELL - 0.5;
  let fy = (y - cu.maskY0) / MASK_CELL - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > f32(cu.maskW) - 0.5 || fy > f32(cu.maskHt) - 0.5) { return 1.0; }
  let x0 = i32(floor(fx)); let y0 = i32(floor(fy));
  let u = fx - f32(x0); let v = fy - f32(y0);
  let xa = max(x0, 0); let xb = min(x0 + 1, cu.maskW - 1);
  let ya = max(y0, 0); let yb = min(y0 + 1, cu.maskHt - 1);
  let a = maskTexel(xa, ya); let b = maskTexel(xb, ya); let c = maskTexel(xa, yb); let d = maskTexel(xb, yb);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

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

// TUFT-01b (twin of carpet.js tuftHit, same order of operations): the tuft of lattice cell (ix, iy) = 2 crossed lean-sheared vertical planes + one
// atlas texel each (textureLoad, no sampler). Returns 0 miss, 1 hit, 2 = culled by the exact root distance (not a test).
fn tuftHit(ix: i32, iy: i32) -> i32 {
  let c = cu.cellM; let seed = cu.seed; let rj = cu.rootJit;
  let jx = (hash24(ix, iy, seed + SALT_JX) * 2.0 - 1.0) * rj;
  let jy = (hash24(ix, iy, seed + SALT_JY) * 2.0 - 1.0) * rj;
  let rx = (f32(ix - cu.ix0) + 0.5 + jx) * c;
  let ry = (f32(iy - cu.iy0) + 0.5 + jy) * c;
  let wxr = rx + cu.orgX; let wyr = ry + cu.orgY;
  let hxy = sqrt(rN2);
  let cr = (rx - rEx) * rDy - (ry - rEy) * rDx;
  let reach = (cu.tuftR * c * (W_JIT_LO + W_JIT_RANGE) + cu.leanMaxR * cu.maxHNear) * hxy;
  if (cr > reach || cr < -reach) { return 2; }
  let cj = cu.classJitterM;
  let v = classAt(wxr + (hash24(ix, iy, seed + SALT_CJX) * 2.0 - 1.0) * cj, wyr + (hash24(ix, iy, seed + SALT_CJY) * 2.0 - 1.0) * cj);
  if (v == 0u) { return 0; }
  let mk = maskAt(wxr, wyr);
  if (mk < MASK_MIN) { return 0; }
  let rank = hash24(ix, iy, seed + SALT_RANK);
  let row0 = cu.vtab[v * ${CARPET_VTAB_ROWS}u];
  let dens = min(1.0, row0.x * cu.densScale);
  if (rank >= dens) { return 0; }
  let pn = vnoise(wxr / cu.patchM, wyr / cu.patchM, seed + SALT_PATCH);
  let row1 = cu.vtab[v * ${CARPET_VTAB_ROWS}u + 1u];
  var h = (row0.y + (row0.z - row0.y) * hash24(ix, iy, seed + SALT_H)) * (PATCH_LO + PATCH_RANGE * pn);
  if (hash24(ix, iy, seed + SALT_TUFT) < row1.y) { h = h * row1.z; }
  h = h * mk;
  let R = cu.tuftR * c * (W_JIT_LO + W_JIT_RANGE * hash24(ix, iy, seed + SALT_W));
  leanRatio(wxr, wyr, v);
  let lx = sLx; let ly = sLy;
  if (cu.windOn != 0) {
    let lr = sqrt(lx * lx + ly * ly) * h; let reach2 = (R + lr) * hxy;
    if (cr > reach2 || cr < -reach2) { return 2; }
  }
  let g = ground(wxr, wyr);
  let shape = i32(((hashFastU(ix, iy, seed + SALT_SHAPE) >> 8u) * u32(cu.atlasN)) >> 24u);
  let ang = hash24(ix, iy, seed + SALT_ROT) * PI;
  let cs = cos(ang); let sn = sin(ang);
  let aw = cu.atlasW; let ah = cu.atlasH;
  let wStroke = row0.w * 0.5; let texM = 2.0 * R / f32(aw); let lz = rEz - g;
  var bestT = BIG; var bestH01 = 0.0;
  for (var pl = 0; pl < 2; pl++) {
    let nx = select(-sn, cs, pl == 0); let ny = select(cs, sn, pl == 0);
    let den = nx * (rDx - lx * rDz) + ny * (rDy - ly * rDz);
    if (den < 1.0e-6 && den > -1.0e-6) { continue; }
    let t = (nx * (rx + lx * lz - rEx) + ny * (ry + ly * lz - rEy)) / den;
    if (t < rT0 || t > rT1 || t >= bestT) { continue; }
    let sr = rEz + t * rDz - g;
    if (sr < 0.0 || sr > h) { continue; }
    let u = ((rEx + t * rDx - rx - lx * sr) * -ny + (rEy + t * rDy - ry - ly * sr) * nx) / R;
    if (u < -1.0 || u > 1.0) { continue; }
    var col = i32((u * 0.5 + 0.5) * f32(aw)); var row = i32((sr / h) * f32(ah));
    if (col >= aw) { col = aw - 1; }
    if (row >= ah) { row = ah - 1; }
    let tx = atlasTexel(col, shape * ah + row);
    if (tx.x == 0u) { continue; }
    let fpk0 = cu.fpK; let a0 = t / FP_ANISO_T;
    let fp0 = select(select(FP_DEFAULT_K, -fpk0, fpk0 < 0.0) * t * clamp(a0, 1.0, FP_ANISO_MAX), fpk0, fpk0 > 0.0);
    let wCap = WMAX_CELLS * 0.5 * fp0; let wMin = cu.minWCells * 0.5 * fp0; let wHit = clamp(wStroke, wMin, wCap);
    if (f32(tx.y) * (1.0 / 32.0) * texM >= wHit) { continue; }
    let lod = clamp(wMin / wStroke - 1.0, 0.0, 1.0);
    if (f32(tx.x - 1u) * (1.0 / 253.0) < LOD_CUT * lod) { continue; }
    bestT = t; bestH01 = f32(tx.x - 1u) * (1.0 / 253.0);
  }
  if (bestT >= BIG) { return 0; }
  let tc = bestT; let zr = rEz + tc * rDz;
  let fpk = cu.fpK; let a = tc / FP_ANISO_T;
  let fp = select(select(FP_DEFAULT_K, -fpk, fpk < 0.0) * tc * clamp(a, 1.0, FP_ANISO_MAX), fpk, fpk > 0.0);
  let dXY = tc * hxy;
  let f2 = clamp((dXY / cu.radiusM - cu.fadeStart) / (1.0 - cu.fadeStart), 0.0, 1.0);
  let fade = 1.0 - f2 * f2 * (3.0 - 2.0 * f2);
  if (rank >= dens * fade) { return 0; }
  sTint = hashFastU(ix, iy, seed + ${SALT_TINT}) >> 24u;
  sVar = v; sH01 = bestH01; sZ = zr; sTb = tc; sLx = lx; sLy = ly; sRx = wxr; sRy = wyr; sFp = fp;
  return 1;
}

fn cellHit(ix: i32, iy: i32) -> i32 {
  if (cu.tufts != 0) { return tuftHit(ix, iy); }
  return select(0, 1, bladeHit(ix, iy));
}

// blade of lattice cell (ix, iy) vs the ray; true on a hit (tB, h01, z, variant, lean in sXxx)
fn bladeHit(ix: i32, iy: i32) -> bool {
  let c = cu.cellM; let seed = cu.seed;
  let jx = (hash24(ix, iy, seed + SALT_JX) * 2.0 - 1.0) * ROOT_JITTER;
  let jy = (hash24(ix, iy, seed + SALT_JY) * 2.0 - 1.0) * ROOT_JITTER;
  let rx = (f32(ix - cu.ix0) + 0.5 + jx) * c; // origin-relative root (ray maths)
  let ry = (f32(iy - cu.iy0) + 0.5 + jy) * c;
  let wxr = rx + cu.orgX; let wyr = ry + cu.orgY; // world root (lookups only)
  let cj = cu.classJitterM;
  let v = classAt(wxr + (hash24(ix, iy, seed + SALT_CJX) * 2.0 - 1.0) * cj, wyr + (hash24(ix, iy, seed + SALT_CJY) * 2.0 - 1.0) * cj);
  if (v == 0u) { return false; }
  let mk = maskAt(wxr, wyr); // MASK-c: after the variant pick, at the blade root
  if (mk < MASK_MIN) { return false; }
  let rank = hash24(ix, iy, seed + SALT_RANK);
  let row0 = cu.vtab[v * ${CARPET_VTAB_ROWS}u]; // density, hMin, hMax, bladeW; row1 = swayGain, tuftP, tuftMul
  let dens = min(1.0, row0.x * cu.densScale);
  if (rank >= dens) { return false; }
  let pn = vnoise(wxr / cu.patchM, wyr / cu.patchM, seed + SALT_PATCH);
  let row1 = cu.vtab[v * ${CARPET_VTAB_ROWS}u + 1u]; // swayGain, tuftP, tuftMul
  var h = (row0.y + (row0.z - row0.y) * hash24(ix, iy, seed + SALT_H)) * (PATCH_LO + PATCH_RANGE * pn);
  if (hash24(ix, iy, seed + SALT_TUFT) < row1.y) { h = h * row1.z; }
  h = h * mk; // MASK-c: height falls gradually with the mask, density unchanged
  let w = row0.w * 0.5 * (W_JIT_LO + W_JIT_RANGE * hash24(ix, iy, seed + SALT_W));
  let g = ground(wxr, wyr);
  leanRatio(wxr, wyr, v);
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
  // footprint first (OB-096): the lateral test caps the hit width at WMAX_CELLS footprints
  let fpk = cu.fpK;
  let a = tc / FP_ANISO_T;
  let fp = select(select(FP_DEFAULT_K, -fpk, fpk < 0.0) * tc * clamp(a, 1.0, FP_ANISO_MAX), fpk, fpk > 0.0);
  let wCap = WMAX_CELLS * 0.5 * fp; let wMin = cu.minWCells * 0.5 * fp; let wHit = clamp(w, wMin, wCap);
  if (px * px + py * py >= wHit * wHit) { return false; }
  // fade on the density threshold (one fixed disappearing distance per blade, true w)
  let dXY = tc * sqrt(rN2);
  let f2 = clamp((dXY / cu.radiusM - cu.fadeStart) / (1.0 - cu.fadeStart), 0.0, 1.0);
  let fade = 1.0 - f2 * f2 * (3.0 - 2.0 * f2);
  if (rank >= dens * fade) { return false; }
  sTint = hashFastU(ix, iy, seed + ${SALT_TINT}) >> 24u; // tint byte (twin: carpet.js writeBlade)
  sVar = v; sH01 = sr / h; sZ = zr; sTb = tc; sLx = lx; sLy = ly; sRx = wxr; sRy = wyr; sFp = fp;
  return true;
}

// ix/iy/ci/cj/i/j in traceCarpet are origin-relative lattice indices (global = + cu.ix0/iy0); the ray eye rEx/rEy is eye - origin.
// loads nothing: the ray globals are set by the caller; returns the lattice steps needed (0 = empty segment)
fn setRay(tHit: f32) -> i32 {
  rN2 = rDx * rDx + rDy * rDy;
  if (!(tHit > 0.0) || tHit >= BIG) { return 0; }
  let gEnd = ground(rEx + tHit * rDx + cu.orgX, rEy + tHit * rDy + cu.orgY);
  let zTop = gEnd + cu.maxHNear;
  var t0 = 0.0;
  if (rDz < 0.0 && rEz > zTop) { t0 = (zTop - rEz) / rDz; }
  let hxy = sqrt(rN2);
  var t1 = tHit;
  if (hxy > 1.0e-9) { let tr = cu.radiusM / hxy; if (tr < t1) { t1 = tr; } }
  t1 = min(t1, cu.tFade); // TUFT-PERF-01b: past tFade the fade is 0
  if (rDz > 0.0) { // ascending: above the blade layer for good
    let gTop = max(gEnd, ground(rEx + cu.orgX, rEy + cu.orgY)) + cu.maxHNear;
    t1 = min(t1, (gTop - rEz) / rDz);
  }
  if (t0 >= t1) { return 0; }
  rT0 = t0; rT1 = t1;
  let c = cu.cellM;
  let i0 = i32(floor((rEx + t0 * rDx) / c)); let j0 = i32(floor((rEy + t0 * rDy) / c)); // origin-relative lattice indices
  let i1 = i32(floor((rEx + t1 * rDx) / c)); let j1 = i32(floor((rEy + t1 * rDy) / c));
  return abs(i1 - i0) + abs(j1 - j0) + 1;
}

// traceCarpetIn twin. Set rEx..rDz first. true on a hit: kTb (metric distance), kH01, kVar, kLx, kLy, kZ.
fn traceCarpet(tHit: f32) -> bool {
  let steps = setRay(tHit);
  if (steps == 0) { return false; }
  let nSteps = min(steps, NMAX); // OB-101: truncate far, never drop the whole ray
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
  let rej = ((0.7071 + cu.rootJit) * c + cu.wMax + cu.leanMaxR * cu.maxHNear) * hxy;
  var prevCi = 1000000000; var prevCj = 1000000000;
  for (var stp = 0; stp < nSteps; stp++) {
    if (tEnter - margin > best) { break; }
    let tNext = select(ty, tx, tx < ty);
    var ci = ix; var cj = iy;
    if (windOn) {
      let tm = 0.5 * (tEnter + select(rT1, tNext, tNext < rT1));
      let px = rEx + tm * rDx; let py = rEy + tm * rDy;
      let sh = clamp(rEz + tm * rDz - ground(px + cu.orgX, py + cu.orgY), 0.0, cu.maxH);
      leanRatio(px + cu.orgX, py + cu.orgY, 0u);
      ci = i32(floor((px - sLx * sh) / c)); cj = i32(floor((py - sLy * sh) / c));
    }
    for (var j = cj - RING; j <= cj + RING; j++) {
      for (var i = ci - RING; i <= ci + RING; i++) {
        if (i - prevCi <= RING && prevCi - i <= RING && j - prevCj <= RING && prevCj - j <= RING) { continue; }
        if (hxy > 1.0e-9) {
          let cr = ((f32(i) + 0.5) * c - rEx) * rDy - ((f32(j) + 0.5) * c - rEy) * rDx;
          if (cr > rej || cr < -rej) { continue; }
        }
        if (cellHit(i + cu.ix0, j + cu.iy0) == 1 && sTb < best) { best = sTb; kTb = sTb; kH01 = sH01; kZ = sZ; kVar = sVar; kTint = sTint; kLx = sLx; kLy = sLy; kRx = sRx; kRy = sRy; kFp = sFp; }
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
@group(0) @binding(5) var uMask: texture_2d<u32>;
@group(0) @binding(6) var uAtlas: texture_2d<u32>;
@group(1) @binding(0) var<uniform> cu: CarpetU;
${HASH_FAST_WGSL}
${GBUF_UNPACK_WGSL}
${WIND_AT_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FULLSCREEN_VS_WGSL}
${OCT_NORMAL_WGSL}
fn classTexel(i: i32, j: i32) -> u32 { return textureLoad(uClass, vec2i(i, j), 0).x; }
fn nearTexel(i: i32, j: i32) -> f32 { return textureLoad(uNearH, vec2i(i, j), 0).x; }
fn maskTexel(i: i32, j: i32) -> f32 { return f32(textureLoad(uMask, vec2i(i, j), 0).x) * (1.0 / 255.0); }
fn atlasTexel(i: i32, j: i32) -> vec2u { return textureLoad(uAtlas, vec2i(i, j), 0).xy; }
fn windKnot(i: u32) -> f32 { return cu.knots[i >> 2u][i & 3u]; }
const KIND_GRASS: u32 = ${KIND_GRASS}u;
const FACE_U: u32 = ${FACE_U}u;
const KIND_TERRAIN: u32 = ${KIND_TERRAIN}u;
${TS_PATCH_NOISE_WGSL}
${CARPET_TRACE_WGSL}
struct FO {
  @location(0) gi: vec4u,
  @location(1) ga: vec4u,
  @location(2) depth: vec4u,
};

// ENV-02e (twin: terrainShade.js grassLookId): the terrain hit's look word (GA.w < 65536 = look pipeline; else 0) -> the blade's dithered look id 0..15.
fn grassLookPick(word: u32, fu: f32, fv: f32) -> u32 {
  if (word >= 65536u) { return 0u; }
  var lo = word & 15u; var hi = (word >> 4u) & 15u; var wb = (word >> 8u) & 255u;
  if ((lo | hi) == 0u) { return 0u; }
  if (lo == 0u) { lo = hi; wb = 0u; } else if (hi == 0u) { hi = lo; wb = 0u; } else if (lo == hi) { wb = 0u; }
  let h24 = hashFastU(i32(floor(fu * 4.0)), i32(floor(fv * 4.0)), ${GRASS_LOOK_SALT}) >> 8u;
  return select(lo, hi, wb * 16777216u > h24 * 255u);
}
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
  // MASK-c (twin: carpet.js writeBlade): the terrain normal under the blade stays (lit like the ground); GA.w = packed word
  // tint byte | back-light byte << 8 | ground type << 16 | (tier offset + 1) << 24 | HAS
  var nrm = gi.z; var gx = 0u;
  let mat0 = giMat(gi.y);
  if ((gi.y & 0xffu) == KIND_TERRAIN && mat0 < 256u) {
    let fu = kRx; let fv = kRy; // world root (f32)
    let v8 = tsValueNoise(fu * ${(1 / NOISE_CELLS[0]).toFixed(4)}, fv * ${(1 / NOISE_CELLS[0]).toFixed(4)}, ${NOISE_SALT});
    let offT = clamp(i32(floor(tsPatchNoise(fu, fv, kFp, v8) * ${PATCH_K.toFixed(4)} + 0.5)), -1, 1);
    gx = ${GRASS_GX_HAS}u + (u32(offT + 1) << 24u) + (mat0 << 16u);
    gx += grassLookPick(ga.w, fu, fv) << 28u; // ENV-02e (twin: carpet.js writeBlade)
  } else {
    let invN = 1.0 / sqrt(kLx * kLx + kLy * kLy + 1.0);
    nrm = packNormalOct(vec3f(kLx * invN, kLy * invN, invN));
  }
  var bl = 0.0;
  if (cu.sun.w > 0.5) { bl = clamp(rDx * cu.sun.x + rDy * cu.sun.y + rDz * cu.sun.z, 0.0, 1.0); }
  gx = gx + kTint + u32(floor(bl * 255.0 + 0.5)) * 256u;
  o.gi = vec4u(gi.x, KIND_GRASS | (FACE_U << 8u) | (gi.y & 0xf000u) | (kVar << 16u), nrm, gi.w);
  o.ga = vec4u(bitcast<u32>(kH01), bitcast<u32>(lean), bitcast<u32>(kZ), gx);
  o.depth = vec4u(bitcast<u32>(kTb / dirLen), 0u, 0u, 0u);
  return o;
}
`;
