// US-016 (docs/architecture.md 14.4 items 4/5, GPU build order steps 2-3):
// pass A2 `terrain` (GLSL literal twin of `engine/render/terrainCaster.js`'s
// `marchTerrainRay`/`castTerrain`) plus the `shadeTerrainFar` GLSL twin of
// `engine/render/terrainShade.js`, included by `shade.frag.js`'s kind==7
// branch. Both are literal ports - see the JS files' own comments for the
// rules; this file mirrors them line for line, not independently derived.
//
// Pass placement (item 2): renders at the SAME sub-sample resolution as the
// cast pass (`cols*n x rows*n`), reads the cast pass's own output (SGI/SGA/
// SDepth, "set 1") and writes a SECOND sub-sample G-buffer ("set 2",
// SGI2/SGA2/SDepth2) - a copy of the set-1 sample unless this sub-ray's
// terrain march finds a hit. D-017/item 11: the JS oracle always uses
// `tMax = FOG_FULL` (no per-cell sector-depth cap - see terrainCaster.js's
// own comment on the fixed bug), which is equivalent, at sub-ray
// granularity, to "only march where the cast pass found nothing" - a
// sub-ray that already has a kind != 0 sample from pass A is a structure
// hit, and per item 1/10 terrain never draws over a structure cell, so this
// pass copies those through untouched with no march at all.
import { GLSL_VERSION, PRECISION } from './common.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { KIND_TERRAIN } from '../../GBuffer.js';
import {
  MAX_TERRAIN_STEPS, STEP_MIN, STEP_K, T_START, FOG_FULL,
} from '../../terrainCaster.js';
import { TLOOK_WIDTH } from '../TerrainTextures.js';

// Shared by the terrain march pass AND shade.frag.js's kind==7 branch (the
// shade pass recomputes the hit-point normal from the same FARH texture -
// see terrainShade.js's `terrainNormal`/`shadeTerrainCells` split: the JS
// oracle computes `b` in the SEPARATE shading pass, not during the march,
// and the GPU mirrors that split literally rather than the march-writes-aoD
// wording in architecture.md 14.4 item 4 - the architect's build-order step
// 3 text ("port shadeTerrainFar line for line") assumes this same split,
// since `shadeTerrainFar` itself takes `b` as an already-computed input).
export const FARH_BILINEAR_GLSL = `
uniform sampler2D uFarH;   // R32F, mapW x mapH
uniform vec4 uFarMap;      // x0, y0, cell, size (mapW == mapH)

// Manual bilinear (item 3: "do not use hardware filtering on the height
// texture") - literal port of overworld_far.js's util.gridHeight. Returns
// false (out of the far map) exactly where the JS returns null.
bool farHBilinear(float x, float y, out float H) {
  float fx = (x - uFarMap.x) / uFarMap.z - 0.5;
  float fy = (y - uFarMap.y) / uFarMap.z - 0.5;
  float fi = floor(fx), fj = floor(fy);
  float wmax = uFarMap.w - 1.0;
  if (fi < 0.0 || fj < 0.0 || fi > wmax - 1.0 || fj > wmax - 1.0) return false;
  int ii = int(fi), jj = int(fj);
  float u = fx - fi, v = fy - fj;
  float a = texelFetch(uFarH, ivec2(ii, jj), 0).r;
  float b = texelFetch(uFarH, ivec2(ii + 1, jj), 0).r;
  float c = texelFetch(uFarH, ivec2(ii, jj + 1), 0).r;
  float d = texelFetch(uFarH, ivec2(ii + 1, jj + 1), 0).r;
  H = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return true;
}

// terrainNormal port (terrainCaster.js): c = 8 m central difference. Falls
// back to the hit-point height H0 (locally flat) on an out-of-map neighbour
// - the JS oracle instead falls back to the analytic recipe.heightAt, which
// has no GLSL equivalent (recipe constants never reach GLSL, item 10's "do
// not" list); harmless in practice, this only differs within 8 m of the
// 2048 m far-map edge, far outside any in-scope view.
vec3 farHNormal(float x, float y, float H0) {
  const float c = 8.0;
  float hL, hR, hD, hU;
  if (!farHBilinear(x - c, y, hL)) hL = H0;
  if (!farHBilinear(x + c, y, hR)) hR = H0;
  if (!farHBilinear(x, y - c, hD)) hD = H0;
  if (!farHBilinear(x, y + c, hU)) hU = H0;
  return normalize(vec3(-(hR - hL), -(hU - hD), 2.0 * c));
}
`;

export const TERRAIN_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec2 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

uniform ivec2 uGrid; // BASE cols, rows (not the sub-grid viewport)
uniform int uN;
uniform usampler2D uSGI;    // RG32UI, set 1 (cast pass output), sub-grid
uniform usampler2D uSGA;    // RGBA32UI (floatBitsToUint u,v,z,aoD), sub-grid
uniform usampler2D uSDepth; // R32UI (floatBitsToUint dist), sub-grid
uniform usampler2D uFarType; // R8UI, mapW x mapH, nearest

uniform vec4 uStructA[${MAX_STRUCTS}]; // origin.xyz, w (footprint width, world m)
uniform vec4 uStructB[${MAX_STRUCTS}]; // h (footprint depth, world m), yOff, structSeq, 0
uniform int uStructCount;

uniform float uPosX, uPosY, uEyeH;
uniform float uDirX, uDirY, uPlaneX, uPlaneY;
uniform float uHorizonRow, uPlaneDistY;
uniform float uTerrainMaxH;
// US-016 (14.4 item 4): the interim sun (D-007 wording, terrainCaster.js's
// exported sunFromWorld) - computed HERE (not in shade.frag's kind==7
// branch) so shade.frag never needs its own uFarH texture unit (16-unit
// fragment-shader budget; shade.frag is already close to the limit with the
// material-shading textures - see the architect review's original item-4
// wording, which puts aoD=b in the march pass for exactly this reason).
uniform vec3 uSunDir;
uniform float uAmbientI, uSunI;

${FARH_BILINEAR_GLSL}

const int MAX_TERRAIN_STEPS = ${MAX_TERRAIN_STEPS};
const float STEP_MIN = ${STEP_MIN.toFixed(1)};
const float STEP_K = ${STEP_K};
const float T_START = ${T_START};
const float FOG_FULL = ${FOG_FULL.toFixed(1)};
const int KIND_TERRAIN = ${KIND_TERRAIN};
const int PLANEID_TERRAIN = -1;
const int MAX_SKIPS = ${MAX_STRUCTS};

// slab2D port (terrainCaster.js): 2D slab test of the world-space ray
// against a structure's world bbox [x0,x1)x[y0,y1).
bool slabTerrain(float ex, float ey, float dx, float dy, float x0, float y0, float x1, float y1, out float tIn, out float tOut) {
  float tMin = -1.0e30, tMax = 1.0e30;
  if (dx != 0.0) {
    float t1 = (x0 - ex) / dx, t2 = (x1 - ex) / dx;
    tMin = max(tMin, min(t1, t2)); tMax = min(tMax, max(t1, t2));
  } else if (ex < x0 || ex > x1) { return false; }
  if (dy != 0.0) {
    float t1 = (y0 - ey) / dy, t2 = (y1 - ey) / dy;
    tMin = max(tMin, min(t1, t2)); tMax = min(tMax, max(t1, t2));
  } else if (ey < y0 || ey > y1) { return false; }
  if (tMax < tMin || tMax < 0.0) return false;
  tIn = max(0.0, tMin); tOut = tMax;
  return true;
}

int farTypeNearest(float x, float y) {
  int ix = int(floor(x / uFarMap.z)), iy = int(floor(y / uFarMap.z));
  int W = int(uFarMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) return 0;
  return int(texelFetch(uFarType, ivec2(ix, iy), 0).r);
}

void main() {
  ivec2 sub = ivec2(gl_FragCoord.xy);
  int cx = sub.x / uN, i = sub.x - cx * uN;
  int cy = sub.y / uN, j = sub.y - cy * uN;

  // Default: copy the pass-A (cast) sample through unchanged.
  uvec2 sgi = texelFetch(uSGI, sub, 0).xy;
  outGI = sgi;
  outGA = texelFetch(uSGA, sub, 0);
  outDepth = texelFetch(uSDepth, sub, 0).x;

  uint kindA = sgi.y & 0xffu;
  if (kindA != 0u) return; // a structure already claimed this sub-ray (item 1/10: never draw over it)

  float ox = (float(i) + 0.5) / float(uN) - 0.5;
  float oy = (float(j) + 0.5) / float(uN) - 0.5;
  float cameraX = (2.0 * (float(cx) + 0.5 + ox)) / float(uGrid.x) - 1.0;
  float rayDirX = uDirX + uPlaneX * cameraX;
  float rayDirY = uDirY + uPlaneY * cameraX;
  float slope = (uHorizonRow - (float(cy) + oy)) / uPlaneDistY;

  if (!(slope < 0.0) && uEyeH >= uTerrainMaxH) return; // climbing above every hill, from the start

  // buildSkips port: one 2D slab per placed structure, computed once per ray.
  float skipIn[MAX_SKIPS];
  float skipOut[MAX_SKIPS];
  int nSkips = 0;
  for (int s = 0; s < MAX_SKIPS; s++) {
    if (s >= uStructCount) break;
    vec4 A = uStructA[s], B = uStructB[s];
    float tIn, tOut;
    if (slabTerrain(uPosX, uPosY, rayDirX, rayDirY, A.x, A.y, A.x + A.w, A.y + B.x, tIn, tOut)) {
      skipIn[nSkips] = tIn; skipOut[nSkips] = tOut; nSkips++;
    }
  }

  float tMax = FOG_FULL;
  float t0 = T_START;
  for (int step = 0; step < MAX_TERRAIN_STEPS; step++) {
    float dt = max(STEP_MIN, STEP_K * t0);
    float t1 = t0 + dt;
    bool last = false;
    if (t1 >= tMax) { t1 = tMax; last = true; }

    float hAtT1 = uEyeH + slope * t1;
    if (slope > 0.0 && hAtT1 > uTerrainMaxH) return; // climbing above every hill

    float px = uPosX + rayDirX * t1, py = uPosY + rayDirY * t1;
    float H;
    if (!farHBilinear(px, py, H)) return; // outside the far map: haze, the sky pass paints it

    bool inSkip = false;
    for (int k = 0; k < MAX_SKIPS; k++) {
      if (k >= nSkips) break;
      if (t1 >= skipIn[k] && t1 <= skipOut[k]) { inSkip = true; break; }
    }

    if (!inSkip && hAtT1 < H) {
      // 5 bisection steps on f(t) = h(t) - H(p(t)) in [t0, t1].
      float a = t0, b = t1;
      for (int bi = 0; bi < 5; bi++) {
        float tm = (a + b) * 0.5;
        float hm = uEyeH + slope * tm;
        float Hm;
        float Hm2 = farHBilinear(uPosX + rayDirX * tm, uPosY + rayDirY * tm, Hm) ? Hm : H;
        if (hm < Hm2) b = tm; else a = tm;
      }
      float tHit = (a + b) * 0.5;
      float hx = uPosX + rayDirX * tHit, hy = uPosY + rayDirY * tHit, hh = uEyeH + slope * tHit;
      int type = farTypeNearest(hx, hy);
      // item 4: aoD = b, N from the c=8 central difference at the hit point
      // (H, the outer bilinear height at t1, is this sub-ray's own local
      // fallback for an out-of-map neighbour - same as the JS oracle's
      // terrainNormal, minus its analytic heightAt fallback, see
      // FARH_BILINEAR_GLSL's doc comment).
      vec3 N = farHNormal(hx, hy, H);
      float ndotl = N.x * uSunDir.x + N.y * uSunDir.y + N.z * uSunDir.z;
      float bLit = uAmbientI + uSunI * max(0.0, ndotl);
      outGI = uvec2(uint(PLANEID_TERRAIN), uint(KIND_TERRAIN) | (uint(type) << 16u));
      outGA = uvec4(floatBitsToUint(hx), floatBitsToUint(hy), floatBitsToUint(hh), floatBitsToUint(bLit));
      outDepth = floatBitsToUint(tHit);
      return;
    }
    if (last) return;
    t0 = t1;
  }
}
`;

// --- shadeTerrainFar (item 5): literal GLSL twin of terrainShade.js, minus
// its own `b`/normal computation (see the FARH_BILINEAR_GLSL doc comment
// above) - included by shade.frag.js's kind==7 branch, which supplies u, v,
// t (dist), type (matId) and b (computed there via farHNormal + uSunDir).
// Uses HASH_FAST's hashFastU (common.js, already included by shade.frag.js)
// for the world-keyed hA/hB/glint dice - never a screen-keyed hash (item 10).
export const TERRAIN_SHADE_GLSL = `
uniform sampler2D uTlook; // RGBA32F, width ${TLOOK_WIDTH}, row = type id (TerrainTextures.js TLOOK_WIDTH)
uniform float uBandNear, uBandMid;
uniform float uTerrainFogStart, uTerrainFogFull, uTerrainFogCurve;
uniform vec3 uTerrainFogNearRGB, uTerrainFogFarRGB;

int pickCodeFromPacked(int x, int count, int idx) {
  int i = idx >= count ? count - 1 : idx;
  return (x >> (8 * i)) & 0xff;
}

struct TerrainOut { float fr, fg, fb, br, bg, bb; int glyph; };

TerrainOut shadeTerrainFar(float t, int type, float b, float u, float v, float timeSec, float gain) {
  int cx = int(floor(u / 8.0)), cy = int(floor(v / 8.0));
  float hA = hashFast(cx, cy, type);
  float hB = hashFast(cx, cy, 7);

  int tier = b < 0.45 ? 0 : (b < 0.8 ? 1 : 2);
  int ii = tier + (int(floor(hA * 3.0)) - 1);
  ii = clamp(ii, 0, 2);

  int base = type; // TLOOK row = type id (texel x = 0..6, see TerrainTextures.js)
  vec4 t0 = texelFetch(uTlook, ivec2(ii, base), 0);
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  float fr = t0.r * 255.0 * gain, fgc = t0.g * 255.0 * gain, fbc = t0.b * 255.0 * gain;
  float br = fr * 0.3, bgc = fgc * 0.3, bbc = fbc * 0.3;

  int bandIdx = t < uBandNear ? 0 : (t < uBandMid ? 1 : 2);
  vec4 gT = texelFetch(uTlook, ivec2(4 + bandIdx, base), 0);
  int packedX = int(gT.x), packedCount = int(gT.y);
  int code = pickCodeFromPacked(packedX, packedCount, int(hB * float(packedCount)));

  vec4 t3 = texelFetch(uTlook, ivec2(3, base), 0);
  if (t3.y > 0.5) {
    float g = hashFast(cx, cy, int(floor(timeSec * 1.5)));
    if (g > 0.5) {
      int alt = pickCodeFromPacked(packedX, packedCount, (int(hB * float(packedCount)) + 1) % max(1, packedCount));
      code = alt;
      vec4 lightC = texelFetch(uTlook, ivec2(2, base), 0);
      float lr = lightC.r * 255.0 * gain, lg = lightC.g * 255.0 * gain, lb = lightC.b * 255.0 * gain;
      fr += (lr - fr) * 0.35; fgc += (lg - fgc) * 0.35; fbc += (lb - fbc) * 0.35;
    }
  }

  float f = (t - uTerrainFogStart) / (uTerrainFogFull - uTerrainFogStart);
  f = clamp(f, 0.0, 1.0);
  f = pow(f, uTerrainFogCurve);
  float fcr = uTerrainFogNearRGB.r + (uTerrainFogFarRGB.r - uTerrainFogNearRGB.r) * f;
  float fcg = uTerrainFogNearRGB.g + (uTerrainFogFarRGB.g - uTerrainFogNearRGB.g) * f;
  float fcb = uTerrainFogNearRGB.b + (uTerrainFogFarRGB.b - uTerrainFogNearRGB.b) * f;
  fr += (fcr - fr) * f; fgc += (fcg - fgc) * f; fbc += (fcb - fbc) * f;
  float fBg = min(1.0, 1.1 * f);
  br += (fcr - br) * fBg; bgc += (fcg - bgc) * fBg; bbc += (fcb - bbc) * fBg;
  if (f > 0.85) code = 0;

  TerrainOut o;
  o.fr = fr; o.fg = fgc; o.fb = fbc; o.br = br; o.bg = bgc; o.bb = bbc; o.glyph = code;
  return o;
}
`;
