// US-030a/US-030b (docs/architecture.md 14.2 items 1/3): GLSL port of
// 'engine/render/sectorCaster.js''s 'castColumn', one fragment = one
// (sub-)ray, no column state (14.2 principle 1). Renders the "cast" pass at
// SUB-sample resolution ('cols*n x rows*n', n = 'uN', the configured
// rays-per-axis): MRT into 'SGI' (RG32UI), 'SGA' (RGBA32UI,
// 'floatBitsToUint') and 'SDEPTH' (R32UI, 'floatBitsToUint') - all-uint
// targets, so this never needs 'EXT_color_buffer_float'. The 'resolve' pass
// (resolve.frag.js) votes the n*n sub-samples down to the final per-cell
// 'GI'/'GA'/'DEPTH'; with n = 1 the sub-grid IS the cell grid and resolve is
// a copy (14.2 item 3). Per-fragment sub-sample offsets are the fixed grid
// '((i+0.5)/n - 0.5, (j+0.5)/n - 0.5)' in cell units (never jittered, 14.2
// item 3/"do not" list) - n=1 collapses to offset (0,0), the exact CPU ray,
// so US-030a's parity behaviour is preserved bit for bit.
//
// The mask bit (UI overlay) is NOT written here any more - it is a per-CELL,
// not per-sub-sample, property, so `resolve.frag.js` applies it once to the
// final `GI.y` (a per-frame `uMask` upload the resolve pass reads instead).
//
// Scope notes (flagged for architect review, not silent):
//  - The CPU's "camera outside a structure's own footprint" VOID_SECTOR
//    first-segment quirk (sectorCaster.js's 'nearSector = ... || VOID_SECTOR'
//    before the loop) is NOT reproduced: this shader starts 'C' at the real
//    entry cell's own sector. Simpler, and arguably more correct, but a
//    documented deviation - not exercised by '?gpucompare=1''s poses or any
//    in-scope level (the camera always spawns inside a placed structure).
//  - Structure order for the 't0 >= bestT' early-out is upload order (world
//    placement order), not a per-frame camera-distance sort - correctness
//    (nearest-candidate-wins) does not depend on order, only the early-out's
//    effectiveness does.
import { GLSL_VERSION, PRECISION } from './common.js';
import { MAX_RAY_STEPS, MAX_DIST } from '../../sectorCaster.js';
import { MAX_STRUCTS } from '../WorldTextures.js';

// Kind/face codes (engine/render/GBuffer.js) - numeric literals, matching
// shade.frag.js/edge.frag.js's own convention (no shared GLSL enum module).
const KIND_WALL = 1, KIND_STEP = 2, KIND_UPPER = 3, KIND_FLOOR = 4, KIND_TOP = 5, KIND_CEIL = 6;
const FACE_N = 1, FACE_E = 2, FACE_S = 3, FACE_W = 4, FACE_U = 5, FACE_D = 6;

export const DDA_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec2 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

uniform ivec2 uGrid; // BASE cols, rows (not the sub-grid viewport)
uniform int uN; // rays per axis (1..4) - US-030b sub-sample count
uniform sampler2D uWorldGeom;   // RGBA32F: floorH, ceilH, topH, ceilOpenH (unused: ceilOpenH is JS-side per 14.2 item 2)
uniform usampler2D uWorldMats;  // RGBA16UI: wallMatId, floorMatId, ceilMatId, upperMatId
uniform usampler2D uWorldFlags; // RG8UI: r = solid|ceilSky<<1|topSky<<2|dynamic<<3, g = floorRise|ceilDrop<<4

uniform vec4 uStructA[${MAX_STRUCTS}]; // origin.xyz, w
uniform vec4 uStructB[${MAX_STRUCTS}]; // h, yOff, structSeq, 0
uniform int uStructCount;

// Camera basis (precomputed JS-side every frame, exactly like
// castScene's own per-frame setup - no trig in the shader).
uniform float uPosX, uPosY, uEyeH;
uniform float uDirX, uDirY, uPlaneX, uPlaneY;
uniform float uHorizonRow, uPlaneDistY;

const int MAX_RAY_STEPS = ${MAX_RAY_STEPS};
const float MAX_DIST = ${MAX_DIST.toFixed(1)};
const int KIND_WALL = ${KIND_WALL}, KIND_STEP = ${KIND_STEP}, KIND_UPPER = ${KIND_UPPER};
const int KIND_FLOOR = ${KIND_FLOOR}, KIND_TOP = ${KIND_TOP}, KIND_CEIL = ${KIND_CEIL};
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};
const float SKY_H = 1.0e30;

int packPlaneId(int structSeq, int tag, int coord) {
  return ((structSeq & 7) << 28) | ((tag & 15) << 24) | (coord & 0xFFFFFF);
}

// One placed structure's cell, fetched from the WorldTextures atlas (see
// engine/world/packed.js/engine/render/gpu/WorldTextures.js for the layout).
struct Cell {
  float floorH, ceilH;
  bool solid, ceilSky;
  uint wallMat, floorMat, ceilMat, upperMat;
  uint floorRise, ceilDrop; // relief nibbles (aoD source, planeAoDFast port)
};

Cell fetchCell(int yOff, int w, int cx, int cy) {
  ivec2 t = ivec2(cx, yOff + cy);
  vec4 g = texelFetch(uWorldGeom, t, 0);
  uvec4 m = texelFetch(uWorldMats, t, 0);
  uvec2 f = texelFetch(uWorldFlags, t, 0).xy;
  Cell c;
  c.floorH = g.x; c.ceilH = g.y;
  c.solid = (f.x & 1u) != 0u;
  c.ceilSky = (f.x & 2u) != 0u;
  c.wallMat = m.x; c.floorMat = m.y; c.ceilMat = m.z; c.upperMat = m.w;
  c.floorRise = f.y & 15u; c.ceilDrop = (f.y >> 4u) & 15u;
  return c;
}

// planeAoDFast port (engine/render/sectorCaster.js): own-cell relief bits
// only, fractional position within the cell ('wx','wy' already known to lie
// inside cell (cx,cy) by construction - the plane-crossing point).
float planeAoD(uint bits, float wx, float wy, float cx, float cy) {
  float fx = wx - cx, fy = wy - cy;
  float a = 1.0e30;
  if ((bits & 1u) != 0u) a = min(a, fx);       // W
  if ((bits & 2u) != 0u) a = min(a, 1.0 - fx); // E
  if ((bits & 4u) != 0u) a = min(a, fy);       // N
  if ((bits & 8u) != 0u) a = min(a, 1.0 - fy); // S
  return a;
}

// wallAoD port: needs the two sectors flanking the wall segment along its
// run ('nbrA'/'nbrB' - see primeWallGSample/wallAoD's doc comments). Reads
// just their floorH (2 extra texelFetches on uWorldGeom; out-of-bounds ->
// "no neighbour", same as the CPU's '!nbrA'/'!nbrB' null case).
float wallAoD(int yOff, int w, int h, float ceilH, bool ceilSky, float hgt, float z, int side, int cx, int cy, float fr) {
  float d = max(0.0, z);
  float zc = ceilSky ? 1.0e30 : (ceilH - hgt);
  if (zc < d) d = max(0.0, zc);
  int aX, aY, bX, bY;
  if (side == 0) { aX = cx; aY = cy - 1; bX = cx; bY = cy + 1; }
  else { aX = cx - 1; aY = cy; bX = cx + 1; bY = cy; }
  bool aValid = aX >= 0 && aX < w && aY >= 0 && aY < h;
  bool bValid = bX >= 0 && bX < w && bY >= 0 && bY < h;
  float aFloor = aValid ? texelFetch(uWorldGeom, ivec2(aX, yOff + aY), 0).x : 0.0;
  float bFloor = bValid ? texelFetch(uWorldGeom, ivec2(bX, yOff + bY), 0).x : 0.0;
  if (!aValid || aFloor > hgt) d = min(d, fr);
  if (!bValid || bFloor > hgt) d = min(d, 1.0 - fr);
  return d;
}

// Slab entry (footprintEntry port): local ray against [0,w)x[0,h). Returns
// false when the ray never crosses the box; 't0' is nudged a hair inward.
bool slabEntry(float lx, float ly, float dx, float dy, float w, float h, out float t0) {
  if (lx >= 0.0 && lx < w && ly >= 0.0 && ly < h) { t0 = 0.0; return true; }
  float tMin = -1.0e30, tMax = 1.0e30;
  if (dx != 0.0) {
    float t1 = (0.0 - lx) / dx, t2 = (w - lx) / dx;
    tMin = max(tMin, min(t1, t2)); tMax = min(tMax, max(t1, t2));
  } else if (lx < 0.0 || lx > w) { return false; }
  if (dy != 0.0) {
    float t1 = (0.0 - ly) / dy, t2 = (h - ly) / dy;
    tMin = max(tMin, min(t1, t2)); tMax = min(tMax, max(t1, t2));
  } else if (ly < 0.0 || ly > h) { return false; }
  if (tMax < tMin || tMax < 0.0) return false;
  t0 = max(tMin, 0.0) + 1.0e-4;
  return true;
}

void main() {
  // US-030b (14.2 item 3): decode the sub-sample fragment address into its
  // owning cell (cx, cy) and its offset index within the n x n sub-grid
  // (i, j), then the fixed (never jittered) sub-sample offset in cell units.
  // n = 1 -> i = j = 0 -> ox = oy = 0, the exact cell centre (US-030a's ray
  // bit for bit).
  ivec2 sub = ivec2(gl_FragCoord.xy);
  int cx = sub.x / uN, i = sub.x - cx * uN;
  int cy = sub.y / uN, j = sub.y - cy * uN;
  float ox = (float(i) + 0.5) / float(uN) - 0.5;
  float oy = (float(j) + 0.5) / float(uN) - 0.5;

  float cameraX = (2.0 * (float(cx) + 0.5 + ox)) / float(uGrid.x) - 1.0;
  float rayDirX = uDirX + uPlaneX * cameraX;
  float rayDirY = uDirY + uPlaneY * cameraX;
  float slope = (uHorizonRow - (float(cy) + oy)) / uPlaneDistY;

  float bestT = 1.0e30;
  int bestKind = 0, bestFace = 0; uint bestMat = 0u; int bestPlaneId = 0;
  float bestU = 0.0, bestV = 0.0, bestZ = 0.0, bestAo = 0.0;

  for (int s = 0; s < uStructCount; s++) {
    vec4 A = uStructA[s], B = uStructB[s];
    float sw = A.w, sh = B.x;
    int w = int(sw + 0.5), h = int(sh + 0.5);
    int yOff = int(B.y + 0.5);
    int structSeq = int(B.z + 0.5);
    float lx = uPosX - A.x, ly = uPosY - A.y, leyeH = uEyeH - A.z;

    float t0;
    if (!slabEntry(lx, ly, rayDirX, rayDirY, sw, sh, t0)) continue;
    if (t0 >= bestT) continue;

    float ex = lx + rayDirX * t0, ey = ly + rayDirY * t0;
    int mapX = int(floor(ex)), mapY = int(floor(ey));
    mapX = clamp(mapX, 0, w - 1); mapY = clamp(mapY, 0, h - 1);

    float deltaDistX = rayDirX == 0.0 ? 1.0e30 : abs(1.0 / rayDirX);
    float deltaDistY = rayDirY == 0.0 ? 1.0e30 : abs(1.0 / rayDirY);
    int stepX = rayDirX < 0.0 ? -1 : 1;
    int stepY = rayDirY < 0.0 ? -1 : 1;
    float sideDistX = rayDirX < 0.0 ? (ex - float(mapX)) * deltaDistX : (float(mapX) + 1.0 - ex) * deltaDistX;
    float sideDistY = rayDirY < 0.0 ? (ey - float(mapY)) * deltaDistY : (float(mapY) + 1.0 - ey) * deltaDistY;

    Cell C = fetchCell(yOff, w, mapX, mapY);
    float t0seg = t0;
    int cMapX = mapX, cMapY = mapY;

    for (int step = 0; step < MAX_RAY_STEPS; step++) {
      if (t0seg >= bestT) break;
      int side;
      float t1;
      if (sideDistX < sideDistY) { t1 = sideDistX; sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else { t1 = sideDistY; sideDistY += deltaDistY; mapY += stepY; side = 1; }
      if (t1 > MAX_DIST) break;

      // --- floor plane (own cell C) ------------------------------------
      if (slope < 0.0) {
        float hAtT1 = leyeH + slope * t1;
        if (hAtT1 < C.floorH) {
          float tp = (C.floorH - leyeH) / slope;
          if (tp >= t0seg && tp < bestT) {
            float wx = lx + rayDirX * tp, wy = ly + rayDirY * tp;
            bestT = tp;
            bestKind = C.solid ? KIND_TOP : KIND_FLOOR;
            bestMat = C.floorMat; bestFace = FACE_U;
            bestPlaneId = packPlaneId(structSeq, bestKind, int(floor(C.floorH * 1000.0 + 0.5)) + 0x800000);
            bestU = wx; bestV = wy;
            bestZ = C.floorH - C.floorH; // 0 by construction (own plane)
            bestAo = planeAoD(C.floorRise, wx, wy, float(cMapX), float(cMapY));
          }
        }
      }
      // --- ceiling plane (own cell C) -----------------------------------
      if (slope > 0.0 && !C.ceilSky) {
        float hAtT1 = leyeH + slope * t1;
        if (hAtT1 > C.ceilH) {
          float tp = (C.ceilH - leyeH) / slope;
          if (tp >= t0seg && tp < bestT) {
            float wx = lx + rayDirX * tp, wy = ly + rayDirY * tp;
            bestT = tp;
            bestKind = KIND_CEIL;
            bestMat = C.ceilMat; bestFace = FACE_D;
            bestPlaneId = packPlaneId(structSeq, bestKind, int(floor(C.ceilH * 1000.0 + 0.5)) + 0x800000);
            bestU = wx; bestV = wy;
            bestZ = C.ceilH - C.floorH;
            bestAo = planeAoD(C.ceilDrop, wx, wy, float(cMapX), float(cMapY));
          }
        }
      }

      bool inBounds = mapX >= 0 && mapX < w && mapY >= 0 && mapY < h;
      if (!inBounds) break; // left the footprint - leave this structure

      Cell N = fetchCell(yOff, w, mapX, mapY);
      float hb = leyeH + slope * t1;
      float hitX = lx + rayDirX * t1, hitY = ly + rayDirY * t1;
      float u = side == 0 ? hitY : hitX;
      // Review 2 item 3: 'coord' must use the POST-step map coords (mapX/
      // mapY, already advanced above) - 'castColumn' computes this from
      // 'ray.mapX/mapY' AFTER 'ddaStep' has run, i.e. the FAR cell, not the
      // near cell 'C' this iteration started from ('cMapX'/'cMapY'). Using
      // the near cell here (the old bug) produced a planeId off by one at
      // the coord field, breaking plane-continuity joins across the
      // boundary (test_room (27,3-4): CPU planeId ...49, GPU ...50).
      int face, coord;
      if (side == 0) { face = stepX > 0 ? FACE_W : FACE_E; coord = stepX > 0 ? mapX : mapX + 1; }
      else { face = stepY > 0 ? FACE_N : FACE_S; coord = stepY > 0 ? mapY : mapY + 1; }
      int wallPlaneId = packPlaneId(structSeq, face, coord);
      float fr = side == 0 ? (hitY - float(cMapY)) : (hitX - float(cMapX));
      float z = hb - C.floorH;

      // Review 2 items 2/4 (gap closure, lip-wall bound): both attempted and
      // reverted - see the programmer's review-2 fix notes in the backlog.
      // A gap-closure else-branch (write C's own floor/ceiling plane at t1
      // when no wall/step/upper claims the boundary) fixed 0 actual holes at
      // the 7 '?gpucompare=1' poses (holes was already 0 without it) but,
      // even restricted to the "entering solid/higher neighbour" cases,
      // regressed kind parity on 2 test_room poses from 100% to 44-55%
      // (sky-adjacent boundaries where the ray keeps walking past
      // BUG-OWN-001's fix). A 'hb > C.floorH' lower bound on the wall/step
      // conditions (matching castColumn's row-range clip) fixed the
      // world_m1 spawn lip but broke legitimate walls whose visible base
      // sits at/below the near cell's floor (e.g. '?gpucompare=1''s "facing
      // stair" pose: 100% -> depthViol/uvViol 5). Not applied.
      // BUG-GPU-002 (2nd fix): the remaining hole (grid 107,23 on the stair
      // pose, cpuKind WALL) is 'hb' landing bit-EXACT on 'N.floorH' (both
      // 3.0) at the outer-wall boundary - a strict '<' excludes that exact
      // row, no other branch claims it (N.ceilSky, no floor/ceiling plane
      // fires for this slope sign), the ray walks straight off the grid
      // edge with nothing hit. castColumn never has this gap: it discretizes
      // to integer screen ROWS via floor/ceil, so the boundary row is always
      // claimed by exactly one of the wall-cap/step bands, never dropped.
      // '<=' (this line only - the exact-match case is single-point, so
      // widening it doesn't reclassify any currently-correct hit) closes it.
      if (N.solid && hb <= N.floorH && t1 < bestT) {
        bestT = t1; bestKind = KIND_WALL; bestMat = N.wallMat; bestFace = face; bestPlaneId = wallPlaneId;
        bestU = u; bestV = hb; bestZ = z;
        bestAo = wallAoD(yOff, w, h, C.ceilH, C.ceilSky, hb, z, side, cMapX, cMapY, fr);
      } else if (!N.solid && N.floorH > C.floorH && hb < N.floorH && t1 < bestT) {
        bestT = t1; bestKind = KIND_STEP; bestMat = N.wallMat; bestFace = face; bestPlaneId = wallPlaneId;
        bestU = u; bestV = hb; bestZ = z;
        bestAo = wallAoD(yOff, w, h, C.ceilH, C.ceilSky, hb, z, side, cMapX, cMapY, fr);
      // BUG-GPU-002 fix: castColumn's non-solid transition (sectorCaster.js
      // ~line 686) draws a step-front band whenever floorH DIFFERS, in
      // EITHER direction - 'higher' is whichever cell has the bigger
      // floorH, and when the NEAR cell is higher (descending: stepping off
      // a raised platform, e.g. the stair pose's 1.0m platform edge) it
      // still emits a face, textured with the near cell's own wallMat. The
      // branch above only covered the ascending case (far higher); the
      // descending case had no branch at all, so the ray fell through with
      // no hit at this boundary and, on the stair pose's platform edge,
      // never found any other plane before leaving the footprint - a
      // kind-0 hole where the CPU draws a KIND_STEP riser. Mirrors the
      // ascending branch exactly, swapping which cell owns floorH/wallMat
      // (C is always the 'near' cell here, matching castColumn's
      // 'nearSector' - same z/wallAoD reference as every other branch).
      // The ascending branch's single-sided 'hb < N.floorH' bound is safe
      // because a look-down ray that dips below the bound is already
      // claimed by C's OWN floor-plane check above (smaller bestT, so
      // 't1 < bestT' fails here) - but that only guards the DOWN side.
      // This descending case needs the explicit upper bound too
      // ('hb < C.floorH'): without it, any level/upward-looking ray
      // (hb >= leyeH > C.floorH, e.g. standing on the platform looking
      // across the room) satisfies 'hb > N.floorH' trivially and this
      // branch wrongly claimed the open view above the platform edge as a
      // riser face - the first attempt's regression (kind match dropped to
      // 0-95% on nearly every pose in '?gpucompare=1').
      } else if (!N.solid && N.floorH < C.floorH && hb > N.floorH && hb < C.floorH && t1 < bestT) {
        bestT = t1; bestKind = KIND_STEP; bestMat = C.wallMat; bestFace = face; bestPlaneId = wallPlaneId;
        bestU = u; bestV = hb; bestZ = z;
        bestAo = wallAoD(yOff, w, h, C.ceilH, C.ceilSky, hb, z, side, cMapX, cMapY, fr);
      } else if (!C.ceilSky && !N.ceilSky && N.ceilH < C.ceilH && hb > N.ceilH && t1 < bestT) {
        bestT = t1; bestKind = KIND_UPPER; bestMat = N.upperMat; bestFace = face; bestPlaneId = wallPlaneId;
        bestU = u; bestV = hb; bestZ = z;
        bestAo = wallAoD(yOff, w, h, C.ceilH, C.ceilSky, hb, z, side, cMapX, cMapY, fr);
      }
      // BUG-OWN-001 fix (architect review 1, item 1): the fourth branch used
      // to 'break' here on C.ceilSky && !N.solid && !N.ceilSky && hb > N.ceilH
      // (a sky-roofed cell looking over a lower ceiling, e.g. ledge 'L' over
      // closed grate 'G'). 'castColumn' (CPU) never terminates a column on
      // sky - it only sets 'skyPending' and keeps walking, painting sky at
      // column end into whatever rows nothing else claimed. Dropped: the ray
      // simply continues with C = N below, matching the CPU 100% at the
      // owner's repro pose (world_m1, sector 'L', ceilH 3.0 < eye) with no
      // regression on the other 8 probed poses.

      C = N; cMapX = mapX; cMapY = mapY; t0seg = t1;
    }
  }

  // US-030b: mask/cov are per-CELL (resolve.frag.js applies them once to the
  // final GI.y) - this sub-sample texel always writes them as 0.
  if (bestKind == 0) {
    outGI = uvec2(0u, 0u);
    outGA = uvec4(0u);
    // Architect review 1 item 4: a constant division by zero is unspecified
    // in GLSL ES 3.00 (it happened to fold to Inf on ANGLE) - write the
    // sentinel literally instead of relying on that fold.
    outDepth = 0x7f800000u; // the "Inf" sentinel (14.2 item 3)
  } else {
    outGI = uvec2(uint(bestPlaneId), uint(bestKind) | (uint(bestFace) << 8) | (bestMat << 16));
    outGA = uvec4(floatBitsToUint(bestU), floatBitsToUint(bestV), floatBitsToUint(bestZ), floatBitsToUint(bestAo));
    outDepth = floatBitsToUint(bestT);
  }
}
`;
