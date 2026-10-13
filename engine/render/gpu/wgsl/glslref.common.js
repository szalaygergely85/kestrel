// WG-5a-2: GLSL reference strings (test-only fixtures for *.glslref.js) - moved out of glsl/common.js so wgsl/** and wg/**
// no longer import glsl/**. glsl/common.js re-exports them for the remaining GL files.

export const GLSL_VERSION = '#version 300 es\n';

export const PRECISION = `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp isampler2D;
`;

export const GBUF_UNPACK = `
// GI.x = planeId (uint bit-cast, compared for equality only).
// GI.y = kind | face<<8 | mask<<12 | cov<<13 | mat<<16
uint giKind(uint y) { return y & 0xffu; }
uint giFace(uint y) { return (y >> 8u) & 0xfu; }
uint giMask(uint y) { return (y >> 12u) & 0x1u; }
uint giCov(uint y)  { return (y >> 13u) & 0x7u; }
uint giMat(uint y)  { return (y >> 16u) & 0xffffu; }
`;

export const BYTE_OUT = `
// Byte output: floor(v+0.5)/255 (matches Math.round for non-negatives);
// never rely on the GL unorm write path or GLSL round().
float toByte01(float v255) { return floor(clamp(v255, 0.0, 255.0) + 0.5) / 255.0; }
`;

export const CELL_RAY_PITCHED = `
vec3 cellDirPitched(vec2 cell, ivec2 grid, vec3 F, vec2 R, vec3 U, vec2 tanHalf) {
  float a = ((2.0 * (cell.x + 0.5)) / float(grid.x) - 1.0) * tanHalf.x;
  float b = (1.0 - (2.0 * cell.y) / float(grid.y)) * tanHalf.y;
  return vec3(F.x + a * R.x + b * U.x, F.y + a * R.y + b * U.y, F.z + b * U.z);
}

vec3 cellRayPitched(vec2 cell, ivec2 grid, vec3 eye, vec3 F, vec2 R, vec3 U, vec2 tanHalf, float vd) {
  vec3 dir = cellDirPitched(cell, grid, F, R, U, tanHalf);
  return vec3(eye.x + dir.x * vd, eye.y + dir.y * vd, eye.z + dir.z * vd);
}

float pitchFogScale(int row, int rows, float tanHalfY, float cosP, float sinP) {
  float b = (1.0 - (2.0 * float(row)) / float(rows)) * tanHalfY;
  return max(0.0, cosP - b * sinP);
}

// Uniform-driven wrappers (need PITCH_UNIFORMS declared before this chunk).
vec3 pitchedCellDir(vec2 cell, ivec2 grid) {
  return cellDirPitched(cell, grid, uPitchA.xyz, uPitchB.xy, vec3(uPitchB.zw, uPitchC.x), vec2(uPitchA.w, uPitchC.y));
}
float fogScaleCell(int row, int rows) {
  return uProjMode == 0 ? 1.0 : pitchFogScale(row, rows, uPitchC.y, uPitchC.z, uPitchC.w);
}
`;

export const OCT_NORMAL = `
uint packNormalOct(vec3 n) {
  float s = abs(n.x) + abs(n.y) + abs(n.z);
  float x = n.x / s, y = n.y / s, z = n.z / s;
  if (z < 0.0) {
    float ax = abs(x), ay = abs(y);
    float sx = x >= 0.0 ? 1.0 : -1.0, sy = y >= 0.0 ? 1.0 : -1.0;
    float nxp = (1.0 - ay) * sx, nyp = (1.0 - ax) * sy;
    x = nxp; y = nyp;
  }
  uint qx = uint(clamp(floor((x * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  uint qy = uint(clamp(floor((y * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  return qx | (qy << 16u);
}

vec3 unpackNormalOct(uint bits) {
  uint qx = bits & 0xFFFFu;
  uint qy = (bits >> 16u) & 0xFFFFu;
  float x = (float(qx) / 65535.0) * 2.0 - 1.0;
  float y = (float(qy) / 65535.0) * 2.0 - 1.0;
  float z = 1.0 - abs(x) - abs(y);
  if (z < 0.0) {
    float ax = abs(x), ay = abs(y);
    float sx = x >= 0.0 ? 1.0 : -1.0, sy = y >= 0.0 ? 1.0 : -1.0;
    float ox = (1.0 - ay) * sx, oy = (1.0 - ax) * sy;
    x = ox; y = oy;
  }
  return normalize(vec3(x, y, z));
}
`;
