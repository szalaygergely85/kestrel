// US-006/US-007 (docs/architecture.md 14.3 items 3/4): the GLSL `light`
// pass - runs after `deriv`, before `shade` (14.2 item 3's pass order gains
// `light` between them). Per-cell (not sub-sample) resolution: `L = ambient
// + sum_i col_i * falloff(d,r) * max(0,N.L) * vis_i(P) + sunCol *
// max(0,N.sunDir) * sunlit(P)`, written to `LIGHT` (RGBA32UI,
// `floatBitsToUint(L.rgb)`, `w = sunlit | litCount << 8`), read back by
// `shade.frag.js` via `texelFetch(uLightTex, cell, 0)`.
//
// US-007 deviation (flagged for architect review, not silent): `findStruct`
// below re-resolves "which placed structure covers this world cell" by a
// plain bbox loop over `uStructCount` (<= 8) EVERY sun-DDA step, instead of
// literally porting `dda.frag.js`'s ray-based slab-entry chaining (14.3 item
// 4's "then the remaining placed structures by slab entry, same loop shape
// as dda.frag"). A per-cell point query is a much simpler problem than a
// ray query (no t-interval bookkeeping across structures needed - each step
// just asks "which structure, if any, owns THIS cell"), and M1's placed-
// structure count is tiny (<= 8, usually 1), so the O(steps x structCount)
// cost is negligible next to the DDA's own <= 48-step, <= 2-fetch-per-step
// budget (14.3 item 6). Produces the identical answer, and is the same
// simplification `lighting.js`'s JS reference makes with `world.sectorAt`
// (see that file's module doc) - kept in sync by construction, not by
// re-deriving the same "which structure" answer two different ways.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK, CELL_RAY, FALLOFF_FAST } from './common.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_SUN_STEPS } from '../../lighting.js';
import { MAX_STRUCTS } from '../WorldTextures.js';

const FACE_N = 1, FACE_E = 2, FACE_S = 3, FACE_W = 4, FACE_U = 5, FACE_D = 6;

export const LIGHT_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec4 outLight;

uniform usampler2D uGI;    // RG32UI - resolved, per-cell (kind/face/mat)
uniform usampler2D uDepth; // R32UI: floatBitsToUint(dist)
uniform usampler2D uLVis;  // R8UI: MAX_VIS_DIM x (MAX_LIGHTS*MAX_VIS_DIM) occlusion atlas

uniform ivec2 uGrid;
uniform float uPosX, uPosY, uEyeH;
uniform float uDirX, uDirY, uPlaneX, uPlaneY;
uniform float uHorizonRow, uPlaneDistY;

uniform vec3 uAmbient;
uniform int uLightCount;
uniform vec4 uLightPos[${MAX_LIGHTS}]; // x,y,z,radius (already jittered - LightSet.update)
uniform vec4 uLightCol[${MAX_LIGHTS}]; // hue*intensity*flicker rgb, visSlot (== light index)
uniform vec4 uVisBox[${MAX_LIGHTS}];   // ox, oy, w, h (world cell units)

// US-007 (14.3 items 3/4): sun uniforms + the world atlas/struct table the
// sun DDA needs (same textures dda.frag.js reads - bound to a second
// sampler unit here, since this is a different program).
uniform vec3 uSunDir; // unit, TOWARD the sun (x east, y south, z up)
uniform vec3 uSunCol; // hue * intensity
uniform int uSunOn;
uniform sampler2D uWorldGeom;   // RGBA32F: floorH, ceilH, topH, ceilOpenH (ceilOpenH unused here)
uniform usampler2D uWorldFlags; // RG8UI: r = solid|ceilSky<<1|topSky<<2|dynamic<<3 (g = relief, unused here)
uniform vec4 uStructA[${MAX_STRUCTS}]; // origin.xyz, w (width)
uniform vec4 uStructB[${MAX_STRUCTS}]; // h, yOff, structSeq, maxH (WorldTextures.js packUStruct)
uniform int uStructCount;

const int MAX_VIS_DIM = ${MAX_VIS_DIM};
const int MAX_STRUCTS = ${MAX_STRUCTS};
const int MAX_SUN_STEPS = ${MAX_SUN_STEPS};
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};

${GBUF_UNPACK}
${CELL_RAY}
${FALLOFF_FAST}

// --- US-007 sun shadow DDA (14.3 item 4, JS twin: lighting.js's sunVisible/sunCellBlocked) ---

// Point query: which placed structure (if any) covers world cell/point
// (wx, wy)? See the module doc's deviation note.
bool findStruct(float wx, float wy, out int idx) {
  for (int s = 0; s < MAX_STRUCTS; s++) {
    if (s >= uStructCount) break;
    vec4 A = uStructA[s], B = uStructB[s];
    float lx = wx - A.x, ly = wy - A.y;
    if (lx >= 0.0 && lx < A.w && ly >= 0.0 && ly < B.x) { idx = s; return true; }
  }
  return false;
}

struct SunCell { float floorH, ceilH, topH; bool ceilSky; };

SunCell fetchSunCell(int yOff, int lcx, int lcy) {
  ivec2 t = ivec2(lcx, yOff + lcy);
  vec4 g = texelFetch(uWorldGeom, t, 0);
  uint flags = texelFetch(uWorldFlags, t, 0).x;
  SunCell c;
  c.floorH = g.x;
  c.ceilH = g.y;
  c.ceilSky = (flags & 2u) != 0u;
  c.topH = ((flags & 4u) != 0u) ? 1.0e30 : g.z;
  return c;
}

// Crossing test (14.3 item 2/4) - literal twin of lighting.js's sunCellBlocked.
bool sunCellBlocked(SunCell c, float h0, float h1) {
  if (h0 < c.floorH) return true;
  if (c.ceilSky) return false;
  return h0 <= c.topH && h1 >= c.ceilH;
}

// Literal twin of lighting.js's sunVisible (minus the world==null and
// straight-up special cases - GLSL always has a world atlas bound, and the
// content's sun elevation is never 90).
bool sunVisible(vec3 S, vec3 dir) {
  float horiz = length(dir.xy);
  float h0 = S.z + 1.0e-3;
  if (horiz < 1.0e-9) {
    int idx0;
    if (!findStruct(S.x, S.y, idx0)) return true;
    vec4 A0 = uStructA[idx0], B0 = uStructB[idx0];
    SunCell c0 = fetchSunCell(int(B0.y + 0.5), int(floor(S.x - A0.x)), int(floor(S.y - A0.y)));
    return !sunCellBlocked(c0, h0, 1.0e30);
  }

  float ndx = dir.x / horiz, ndy = dir.y / horiz;
  float tanElev = dir.z / horiz;
  int mapX = int(floor(S.x)), mapY = int(floor(S.y));
  int stepX = ndx > 0.0 ? 1 : (ndx < 0.0 ? -1 : 0);
  int stepY = ndy > 0.0 ? 1 : (ndy < 0.0 ? -1 : 0);
  float deltaDistX = ndx == 0.0 ? 1.0e30 : abs(1.0 / ndx);
  float deltaDistY = ndy == 0.0 ? 1.0e30 : abs(1.0 / ndy);
  float sideDistX = ndx == 0.0 ? 1.0e30 : (ndx > 0.0 ? (float(mapX) + 1.0 - S.x) : (S.x - float(mapX))) * deltaDistX;
  float sideDistY = ndy == 0.0 ? 1.0e30 : (ndy > 0.0 ? (float(mapY) + 1.0 - S.y) : (S.y - float(mapY))) * deltaDistY;

  float tPrev = 0.0;
  for (int step = 0; step < MAX_SUN_STEPS; step++) {
    int idx;
    if (!findStruct(float(mapX) + 0.5, float(mapY) + 0.5, idx)) return true;
    vec4 A = uStructA[idx], B = uStructB[idx];
    int lcx = mapX - int(A.x + 0.5), lcy = mapY - int(A.y + 0.5);
    SunCell c = fetchSunCell(int(B.y + 0.5), lcx, lcy);

    float t1;
    if (sideDistX < sideDistY) { t1 = sideDistX; sideDistX += deltaDistX; mapX += stepX; }
    else { t1 = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
    float h1 = h0 + tanElev * (t1 - tPrev);
    if (sunCellBlocked(c, h0, h1)) return false;
    h0 = h1; tPrev = t1;
    if (h0 > B.w) return true; // B.w = uStructMaxH of the CURRENT structure
  }
  return true; // step cap - bias to lit
}

vec3 faceNormal(uint face) {
  if (face == uint(FACE_N)) return vec3(0.0, -1.0, 0.0);
  if (face == uint(FACE_E)) return vec3(1.0, 0.0, 0.0);
  if (face == uint(FACE_S)) return vec3(0.0, 1.0, 0.0);
  if (face == uint(FACE_W)) return vec3(-1.0, 0.0, 0.0);
  if (face == uint(FACE_U)) return vec3(0.0, 0.0, 1.0);
  if (face == uint(FACE_D)) return vec3(0.0, 0.0, -1.0);
  return vec3(0.0);
}

float sampleVis(int i, float px, float py) {
  vec4 box = uVisBox[i];
  float w = box.z, h = box.w;
  if (w <= 0.0 || h <= 0.0) return 1.0;
  float lx = floor(px - box.x), ly = floor(py - box.y);
  if (lx < 0.0 || ly < 0.0 || lx >= w || ly >= h) return 1.0;
  return float(texelFetch(uLVis, ivec2(int(lx), i * MAX_VIS_DIM + int(ly)), 0).r) / 255.0;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  vec3 L = uAmbient;
  if (giKind(gi.y) == 0u) {
    outLight = uvec4(floatBitsToUint(L), 0u);
    return;
  }
  float dist = uintBitsToFloat(texelFetch(uDepth, cell, 0).r);
  vec3 P = cellRayP(vec2(cell), uGrid, uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY, dist);
  vec3 N = faceNormal(giFace(gi.y));

  int litCount = 0;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    vec3 d3 = lp.xyz - P;
    float r = lp.w;
    float d2 = dot(d3, d3);
    if (d2 >= r * r) continue;
    float d = sqrt(d2);
    float fo = falloffFast(d, r);
    if (fo <= 0.0) continue;
    float ndotl = d > 1e-6 ? dot(N, d3) / d : 0.0;
    if (ndotl <= 0.0) continue;
    // Architect review 1 item 1: sample at S = P + N*0.01, matching
    // lightAt() in lighting.js (a wall hit lies exactly on the cell
    // boundary; sampling P itself is a float coin flip between the solid
    // cell and the open one).
    float vis = sampleVis(i, P.x + N.x * 0.01, P.y + N.y * 0.01);
    if (vis <= 0.0) continue;
    L += uLightCol[i].rgb * (fo * ndotl * vis);
    litCount++;
  }

  // US-007 (14.3 item 4): "Skip when uSunOn == 0 or N.sunDir <= 0".
  int sunlit = 0;
  if (uSunOn != 0) {
    float ndotsun = dot(N, uSunDir);
    if (ndotsun > 0.0) {
      vec3 S = P + N * 0.01;
      if (sunVisible(S, uSunDir)) {
        sunlit = 1;
        L += uSunCol * ndotsun;
      }
    }
  }

  outLight = uvec4(floatBitsToUint(L), uint(sunlit) | (uint(litCount) << 8));
}
`;
