// engine/voxel/instanceRect.js - US-040 shared "pose -> world AABB -> screen
// rect" step (architecture.md 15.2 item 2): "move that code into one helper
// `instanceRect(...)` that castModels and the pool both call, so culling can
// never differ between paths". Hot path (called once per instance per frame
// by both castModels and VoxelPool.project): no `new`, literals, closures,
// `for..of` or destructuring - callers own all scratch/out storage.

import { PART_STRIDE } from './VoxelModel.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';

// Duplicated from the sector caster's projection (same reasoning as
// voxelMarch.js's own HFOV_DEG: engine/voxel/** imports only
// ../render/GBuffer.js from outside the voxel package).
export const HFOV_DEG = 75;

/**
 * Fills `proj` (a plain object reused frame to frame) with the per-frame
 * projection terms `instanceRect` needs, from `cam` ({x,y,z,yawDeg,pitchDeg})
 * and a `{cols,rows,pxCellW,pxCellH}`-shaped render target. Computed once per
 * frame, not per instance (the original castModels code hoisted exactly
 * this out of its instance loop).
 */
export function computeProjection(cam, rt, proj) {
  const cols = rt.cols, rows = rt.rows;
  const hFovRad = (HFOV_DEG * Math.PI) / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);
  const yawRad = (cam.yawDeg * Math.PI) / 180;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalfHFov, planeY = dirX * tanHalfHFov;
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const pitchRad = (cam.pitchDeg * Math.PI) / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;
  const planeDet = dirX * planeY - dirY * planeX;
  proj.cols = cols; proj.rows = rows;
  proj.dirX = dirX; proj.dirY = dirY;
  proj.planeX = planeX; proj.planeY = planeY;
  proj.planeDet = planeDet;
  proj.horizonRow = horizonRow; proj.planeDistY = planeDistY;
  proj.eyeX = cam.x; proj.eyeY = cam.y; proj.eyeZ = cam.z;
  return proj;
}

/**
 * `computeVoxelPose(pm, inst, pose)` -> world AABB of the posed part boxes
 * (from `FORWARD`, computeVoxelPose's forward-transform side output) ->
 * screen rect. Any AABB corner at camera depth `<= 0.05` -> the full screen
 * (per 15.2 item 2). `partAABB` (Float64Array, length >= partCount*6) is
 * optional - pass it so callers that need per-part culling (castModels) get
 * each part's world AABB in the same pass; pass `null` to skip.
 *
 * Fills `rect`: { minX,minY,minZ, maxX,maxY,maxZ (whole-instance world AABB),
 * minCol,maxCol,minRow,maxRow (clamped screen rect), empty (bool) }.
 */
export function instanceRect(proj, pm, inst, pose, partAABB, rect) {
  computeVoxelPose(pm, inst, pose);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const partCount = pm.partCount;
  for (let p = 0; p < partCount; p++) {
    const pb = p * PART_STRIDE;
    const x0 = pm.parts[pb], y0 = pm.parts[pb + 1], z0 = pm.parts[pb + 2];
    const x1 = pm.parts[pb + 3], y1 = pm.parts[pb + 4], z1 = pm.parts[pb + 5];
    const fb12 = p * 12;
    const A0 = FORWARD[fb12], A1 = FORWARD[fb12 + 1], A2 = FORWARD[fb12 + 2];
    const A3 = FORWARD[fb12 + 3], A4 = FORWARD[fb12 + 4], A5 = FORWARD[fb12 + 5];
    const A6 = FORWARD[fb12 + 6], A7 = FORWARD[fb12 + 7], A8 = FORWARD[fb12 + 8];
    const Bx = FORWARD[fb12 + 9], By = FORWARD[fb12 + 10], Bz = FORWARD[fb12 + 11];
    let pMinX = Infinity, pMinY = Infinity, pMinZ = Infinity;
    let pMaxX = -Infinity, pMaxY = -Infinity, pMaxZ = -Infinity;
    for (let c = 0; c < 8; c++) {
      const cx = (c & 1) ? x1 : x0, cy = (c & 2) ? y1 : y0, cz = (c & 4) ? z1 : z0;
      const wx = A0 * cx + A1 * cy + A2 * cz + Bx;
      const wy = A3 * cx + A4 * cy + A5 * cz + By;
      const wz = A6 * cx + A7 * cy + A8 * cz + Bz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      if (wx < pMinX) pMinX = wx; if (wx > pMaxX) pMaxX = wx;
      if (wy < pMinY) pMinY = wy; if (wy > pMaxY) pMaxY = wy;
      if (wz < pMinZ) pMinZ = wz; if (wz > pMaxZ) pMaxZ = wz;
    }
    if (partAABB) {
      const pab = p * 6;
      partAABB[pab] = pMinX; partAABB[pab + 1] = pMinY; partAABB[pab + 2] = pMinZ;
      partAABB[pab + 3] = pMaxX; partAABB[pab + 4] = pMaxY; partAABB[pab + 5] = pMaxZ;
    }
  }

  rect.minX = minX; rect.minY = minY; rect.minZ = minZ;
  rect.maxX = maxX; rect.maxY = maxY; rect.maxZ = maxZ;

  const cols = proj.cols, rows = proj.rows;
  let minCol = 0, maxCol = cols - 1, minRow = 0, maxRow = rows - 1;
  let useFull = false;
  const planeDet = proj.planeDet;
  if (planeDet !== 0) {
    let rMinCol = cols, rMaxCol = -1, rMinRow = rows, rMaxRow = -1;
    for (let c = 0; c < 8 && !useFull; c++) {
      const wx = (c & 1) ? maxX : minX, wy = (c & 2) ? maxY : minY, wz = (c & 4) ? maxZ : minZ;
      const relx = wx - proj.eyeX, rely = wy - proj.eyeY;
      const t = (relx * proj.planeY - rely * proj.planeX) / planeDet;
      if (t <= 0.05) { useFull = true; break; }
      const u = (proj.dirX * rely - proj.dirY * relx) / planeDet;
      const cameraX = u / t;
      const colF = ((cameraX + 1) * cols) / 2 - 0.5;
      const rowF = proj.horizonRow - ((wz - proj.eyeZ) / t) * proj.planeDistY;
      const c0 = Math.floor(colF) - 1, c1 = Math.ceil(colF) + 1;
      const r0 = Math.floor(rowF) - 1, r1 = Math.ceil(rowF) + 1;
      if (c0 < rMinCol) rMinCol = c0; if (c1 > rMaxCol) rMaxCol = c1;
      if (r0 < rMinRow) rMinRow = r0; if (r1 > rMaxRow) rMaxRow = r1;
    }
    if (!useFull) {
      minCol = Math.max(0, rMinCol); maxCol = Math.min(cols - 1, rMaxCol);
      minRow = Math.max(0, rMinRow); maxRow = Math.min(rows - 1, rMaxRow);
    }
  }
  rect.minCol = minCol; rect.maxCol = maxCol;
  rect.minRow = minRow; rect.maxRow = maxRow;
  rect.empty = minCol > maxCol || minRow > maxRow;
  return rect;
}
