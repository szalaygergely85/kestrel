// Test-fixture GLSL snippets (WG-5a-3) moved out of glsl/common.js + glsl/terrain.frag.js so
// wgsl/** tests no longer import glsl/**. The glsl files re-export them.

export const HASH_FAST = `
uint hashFastU(int x, int y, int s) {
  uint h = uint(x) * 0x27d4eb2du ^ uint(y) * 0x165667b1u ^ uint(s) * 0x9e3779b1u;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
// The uint->float conversion via >>8 is exact (24 significant bits fit a
// float32 mantissa) - no driver-dependent rounding (tech notes item 5).
float hashFast(int x, int y, int s) {
  return float(hashFastU(x, y, s) >> 8u) * (1.0 / 16777216.0);
}
`;

export const CELL_RAY = `
vec3 cellRayP(vec2 cell, ivec2 grid, float posX, float posY, float eyeH,
    float dirX, float dirY, float planeX, float planeY,
    float horizonRow, float planeDistY, float dist) {
  float cameraX = (2.0 * (cell.x + 0.5)) / float(grid.x) - 1.0;
  float rayDirX = dirX + planeX * cameraX;
  float rayDirY = dirY + planeY * cameraX;
  float slope = -(cell.y - horizonRow) / planeDistY;
  return vec3(posX + rayDirX * dist, posY + rayDirY * dist, eyeH + slope * dist);
}
`;

export const PITCH_UNIFORMS = `
uniform int uProjMode;  // 0 = shear (cellRayP / uHorizonRow), 1 = pitched (cellRayPitched)
uniform vec4 uPitchA;   // fX, fY, fZ, tanHalfX
uniform vec4 uPitchB;   // rX, rY, uX, uY
uniform vec4 uPitchC;   // uZ, tanHalfY, cosP, sinP
`;

export const NEAR_TYPE_NEAREST_GLSL = `
int nearTypeNearest(float x, float y) {
  int ix = int(floor((x - uNearMap.x) / uNearMap.z));
  int iy = int(floor((y - uNearMap.y) / uNearMap.z));
  int W = int(uNearMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) return 0;
  return int(texelFetch(uNearType, ivec2(ix, iy), 0).r);
}
`;

export const FAR_TYPE_NEAREST_GLSL = `
int farTypeNearest(float x, float y) {
  int ix = int(floor(x / uFarMap.z)), iy = int(floor(y / uFarMap.z));
  int W = int(uFarMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) return 0;
  return int(texelFetch(uFarType, ivec2(ix, iy), 0).r);
}
`;
