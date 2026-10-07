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
