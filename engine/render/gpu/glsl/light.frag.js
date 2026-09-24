// US-006 (docs/architecture.md 14.3 item 3): the GLSL `light` pass - runs
// after `deriv`, before `shade` (14.2 item 3's pass order gains `light`
// between them). Per-cell (not sub-sample) resolution: `L = ambient +
// sum_i col_i * falloff(d,r) * max(0,N.L) * vis_i(P)`, written to `LIGHT`
// (RGBA32UI, `floatBitsToUint(L.rgb)`), read back by `shade.frag.js` via
// `texelFetch(uLightTex, cell, 0)`. Sun (US-007) is NOT implemented here -
// there is no `uSunOn`/shadow DDA; `LightSet.sun.on` stays false for every
// US-006 code path, so this pass is point-lights-only by construction.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK, CELL_RAY, FALLOFF_FAST } from './common.js';
import { MAX_LIGHTS, MAX_VIS_DIM } from '../../lighting.js';

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

const int MAX_VIS_DIM = ${MAX_VIS_DIM};
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};

${GBUF_UNPACK}
${CELL_RAY}
${FALLOFF_FAST}

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
  }

  outLight = uvec4(floatBitsToUint(L), 0u);
}
`;
