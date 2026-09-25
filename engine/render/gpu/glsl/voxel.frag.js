// engine/render/gpu/glsl/voxel.frag.js - US-040 pass A3 `voxel` (docs/
// architecture.md 15.2 item 4). Literal GLSL twin of `engine/voxel/
// voxelMarch.js`'s `marchVoxelRay`/`castModels` (faceMode 'nearest' - US-040
// never writes face 7/packed normals, that is US-041a/15.3). Renders at the
// SAME sub-sample resolution as cast/terrain (`cols*n x rows*n`), ping-pongs
// between the SAME two sub-sample sets those passes already own (no third
// set - `GpuCellPipeline.js` picks the read/write bind tables and FBO by
// `_subSetCur`, this shader only ever sees "the" `uSGI`/`uSGA`/`uSDepth`
// input and writes its own MRT output).
import { GLSL_VERSION, PRECISION, OCT_NORMAL } from './common.js';
import { MAX_VOX_INSTANCES, MAX_VOX_PARTS, MAX_VOX_STEPS } from '../../../voxel/VoxelModel.js';
import { KIND_MODEL, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED } from '../../GBuffer.js';
import { VOX_ATLAS_WIDTH, VOXINST_WIDTH, VOXINST_ROWS_PER_INSTANCE } from '../VoxelTextures.js';

export const VOXEL_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec2 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

uniform ivec2 uGrid; // BASE cols, rows (not the sub-grid viewport)
uniform int uN;
uniform usampler2D uSGI;    // RG32UI, the sub-sample set written last
uniform usampler2D uSGA;    // RGBA32UI (floatBitsToUint u,v,z,aoD)
uniform usampler2D uSDepth; // R32UI (floatBitsToUint dist)

uniform usampler2D uVOX;     // R16UI, width ${VOX_ATLAS_WIDTH} - MaterialTable id, 0 = empty
uniform sampler2D uVOXINST;  // RGBA32F, width ${VOXINST_WIDTH} - per-instance/part rows (VoxelTextures.js)
uniform int uVoxCount;
uniform vec4 uVoxRect[${MAX_VOX_INSTANCES}]; // rx0,ry0,rx1,ry1 in cells, half-open

uniform float uPosX, uPosY, uEyeH;
uniform float uDirX, uDirY, uPlaneX, uPlaneY;
uniform float uHorizonRow, uPlaneDistY;

const int MAX_VOX_INSTANCES = ${MAX_VOX_INSTANCES};
const int MAX_VOX_PARTS = ${MAX_VOX_PARTS};
const int MAX_VOX_STEPS = ${MAX_VOX_STEPS};
const int VOXINST_ROWS_PER_INSTANCE = ${VOXINST_ROWS_PER_INSTANCE};
const int KIND_MODEL = ${KIND_MODEL};
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};
const int FACE_PACKED = ${FACE_PACKED};

${OCT_NORMAL}

uint voxTexel(int idx) {
  return texelFetch(uVOX, ivec2(idx & 255, idx >> 8), 0).r;
}

// World-space slab test (instance AABB) - literal twin of castModels' own
// per-cell world-AABB reject (no tOut<0 check there, see the JS comment).
bool slabWorld(vec3 e, vec3 d, vec3 bmin, vec3 bmax, out float tIn, out float tOut) {
  tIn = -1.0e30; tOut = 1.0e30;
  if (d.x != 0.0) { float t1 = (bmin.x - e.x) / d.x, t2 = (bmax.x - e.x) / d.x; tIn = max(tIn, min(t1, t2)); tOut = min(tOut, max(t1, t2)); }
  else if (e.x < bmin.x || e.x > bmax.x) return false;
  if (d.y != 0.0) { float t1 = (bmin.y - e.y) / d.y, t2 = (bmax.y - e.y) / d.y; tIn = max(tIn, min(t1, t2)); tOut = min(tOut, max(t1, t2)); }
  else if (e.y < bmin.y || e.y > bmax.y) return false;
  if (d.z != 0.0) { float t1 = (bmin.z - e.z) / d.z, t2 = (bmax.z - e.z) / d.z; tIn = max(tIn, min(t1, t2)); tOut = min(tOut, max(t1, t2)); }
  else if (e.z < bmin.z || e.z > bmax.z) return false;
  return true;
}

void main() {
  ivec2 sub = ivec2(gl_FragCoord.xy);
  int cx = sub.x / uN, i = sub.x - cx * uN;
  int cy = sub.y / uN, j = sub.y - cy * uN;

  // Default: copy the input sample through unchanged.
  outGI = texelFetch(uSGI, sub, 0).xy;
  outGA = texelFetch(uSGA, sub, 0);
  uint depthBitsIn = texelFetch(uSDepth, sub, 0).x;
  outDepth = depthBitsIn;

  if (uVoxCount <= 0) return;

  float best = uintBitsToFloat(depthBitsIn);

  float ox = (float(i) + 0.5) / float(uN) - 0.5;
  float oy = (float(j) + 0.5) / float(uN) - 0.5;
  float cameraX = (2.0 * (float(cx) + 0.5 + ox)) / float(uGrid.x) - 1.0;
  vec3 e = vec3(uPosX, uPosY, uEyeH);
  vec3 d = vec3(uDirX + uPlaneX * cameraX, uDirY + uPlaneY * cameraX, (uHorizonRow - (float(cy) + oy)) / uPlaneDistY);
  vec2 cellF = vec2(float(cx), float(cy));

  bool hit = false;
  uint hitMat = 0u, hitPlaneId = 0u;
  int hitFace = FACE_U;
  float hitU = 0.0, hitV = 0.0, hitZ = 0.0, hitT = 0.0;
  // US-041a (15.3 item 3): the packed normal (bits) for a non-axis-aligned
  // part's hit - only used when hitFace ends up FACE_PACKED.
  uint hitNormalBits = 0u;

  for (int ii = 0; ii < MAX_VOX_INSTANCES; ii++) {
    if (ii >= uVoxCount) break;
    vec4 rect = uVoxRect[ii]; // rx0,ry0,rx1,ry1 in cells, half-open
    if (cellF.x < rect.x || cellF.x >= rect.z || cellF.y < rect.y || cellF.y >= rect.w) continue;

    int rowBase = ii * VOXINST_ROWS_PER_INSTANCE;
    vec4 H0 = texelFetch(uVOXINST, ivec2(0, rowBase), 0);
    vec4 H1 = texelFetch(uVOXINST, ivec2(1, rowBase), 0);
    vec4 H2 = texelFetch(uVOXINST, ivec2(2, rowBase), 0);
    int partCount = int(H0.w);
    float feetZ = H2.x, cellM = H2.y;

    float tIn, tOut;
    if (!slabWorld(e, d, H0.xyz, H1.xyz, tIn, tOut)) continue;
    if (tIn > tOut || tIn >= best) continue;

    for (int k = 0; k < MAX_VOX_PARTS; k++) {
      if (k >= partCount) break;
      int row = rowBase + 1 + k;
      vec4 T0 = texelFetch(uVOXINST, ivec2(0, row), 0);
      vec4 T1 = texelFetch(uVOXINST, ivec2(1, row), 0);
      vec4 T2 = texelFetch(uVOXINST, ivec2(2, row), 0);
      vec4 T3 = texelFetch(uVOXINST, ivec2(3, row), 0);
      vec4 T4 = texelFetch(uVOXINST, ivec2(4, row), 0);
      vec3 Arow0 = T0.xyz, Arow1 = T1.xyz, Arow2 = T2.xyz;
      vec3 oL = vec3(T0.w, T1.w, T2.w);
      float x0 = T3.x, y0 = T3.y, z0 = T3.z;
      int atlasBase = int(T3.w);
      float bxN = T4.x, byN = T4.y, bzN = T4.z;
      float x1 = x0 + bxN, y1 = y0 + byN, z1 = z0 + bzN;
      // US-041a (15.3 item 3): VoxelTextures.js's flags = (axisAligned?1:0)
      // | (k<<1) (T4.w) - the SAME per-part flag computeVoxelPose wrote
      // (voxelPose.js's _axisAligned), so the GPU march can never disagree
      // with the CPU oracle on which faces get FACE_PACKED.
      bool partAxisAligned = (int(T4.w) & 1) != 0;

      vec3 dL = vec3(dot(Arow0, d), dot(Arow1, d), dot(Arow2, d));

      float ptIn = -1.0e30, ptOut = 1.0e30;
      int entryAxis = -1;
      bool pMiss = false;
      if (dL.x != 0.0) {
        float t1 = (x0 - oL.x) / dL.x, t2 = (x1 - oL.x) / dL.x;
        float tlo = min(t1, t2), thi = max(t1, t2);
        if (tlo > ptIn) { ptIn = tlo; entryAxis = 0; }
        if (thi < ptOut) ptOut = thi;
      } else if (oL.x < x0 || oL.x > x1) pMiss = true;
      if (!pMiss) {
        if (dL.y != 0.0) {
          float t1 = (y0 - oL.y) / dL.y, t2 = (y1 - oL.y) / dL.y;
          float tlo = min(t1, t2), thi = max(t1, t2);
          if (tlo > ptIn) { ptIn = tlo; entryAxis = 1; }
          if (thi < ptOut) ptOut = thi;
        } else if (oL.y < y0 || oL.y > y1) pMiss = true;
      }
      if (!pMiss) {
        if (dL.z != 0.0) {
          float t1 = (z0 - oL.z) / dL.z, t2 = (z1 - oL.z) / dL.z;
          float tlo = min(t1, t2), thi = max(t1, t2);
          if (tlo > ptIn) { ptIn = tlo; entryAxis = 2; }
          if (thi < ptOut) ptOut = thi;
        } else if (oL.z < z0 || oL.z > z1) pMiss = true;
      }
      if (pMiss || ptIn > ptOut || ptOut < 0.0 || ptIn >= best) continue;

      float t = ptIn > 0.0 ? ptIn : 0.0;
      if (t >= best) continue;

      float px = oL.x + t * dL.x, py = oL.y + t * dL.y, pz = oL.z + t * dL.z;
      int ix = int(floor(px)), iy = int(floor(py)), iz = int(floor(pz));
      int ix0 = int(x0), iy0 = int(y0), iz0 = int(z0), ix1 = int(x1), iy1 = int(y1), iz1 = int(z1);
      if (ix < ix0) ix = ix0; else if (ix >= ix1) ix = ix1 - 1;
      if (iy < iy0) iy = iy0; else if (iy >= iy1) iy = iy1 - 1;
      if (iz < iz0) iz = iz0; else if (iz >= iz1) iz = iz1 - 1;

      float sx = dL.x > 0.0 ? 1.0 : (dL.x < 0.0 ? -1.0 : 0.0);
      float sy = dL.y > 0.0 ? 1.0 : (dL.y < 0.0 ? -1.0 : 0.0);
      float sz = dL.z > 0.0 ? 1.0 : (dL.z < 0.0 ? -1.0 : 0.0);
      float tDeltaX = dL.x != 0.0 ? abs(1.0 / dL.x) : 1.0e30;
      float tDeltaY = dL.y != 0.0 ? abs(1.0 / dL.y) : 1.0e30;
      float tDeltaZ = dL.z != 0.0 ? abs(1.0 / dL.z) : 1.0e30;
      float tMaxX = sx > 0.0 ? (float(ix) + 1.0 - oL.x) / dL.x : (sx < 0.0 ? (float(ix) - oL.x) / dL.x : 1.0e30);
      float tMaxY = sy > 0.0 ? (float(iy) + 1.0 - oL.y) / dL.y : (sy < 0.0 ? (float(iy) - oL.y) / dL.y : 1.0e30);
      float tMaxZ = sz > 0.0 ? (float(iz) + 1.0 - oL.z) / dL.z : (sz < 0.0 ? (float(iz) - oL.z) / dL.z : 1.0e30);

      int curFace = entryAxis == 0 ? (sx > 0.0 ? FACE_W : FACE_E) : entryAxis == 1 ? (sy > 0.0 ? FACE_N : FACE_S) : (sz > 0.0 ? FACE_D : FACE_U);
      int curLayer = entryAxis == 0 ? (ix - ix0) : entryAxis == 1 ? (iy - iy0) : (iz - iz0);

      for (int step = 0; step < MAX_VOX_STEPS; step++) {
        if (ix >= ix0 && ix < ix1 && iy >= iy0 && iy < iy1 && iz >= iz0 && iz < iz1) {
          int local = atlasBase + (ix - ix0) + int(bxN) * ((iy - iy0) + int(byN) * (iz - iz0));
          uint m = voxTexel(local);
          if (m != 0u && t > 1.0e-6) {
            if (t < best) {
              best = t;
              hit = true;
              hitMat = m;
              vec3 nLocal = curFace == FACE_N ? vec3(0.0, -1.0, 0.0)
                : curFace == FACE_E ? vec3(1.0, 0.0, 0.0)
                : curFace == FACE_S ? vec3(0.0, 1.0, 0.0)
                : curFace == FACE_W ? vec3(-1.0, 0.0, 0.0)
                : curFace == FACE_U ? vec3(0.0, 0.0, 1.0)
                : vec3(0.0, 0.0, -1.0);
              // n_world = cellM * Amat^T * n_local (Amat rows are Arow0/1/2; Amat^T's rows are Amat's columns).
              vec3 nWorld = cellM * vec3(
                Arow0.x * nLocal.x + Arow1.x * nLocal.y + Arow2.x * nLocal.z,
                Arow0.y * nLocal.x + Arow1.y * nLocal.y + Arow2.y * nLocal.z,
                Arow0.z * nLocal.x + Arow1.z * nLocal.y + Arow2.z * nLocal.z);
              // US-041a (15.3 items 2/3): literal twin of castModels' own
              // (axisAligned || faceMode === 'nearest') ? roundedFace(...) :
              // FACE_PACKED - this pass never gets faceMode: 'nearest'
              // (that was US-040's own scope, before rotated normals existed).
              if (partAxisAligned) {
                float anx = abs(nWorld.x), any = abs(nWorld.y), anz = abs(nWorld.z);
                if (anx >= any && anx >= anz) hitFace = nWorld.x >= 0.0 ? FACE_E : FACE_W;
                else if (any >= anx && any >= anz) hitFace = nWorld.y >= 0.0 ? FACE_S : FACE_N;
                else hitFace = nWorld.z >= 0.0 ? FACE_U : FACE_D;
              } else {
                hitFace = FACE_PACKED;
                hitNormalBits = packNormalOct(nWorld);
              }

              float hx = oL.x + t * dL.x, hy = oL.y + t * dL.y, hz = oL.z + t * dL.z;
              float lx = hx - x0, ly = hy - y0, lz = hz - z0;
              // u/v are selected by the LOCAL entry face (curFace), exactly as
              // castModels does (localFace), not by the rounded world face:
              // at yaw 90 the two differ on every lateral cell (arch review 1).
              if (curFace == FACE_E || curFace == FACE_W) { hitU = ly * cellM; hitV = lz * cellM; }
              else if (curFace == FACE_N || curFace == FACE_S) { hitU = lx * cellM; hitV = lz * cellM; }
              else { hitU = lx * cellM; hitV = ly * cellM; }

              hitZ = e.z + t * d.z - feetZ;
              hitPlaneId = (0xFu << 28) | ((uint(ii) & 0xFu) << 24) | ((uint(k) & 0x7u) << 21) | ((uint(curFace) & 0x7u) << 18) | (uint(curLayer) & 0x3FFFFu);
              hitT = t;
            }
            break; // first non-zero voxel is this part's hit (marchVoxelRay: stops the part march here regardless of whether it beat best)
          }
        }
        if (t >= ptOut || t >= best) break;

        int axis;
        if (tMaxX < tMaxY) axis = tMaxX < tMaxZ ? 0 : 2; else axis = tMaxY < tMaxZ ? 1 : 2;
        if (axis == 0) { ix += int(sx); t = tMaxX; tMaxX += tDeltaX; curFace = sx > 0.0 ? FACE_W : FACE_E; curLayer = ix - ix0; }
        else if (axis == 1) { iy += int(sy); t = tMaxY; tMaxY += tDeltaY; curFace = sy > 0.0 ? FACE_N : FACE_S; curLayer = iy - iy0; }
        else { iz += int(sz); t = tMaxZ; tMaxZ += tDeltaZ; curFace = sz > 0.0 ? FACE_D : FACE_U; curLayer = iz - iz0; }
        if (ix < ix0 || ix >= ix1 || iy < iy0 || iy >= iy1 || iz < iz0 || iz >= iz1) break;
        if (t >= best) break;
      }
    }
  }

  if (hit) {
    outGI = uvec2(hitPlaneId, uint(KIND_MODEL) | (uint(hitFace) << 8u) | (hitMat << 16u));
    // US-041a (15.3 item 3): face 7 (FACE_PACKED) writes the octahedral-
    // packed normal into GA.w instead of the +Inf bits (0x7f800000u) - the
    // shade pass forces aoD = Inf for EVERY kind-8 cell itself (it is
    // never a real ambient-occlusion distance here), so this slot is free
    // for the normal exactly like the CPU oracle's Uint32Array alias of
    // gbuf.aoD (voxelMarch.js).
    uint gaw = (hitFace == FACE_PACKED) ? hitNormalBits : 0x7f800000u;
    outGA = uvec4(floatBitsToUint(hitU), floatBitsToUint(hitV), floatBitsToUint(hitZ), gaw);
    outDepth = floatBitsToUint(hitT);
  }
}
`;
