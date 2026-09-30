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

// ---------------------------------------------------------------------------
// RE-01 (docs/architecture.md 28.1): a real rotated view matrix for
// `cam.projection: 'pitched'` (mesh renderer only, RE-02). `'shear'` above
// stays bit-identical - nothing here is called from that path.
// ---------------------------------------------------------------------------

/** Default vertical FOV for the pitched camera, degrees (28.1). */
export const PROJ_PITCHED_VFOV_DEG = 36;

/**
 * @typedef {Object} PitchedTerms   filled by pitchedTerms; consumers read, never write
 * @property {'pitched'} projection
 * @property {number} cols
 * @property {number} rows
 * @property {number} aspect
 * @property {number} eyeX
 * @property {number} eyeY
 * @property {number} eyeZ
 * @property {number} fX
 * @property {number} fY
 * @property {number} fZ
 * @property {number} rX
 * @property {number} rY
 * @property {number} uX
 * @property {number} uY
 * @property {number} uZ
 * @property {number} tanHalfX
 * @property {number} tanHalfY
 * @property {number} yawDeg
 * @property {number} pitchDeg
 * @property {number} vfovDeg
 * @property {Float64Array} M - world -> clip, refreshed by pitchedTerms
 */

/**
 * Allocates a `PitchedTerms` object (with its `M` Float64Array(16)). The
 * only allocation in the pitched-camera API; every other function here is
 * zero-alloc when given a reused `out`.
 * @returns {PitchedTerms}
 */
export function createPitchedTerms() {
  return {
    projection: 'pitched',
    cols: 0, rows: 0, aspect: 0,
    eyeX: 0, eyeY: 0, eyeZ: 0,
    fX: 0, fY: 0, fZ: 0,
    rX: 0, rY: 0,
    uX: 0, uY: 0, uZ: 0,
    tanHalfX: 0, tanHalfY: 0,
    yawDeg: 0, pitchDeg: 0, vfovDeg: 0,
    M: new Float64Array(16),
  };
}

/**
 * Fills (and returns) `out` with the pitched-camera basis/terms and its
 * world -> clip matrix (28.1). `pitchDeg` keeps the engine sign (positive =
 * up); range `-89..89`, else throws. Zero allocation.
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number,vfovDeg?:number}} cam
 * @param {GridSpec} grid
 * @param {PitchedTerms} out
 * @returns {PitchedTerms}
 */
export function pitchedTerms(cam, grid, out) {
  if (cam.pitchDeg < -89 || cam.pitchDeg > 89) {
    throw new Error(`pitchedTerms: pitchDeg ${cam.pitchDeg} out of range [-89, 89]`);
  }
  const cols = grid.cols, rows = grid.rows;
  const yawRad = (cam.yawDeg * Math.PI) / 180;
  const p = (cam.pitchDeg * Math.PI) / 180;
  const fx = Math.sin(yawRad), fy = -Math.cos(yawRad);
  const cosP = Math.cos(p), sinP = Math.sin(p);

  const fX = cosP * fx, fY = cosP * fy, fZ = sinP;
  const rX = Math.cos(yawRad), rY = Math.sin(yawRad);
  const uX = -sinP * fx, uY = -sinP * fy, uZ = cosP;

  const aspect = (cols * (grid.pxCellW || 1)) / (rows * (grid.pxCellH || 1));
  const vfovDeg = cam.vfovDeg || PROJ_PITCHED_VFOV_DEG;
  const tanHalfY = Math.tan((vfovDeg * Math.PI) / 180 / 2);
  const tanHalfX = tanHalfY * aspect;

  out.projection = 'pitched';
  out.cols = cols; out.rows = rows; out.aspect = aspect;
  out.eyeX = cam.x; out.eyeY = cam.y; out.eyeZ = cam.z;
  out.fX = fX; out.fY = fY; out.fZ = fZ;
  out.rX = rX; out.rY = rY;
  out.uX = uX; out.uY = uY; out.uZ = uZ;
  out.tanHalfX = tanHalfX; out.tanHalfY = tanHalfY;
  out.yawDeg = cam.yawDeg; out.pitchDeg = cam.pitchDeg; out.vfovDeg = vfovDeg;

  pitchedProjection(out, out.M);
  return out;
}

/**
 * Builds `M = P*V` (world -> clip, column-major, `out16[col*4+row]`,
 * Float64Array(16)) from `terms` (28.1). At `pitchDeg = 0` with
 * `vfovDeg = 2*atan(tan(PROJ_HFOV_DEG/2)/aspect)` this equals
 * `shearProjection`'s matrix element-wise within 1e-12.
 * @param {PitchedTerms} terms
 * @param {Float64Array} out16
 * @returns {Float64Array}
 */
export function pitchedProjection(terms, out16) {
  const {
    fX, fY, fZ, rX, rY, uX, uY, uZ,
    eyeX, eyeY, eyeZ, tanHalfX, tanHalfY, rows,
  } = terms;

  // row_w = (F.x, F.y, F.z, -dot(F,eye))
  const wA = fX, wB = fY, wC = fZ, wD = -(fX * eyeX + fY * eyeY + fZ * eyeZ);

  // row_x = (1/tanHalfX) * (R.x, R.y, 0, -dot(R,eye))  (rZ = 0)
  const xScale = 1 / tanHalfX;
  const xA = xScale * rX, xB = xScale * rY, xC = 0, xD = xScale * -(rX * eyeX + rY * eyeY);

  // row_y = -(1/tanHalfY) * (U.x, U.y, U.z, -dot(U,eye)) + (1/rows)*row_w
  const yScale = 1 / tanHalfY;
  const dotU = uX * eyeX + uY * eyeY + uZ * eyeZ;
  const invRows = 1 / rows;
  const yA = -yScale * uX + invRows * wA;
  const yB = -yScale * uY + invRows * wB;
  const yC = -yScale * uZ + invRows * wC;
  const yD = yScale * dotU + invRows * wD;

  // row_z = A*row_w + (0, 0, 0, B), A/B exactly as shearProjection.
  const A = (PROJ_FAR + PROJ_NEAR) / (PROJ_FAR - PROJ_NEAR);
  const B = (-2 * PROJ_FAR * PROJ_NEAR) / (PROJ_FAR - PROJ_NEAR);
  const zA = A * wA, zB = A * wB, zC = A * wC, zD = A * wD + B;

  out16[0] = xA; out16[1] = yA; out16[2] = zA; out16[3] = wA;
  out16[4] = xB; out16[5] = yB; out16[6] = zB; out16[7] = wB;
  out16[8] = xC; out16[9] = yC; out16[10] = zC; out16[11] = wC;
  out16[12] = xD; out16[13] = yD; out16[14] = zD; out16[15] = wD;
  return out16;
}

/**
 * Cell ray for the pitched camera (28.1 "cell convention"): origin = eye,
 * direction `F + a*R + b*U` (not normalised - the forward component is 1,
 * so the distance along `dir` is the view depth `vd`). `col`/`row` may be
 * fractional. Zero allocation.
 * @param {PitchedTerms} terms
 * @param {number} col
 * @param {number} row
 * @param {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}} out
 * @returns {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}}
 */
export function screenRay(terms, col, row, out) {
  const a = ((2 * (col + 0.5)) / terms.cols - 1) * terms.tanHalfX;
  const b = (1 - (2 * row) / terms.rows) * terms.tanHalfY;
  out.ox = terms.eyeX; out.oy = terms.eyeY; out.oz = terms.eyeZ;
  out.dx = terms.fX + a * terms.rX + b * terms.uX;
  out.dy = terms.fY + a * terms.rY + b * terms.uY;
  out.dz = terms.fZ + b * terms.uZ; // rZ = 0
  return out;
}

/**
 * `eye + vd*dir` for the pitched cell ray - JS twin of GLSL `cellRayPitched`.
 * @param {PitchedTerms} terms
 * @param {number} col
 * @param {number} row
 * @param {number} vd - view depth, metres
 * @param {Float64Array|number[]} out3
 * @returns {Float64Array|number[]}
 */
export function unprojectPitched(terms, col, row, vd, out3) {
  const a = ((2 * (col + 0.5)) / terms.cols - 1) * terms.tanHalfX;
  const b = (1 - (2 * row) / terms.rows) * terms.tanHalfY;
  const dx = terms.fX + a * terms.rX + b * terms.uX;
  const dy = terms.fY + a * terms.rY + b * terms.uY;
  const dz = terms.fZ + b * terms.uZ;
  out3[0] = terms.eyeX + dx * vd;
  out3[1] = terms.eyeY + dy * vd;
  out3[2] = terms.eyeZ + dz * vd;
  return out3;
}

/**
 * Inverse of `unprojectPitched`/`screenRay`: world point -> `[col, row, vd]`.
 * `vd <= 0` means the point is behind (or on) the eye plane - only `out3[2]`
 * (`vd`) is valid in that case. Zero allocation.
 * @param {PitchedTerms} terms
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Float64Array|number[]} out3
 * @returns {Float64Array|number[]}
 */
export function worldToCell(terms, x, y, z, out3) {
  const dx = x - terms.eyeX, dy = y - terms.eyeY, dz = z - terms.eyeZ;
  const vd = dx * terms.fX + dy * terms.fY + dz * terms.fZ;
  out3[2] = vd;
  if (vd <= 0) return out3;
  const vx = dx * terms.rX + dy * terms.rY; // rZ = 0
  const vy = dx * terms.uX + dy * terms.uY + dz * terms.uZ;
  out3[0] = (vx / vd / terms.tanHalfX + 1) * (terms.cols / 2) - 0.5;
  out3[1] = (1 - vy / vd / terms.tanHalfY) * (terms.rows / 2);
  return out3;
}

/**
 * `eye = focus - dist*F`, `F` from `yawDeg`/`pitchDeg` (28.1's basis, same
 * sign convention). Zero allocation.
 * @param {number} fx - focus x
 * @param {number} fy - focus y
 * @param {number} fz - focus z
 * @param {number} yawDeg
 * @param {number} pitchDeg
 * @param {number} dist
 * @param {Float64Array|number[]} out3
 * @returns {Float64Array|number[]}
 */
export function pitchedEyeFromFocus(fx, fy, fz, yawDeg, pitchDeg, dist, out3) {
  const yawRad = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const sfx = Math.sin(yawRad), sfy = -Math.cos(yawRad);
  const cosP = Math.cos(p), sinP = Math.sin(p);
  const Fx = cosP * sfx, Fy = cosP * sfy, Fz = sinP;
  out3[0] = fx - dist * Fx;
  out3[1] = fy - dist * Fy;
  out3[2] = fz - dist * Fz;
  return out3;
}
