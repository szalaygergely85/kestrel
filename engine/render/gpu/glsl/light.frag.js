// US-006/US-007 (docs/architecture.md 14.3 items 3/4): the GLSL `light`
// pass - runs after `deriv`, before `shade` (14.2 item 3's pass order gains
// `light` between them). Per-cell (not sub-sample) resolution: `L = ambient
// + sum_i col_i * falloff(d,r) * max(0,N.L) * vis_i(P) + sunCol *
// max(0,N.sunDir) * sunlit(P)`, written to `LIGHT` (RGBA32UI,
// `floatBitsToUint(L.rgb)`, `w = sunlit | litCount << 8`), read back by
// `shade.frag.js` via `texelFetch(uLightTex, cell, 0)`.
//
// ME-19c2: the GL sun shadow DDA (findStruct/sunVisible + world atlas) was removed; the sun is the shadow map only.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK, CELL_RAY, PITCH_UNIFORMS, CELL_RAY_PITCHED, FALLOFF_FAST, OCT_NORMAL } from './common.js';
import { MAX_LIGHTS, MAX_VIS_DIM } from '../../lighting.js';
import { FACE_PACKED, KIND_TERRAIN } from '../../GBuffer.js';
import { SUN_N_SHIFT } from '../../shadowSun.js';

const FACE_N = 1, FACE_E = 2, FACE_S = 3, FACE_W = 4, FACE_U = 5, FACE_D = 6;

export const LIGHT_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec4 outLight;

uniform usampler2D uGI;    // RG32UI - resolved, per-cell (kind/face/mat)
uniform usampler2D uGA;    // RGBA32UI: floatBitsToUint(u, v, z, aoD) - only .w (aoD) read here, face 7's packed normal
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

// Sun uniforms (US-007 14.3 item 3). ME-19c2: the sun DDA and its world atlas/struct uniforms are gone.
uniform vec3 uSunDir; // unit, TOWARD the sun (x east, y south, z up)
uniform vec3 uSunCol; // hue * intensity
uniform int uSunOn;

// ME-15c (27.9a items 6/8, JS twin: shadowSun.js's sunShadowTaps): sun shadow map lookup. uSunMode 0 off, 2 map. The map is a depth24 texture read with
// texelFetch (NEAREST, no hardware compare), 4 taps at floor(uv*res - 0.5) + {0,1}^2, EXPLICIT bounds check on every
// tap (texelFetch out of range returns 0 = "nearest" = shadowed, the opposite of the JS rule: outside = sunlit).
uniform int uSunMode;
uniform mat4 uSunShadowM;        // world -> clip (float32 copy of shadowSunMatrix().M)
uniform float uSunShadowRes;     // map side in texels
uniform float uSunShadowTexelM;  // metres per texel
uniform float uSunShadowBiasM;   // receiver offset toward the sun (m)
uniform float uSunShadowNormalOff; // receiver offset along N, in texels
uniform sampler2D uSunShadow;

const int MAX_VIS_DIM = ${MAX_VIS_DIM};
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};
const int FACE_PACKED = ${FACE_PACKED};
const uint SUN_N_SHIFT = ${SUN_N_SHIFT}u;
// US-026a S5 (23.4 "Lighting"): kind 7 (terrain) is lit by the sun
// ANALYTICALLY in the terrain shade pass instead (D-007: no terrain shadow
// rays) - literal twin of lighting.js's kind[i] === KIND_TERRAIN skipSun.
const int KIND_TERRAIN = ${KIND_TERRAIN};
// BUG-LIGHT-002 (docs/backlog.md row 25d): same epsilon as lighting.js's
// VIS_FLOOR_EPS - biases sampleVis's floor so a sample point that lands
// within float32 noise of an exact vis-grid boundary (the "toward the
// light" 0.02 nudge can land almost exactly back on one) always resolves to
// the same cell as the JS float64 oracle, instead of a coin-flip that can
// fully include/exclude a light (a dLViol far above per-channel noise).
const float VIS_FLOOR_EPS = 1e-3;

${GBUF_UNPACK}
${CELL_RAY}
${PITCH_UNIFORMS}
${CELL_RAY_PITCHED}
${FALLOFF_FAST}
${OCT_NORMAL}

// Quantised 4-tap PCF: n in 0..4 (taps where depth(P') <= mapDepth). Receivers outside the box (uv or depth outside
// [0,1]) and taps outside the map are sunlit. P' = P + N * normalOff * texelM + sunDir * biasM.
int sunShadowTaps(vec3 P, vec3 N) {
  vec3 Pp = P + N * (uSunShadowNormalOff * uSunShadowTexelM) + uSunDir * uSunShadowBiasM;
  vec4 c = uSunShadowM * vec4(Pp, 1.0);
  float u = (c.x + 1.0) * 0.5, v = (c.y + 1.0) * 0.5, d = (c.z + 1.0) * 0.5;
  if (u < 0.0 || u >= 1.0 || v < 0.0 || v >= 1.0 || d < 0.0 || d > 1.0) return 4;
  ivec2 t0 = ivec2(floor(vec2(u, v) * uSunShadowRes - 0.5));
  int res = int(uSunShadowRes);
  int n = 0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 t = t0 + ivec2(i, j);
      if (t.x < 0 || t.y < 0 || t.x >= res || t.y >= res) { n++; continue; }
      if (d <= texelFetch(uSunShadow, t, 0).r) n++;
    }
  }
  return n;
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
  float lx = floor(px - box.x + VIS_FLOOR_EPS), ly = floor(py - box.y + VIS_FLOOR_EPS);
  if (lx < 0.0 || ly < 0.0 || lx >= w || ly >= h) return 1.0;
  return float(texelFetch(uLVis, ivec2(int(lx), i * MAX_VIS_DIM + int(ly)), 0).r) / 255.0;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  uint kindU = giKind(gi.y);
  vec3 L = uAmbient;
  if (kindU == 0u) {
    outLight = uvec4(floatBitsToUint(L), 0u);
    return;
  }
  float dist = uintBitsToFloat(texelFetch(uDepth, cell, 0).r);
  vec3 P;
  if (uProjMode == 0) {
    P = cellRayP(vec2(cell), uGrid, uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY, dist);
  } else {
    // RE-02a: pitched camera (28.1 A2); dist is the view depth vd.
    P = cellRayPitched(vec2(cell), uGrid, vec3(uPosX, uPosY, uEyeH), uPitchA.xyz, uPitchB.xy, vec3(uPitchB.zw, uPitchC.x), vec2(uPitchA.w, uPitchC.y), dist);
  }
  uint faceU = giFace(gi.y);
  // US-041a (15.3 item 3): the only light-pass change - face 7 (a rotated
  // voxel-model part) has no fixed axis normal; decode it from GA.w's
  // octahedral-packed bits instead (literal twin of voxelMarch.js's
  // packNormalOct / lighting.js's CPU decode).
  vec3 N;
  if (kindU == uint(KIND_TERRAIN)) N = unpackNormalOct(texelFetch(uGI, cell, 0).z); // ME-06: terrain's packed normal lives in GI.z (GA.w is +Inf)
  else N = (faceU == uint(FACE_PACKED)) ? unpackNormalOct(texelFetch(uGA, cell, 0).w) : faceNormal(faceU);

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
    // BUG-LIGHT-001 fix (JS twin: lighting.js's lightAt): sample at
    // S = P + (L-P)/|L-P| * 0.02, toward the LIGHT, not along N. N alone
    // (the old fix, matching a wall hit's cell boundary) does nothing for a
    // floor (N = 0,0,1) - it only nudges z, so floor(P.x/y) stays an exact
    // float coin flip at a depth-discontinuity silhouette edge. d3/d is
    // already the unit vector toward the light.
    vec3 toLight = d3 / d;
    float vis = sampleVis(i, P.x + toLight.x * 0.02, P.y + toLight.y * 0.02);
    if (vis <= 0.0) continue;
    L += uLightCol[i].rgb * (fo * ndotl * vis);
    litCount++;
  }

  // US-007 (14.3 item 4): "Skip when uSunOn == 0 or N.sunDir <= 0". US-026a
  // S5: also skip for terrain (kind 7) - the terrain shade pass adds the sun
  // term itself, analytically (D-007); a second, shadow-ray-tested sun
  // contribution here would double the sun on every terrain cell.
  int sunlit = 0;
  int sunN = 0;
  if (uSunMode == 2) {
    // ME-15c: shadow-map sun. Terrain only gets n (the shade pass scales its analytic sun term by n/4); with the sun
    // off, terrain reports n = 4 (lit, as before ME-15). Twin of lighting.js's lightAt 'sunMap' branch.
    bool isT = kindU == uint(KIND_TERRAIN);
    if (uSunOn != 0) {
      float ndotsun = dot(N, uSunDir);
      if (isT || ndotsun > 0.0) {
        sunN = sunShadowTaps(P, N);
        sunlit = sunN >= 2 ? 1 : 0;
        if (!isT && ndotsun > 0.0) L += uSunCol * (ndotsun * float(sunN) * 0.25);
      }
    } else if (isT) {
      sunN = 4;
    }
  }

  outLight = uvec4(floatBitsToUint(L), uint(sunlit) | (uint(litCount) << 8) | (uint(sunN) << SUN_N_SHIFT));
}
`;
