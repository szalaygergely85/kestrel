// engine/voxel/voxelMarch.js - US-039 CPU raymarch into the G-buffer
// (architecture.md 15.1 "March"). `marchVoxelRay`/`castModels` are hot path:
// no `new`, array/object literals, closures, `for..of` or destructuring
// (tech notes item 5) - all scratch is module-level, sized for
// MAX_VOX_PARTS/MAX_VOX_INSTANCES.

import { KIND_MODEL, FACE_PACKED, MAX_VOX_STEPS, MAX_VOX_INSTANCES, MAX_VOX_PARTS, PART_STRIDE } from './VoxelModel.js';
import { FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D } from '../render/GBuffer.js';
import { computeVoxelPose } from './voxelPose.js';
import { packNormalOct } from './octNormal.js';
import { HFOV_DEG, computeProjection, instanceRect } from './instanceRect.js';

export { HFOV_DEG };

/** Last hit's local material index (1..255), a side-channel scratch set by
 * `marchVoxelRay` right before it returns 1 (same pattern as `FORWARD` in
 * voxelPose.js) - kept out of `out` because 15.1 pins that array's shape
 * to exactly 8 slots ([t, lx, ly, lz, localFace, layer, 0, 0]). */
export let LAST_MAT_LOCAL = 0;

/**
 * Amanatides-Woo march of a WORLD ray against part `k`'s local box, via the
 * `pose` (world-to-part-local L_k, from computeVoxelPose). Returns 1 and
 * fills `out` (length >= 8) on a hit with `t < tMax`, else 0.
 * out = [t, lx, ly, lz, localFace(1..6), layer, 0, 0].
 */
export function marchVoxelRay(pm, k, pose, ox, oy, oz, dx, dy, dz, tMax, out) {
  const base = k * PART_STRIDE;
  const a0 = pose[base], a1 = pose[base + 1], a2 = pose[base + 2];
  const a3 = pose[base + 3], a4 = pose[base + 4], a5 = pose[base + 5];
  const a6 = pose[base + 6], a7 = pose[base + 7], a8 = pose[base + 8];
  const bxT = pose[base + 9], byT = pose[base + 10], bzT = pose[base + 11];

  const lox = a0 * ox + a1 * oy + a2 * oz + bxT;
  const loy = a3 * ox + a4 * oy + a5 * oz + byT;
  const loz = a6 * ox + a7 * oy + a8 * oz + bzT;
  const ldx = a0 * dx + a1 * dy + a2 * dz;
  const ldy = a3 * dx + a4 * dy + a5 * dz;
  const ldz = a6 * dx + a7 * dy + a8 * dz;

  const pbase = k * PART_STRIDE;
  const x0 = pm.parts[pbase], y0 = pm.parts[pbase + 1], z0 = pm.parts[pbase + 2];
  const x1 = pm.parts[pbase + 3], y1 = pm.parts[pbase + 4], z1 = pm.parts[pbase + 5];
  const atlasOff = pm.parts[pbase + 10];
  const bxN = pm.parts[pbase + 11], byN = pm.parts[pbase + 12];

  let tEnter = -Infinity, tExit = Infinity, entryAxis = -1;
  if (ldx === 0) {
    if (lox < x0 || lox > x1) return 0;
  } else {
    let t1 = (x0 - lox) / ldx, t2 = (x1 - lox) / ldx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tEnter) { tEnter = t1; entryAxis = 0; }
    if (t2 < tExit) tExit = t2;
  }
  if (ldy === 0) {
    if (loy < y0 || loy > y1) return 0;
  } else {
    let t1 = (y0 - loy) / ldy, t2 = (y1 - loy) / ldy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tEnter) { tEnter = t1; entryAxis = 1; }
    if (t2 < tExit) tExit = t2;
  }
  if (ldz === 0) {
    if (loz < z0 || loz > z1) return 0;
  } else {
    let t1 = (z0 - loz) / ldz, t2 = (z1 - loz) / ldz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tEnter) { tEnter = t1; entryAxis = 2; }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter > tExit || tExit < 0 || tEnter >= tMax) return 0;

  let t = tEnter > 0 ? tEnter : 0;
  if (t >= tMax) return 0;

  let px = lox + t * ldx, py = loy + t * ldy, pz = loz + t * ldz;
  let ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  if (ix < x0) ix = x0; else if (ix >= x1) ix = x1 - 1;
  if (iy < y0) iy = y0; else if (iy >= y1) iy = y1 - 1;
  if (iz < z0) iz = z0; else if (iz >= z1) iz = z1 - 1;

  const sx = ldx > 0 ? 1 : (ldx < 0 ? -1 : 0);
  const sy = ldy > 0 ? 1 : (ldy < 0 ? -1 : 0);
  const sz = ldz > 0 ? 1 : (ldz < 0 ? -1 : 0);
  const tDeltaX = ldx !== 0 ? Math.abs(1 / ldx) : Infinity;
  const tDeltaY = ldy !== 0 ? Math.abs(1 / ldy) : Infinity;
  const tDeltaZ = ldz !== 0 ? Math.abs(1 / ldz) : Infinity;
  let tMaxX = sx > 0 ? (ix + 1 - lox) / ldx : (sx < 0 ? (ix - lox) / ldx : Infinity);
  let tMaxY = sy > 0 ? (iy + 1 - loy) / ldy : (sy < 0 ? (iy - loy) / ldy : Infinity);
  let tMaxZ = sz > 0 ? (iz + 1 - loz) / ldz : (sz < 0 ? (iz - loz) / ldz : Infinity);

  let curFace = entryAxis === 0 ? (sx > 0 ? FACE_W : FACE_E)
    : entryAxis === 1 ? (sy > 0 ? FACE_N : FACE_S)
      : (sz > 0 ? FACE_D : FACE_U);
  let curLayer = entryAxis === 0 ? (ix - x0) : entryAxis === 1 ? (iy - y0) : (iz - z0);

  for (let step = 0; step < MAX_VOX_STEPS; step++) {
    if (ix >= x0 && ix < x1 && iy >= y0 && iy < y1 && iz >= z0 && iz < z1) {
      const local = atlasOff + (ix - x0) + bxN * ((iy - y0) + byN * (iz - z0));
      const m = pm.vox[local];
      if (m !== 0 && t > 1e-6) {
        const hx = lox + t * ldx, hy = loy + t * ldy, hz = loz + t * ldz;
        out[0] = t;
        out[1] = hx - x0;
        out[2] = hy - y0;
        out[3] = hz - z0;
        out[4] = curFace;
        out[5] = curLayer;
        out[6] = 0;
        out[7] = 0;
        LAST_MAT_LOCAL = m;
        return 1;
      }
    }
    if (t >= tExit || t >= tMax) return 0;

    let axis;
    if (tMaxX < tMaxY) axis = tMaxX < tMaxZ ? 0 : 2;
    else axis = tMaxY < tMaxZ ? 1 : 2;

    if (axis === 0) {
      ix += sx; t = tMaxX; tMaxX += tDeltaX;
      curFace = sx > 0 ? FACE_W : FACE_E;
      curLayer = ix - x0;
    } else if (axis === 1) {
      iy += sy; t = tMaxY; tMaxY += tDeltaY;
      curFace = sy > 0 ? FACE_N : FACE_S;
      curLayer = iy - y0;
    } else {
      iz += sz; t = tMaxZ; tMaxZ += tDeltaZ;
      curFace = sz > 0 ? FACE_D : FACE_U;
      curLayer = iz - z0;
    }
    if (ix < x0 || ix >= x1 || iy < y0 || iy >= y1 || iz < z0 || iz >= z1) return 0;
    if (t >= tMax) return 0;
  }
  return 0;
}

function localFaceNormal(face, out) {
  if (face === FACE_N) { out[0] = 0; out[1] = -1; out[2] = 0; }
  else if (face === FACE_E) { out[0] = 1; out[1] = 0; out[2] = 0; }
  else if (face === FACE_S) { out[0] = 0; out[1] = 1; out[2] = 0; }
  else if (face === FACE_W) { out[0] = -1; out[1] = 0; out[2] = 0; }
  else if (face === FACE_U) { out[0] = 0; out[1] = 0; out[2] = 1; }
  else { out[0] = 0; out[1] = 0; out[2] = -1; }
}

function roundedFace(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? FACE_E : FACE_W;
  if (ay >= ax && ay >= az) return ny >= 0 ? FACE_S : FACE_N;
  return nz >= 0 ? FACE_U : FACE_D;
}

// ---- castModels scratch (module-level, zero per-call allocation) ----------
const _pose = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const _hit = new Float64Array(8);
const _bestHit = new Float64Array(8);
const _nLocal = new Float64Array(3);
const _nWorld = new Float64Array(3);
// Per-part WORLD AABB (minX,minY,minZ,maxX,maxY,maxZ), filled once per
// instance alongside the whole-model AABB - a cheap world-space slab test
// against this lets the per-cell/per-part loop skip most non-intersecting
// (part, cell) pairs without paying for marchVoxelRay's part-local
// transform + slab test (perf, not correctness: a part that fails this
// quick test can never produce a hit, since marchVoxelRay's own slab test
// is exact against the same box, just in a different space).
const _partAABB = new Float64Array(MAX_VOX_PARTS * 6);
const _proj = { cols: 0, rows: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, planeDet: 0, horizonRow: 0, planeDistY: 0, eyeX: 0, eyeY: 0, eyeZ: 0 };
const _rect = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false };

/**
 * Casts up to MAX_VOX_INSTANCES voxel model instances into `fb` (a
 * `{rt:{cols,rows,pxCellW,pxCellH}, depth:Float32Array, gbuf:GBuffer}`),
 * per architecture.md 15.1 "March". `cam` is `{x,y,z,yawDeg,pitchDeg}`
 * (engine/entities/Camera.js's shape). `opts.faceMode` = 'nearest' writes
 * world axis faces (1..6) even for non-axis-aligned parts, for US-040
 * before the light pass exists.
 */
export function castModels(fb, list, cam, opts) {
  const rt = fb.rt;
  const cols = rt.cols, rows = rt.rows;
  const gbuf = fb.gbuf;
  const depth = fb.depth;
  const faceMode = (opts && opts.faceMode) || 'packed';
  const stats = opts && opts.stats;
  if (stats) { stats.instancesCulled = 0; stats.raysMarched = 0; stats.cellsWritten = 0; }

  computeProjection(cam, rt, _proj);
  const dirX = _proj.dirX, dirY = _proj.dirY, planeX = _proj.planeX, planeY = _proj.planeY;
  const eyeX = _proj.eyeX, eyeY = _proj.eyeY, eyeZ = _proj.eyeZ;
  const horizonRow = _proj.horizonRow, planeDistY = _proj.planeDistY;

  const total = list.length;
  const n = Math.min(total, MAX_VOX_INSTANCES);
  if (stats) stats.instancesCulled += Math.max(0, total - MAX_VOX_INSTANCES);

  for (let ii = 0; ii < n; ii++) {
    const inst = list[ii];
    const pm = inst.model;
    // Shared with VoxelPool.project (15.2 item 2): pose -> world AABB
    // (also fills _partAABB, this function's per-part quick-reject data) ->
    // screen rect, so the two paths can never cull differently.
    instanceRect(_proj, pm, inst, _pose, _partAABB, _rect);
    if (_rect.empty) continue;
    const minX = _rect.minX, minY = _rect.minY, minZ = _rect.minZ;
    const maxX = _rect.maxX, maxY = _rect.maxY, maxZ = _rect.maxZ;
    const minCol = _rect.minCol, maxCol = _rect.maxCol, minRow = _rect.minRow, maxRow = _rect.maxRow;

    for (let row = minRow; row <= maxRow; row++) {
      // Engine row convention (sector/terrain casters, every GPU pass): the
      // ray samples at `row`, not `row + 0.5` (US-040 re-review: the half-row
      // offset was the whole gpucompare uvViol/depthViol on kind 8).
      const rdz = (horizonRow - row) / planeDistY; // col-independent - hoisted out of the col loop
      const rowOff = row * cols;
      for (let col = minCol; col <= maxCol; col++) {
        const i = rowOff + col;
        const cameraX = (2 * (col + 0.5)) / cols - 1;
        const rdx = dirX + planeX * cameraX;
        const rdy = dirY + planeY * cameraX;

        const curDepth = depth[i];
        // World-AABB slab test (skip the cell if it can't beat the depth
        // buffer already there).
        let tEnter2 = -Infinity, tExit2 = Infinity, aabbMiss = false;
        if (rdx === 0) { if (eyeX < minX || eyeX > maxX) aabbMiss = true; }
        else {
          let t1 = (minX - eyeX) / rdx, t2 = (maxX - eyeX) / rdx;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tEnter2) tEnter2 = t1;
          if (t2 < tExit2) tExit2 = t2;
        }
        if (!aabbMiss) {
          if (rdy === 0) { if (eyeY < minY || eyeY > maxY) aabbMiss = true; }
          else {
            let t1 = (minY - eyeY) / rdy, t2 = (maxY - eyeY) / rdy;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > tEnter2) tEnter2 = t1;
            if (t2 < tExit2) tExit2 = t2;
          }
        }
        if (!aabbMiss) {
          if (rdz === 0) { if (eyeZ < minZ || eyeZ > maxZ) aabbMiss = true; }
          else {
            let t1 = (minZ - eyeZ) / rdz, t2 = (maxZ - eyeZ) / rdz;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > tEnter2) tEnter2 = t1;
            if (t2 < tExit2) tExit2 = t2;
          }
        }
        if (aabbMiss || tEnter2 > tExit2 || tEnter2 >= curDepth) continue;

        let bestT = Infinity, bestPart = -1;
        for (let p = 0; p < pm.partCount; p++) {
          // Quick world-space reject against the part's own AABB (cheaper
          // than marchVoxelRay's part-local transform + slab test) - skips
          // most non-intersecting (part, cell) pairs for models whose parts
          // don't all overlap the same screen cells (legs vs head, etc).
          const pab = p * 6;
          const paMinX = _partAABB[pab], paMinY = _partAABB[pab + 1], paMinZ = _partAABB[pab + 2];
          const paMaxX = _partAABB[pab + 3], paMaxY = _partAABB[pab + 4], paMaxZ = _partAABB[pab + 5];
          let pte = -Infinity, ptx = Infinity, pMiss = false;
          if (rdx === 0) { if (eyeX < paMinX || eyeX > paMaxX) pMiss = true; }
          else {
            let t1 = (paMinX - eyeX) / rdx, t2 = (paMaxX - eyeX) / rdx;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > pte) pte = t1;
            if (t2 < ptx) ptx = t2;
          }
          if (!pMiss) {
            if (rdy === 0) { if (eyeY < paMinY || eyeY > paMaxY) pMiss = true; }
            else {
              let t1 = (paMinY - eyeY) / rdy, t2 = (paMaxY - eyeY) / rdy;
              if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
              if (t1 > pte) pte = t1;
              if (t2 < ptx) ptx = t2;
            }
          }
          if (!pMiss) {
            if (rdz === 0) { if (eyeZ < paMinZ || eyeZ > paMaxZ) pMiss = true; }
            else {
              let t1 = (paMinZ - eyeZ) / rdz, t2 = (paMaxZ - eyeZ) / rdz;
              if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
              if (t1 > pte) pte = t1;
              if (t2 < ptx) ptx = t2;
            }
          }
          if (pMiss || pte > ptx || pte >= bestT || pte >= curDepth) continue;

          if (stats) stats.raysMarched++;
          const hit = marchVoxelRay(pm, p, _pose, eyeX, eyeY, eyeZ, rdx, rdy, rdz, Math.min(curDepth, bestT), _hit);
          if (hit && _hit[0] < bestT) {
            bestT = _hit[0]; bestPart = p;
            _bestHit[0] = _hit[0]; _bestHit[1] = _hit[1]; _bestHit[2] = _hit[2]; _bestHit[3] = _hit[3];
            _bestHit[4] = _hit[4]; _bestHit[5] = _hit[5];
          }
        }
        if (bestPart < 0 || bestT >= curDepth) continue;

        const t = _bestHit[0];
        const localFace = _bestHit[4];
        const layer = _bestHit[5];
        const matLocal = LAST_MAT_LOCAL;
        const matId = pm.matIds[matLocal];

        let u, v;
        if (localFace === FACE_E || localFace === FACE_W) { u = _bestHit[2] * pm.cellM; v = _bestHit[3] * pm.cellM; }
        else if (localFace === FACE_N || localFace === FACE_S) { u = _bestHit[1] * pm.cellM; v = _bestHit[3] * pm.cellM; }
        else { u = _bestHit[1] * pm.cellM; v = _bestHit[2] * pm.cellM; }

        const worldZ = eyeZ + t * rdz - inst.z;

        const axisAligned = _pose[bestPart * PART_STRIDE + 12] === 1;
        let face;
        const obase = bestPart * PART_STRIDE;
        localFaceNormal(localFace, _nLocal);
        // n_world = cellM * Amat^T * n_local (Amat = the L_k 3x3, world-to-local).
        const a0 = _pose[obase], a1 = _pose[obase + 1], a2 = _pose[obase + 2];
        const a3 = _pose[obase + 3], a4 = _pose[obase + 4], a5 = _pose[obase + 5];
        const a6 = _pose[obase + 6], a7 = _pose[obase + 7], a8 = _pose[obase + 8];
        const nx = _nLocal[0], ny = _nLocal[1], nz = _nLocal[2];
        // Amat^T columns are Amat's rows transposed: (Amat^T * n) uses Amat's
        // COLUMNS as rows here.
        _nWorld[0] = pm.cellM * (a0 * nx + a3 * ny + a6 * nz);
        _nWorld[1] = pm.cellM * (a1 * nx + a4 * ny + a7 * nz);
        _nWorld[2] = pm.cellM * (a2 * nx + a5 * ny + a8 * nz);

        if ((axisAligned || faceMode === 'nearest')) {
          face = roundedFace(_nWorld[0], _nWorld[1], _nWorld[2]);
        } else {
          face = FACE_PACKED;
        }

        const planeId = (0xF << 28) | ((ii & 0xF) << 24) | ((bestPart & 0x7) << 21) | ((localFace & 0x7) << 18) | (layer & 0x3FFFF);

        depth[i] = t;
        if (face === FACE_PACKED) {
          const bits = packNormalOct(_nWorld[0], _nWorld[1], _nWorld[2]);
          gbuf.writeSample(i, KIND_MODEL, matId, face, planeId, u, v, worldZ, 0);
          getAoAlias(gbuf)[i] = bits;
        } else {
          gbuf.writeSample(i, KIND_MODEL, matId, face, planeId, u, v, worldZ, Infinity);
        }
        if (stats) stats.cellsWritten++;
      }
    }
  }
}

// 15.1 item 4: "on the CPU [the packed normal bits] go into the bits of
// gbuf.aoD[i] through a Uint32Array alias of gbuf.aoD.buffer, made once per
// GBuffer identity (not per frame)". Cached on the GBuffer instance itself
// via a non-enumerable property so repeated castModels calls on the same
// fb don't re-alias every frame.
const ALIAS_KEY = '__voxAoU32';
function getAoAlias(gbuf) {
  let alias = gbuf[ALIAS_KEY];
  if (!alias || alias.buffer !== gbuf.aoD.buffer) {
    alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
    Object.defineProperty(gbuf, ALIAS_KEY, { value: alias, enumerable: false, configurable: true, writable: true });
  }
  return alias;
}
