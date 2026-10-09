import { STEP } from '../../../core/loop.js';
import { WIND_K_SIZE } from '../../../world/wind.js';
import { AO_RADIUS_M, AO_BIAS } from '../../horizonAo.js';

// WG-3a (docs/architecture.md 38.5): WGSL twins of the shared GLSL snippets in glsl/common.js that more than one
// module needs. Pure strings, no GPU globals. No raw `%` anywhere (38.5 item 1); add fmodGlsl/imod/umod here when a
// later pass needs them.

// twin of glsl/common.js GBUF_UNPACK. GI.x = planeId (bit pattern, equality only);
// GI.y = kind | face<<8 | mask<<12 | cov<<13 | mat<<16
export const GBUF_UNPACK_WGSL = `
fn giKind(y: u32) -> u32 { return y & 0xffu; }
fn giFace(y: u32) -> u32 { return (y >> 8u) & 0xfu; }
fn giMask(y: u32) -> u32 { return (y >> 12u) & 0x1u; }
fn giCov(y: u32) -> u32 { return (y >> 13u) & 0x7u; }
fn giMat(y: u32) -> u32 { return (y >> 16u) & 0xffffu; }
`;

// Fullscreen triangle (same vertex stage as present/debug); the fragment stage indexes with @builtin(position).xy.
export const FULLSCREEN_VS_WGSL = `
@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let pos = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
  return vec4f(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

// twin of glsl/common.js CELL_RAY: world-space surface point of screen cell `cell` at resolved depth `dist` (shear camera).
// `grid` is (cols, rows) as vec2i (GLSL ivec2).
export const CELL_RAY_WGSL = `
fn cellRayP(cell: vec2f, grid: vec2i, posX: f32, posY: f32, eyeH: f32,
    dirX: f32, dirY: f32, planeX: f32, planeY: f32,
    horizonRow: f32, planeDistY: f32, dist: f32) -> vec3f {
  let cameraX = (2.0 * (cell.x + 0.5)) / f32(grid.x) - 1.0;
  let rayDirX = dirX + planeX * cameraX;
  let rayDirY = dirY + planeY * cameraX;
  let slope = -(cell.y - horizonRow) / planeDistY;
  return vec3f(posX + rayDirX * dist, posY + rayDirY * dist, eyeH + slope * dist);
}
`;

// twin of glsl/common.js CELL_RAY_PITCHED's pure functions (the uniform-driven wrappers pitchedCellDir/fogScaleCell
// need the module's own uniform block and are written per module).
export const CELL_RAY_PITCHED_WGSL = `
fn cellDirPitched(cell: vec2f, grid: vec2i, F: vec3f, R: vec2f, U: vec3f, tanHalf: vec2f) -> vec3f {
  let a = ((2.0 * (cell.x + 0.5)) / f32(grid.x) - 1.0) * tanHalf.x;
  let b = (1.0 - (2.0 * cell.y) / f32(grid.y)) * tanHalf.y;
  return vec3f(F.x + a * R.x + b * U.x, F.y + a * R.y + b * U.y, F.z + b * U.z);
}

fn cellRayPitched(cell: vec2f, grid: vec2i, eye: vec3f, F: vec3f, R: vec2f, U: vec3f, tanHalf: vec2f, vd: f32) -> vec3f {
  let dir = cellDirPitched(cell, grid, F, R, U, tanHalf);
  return vec3f(eye.x + dir.x * vd, eye.y + dir.y * vd, eye.z + dir.z * vd);
}

fn pitchFogScale(row: i32, rows: i32, tanHalfY: f32, cosP: f32, sinP: f32) -> f32 {
  let b = (1.0 - (2.0 * f32(row)) / f32(rows)) * tanHalfY;
  return max(0.0, cosP - b * sinP);
}
`;

// twin of glsl/common.js FALLOFF_FAST (design/palette.js util.falloff)
export const FALLOFF_FAST_WGSL = `
fn falloffFast(d: f32, r: f32) -> f32 {
  if (d >= r) { return 0.0; }
  var x = d / r; x = 1.0 - x * x;
  return x * x;
}
`;

// twin of glsl/common.js OCT_NORMAL / engine/voxel/octNormal.js (qx | qy << 16)
export const OCT_NORMAL_WGSL = `
fn packNormalOct(n: vec3f) -> u32 {
  let s = abs(n.x) + abs(n.y) + abs(n.z);
  var x = n.x / s; var y = n.y / s; let z = n.z / s;
  if (z < 0.0) {
    let ax = abs(x); let ay = abs(y);
    let sx = select(-1.0, 1.0, x >= 0.0); let sy = select(-1.0, 1.0, y >= 0.0);
    let nxp = (1.0 - ay) * sx; let nyp = (1.0 - ax) * sy;
    x = nxp; y = nyp;
  }
  let qx = u32(clamp(floor((x * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  let qy = u32(clamp(floor((y * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  return qx | (qy << 16u);
}

fn unpackNormalOct(bits: u32) -> vec3f {
  let qx = bits & 0xFFFFu;
  let qy = (bits >> 16u) & 0xFFFFu;
  var x = (f32(qx) / 65535.0) * 2.0 - 1.0;
  var y = (f32(qy) / 65535.0) * 2.0 - 1.0;
  let z = 1.0 - abs(x) - abs(y);
  if (z < 0.0) {
    let ax = abs(x); let ay = abs(y);
    let sx = select(-1.0, 1.0, x >= 0.0); let sy = select(-1.0, 1.0, y >= 0.0);
    let ox = (1.0 - ay) * sx; let oy = (1.0 - ax) * sy;
    x = ox; y = oy;
  }
  return normalize(vec3f(x, y, z));
}
`;

// WG-3c: GLSL `mod(x, y)` (floor-mod: x - y * floor(x / y)) and int `%` (truncated: a - b * (a / b), WGSL integer `/` truncates toward zero) without a raw `%` token.
export const FMOD_WGSL = `
fn fmodGlsl(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn imod(a: i32, b: i32) -> i32 { return a - b * (a / b); }
fn umod(a: u32, b: u32) -> u32 { return a - b * (a / b); }
`;

// twin of glsl/common.js HASH_FAST (bit-exact u32 hash, detailShade.js hashFast). Signed ints enter as bit patterns (u32(i32)).
export const HASH_FAST_WGSL = `
fn hashFastU(x: i32, y: i32, s: i32) -> u32 {
  var h: u32 = (u32(x) * 0x27d4eb2du) ^ (u32(y) * 0x165667b1u) ^ (u32(s) * 0x9e3779b1u); // GLSL precedence made explicit
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
fn hashFast(x: i32, y: i32, s: i32) -> f32 {
  return f32(hashFastU(x, y, s) >> 8u) * (1.0 / 16777216.0);
}
`;

// twin of glsl/common.js BYTE_OUT: floor(v+0.5)/255, never round().
export const BYTE_OUT_WGSL = `
fn toByte01(v255: f32) -> f32 { return floor(clamp(v255, 0.0, 255.0) + 0.5) / 255.0; }
`;

// twin of glsl/common.js SMOOTHSTEP_FAST
export const SMOOTHSTEP_FAST_WGSL = `
fn smoothstepFast(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
fn coverFast(cx: f32, cy: f32) -> f32 { return abs(cx) + abs(cy); }
`;

// twin of glsl/common.js QFLOOR
export const QFLOOR_WGSL = `
fn qfloor(x: f32) -> f32 { return floor(x + (1.0 / 256.0)); }
`;

// twin of glsl/common.js ORIENT_AND_LINES (detailShade.js orientClassFast / crossLineFast / lineGlyphCodeFast)
export const ORIENT_AND_LINES_WGSL = `
const TAN22: f32 = 0.40403; // tan(22 deg)
const TAN68: f32 = 2.47509; // tan(68 deg)

fn orientClassCode(cx: f32, cy: f32, cellAspect: f32) -> i32 {
  let gy = cy / cellAspect;
  let dx = -gy; let dy = cx;
  if (dx == 0.0 && dy == 0.0) { return 0; }
  let adx = abs(dx); let ady = abs(dy);
  if (ady <= TAN22 * adx) { return 0; }
  if (ady >= TAN68 * adx) { return 1; }
  return select(2, 3, dx * dy > 0.0);
}

// Returns fraction in [0,1] or -1.0 if no line crosses this cell's footprint.
fn crossLineFast(c: f32, cx: f32, cy: f32, period: f32, offset: f32) -> f32 {
  var hw = 0.5 * (abs(cx) + abs(cy));
  if (!(hw > 1e-7)) { hw = 1e-7; }
  let k = qfloor((c + hw - offset) / period);
  let line = offset + k * period;
  if (line < c - hw) { return -1.0; }
  let fr = select(0.5, 0.5 + (line - c) / cy, abs(cy) > 1e-9);
  return clamp(fr, 0.0, 1.0);
}

const LINE_DASH: i32 = 45 - 32; const LINE_UNDERSCORE: i32 = 95 - 32; const LINE_PIPE: i32 = 124 - 32;
const LINE_SLASH: i32 = 47 - 32; const LINE_BACKSLASH: i32 = 92 - 32;
fn lineGlyphCodeFast(cx: f32, cy: f32, fr: f32, cellAspect: f32) -> i32 {
  let k = orientClassCode(cx, cy, cellAspect);
  if (k == 0) { return select(LINE_DASH, LINE_UNDERSCORE, fr >= 0.5); }
  return select(select(LINE_BACKSLASH, LINE_SLASH, k == 2), LINE_PIPE, k == 1);
}
`;

// S8-B2-12c (docs/architecture.md 38.13): twin of cloudShadow.js `cloudShadeQ` + sky.js `cloudValueNoise` (256-periodic
// lattice, no raw `%`, no `round`). Needs `hashFast` (HASH_FAST_WGSL) in scope - the including module interpolates both,
// once each. `cloudShadeQ4` is pure (A = (offX, offY, scale, strength), B = (cover, soft, deckH, seed)); light.wgsl.js
// wraps it as `cloudShadeQ(P, sd)` reading the LightU fields.
export const CLOUD_SHADOW_WGSL = `
fn cloudVN(x: f32, y: f32, seed: i32) -> f32 {
  let ix = i32(floor(x)); let iy = i32(floor(y));
  let fx = x - f32(ix); let fy = y - f32(iy);
  let v00 = hashFast(ix & 255, iy & 255, seed);
  let v10 = hashFast((ix + 1) & 255, iy & 255, seed);
  let v01 = hashFast(ix & 255, (iy + 1) & 255, seed);
  let v11 = hashFast((ix + 1) & 255, (iy + 1) & 255, seed);
  let sx = fx * fx * (3.0 - 2.0 * fx); let sy = fy * fy * (3.0 - 2.0 * fy);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v11 - v10 - v01 + v00) * sx * sy;
}

fn cloudShadeQ4(P: vec3f, sd: vec3f, A: vec4f, B: vec4f) -> u32 {
  let t = (B.z - P.z) / max(sd.z, 0.2);
  let qx = (P.x + sd.x * t) * A.z + A.x;
  let qy = (P.y + sd.y * t) * A.z + A.y;
  let seed = i32(B.w);
  let n = cloudVN(qx, qy, seed) * 0.65 + cloudVN(qx * 2.03 + 17.0, qy * 2.03 + 17.0, seed) * 0.35;
  let tt = clamp((n - B.x) / B.y, 0.0, 1.0);
  let d = tt * tt * (3.0 - 2.0 * tt);
  return u32(floor(A.w * 0.6 * d * 255.0 + 0.5));
}
`;

// S8-B2-20 (docs/architecture.md 38.17): twin of horizonAo.js's `aoTapOcc` (horizon AO light-pass term, 4 depth
// taps). Pure - N (receiver's unit normal) and v (Pt - P, tap minus receiver) only, no textures/uniforms. The
// including module (light.wgsl.js) defines `fn cellPoint(...)` and the per-cell tap loop around this.
export const HORIZON_AO_WGSL = `
const AO_RADIUS_M: f32 = ${AO_RADIUS_M};
const AO_BIAS: f32 = ${AO_BIAS};
fn aoTapOcc(N: vec3f, v: vec3f) -> f32 {
  let d2 = dot(v, v);
  if (d2 < 1e-8 || d2 >= AO_RADIUS_M * AO_RADIUS_M) { return 0.0; }
  let d = sqrt(d2);
  let c = dot(N, v) / d - AO_BIAS;
  if (c > 0.0) { return c * (1.0 - d / AO_RADIUS_M); }
  return 0.0;
}
`;

// S8-B2-05: twin of the world wind sampler engine/world/wind.js `createWind(..)._baseInto` (US-138, arch 32.5): base direction (forwardOf, ground axes
// x east / y south), a gust that travels downwind through the 64-knot kernel table K with a smoothstep between knots; zones are off.
// The including module defines `fn windKnot(i: u32) -> f32` (K[i], e.g. from a uniform vec4 array). Args: world x/y, time in seconds (= tick * STEP),
// then field.params: dirX, dirY, speed, amp, period (ticks, P), travel. Returns the wind vector (m/s, x/y).
export const WIND_AT_WGSL = `
const WIND_STEP: f32 = ${STEP};
const WIND_K_SIZE: f32 = ${WIND_K_SIZE}.0;
fn windAt(x: f32, y: f32, t: f32, dirX: f32, dirY: f32, speed: f32, amp: f32, period: f32, travel: f32) -> vec2f {
  let tl = t / WIND_STEP - (x * dirX + y * dirY) / (travel * WIND_STEP);
  let k = floor(tl / period);
  let fr = (tl - k * period) / period;
  let s = fr * fr * (3.0 - 2.0 * fr);
  let m0 = k - WIND_K_SIZE * floor(k / WIND_K_SIZE);
  let m1 = m0 + 1.0;
  let k0 = u32(m0);
  let k1 = select(u32(m1), 0u, m1 >= WIND_K_SIZE);
  let a = windKnot(k0);
  let g = a + (windKnot(k1) - a) * s;
  let sp = speed * max(0.0, 1.0 + amp * (2.0 * g - 1.0));
  return vec2f(dirX * sp, dirY * sp);
}
`;
