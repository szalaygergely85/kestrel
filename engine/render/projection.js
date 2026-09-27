// @ts-check
// engine/render/projection.js - ME-02 (docs/backlog.md, docs/architecture.md
// 27.5, 27.15.3). The ONE place today's y-shear camera is expressed as a
// single 4x4 matrix (`shearProjection`), plus its exact inverse
// (`unprojectCell`, which must equal `cellRayP` - engine/render/gpu/glsl/
// common.js - within 1e-9). No camera pitch rotation anywhere (27.1 item 2,
// 27.15.3 "do not"): pitch only shifts `horizonRow`, exactly as the DDA
// caster and the voxel march already do.
//
// Every camera term below is the literal expression order of
// `castScene` (engine/render/sectorCaster.js) and
// `computeProjection` (engine/voxel/instanceRect.js) - the three must never
// drift apart (projection.test.js checks it).
//
// engine/render/projection.js imports nothing (27.15.0 "Imports of the new
// modules").

/** Horizontal field of view in degrees (matches `HFOV_DEG` everywhere else). */
export const PROJ_HFOV_DEG = 75;
/** Near clip distance, metres (27.5). */
export const PROJ_NEAR = 0.05;
/** Far clip distance, metres (27.5, `fogFull`). */
export const PROJ_FAR = 2000;

/**
 * @typedef {Object} GridSpec
 * @property {number} cols
 * @property {number} rows
 * @property {number} [pxCellW] - device-pixel cell width (default 1)
 * @property {number} [pxCellH] - device-pixel cell height (default 1)
 */

/**
 * @typedef {Object} CamPose
 * @property {number} x - world metres
 * @property {number} y - world metres
 * @property {number} z - world metres, eye height
 * @property {number} yawDeg - compass yaw, degrees (D-028)
 * @property {number} pitchDeg - degrees
 */

/**
 * @typedef {Object} ProjTerms
 * @property {number} cols
 * @property {number} rows
 * @property {number} eyeX
 * @property {number} eyeY
 * @property {number} eyeZ
 * @property {number} dirX
 * @property {number} dirY
 * @property {number} planeX
 * @property {number} planeY
 * @property {number} tanHalf
 * @property {number} planeDistX
 * @property {number} planeDistY
 * @property {number} horizonRow
 * @property {number} tanPitch
 */

/**
 * Fills (and returns) `out` with the per-frame camera/projection terms, in
 * the same expression order as `castScene`/`computeProjection`. Zero
 * allocation when `out` is reused frame to frame.
 * @param {CamPose} cam
 * @param {GridSpec} grid
 * @param {ProjTerms} out
 * @returns {ProjTerms}
 */
export function projTerms(cam, grid, out) {
  const cols = grid.cols, rows = grid.rows;
  const hFovRad = (PROJ_HFOV_DEG * Math.PI) / 180;
  const tanHalf = Math.tan(hFovRad / 2);
  const yawRad = (cam.yawDeg * Math.PI) / 180;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalf;
  const planeY = dirX * tanHalf;
  const aspect = (cols * (grid.pxCellW || 1)) / (rows * (grid.pxCellH || 1));
  const planeDistY = (rows / 2) * aspect / tanHalf;
  const planeDistX = cols / (2 * tanHalf);
  const tanPitch = Math.tan((cam.pitchDeg * Math.PI) / 180);
  const horizonRow = rows / 2 + tanPitch * planeDistY;

  out.cols = cols;
  out.rows = rows;
  out.eyeX = cam.x;
  out.eyeY = cam.y;
  out.eyeZ = cam.z;
  out.dirX = dirX;
  out.dirY = dirY;
  out.planeX = planeX;
  out.planeY = planeY;
  out.tanHalf = tanHalf;
  out.planeDistX = planeDistX;
  out.planeDistY = planeDistY;
  out.horizonRow = horizonRow;
  out.tanPitch = tanPitch;
  return out;
}

/**
 * Builds M = P * V (world -> clip, column-major, `out16[col*4 + row]`) from
 * `terms` (27.5 + 27.15.0 amendments 1 and 8): `x_clip = r * (2 planeDistX /
 * cols)`, `y_clip = (d*tanPitch - h) * (2*planeDistY/rows) + d/rows`,
 * `z_clip = d*(F+N)/(F-N) - 2FN/(F-N)`, `w_clip = d` where `r = dot(P-eye,
 * right)`, `d = dot(P-eye, fwd)`, `h = P.z - eyeZ`. No pitch rotation of
 * geometry: pitch only enters through `terms.horizonRow`/`terms.tanPitch`.
 * @param {ProjTerms} terms
 * @param {Float64Array} out16
 * @returns {Float64Array}
 */
export function shearProjection(terms, out16) {
  const { rows, eyeX, eyeY, eyeZ, dirX, dirY, tanHalf, planeDistY, tanPitch } = terms;
  const rX = -dirY, rY = dirX;

  // row_w = d (dot(P - eye, fwd)): a=dirX, b=dirY, c=0, d0=-(dirX*eyeX+dirY*eyeY)
  const wA = dirX, wB = dirY, wC = 0, wD = -(dirX * eyeX + dirY * eyeY);

  // row_x = (1/tanHalf) * (rX, rY, 0, -(rX*eyeX+rY*eyeY))  ( = r * 2*planeDistX/cols )
  const xScale = 1 / tanHalf;
  const xA = xScale * rX, xB = xScale * rY, xC = 0, xD = xScale * -(rX * eyeX + rY * eyeY);

  // row_y = (ky*tanPitch + 1/rows) * row_w - ky * (0, 0, 1, -eyeZ), ky = 2*planeDistY/rows
  const ky = (2 * planeDistY) / rows;
  const yS = ky * tanPitch + 1 / rows;
  const yA = yS * wA, yB = yS * wB, yC = -ky, yD = yS * wD + ky * eyeZ;

  // row_z = A*row_w + (0, 0, 0, B), A = (F+N)/(F-N), B = -2FN/(F-N)
  const A = (PROJ_FAR + PROJ_NEAR) / (PROJ_FAR - PROJ_NEAR);
  const B = (-2 * PROJ_FAR * PROJ_NEAR) / (PROJ_FAR - PROJ_NEAR);
  const zA = A * wA, zB = A * wB, zC = 0, zD = A * wD + B;

  out16[0] = xA; out16[1] = yA; out16[2] = zA; out16[3] = wA;
  out16[4] = xB; out16[5] = yB; out16[6] = zB; out16[7] = wB;
  out16[8] = xC; out16[9] = yC; out16[10] = zC; out16[11] = wC;
  out16[12] = xD; out16[13] = yD; out16[14] = zD; out16[15] = wD;
  return out16;
}

/**
 * Applies `M` (as built by `shearProjection`) to world point `(x, y, z)` and
 * writes `[X, Y, zNdc, w]` into `out4`: `X = W/2 * xClip/w + W/2`,
 * `Y = H/2 * yClip/w + H/2`, `zNdc = zClip/w`, `w = wClip`. When `w <= 0`
 * (behind the camera plane) only `out4[3]` (`w`) is valid - the caller must
 * check it before trusting X/Y/zNdc.
 * @param {Float64Array} M - column-major 4x4, world -> clip
 * @param {number} W - raster width in sub-sample pixels (`cols*n`)
 * @param {number} H - raster height in sub-sample pixels (`rows*n`)
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Float64Array|number[]} out4
 * @returns {Float64Array|number[]}
 */
export function projectPoint(M, W, H, x, y, z, out4) {
  const xClip = M[0] * x + M[4] * y + M[8] * z + M[12];
  const yClip = M[1] * x + M[5] * y + M[9] * z + M[13];
  const zClip = M[2] * x + M[6] * y + M[10] * z + M[14];
  const w = M[3] * x + M[7] * y + M[11] * z + M[15];
  out4[3] = w;
  if (w <= 0) return out4;
  out4[0] = (W / 2) * (xClip / w) + W / 2;
  out4[1] = (H / 2) * (yClip / w) + H / 2;
  out4[2] = zClip / w;
  return out4;
}

/**
 * The exact inverse of the projection for a resolved per-cell distance:
 * literal twin of GLSL `cellRayP` (engine/render/gpu/glsl/common.js).
 * @param {ProjTerms} terms
 * @param {number} col - screen cell column (samples at `col + 0.5`)
 * @param {number} row - screen cell row (samples at `row`, 27.15.0 amendment 1)
 * @param {number} dist - resolved ray distance, metres
 * @param {Float64Array|number[]} out3
 * @returns {Float64Array|number[]}
 */
export function unprojectCell(terms, col, row, dist, out3) {
  const cameraX = (2 * (col + 0.5)) / terms.cols - 1;
  const rayDirX = terms.dirX + terms.planeX * cameraX;
  const rayDirY = terms.dirY + terms.planeY * cameraX;
  const slope = (terms.horizonRow - row) / terms.planeDistY;
  out3[0] = terms.eyeX + rayDirX * dist;
  out3[1] = terms.eyeY + rayDirY * dist;
  out3[2] = terms.eyeZ + slope * dist;
  return out3;
}

/**
 * Inverse of the `X = n*(col + 0.5)`, `Y = n*(row + 0.5)` sub-sample mapping
 * (27.15.0 amendment 1).
 * @param {number} n - sub-samples per cell
 * @param {number} X
 * @param {number} Y
 * @param {Float64Array|number[]} out2
 * @returns {Float64Array|number[]}
 */
export function windowToCell(n, X, Y, out2) {
  out2[0] = X / n - 0.5;
  out2[1] = Y / n - 0.5;
  return out2;
}
