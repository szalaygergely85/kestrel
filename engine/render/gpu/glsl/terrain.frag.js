// US-016 (docs/architecture.md 14.4 items 4/5, GPU build order steps 2-3),
// extended by US-026a S5 (23.7): pass A2 `terrain` (GLSL literal twin of
// `engine/render/terrainCaster.js`'s `marchTerrainRay`/`castTerrain`, now
// near-band-aware) plus `shadeTerrain` (renamed from `shadeTerrainFar` to
// match the JS oracle's own US-026a rename), the GLSL twin of
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
import { GLSL_VERSION, PRECISION, HASH_FAST, OCT_NORMAL } from './common.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import {
  MAX_TERRAIN_STEPS, STEP_MIN, STEP_K, T_START, FOG_FULL, DITHER_SEED,
} from '../../terrainCaster.js';
import { TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from '../TerrainTextures.js';

// Used by the terrain march pass only (US-026a S5: the normal is now PACKED
// at hit time in the march pass itself - `terrainNormalNear` below, in
// NEARH_BILINEAR_GLSL - and `b`/lighting moves to the shade pass, which
// decodes that packed normal back out instead of recomputing it from FARH.
// shade.frag.js therefore no longer needs this block/a FARH texture unit at
// all - see terrainShade.js's `shadeTerrainCells` doc comment for the JS
// twin of this split).
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
`;

// US-026a S5 (23.1 decision 6, 23.4): the near-band twin of
// `FARH_BILINEAR_GLSL` above - `NEARH`/`NEARTYPE` (`TerrainTextures.js`'s
// `packNearTextures`), the "useNear" dither, the near/far height pick
// `H(px,py,t)`, and the near-aware normal (`c=2` near / `c=8` far). Literal
// GLSL twin of `terrainCaster.js`'s `useNear`/`sampleH`/`terrainNormal`.
// Gated ENTIRELY by `uNearReady` (never a bare geometry check): OFF (byte-
// identical to pre-US-026a far-only output) whenever `GpuCellPipeline.js`
// uploads `uNearReady = 0` - the same condition `activeNearLOD` gates the
// JS oracle on (`terrain.nearReady && recipe.nearLOD.handover && .step`).
export const NEARH_BILINEAR_GLSL = `
uniform sampler2D uNearH;   // R32F, near.w x near.h (192x192)
uniform usampler2D uNearType; // R8UI, same size, nearest
uniform vec4 uNearMap;      // x0, y0, cell (2), size (near.w == near.h)
uniform int uNearReady;     // activeNearLOD(terrain) != null (23.4/terrainCaster.js)
uniform float uFarMinH, uNearMinH;
uniform vec2 uHandover;     // recipe.nearLOD.handover [h0, h1] - never a literal
uniform vec2 uNearStep;     // recipe.nearLOD.step {min, k} - never a literal

${HASH_FAST}

bool nearHBilinear(float x, float y, out float H) {
  float fx = (x - uNearMap.x) / uNearMap.z - 0.5;
  float fy = (y - uNearMap.y) / uNearMap.z - 0.5;
  float fi = floor(fx), fj = floor(fy);
  float wmax = uNearMap.w - 1.0;
  if (fi < 0.0 || fj < 0.0 || fi > wmax - 1.0 || fj > wmax - 1.0) return false;
  int ii = int(fi), jj = int(fj);
  float u = fx - fi, v = fy - fj;
  float a = texelFetch(uNearH, ivec2(ii, jj), 0).r;
  float b = texelFetch(uNearH, ivec2(ii + 1, jj), 0).r;
  float c = texelFetch(uNearH, ivec2(ii, jj + 1), 0).r;
  float d = texelFetch(uNearH, ivec2(ii + 1, jj + 1), 0).r;
  H = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return true;
}

int nearTypeNearest(float x, float y) {
  int ix = int(floor((x - uNearMap.x) / uNearMap.z));
  int iy = int(floor((y - uNearMap.y) / uNearMap.z));
  int W = int(uNearMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) return 0;
  return int(texelFetch(uNearType, ivec2(ix, iy), 0).r);
}

const int DITHER_SEED = ${DITHER_SEED};

// useNear(t, px, py) (23.4): literal twin of terrainCaster.js's useNear -
// world-cell-keyed (2 m), never screen-cell-keyed.
bool useNearSample(float t, float px, float py) {
  if (uNearReady == 0) return false;
  if (t >= uHandover.y) return false;
  if (t < uHandover.x) return true;
  int cx = int(floor(px / 2.0)), cy = int(floor(py / 2.0));
  float h = hashFast(cx, cy, DITHER_SEED);
  return h > (t - uHandover.x) / (uHandover.y - uHandover.x);
}

// H(px, py, t) (23.4): bilinear on the near band when useNearSample, else
// the far grid ("NEARH 'outside' (half-cell rim) -> FARH for that sample").
bool sampleHeight(float t, float px, float py, out float H, out bool isNear) {
  if (useNearSample(t, px, py)) {
    float hn;
    if (nearHBilinear(px, py, hn)) { H = hn; isNear = true; return true; }
  }
  float hf;
  if (farHBilinear(px, py, hf)) { H = hf; isNear = false; return true; }
  return false;
}

// terrainNormal port (terrainCaster.js): c=2 near / c=8 far central
// difference. A neighbour off the near band falls back to the far grid
// (same "NEARH outside -> FARH" rule sampleHeight uses); a neighbour off
// BOTH grids falls back to H0 (locally flat) - like farHNormal above, the
// JS oracle's own analytic heightAt fallback has no GLSL equivalent (item
// 10's "do not" list), harmless this close to either grid's edge.
float sampleHOrH0(float x, float y, bool isNear, float H0) {
  if (isNear) {
    float hn;
    if (nearHBilinear(x, y, hn)) return hn;
  }
  float hf;
  if (farHBilinear(x, y, hf)) return hf;
  return H0;
}

vec3 terrainNormalNear(float x, float y, bool isNear, float H0) {
  float c = isNear ? 2.0 : 8.0;
  float hL = sampleHOrH0(x - c, y, isNear, H0);
  float hR = sampleHOrH0(x + c, y, isNear, H0);
  float hD = sampleHOrH0(x, y - c, isNear, H0);
  float hU = sampleHOrH0(x, y + c, isNear, H0);
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
// US-026a S5 (23.4 "Lighting"): the sun/lighting term (b) moves to the
// shade pass (it reads the hit-point normal back from aoD - see below);
// this pass only writes the PACKED NORMAL (FACE_PACKED/packNormalOct),
// never b itself any more (superseding the item-4 wording quoted in the
// old comment here - the architect's own build-order step 3 note confirms
// this split, since shadeTerrainFar/renamed shadeTerrain always took b
// as an input, never recomputed it).

${FARH_BILINEAR_GLSL}
${NEARH_BILINEAR_GLSL}
${OCT_NORMAL}

const int MAX_TERRAIN_STEPS = ${MAX_TERRAIN_STEPS};
const float STEP_MIN = ${STEP_MIN.toFixed(1)};
const float STEP_K = ${STEP_K};
const float T_START = ${T_START};
const float FOG_FULL = ${FOG_FULL.toFixed(1)};
const int KIND_TERRAIN = ${KIND_TERRAIN};
const int FACE_PACKED = ${FACE_PACKED};
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

  // US-026a S5 (23.4 "March schedule"/"new early-out"): per-ray constants,
  // gated by uNearReady exactly like the JS oracle's nl (activeNearLOD)
  // - OFF (uNearReady == 0) reduces every one of these to the pre-US-026a
  // far-only value, byte-identical output.
  float nearH1 = uNearReady != 0 ? uHandover.y : -1.0e30;
  float nearStepMin = uNearReady != 0 ? uNearStep.x : STEP_MIN;
  float nearStepK = uNearReady != 0 ? uNearStep.y : STEP_K;
  float minHDraw = uNearReady != 0 ? min(uFarMinH, uNearMinH) : uFarMinH;

  float tMax = FOG_FULL;
  float t0 = T_START;
  for (int step = 0; step < MAX_TERRAIN_STEPS; step++) {
    float dt = t0 < nearH1 ? max(nearStepMin, nearStepK * t0) : max(STEP_MIN, STEP_K * t0);
    float t1 = t0 + dt;
    bool last = false;
    if (t1 >= tMax) { t1 = tMax; last = true; }

    float hAtT1 = uEyeH + slope * t1;
    if (slope > 0.0 && hAtT1 > uTerrainMaxH) return; // climbing above every hill

    float px = uPosX + rayDirX * t1, py = uPosY + rayDirY * t1;
    float H; bool isNear;
    if (!sampleHeight(t1, px, py, H, isNear)) return; // outside the far map: haze, the sky pass paints it

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
        float Hm; bool nearM;
        float Hm2 = sampleHeight(tm, uPosX + rayDirX * tm, uPosY + rayDirY * tm, Hm, nearM) ? Hm : H;
        if (hm < Hm2) b = tm; else a = tm;
      }
      float tHit = (a + b) * 0.5;
      float hx = uPosX + rayDirX * tHit, hy = uPosY + rayDirY * tHit, hh = uEyeH + slope * tHit;
      // US-026a 23.4 "Hit sample": re-sample AT tHit (not t1) to know which
      // grid the hit itself resolved against - literal twin of the JS
      // oracle's own second sampleH(terrain, nl, tHit, ...) call.
      float Hhit; bool isNearHit;
      sampleHeight(tHit, hx, hy, Hhit, isNearHit);
      int type = isNearHit ? nearTypeNearest(hx, hy) : farTypeNearest(hx, hy);
      // US-026a S5: aoD now carries the PACKED NORMAL (c=2 near / c=8 far),
      // not b (item 4's old wording) - b moves to the shade pass, which
      // decodes this same normal back out (terrainShade.js's shadeTerrainCells
      // split, ported literally - see the doc comment above uTerrainMaxH).
      vec3 N = terrainNormalNear(hx, hy, isNearHit, hh);
      outGI = uvec2(uint(PLANEID_TERRAIN), uint(KIND_TERRAIN) | (uint(FACE_PACKED) << 8u) | (uint(type) << 16u));
      outGA = uvec4(floatBitsToUint(hx), floatBitsToUint(hy), floatBitsToUint(hh), packNormalOct(N));
      outDepth = floatBitsToUint(tHit);
      return;
    }
    // 23.4 "new early-out": a steep descending ray whose own height has
    // already dropped below the lowest point ANY surface reaches can never
    // hit going forward - strict superset of the hit test above (see
    // terrainCaster.js's own comment on why this is safe to place here).
    if (slope < 0.0 && hAtT1 < minHDraw) return;
    if (last) return;
    t0 = t1;
  }
}
`;

// --- shadeTerrain (item 5, renamed from shadeTerrainFar by US-026a - matches
// the JS oracle's own terrainShade.js rename), literal GLSL twin of
// terrainShade.js's `shadeTerrain`, folding in 23.4's near-detail (close
// band, jitter, 2 m/8 m hash-cell switch, features) - included by
// shade.frag.js's kind==7 branch, which supplies u, v, t (dist), type
// (matId) and b (the un-jittered lighting term, computed there by decoding
// the march pass's packed normal - see terrain.frag.js's own doc comment on
// why `aoD` now carries the normal, not `b`). `gain` is computed INSIDE this
// function now (from the post-jitter `bEff`, literal twin of terrainShade.js's
// `gainOf(bEff, ...)`) rather than passed in - a pre-US-026a caller computed
// it from the un-jittered `b`, which is only correct when jitter is off (near
// detail inactive); computing it here is exact either way. Uses HASH_FAST's
// hashFastU (common.js, already included by shade.frag.js) for the
// world-keyed hA/hB/jitter/glint/feature dice - never a screen-keyed hash
// (item 10).
export const TERRAIN_SHADE_GLSL = `
uniform sampler2D uTlook; // RGBA32F, width ${TLOOK_WIDTH}, row = type id (TerrainTextures.js TLOOK_WIDTH)
uniform float uBandNear, uBandMid;
uniform float uTerrainFogStart, uTerrainFogFull, uTerrainFogCurve;
uniform vec3 uTerrainFogNearRGB, uTerrainFogFarRGB;
// US-026a S5 (23.4 near-detail): gated ENTIRELY by uNearDetailOn - a
// DIFFERENT (more lenient) gate than the march pass's uNearReady: the JS
// oracle's makeTerrainShadeCtx sets ctx.closeBand/ctx.handover off
// recipe.nearLOD.bands/.handover alone (never terrain.nearReady or
// .step - see terrainShade.js's own doc comment), so this uniform is
// computed the same lenient way, independently of uNearReady.
uniform int uNearDetailOn;
uniform vec2 uHandover;  // recipe.nearLOD.handover [h0, h1] - never a literal
uniform float uCloseBand; // recipe.nearLOD.bands.close - never a literal (40)

int pickCodeFromPacked(int x, int count, int idx) {
  int i = idx >= count ? count - 1 : idx;
  return (x >> (8 * i)) & 0xff;
}

const int MAX_FEATURES_PER_TYPE = ${MAX_FEATURES_PER_TYPE};

struct TerrainOut { float fr, fg, fb, br, bg, bb; int glyph; };

TerrainOut shadeTerrain(float t, int type, float b, float u, float v, float timeSec) {
  // 23.4 near-detail: hash cell 2 m inside the near-handover band, else 8 m
  // (the far grid's cell size) - "hash cell 2 m when t < h1, else 8 m".
  float cellSz = (uNearDetailOn != 0 && t < uHandover.y) ? 2.0 : 8.0;
  int cx = int(floor(u / cellSz)), cy = int(floor(v / cellSz));
  float hA = hashFast(cx, cy, type);
  float hB = hashFast(cx, cy, 7);

  // 23.4 near-detail: close (< closeBand) gets a +-0.08 brightness jitter
  // (own hash salt 10, per-cell) - "shading only, heightAt stays smooth".
  bool close = uNearDetailOn != 0 && t < uCloseBand;
  float bEff = close ? b + (hashFast(cx, cy, 10) * 2.0 - 1.0) * 0.08 : b;

  int tier = bEff < 0.45 ? 0 : (bEff < 0.8 ? 1 : 2);
  int ii = tier + (int(floor(hA * 3.0)) - 1);
  ii = clamp(ii, 0, 2);

  int base = type; // TLOOK row = type id (texel x = 0..6, see TerrainTextures.js)
  vec4 t0 = texelFetch(uTlook, ivec2(ii, base), 0);
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  float fr = t0.r * 255.0, fgc = t0.g * 255.0, fbc = t0.b * 255.0;
  // gainOf(bEff, shading) port - samplePowLUT/uFgMin/uFgMaxGain are already
  // declared/included by shade.frag.js (the same gain formula shadeCore uses).
  float bcc = max(bEff, 0.0);
  float gain = uFgMin + (1.0 - uFgMin) * samplePowLUT(min(bcc, 1.0));
  if (bcc > 1.0) gain = min(uFgMaxGain, gain + (bcc - 1.0) * 0.5);
  fr *= gain; fgc *= gain; fbc *= gain;
  float br = fr * 0.3, bgc = fgc * 0.3, bbc = fbc * 0.3;

  int bandIdx = t < uBandNear ? 0 : (t < uBandMid ? 1 : 2);
  // 23.4 near-detail: close wins over the near/mid/far tier (TLOOK texel 7,
  // fixed - "< 40 m, wins over 4-6").
  vec4 gT = close ? texelFetch(uTlook, ivec2(7, base), 0) : texelFetch(uTlook, ivec2(4 + bandIdx, base), 0);
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

  // 23.4 close-band features (wildflower/pebble): up to MAX_FEATURES_PER_TYPE
  // slots packed into TLOOK texels 8-15 (TerrainTextures.js's own doc
  // comment has the exact layout) - fi (texel .w of the "A" slot) is the
  // feature's index in the FLAT list the JS oracle hashes with the SAME salt
  // (20+fi), so the dice never drift between the two paths. First slot (by
  // the flat list's own order) whose chance test passes wins, same as the
  // JS oracle's for loop.
  if (close) {
    for (int slot = 0; slot < MAX_FEATURES_PER_TYPE; slot++) {
      vec4 fa = texelFetch(uTlook, ivec2(8 + slot * 2, base), 0);
      float fchance = fa.x;
      if (fchance <= 0.0) continue;
      int fi = int(fa.w);
      float fh = hashFast(cx, cy, 20 + fi);
      if (fh >= fchance) continue;
      code = fh < fchance * 0.5 ? int(fa.y) : int(fa.z);
      vec4 fbCol = texelFetch(uTlook, ivec2(9 + slot * 2, base), 0);
      fr = fbCol.x * 255.0; fgc = fbCol.y * 255.0; fbc = fbCol.z * 255.0;
      br = fr * 0.3; bgc = fgc * 0.3; bbc = fbc * 0.3;
      break;
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
