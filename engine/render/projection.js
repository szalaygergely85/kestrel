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
 * @property {number} near - PROJ_NEAR, carried so instanceRect never hard-codes it (RE-02b F3)
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
 * @property {number} cosP - cos(pitch), RE-02a: the horizontal fog-distance factor (28.1 A2 item 3)
 * @property {number} sinP - sin(pitch)
 * @property {Float64Array} M - world -> clip, refreshed by pitchedTerms
 * @property {0|1} ortho - US-068a (38.19): 1 = parallel rays (`cam.projection = 'ortho'`); then `projection` is 'ortho'
 * @property {number} halfW - ortho half view width, m (0 in perspective)
 * @property {number} halfH - ortho half view height, m (0 in perspective)
 */

/** US-068a: the ortho eye sits this far behind the focus along -F (38.19). */
export const ORTHO_BACK_M = 500;

/**
 * Allocates a `PitchedTerms` object (with its `M` Float64Array(16)). The
 * only allocation in the pitched-camera API; every other function here is
 * zero-alloc when given a reused `out`.
 * @returns {PitchedTerms}
 */
export function createPitchedTerms() {
  return {
    projection: 'pitched',
    near: PROJ_NEAR,
    cols: 0, rows: 0, aspect: 0,
    eyeX: 0, eyeY: 0, eyeZ: 0,
    fX: 0, fY: 0, fZ: 0,
    rX: 0, rY: 0,
    uX: 0, uY: 0, uZ: 0,
    tanHalfX: 0, tanHalfY: 0,
    yawDeg: 0, pitchDeg: 0, vfovDeg: 0, cosP: 0, sinP: 0,
    ortho: 0, halfW: 0, halfH: 0,
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
  const isOrtho = cam.projection === 'ortho';
  const pLim = isOrtho ? 90 : 89;
  if (cam.pitchDeg < -pLim || cam.pitchDeg > pLim) {
    throw new Error(`pitchedTerms: pitchDeg ${cam.pitchDeg} out of range [-${pLim}, ${pLim}]`);
  }
  if (isOrtho && !(cam.orthoHalfH > 0)) {
    throw new Error(`pitchedTerms: ortho needs orthoHalfH > 0 (got ${cam.orthoHalfH})`);
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
  const vfovDeg = cam.vfovDeg || fpVfovDeg(grid);
  const tanHalfY = Math.tan((vfovDeg * Math.PI) / 180 / 2);
  const tanHalfX = tanHalfY * aspect;

  out.projection = isOrtho ? 'ortho' : 'pitched';
  out.near = PROJ_NEAR;
  out.cols = cols; out.rows = rows; out.aspect = aspect;
  if (isOrtho) {
    // eye = focus - ORTHO_BACK_M*F when the cam carries a focus, else cam.x/y/z is the eye
    const hasF = cam.focusX !== undefined;
    out.eyeX = hasF ? cam.focusX - ORTHO_BACK_M * fX : cam.x;
    out.eyeY = hasF ? cam.focusY - ORTHO_BACK_M * fY : cam.y;
    out.eyeZ = hasF ? cam.focusZ - ORTHO_BACK_M * fZ : cam.z;
  } else {
    out.eyeX = cam.x; out.eyeY = cam.y; out.eyeZ = cam.z;
  }
  out.ortho = isOrtho ? 1 : 0;
  out.halfH = isOrtho ? cam.orthoHalfH : 0;
  out.halfW = isOrtho ? cam.orthoHalfH * aspect : 0;
  out.fX = fX; out.fY = fY; out.fZ = fZ;
  out.rX = rX; out.rY = rY;
  out.uX = uX; out.uY = uY; out.uZ = uZ;
  // ortho: the tanHalf slots carry halfW/halfH (38.19), so a/b below are already metres
  out.tanHalfX = isOrtho ? out.halfW : tanHalfX; out.tanHalfY = isOrtho ? out.halfH : tanHalfY;
  out.yawDeg = cam.yawDeg; out.pitchDeg = cam.pitchDeg; out.vfovDeg = vfovDeg;
  out.cosP = cosP; out.sinP = sinP;

  if (isOrtho) orthoProjection(out, out.M); else pitchedProjection(out, out.M);
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
 * US-068a (38.19): ortho `M` (column-major, same layout/NDC as pitchedProjection). row_x = (R,-R.eye)/halfW,
 * row_y = -(U,-U.eye)/halfH + (0,0,0,1/rows), row_z = linear vd [near,far] -> [-1,1], row_w = (0,0,0,1).
 * @param {PitchedTerms} terms
 * @param {Float64Array} out16
 * @returns {Float64Array}
 */
export function orthoProjection(terms, out16) {
  const { fX, fY, fZ, rX, rY, uX, uY, uZ, eyeX, eyeY, eyeZ, rows } = terms;
  const xS = 1 / terms.halfW, yS = 1 / terms.halfH;
  const dotR = rX * eyeX + rY * eyeY;
  const dotU = uX * eyeX + uY * eyeY + uZ * eyeZ;
  const dotF = fX * eyeX + fY * eyeY + fZ * eyeZ;
  const zS = 2 / (PROJ_FAR - PROJ_NEAR);
  const zD = -(2 * dotF + PROJ_FAR + PROJ_NEAR) / (PROJ_FAR - PROJ_NEAR);
  out16[0] = xS * rX; out16[1] = -yS * uX; out16[2] = zS * fX; out16[3] = 0;
  out16[4] = xS * rY; out16[5] = -yS * uY; out16[6] = zS * fY; out16[7] = 0;
  out16[8] = 0; out16[9] = -yS * uZ; out16[10] = zS * fZ; out16[11] = 0;
  out16[12] = -xS * dotR; out16[13] = yS * dotU + 1 / rows; out16[14] = zD; out16[15] = 1;
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
  if (terms.ortho) { // parallel rays: origin moves, dir = F (a/b already in metres)
    out.ox = terms.eyeX + a * terms.rX + b * terms.uX;
    out.oy = terms.eyeY + a * terms.rY + b * terms.uY;
    out.oz = terms.eyeZ + b * terms.uZ;
    out.dx = terms.fX; out.dy = terms.fY; out.dz = terms.fZ;
    return out;
  }
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
  if (terms.ortho) {
    out3[0] = terms.eyeX + a * terms.rX + b * terms.uX + vd * terms.fX;
    out3[1] = terms.eyeY + a * terms.rY + b * terms.uY + vd * terms.fY;
    out3[2] = terms.eyeZ + b * terms.uZ + vd * terms.fZ;
    return out3;
  }
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
  const vx = dx * terms.rX + dy * terms.rY; // rZ = 0
  const vy = dx * terms.uX + dy * terms.uY + dz * terms.uZ;
  if (terms.ortho) { // no perspective divide; vd may be <= 0 (behind the far-back eye)
    out3[0] = (vx / terms.tanHalfX + 1) * (terms.cols / 2) - 0.5;
    out3[1] = (1 - vy / terms.tanHalfY) * (terms.rows / 2);
    return out3;
  }
  if (vd <= 0) return out3;
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

// ---------------------------------------------------------------------------
// RE-02a (docs/architecture.md 28.1 Amendment 2): the pipeline renders a
// pitched cam. Helpers the mesh path's consumers share.
// ---------------------------------------------------------------------------

/**
 * The ONE place a camera's projection is resolved (28.1 A2 item 1). Until
 * RE-02b the default is `'shear'` on every renderer; `'pitched'` must be
 * requested explicitly (`cam.projection = 'pitched'`).
 * @param {{projection?: 'shear'|'pitched'}} cam
 * @param {string} [renderer] - 'dda' | 'mesh' - an unset projection resolves to pitched on 'mesh', shear on 'dda' (RE-02b)
 * @returns {'shear'|'pitched'|'ortho'}
 */
export function resolveProjection(cam, renderer) {
  if (cam.projection === 'pitched') return 'pitched';
  if (cam.projection === 'ortho') return 'ortho';
  if (cam.projection === 'shear') return 'shear';
  return renderer === 'mesh' ? 'pitched' : 'shear';
}

/**
 * First-person vertical fov (28.1 A2 item 5): `2*atan(tan(PROJ_HFOV_DEG/2)/aspect)`, so the horizontal
 * fov stays 75 deg on every aspect and the pitched view at pitch 0 equals the shear view.
 * @param {{cols:number, rows:number, pxCellW?:number, pxCellH?:number}} grid
 * @returns {number} degrees
 */
export function fpVfovDeg(grid) {
  const aspect = (grid.cols * (grid.pxCellW || 1)) / (grid.rows * (grid.pxCellH || 1));
  return (2 * Math.atan(Math.tan((PROJ_HFOV_DEG * Math.PI) / 360) / aspect) * 180) / Math.PI;
}

/** Look-pitch clamp on the pitched camera (28.1 A2 item 6); the shear clamp stays 35. */
export const PITCH_CLAMP_PITCHED_DEG = 70;

/** US-068b3a: true for the pitched camera family ('pitched' and 'ortho' share basis, terms and the worldToCell path). @param {string} proj a `resolveProjection` result */
export function isPitchedFamily(proj) { return proj === 'pitched' || proj === 'ortho'; }

/** The 28.1 throw: DDA, voxel march and the CPU caster only know the shear camera. */
export function assertProjectionRenderer(cam, renderer) {
  const rp = resolveProjection(cam, renderer);
  if ((rp === 'pitched' || rp === 'ortho') && renderer !== 'mesh') {
    throw new Error("cam.projection 'pitched' requires renderer 'mesh'");
  }
}

/**
 * Horizontal forward distance factor for a cell row: `max(0, dot(dir, (fx,fy,0)))`
 * with `dir = F + a*R + b*U`; `R.(fx,fy) = 0`, so it is `cosP - b*sinP`, `b =
 * (1 - 2*row/rows)*tanHalfY`. `vd * pitchedFogScale(row)` is the shear `d`
 * (28.1 A2 item 3: fog never swims with pitch; pitch 0 == shear). GLSL twin:
 * `pitchFogScale` in glsl/common.js.
 * @param {PitchedTerms} terms
 * @param {number} row
 * @returns {number}
 */
export function pitchedFogScale(terms, row) {
  if (terms.ortho) return terms.cosP; // parallel rays: constant (38.19)
  const b = (1 - (2 * row) / terms.rows) * terms.tanHalfY;
  const k = terms.cosP - b * terms.sinP;
  return k > 0 ? k : 0;
}

/**
 * BUG-RTS-001 (28.11a): per-frame terrain look-hash cell (metres) for the pitched view, 0 for shear
 * (= keep the fixed 2/8 m cell). Ground metres per column at the view-centre distance, rounded up to
 * a power of two (zoom steps nest), clamped 0.125..2. Depends on zoom + grid only (world-keyed,
 * no panning shimmer). Shared by the JS oracle (compositor) and GpuCellPipeline (`uHashCell`).
 * @deprecated (28.11c) superseded by per-cell mode (hashCell = -k); kept for its tests.
 * @param {PitchedTerms|{projection?:string}} terms  pitchedTerms output (shear terms -> 0)
 * @param {number} cols
 * @param {number} zRef  ground height under the view focus
 * @returns {number}
 */
export function pitchedHashCell(terms, cols, zRef) {
  const t = /** @type {PitchedTerms} */ (terms);
  if (!t || t.projection !== 'pitched' || !(t.sinP < 0) || !(cols > 0) || !Number.isFinite(zRef)) return 0;
  const vdC = (t.eyeZ - zRef) / -t.sinP;
  const fp = (2 * t.tanHalfX * vdC) / cols;
  if (!(fp > 0)) return 0;
  const c = Math.pow(2, Math.ceil(Math.log2(fp)));
  return c < 0.125 ? 0.125 : c > 2 ? 2 : c;
}

/**
 * US-068b1 (38.19): ortho look-hash cell (m): positive fixed size `clamp(2^ceil(log2(2*halfW/cols)), 0.125, 2)` (ground m per
 * column is constant in ortho). 0 when not ortho. Host sends it as `hashCell` (> 0 = fixed cell, 28.11 path) instead of `-k`.
 * @param {PitchedTerms} terms
 * @param {number} cols
 * @returns {number}
 */
export function orthoHashCell(terms, cols) {
  if (!terms || !terms.ortho || !(cols > 0) || !(terms.halfW > 0)) return 0;
  const c = Math.pow(2, Math.ceil(Math.log2((2 * terms.halfW) / cols)));
  return c < 0.125 ? 0.125 : c > 2 ? 2 : c;
}

// ---------------------------------------------------------------------------
// RE-07a (28.9 item 3): the frame's world -> clip matrix for ANY camera, so UI
// overlays project with exactly the matrix the mesh raster uses.
// ---------------------------------------------------------------------------
const _frameTerms = /** @type {ProjTerms} */ ({});
const _framePitched = createPitchedTerms();

/**
 * Writes the raster matrix M (column-major, world -> clip) of `cam` for a
 * `cols x rows` grid into `out16`. Shear and pitched: the same call the mesh
 * raster makes (`resolveProjection(cam, renderer)`, renderer default 'mesh'). Zero allocation after first use.
 * @param {Object} cam
 * @param {{cols:number, rows:number, pxCellW?:number, pxCellH?:number}} grid
 * @param {Float64Array} out16
 * @returns {Float64Array}
 */
export function frameMatrix(cam, grid, out16, renderer = 'mesh') {
  const rp = resolveProjection(cam, renderer);
  if (rp === 'pitched' || rp === 'ortho') {
    pitchedTerms(cam, grid, _framePitched);
    out16.set(_framePitched.M);
  } else {
    projTerms(cam, grid, _frameTerms);
    shearProjection(_frameTerms, out16);
  }
  return out16;
}

/**
 * PREC-01a (37.9 step 1): viewProj * T(ox, oy, 0) for a camera-relative render origin. Columns 0-2 are copied, the translation column is
 * `M[0..3]*ox + M[4..7]*oy + M[12..15]` in f64 and only then stored to `outF32` (the formula water uses). Zero allocation.
 * @param {ArrayLike<number>} M64 column-major world -> clip, f64
 * @param {number} ox @param {number} oy
 * @param {Float32Array|Float64Array} outF32
 * @returns {Float32Array|Float64Array}
 */
export function viewProjAtOrigin(M64, ox, oy, outF32) {
  for (let k = 0; k < 12; k++) outF32[k] = M64[k];
  for (let k = 0; k < 4; k++) outF32[12 + k] = M64[k] * ox + M64[4 + k] * oy + M64[12 + k];
  return outF32;
}
