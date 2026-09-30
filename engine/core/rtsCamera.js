// @ts-check
// engine/core/rtsCamera.js (RE-03, docs/architecture.md 28.1 "RE-03
// engine/core/rtsCamera.js"). Presentation, not sim: may use Math.exp and a
// frame dt; imports engine/render/projection.js (a leaf, no imports) and
// engine/core/transform.js (DEG2RAD). Drives an RTS-style top-down pitched
// camera: a ground focus point {focusX, focusY} + a zoom factor pick the eye
// position each frame via `pitchedEyeFromFocus`.
//
// State kept on the returned object: {focusX, focusY, zoom} plus the
// resolved options. `update()` never allocates when `input`/`grid`/`cam` are
// reused frame to frame (all scratch lives on the rtsCamera instance).

import { DEG2RAD } from './transform.js';
import { pitchedEyeFromFocus } from '../render/projection.js';

/** Default vertical FOV comes from projection.js if not given in options
 * (RE-03 spec); imported lazily-by-value at create time so this module has
 * no compile-time dependency on the exact default beyond re-exporting it. */
import { PROJ_PITCHED_VFOV_DEG } from '../render/projection.js';

/**
 * @typedef {Object} RtsCameraBounds
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/**
 * @typedef {Object} RtsCameraOptions
 * @property {number} [yawDeg=0]
 * @property {number} [pitchDeg=-58]
 * @property {number} [vfovDeg] - defaults to PROJ_PITCHED_VFOV_DEG
 * @property {number} [widthM=30] - ground width at zoom 1, metres
 * @property {number} [zoomMin=25/30]
 * @property {number} [zoomMax=35/30]
 * @property {RtsCameraBounds} bounds - map rect the focus is clamped to
 * @property {number} [panSpeed=20] - m/s at zoom 1 (keys/edge scroll)
 * @property {number} [edgePx=24] - screen-edge band width, device px
 * @property {(x:number,y:number)=>number} [heightFn] - ground z under the focus; default () => 0
 * @property {number} [heightSmoothK=8] - exponential smoothing rate for focus z, 1/s
 */

/**
 * Duck-typed per-frame input for `update()`. Every field is optional; a
 * missing field means "no input of that kind this frame".
 * @typedef {Object} RtsCameraInput
 * @property {boolean} [left] @property {boolean} [right]
 * @property {boolean} [up] @property {boolean} [down]        - pan keys, screen-relative (up = toward the top of the screen)
 * @property {number} [mouseX] @property {number} [mouseY]    - device px, for edge-scroll
 * @property {number} [screenW] @property {number} [screenH]  - device px, viewport size (edge-scroll needs these to know where the edges are)
 * @property {boolean} [dragging] - true while a pan-drag is active
 * @property {number} [dragCol0] @property {number} [dragRow0] - drag start, screen cell coords (fractional ok)
 * @property {number} [dragCol1] @property {number} [dragRow1] - drag current, screen cell coords
 * @property {number} [zoomDelta] - +in/-out (or -in/+out, caller's convention - see zoomBy), applied and clamped this frame
 */

/**
 * @typedef {Object} RtsCamera
 * @property {number} focusX @property {number} focusY - ground focus point, world metres
 * @property {number} zoom - current zoom factor, clamped to [zoomMin, zoomMax]
 * @property {number} focusZ - smoothed ground height under the focus (internal, exposed for debugging)
 * @property {RtsCameraOptions} opts - resolved options (all defaults filled in)
 */

/**
 * Builds an RtsCamera. `opts.bounds` is required; every other option has a
 * default (28.1). The returned object owns its own scratch state, so
 * `update()` never allocates.
 * @param {RtsCameraOptions} opts
 * @returns {RtsCamera}
 */
export function createRtsCamera(opts) {
  if (!opts || !opts.bounds) throw new Error('createRtsCamera: opts.bounds is required');
  const resolved = {
    yawDeg: opts.yawDeg ?? 0,
    pitchDeg: opts.pitchDeg ?? -58,
    vfovDeg: opts.vfovDeg ?? PROJ_PITCHED_VFOV_DEG,
    widthM: opts.widthM ?? 30,
    zoomMin: opts.zoomMin ?? 25 / 30,
    zoomMax: opts.zoomMax ?? 35 / 30,
    bounds: opts.bounds,
    panSpeed: opts.panSpeed ?? 20,
    edgePx: opts.edgePx ?? 24,
    heightFn: opts.heightFn ?? (() => 0),
    heightSmoothK: opts.heightSmoothK ?? 8,
  };
  const startX = clamp((resolved.bounds.x0 + resolved.bounds.x1) / 2, resolved.bounds.x0, resolved.bounds.x1);
  const startY = clamp((resolved.bounds.y0 + resolved.bounds.y1) / 2, resolved.bounds.y0, resolved.bounds.y1);
  return {
    focusX: startX,
    focusY: startY,
    zoom: clamp(1, resolved.zoomMin, resolved.zoomMax),
    focusZ: resolved.heightFn(startX, startY),
    opts: resolved,
    // Scratch (reused every update() call - zero alloc on the hot path).
    _ray0: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 },
    _ray1: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 },
    _hit0: [0, 0, 0],
    _hit1: [0, 0, 0],
    _eye: [0, 0, 0],
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * `tanHalfX` for the current grid/vfov, without needing a full PitchedTerms
 * (which itself needs an eye position we don't have yet - `dist` below
 * depends on `tanHalfX` but not on the eye). Same expression as
 * `pitchedTerms` in engine/render/projection.js.
 * @param {number} vfovDeg
 * @param {{cols:number,rows:number,pxCellW?:number,pxCellH?:number}} grid
 * @returns {number}
 */
function tanHalfXFor(vfovDeg, grid) {
  const aspect = (grid.cols * (grid.pxCellW || 1)) / (grid.rows * (grid.pxCellH || 1));
  const tanHalfY = Math.tan((vfovDeg * DEG2RAD) / 2);
  return tanHalfY * aspect;
}

/**
 * Intersects a screenRay-shaped ray with the horizontal plane z = planeZ.
 * Writes the world-space hit point into `out3`. If the ray is (near)
 * parallel to the plane, falls back to the ray origin (no divide by ~0).
 * @param {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}} ray
 * @param {number} planeZ
 * @param {number[]} out3
 */
function intersectPlaneZ(ray, planeZ, out3) {
  if (Math.abs(ray.dz) > 1e-9) {
    const t = (planeZ - ray.oz) / ray.dz;
    out3[0] = ray.ox + t * ray.dx;
    out3[1] = ray.oy + t * ray.dy;
    out3[2] = planeZ;
  } else {
    out3[0] = ray.ox;
    out3[1] = ray.oy;
    out3[2] = planeZ;
  }
}

/**
 * Advances the RTS camera by one frame and writes the resulting eye pose
 * into `cam` (in place): `cam.x/y/z`, `cam.projection = 'pitched'`,
 * `cam.yawDeg`, `cam.pitchDeg`, `cam.vfovDeg`. Zero allocation.
 *
 * Pan (keys/edge-scroll): `panSpeed*zoom*dt` metres, screen-relative
 * directions for `yawDeg` (v1 handles yaw 0 exactly: "up" = -y, "right" =
 * +x; a nonzero yaw would need the camera's R/F basis rotated into these
 * directions, out of scope here since RE-03's camera is fixed-yaw).
 *
 * Drag-pan: exact ground delta of two `screenRay` hits (drag start/current
 * screen cell) on the plane z = focus z, so the ground point under the
 * cursor stays fixed while dragging.
 *
 * Zoom: this function does not drive zoom from continuous input beyond
 * `input.zoomDelta` (added and clamped this frame, e.g. from a mouse wheel);
 * see `zoomBy()` for a direct, discrete-step alternative.
 * @param {RtsCamera} rts
 * @param {number} dt seconds
 * @param {RtsCameraInput} input
 * @param {{cols:number,rows:number,pxCellW?:number,pxCellH?:number}} grid
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number,vfovDeg:number,projection:string}} cam
 */
export function update(rts, dt, input, grid, cam) {
  const o = rts.opts;

  if (input.zoomDelta) {
    rts.zoom = clamp(rts.zoom + input.zoomDelta, o.zoomMin, o.zoomMax);
  }

  const panDist = o.panSpeed * rts.zoom * dt;
  // Screen-relative directions at yawDeg = 0: right = +x, up (toward the top
  // of the screen) = -y.
  let dx = 0, dy = 0;
  if (input.left) dx -= panDist;
  if (input.right) dx += panDist;
  if (input.up) dy -= panDist;
  if (input.down) dy += panDist;

  if (o.edgePx > 0 && input.screenW && input.screenH && input.mouseX !== undefined && input.mouseY !== undefined) {
    if (input.mouseX < o.edgePx) dx -= panDist;
    else if (input.mouseX > input.screenW - o.edgePx) dx += panDist;
    if (input.mouseY < o.edgePx) dy -= panDist;
    else if (input.mouseY > input.screenH - o.edgePx) dy += panDist;
  }

  rts.focusX += dx;
  rts.focusY += dy;

  if (input.dragging
    && input.dragCol0 !== undefined && input.dragRow0 !== undefined
    && input.dragCol1 !== undefined && input.dragRow1 !== undefined) {
    // Build minimal pitched terms for the CURRENT eye/basis (from the
    // previous frame's cam pose) so we can cast the two drag rays.
    const tanHalfX = tanHalfXFor(o.vfovDeg, grid);
    const tanHalfY = Math.tan((o.vfovDeg * DEG2RAD) / 2);
    const yawRad = o.yawDeg * DEG2RAD;
    const p = o.pitchDeg * DEG2RAD;
    const fx = Math.sin(yawRad), fy = -Math.cos(yawRad);
    const cosP = Math.cos(p), sinP = Math.sin(p);
    const terms = {
      cols: grid.cols, rows: grid.rows,
      eyeX: cam.x, eyeY: cam.y, eyeZ: cam.z,
      fX: cosP * fx, fY: cosP * fy, fZ: sinP,
      rX: Math.cos(yawRad), rY: Math.sin(yawRad),
      uX: -sinP * fx, uY: -sinP * fy, uZ: cosP,
      tanHalfX, tanHalfY,
    };
    screenRayInto(terms, input.dragCol0, input.dragRow0, rts._ray0);
    screenRayInto(terms, input.dragCol1, input.dragRow1, rts._ray1);
    intersectPlaneZ(rts._ray0, rts.focusZ, rts._hit0);
    intersectPlaneZ(rts._ray1, rts.focusZ, rts._hit1);
    // Move the focus by the negated ground delta so the ground point under
    // the cursor stays fixed: as the cursor moves from hit0 to hit1, the
    // world should appear to slide by (hit1 - hit0), i.e. the focus moves
    // by -(hit1 - hit0).
    rts.focusX -= (rts._hit1[0] - rts._hit0[0]);
    rts.focusY -= (rts._hit1[1] - rts._hit0[1]);
  }

  rts.focusX = clamp(rts.focusX, o.bounds.x0, o.bounds.x1);
  rts.focusY = clamp(rts.focusY, o.bounds.y0, o.bounds.y1);

  const targetZ = o.heightFn(rts.focusX, rts.focusY);
  const k = 1 - Math.exp(-o.heightSmoothK * dt);
  rts.focusZ += (targetZ - rts.focusZ) * k;

  const tanHalfX = tanHalfXFor(o.vfovDeg, grid);
  const dist = (o.widthM * rts.zoom) / (2 * tanHalfX);

  pitchedEyeFromFocus(rts.focusX, rts.focusY, rts.focusZ, o.yawDeg, o.pitchDeg, dist, rts._eye);
  cam.x = rts._eye[0];
  cam.y = rts._eye[1];
  cam.z = rts._eye[2];
  cam.projection = 'pitched';
  cam.yawDeg = o.yawDeg;
  cam.pitchDeg = o.pitchDeg;
  cam.vfovDeg = o.vfovDeg;
}

/**
 * Local (not exported from projection.js) screenRay math, applied to a
 * manually-built minimal terms object (used by the drag-pan path above,
 * which needs rays cast against the PREVIOUS frame's eye/basis before this
 * frame's new eye is known). Same expression as `screenRay` in
 * engine/render/projection.js. Zero allocation (writes into `out`).
 * @param {{cols:number,rows:number,eyeX:number,eyeY:number,eyeZ:number,fX:number,fY:number,fZ:number,rX:number,rY:number,uX:number,uY:number,uZ:number,tanHalfX:number,tanHalfY:number}} terms
 * @param {number} col
 * @param {number} row
 * @param {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}} out
 */
function screenRayInto(terms, col, row, out) {
  const a = ((2 * (col + 0.5)) / terms.cols - 1) * terms.tanHalfX;
  const b = (1 - (2 * row) / terms.rows) * terms.tanHalfY;
  out.ox = terms.eyeX; out.oy = terms.eyeY; out.oz = terms.eyeZ;
  out.dx = terms.fX + a * terms.rX + b * terms.uX;
  out.dy = terms.fY + a * terms.rY + b * terms.uY;
  out.dz = terms.fZ + b * terms.uZ;
}

/**
 * Discrete zoom step (e.g. one mouse-wheel notch), clamped to
 * `[zoomMin, zoomMax]`. An alternative to `input.zoomDelta` for callers that
 * prefer to drive zoom outside `update()`.
 * @param {RtsCamera} rts
 * @param {number} delta
 */
export function zoomBy(rts, delta) {
  rts.zoom = clamp(rts.zoom + delta, rts.opts.zoomMin, rts.opts.zoomMax);
}
