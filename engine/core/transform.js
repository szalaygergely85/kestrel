// @ts-check
// engine/core/transform.js (CO-1, docs/coordinates.md section 3 — "the one
// conversion module"). Pure functions, allocation-free in the per-call path
// (caller-owned `out`), no engine imports besides itself. This is the ONLY
// place the compass yaw convention and the quarter-turn tables are spelled
// out: 0 = north (-y), 90 = east (+x), clockwise seen from above.
//
// Frame = {x,y,z,yawSteps:0|1|2|3} — rigid quarter-turn frame (structures,
// chunks). Transform = {x,y,z,yawDeg,pitchDeg?} — entity/camera pose, world
// metres. Nothing here allocates on the hot path: every function that
// returns a vector/point writes into the caller's `out`.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// Exact quarter-turn trig tables (yawSteps 0..3 -> 0/90/180/270 deg): no
// float drift, integer inputs stay integers.
export const QUARTER_COS = [1, 0, -1, 0];
export const QUARTER_SIN = [0, 1, 0, -1];

// ---- angles (the only place the compass convention is spelled out) --------

/**
 * Wrap degrees into [0, 360).
 * @param {number} deg
 * @returns {number}
 */
export function wrapDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Shortest signed arc from `fromDeg` to `toDeg`, result in (-180, 180].
 * @param {number} fromDeg
 * @param {number} toDeg
 * @returns {number}
 */
export function shortestArcDeg(fromDeg, toDeg) {
  let d = (toDeg - fromDeg) % 360;
  if (d <= -180) d += 360;
  else if (d > 180) d -= 360;
  return d;
}

/**
 * Compass yaw (deg) of a direction (dx, dy): 0 = north (-y), 90 = east (+x),
 * clockwise. Replaces the 4 hand-written `atan2(dx, -dy)` copies.
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
export function yawFromDelta(dx, dy) {
  return wrapDeg(Math.atan2(dx, -dy) * 180 / Math.PI);
}

/**
 * Forward unit vector for a compass yaw: (sin yaw, -cos yaw).
 * @param {number} yawDeg
 * @param {number[]|Float32Array} out caller-owned length-2 vector, written in place
 * @returns {number[]|Float32Array} `out`
 */
export function forwardOf(yawDeg, out) {
  const r = yawDeg * Math.PI / 180;
  out[0] = Math.sin(r);
  out[1] = -Math.cos(r);
  return out;
}

/**
 * Right unit vector for a compass yaw: (cos yaw, sin yaw).
 * @param {number} yawDeg
 * @param {number[]|Float32Array} out caller-owned length-2 vector, written in place
 * @returns {number[]|Float32Array} `out`
 */
export function rightOf(yawDeg, out) {
  const r = yawDeg * Math.PI / 180;
  out[0] = Math.cos(r);
  out[1] = Math.sin(r);
  return out;
}

/**
 * Rotate vector (x, y) by compass yaw `yawDeg` (same convention as forward/right).
 * @param {number} yawDeg
 * @param {number} x
 * @param {number} y
 * @param {number[]|Float32Array} out caller-owned length-2 vector, written in place
 * @returns {number[]|Float32Array} `out`
 */
export function rotateVec2(yawDeg, x, y, out) {
  const r = yawDeg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const ox = x * c - y * s;
  const oy = x * s + y * c;
  out[0] = ox;
  out[1] = oy;
  return out;
}

/**
 * Direction the light travels FROM, given compass azimuth + elevation
 * (degrees): sun direction, horizon billboards.
 * out = (sin az * cos el, -cos az * cos el, sin el)
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @param {number[]|Float32Array} out caller-owned length-3 vector, written in place
 * @returns {number[]|Float32Array} `out`
 */
export function dirFromAzEl(azimuthDeg, elevationDeg, out) {
  // deg * PI / 180 (NOT deg * DEG2RAD): bit-identical to the pre-CO-1b LightSet.setSun
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  const cel = Math.cos(el);
  out[0] = Math.sin(az) * cel;
  out[1] = -Math.cos(az) * cel;
  out[2] = Math.sin(el);
  return out;
}

// ---- Frame (local <-> world; rotation about the frame origin, then translation) ----

/**
 * @typedef {{x: number, y: number, z: number, yawSteps: 0|1|2|3}} Frame
 * @typedef {{x: number, y: number, z: number, yawDeg: number, pitchDeg?: number}} Transform
 */

/**
 * Build a validated plain Frame object. Throws on non-finite x/y/z or a non-0..3 integer yawSteps.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {0|1|2|3} [yawSteps]
 * @returns {Frame}
 */
export function makeFrame(x, y, z, yawSteps = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`makeFrame: x/y/z must be finite (got ${x}, ${y}, ${z})`);
  }
  if (!Number.isInteger(yawSteps) || yawSteps < 0 || yawSteps > 3) {
    throw new Error(`makeFrame: yawSteps must be an integer 0..3 (got ${yawSteps})`);
  }
  return { x, y, z, yawSteps };
}

/**
 * Local point (lx, ly, lz) of `frame` -> world point, written into `out`.
 * @param {Frame} frame
 * @param {number} lx
 * @param {number} ly
 * @param {number} lz
 * @param {{x: number, y: number, z: number}} out caller-owned point, written in place
 * @returns {{x: number, y: number, z: number}} `out`
 */
export function localToWorld(frame, lx, ly, lz, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  out.x = frame.x + c * lx - s * ly;
  out.y = frame.y + s * lx + c * ly;
  out.z = frame.z + lz;
  return out;
}

/**
 * World point (wx, wy, wz) -> local point of `frame` (exact inverse, integer table -> no drift).
 * @param {Frame} frame
 * @param {number} wx
 * @param {number} wy
 * @param {number} wz
 * @param {{x: number, y: number, z: number}} out caller-owned point, written in place
 * @returns {{x: number, y: number, z: number}} `out`
 */
export function worldToLocal(frame, wx, wy, wz, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  const dx = wx - frame.x, dy = wy - frame.y;
  // Inverse rotation of [[c,-s],[s,c]] is [[c,s],[-s,c]] (orthonormal).
  out.x = c * dx + s * dy;
  out.y = -s * dx + c * dy;
  out.z = wz - frame.z;
  return out;
}

/**
 * Rotate a local direction (dx, dy) of `frame` into world (rotation only, no translation).
 * @param {Frame} frame
 * @param {number} dx
 * @param {number} dy
 * @param {number[]|Float32Array} out caller-owned length-2 vector, written in place
 * @returns {number[]|Float32Array} `out`
 */
export function localDirToWorld(frame, dx, dy, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  out[0] = c * dx - s * dy;
  out[1] = s * dx + c * dy;
  return out;
}

/**
 * Local compass yaw of `frame` -> world compass yaw.
 * @param {Frame} frame
 * @param {number} yawDeg
 * @returns {number}
 */
export function localYawToWorld(frame, yawDeg) {
  return wrapDeg(yawDeg + 90 * frame.yawSteps);
}

/**
 * World compass yaw -> local compass yaw of `frame`.
 * @param {Frame} frame
 * @param {number} yawDeg
 * @returns {number}
 */
export function worldYawToLocal(frame, yawDeg) {
  return wrapDeg(yawDeg - 90 * frame.yawSteps);
}

/**
 * Axis-aligned world bounding box of the local rectangle [0,w) x [0,h) of
 * `frame`. Integers stay integers (exact quarter-turn table). Writes
 * {x0,y0,x1,y1} into `out`.
 * @param {Frame} frame
 * @param {number} w
 * @param {number} h
 * @param {{x0: number, y0: number, x1: number, y1: number}} out caller-owned rect, written in place
 * @returns {{x0: number, y0: number, x1: number, y1: number}} `out`
 */
export function frameBBox(frame, w, h, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  // Corners of [0,w]x[0,h] rotated by the frame, then translated (inlined: no allocation).
  const ax = frame.x, ay = frame.y;
  // (lx,ly) = (0,0),(w,0),(0,h),(w,h)
  const x00 = ax, y00 = ay;
  const x10 = ax + c * w, y10 = ay + s * w;
  const x01 = ax - s * h, y01 = ay + c * h;
  const x11 = ax + c * w - s * h, y11 = ay + s * w + c * h;
  const x0 = Math.min(x00, x10, x01, x11), x1 = Math.max(x00, x10, x01, x11);
  const y0 = Math.min(y00, y10, y01, y11), y1 = Math.max(y00, y10, y01, y11);
  out.x0 = x0;
  out.y0 = y0;
  out.x1 = x1;
  out.y1 = y1;
  return out;
}

/**
 * Rotated size of a local w x h rectangle for `yawSteps` (swapped for odd steps).
 * @param {0|1|2|3} yawSteps
 * @param {number} w
 * @param {number} h
 * @param {{w: number, h: number}} out caller-owned size, written in place
 * @returns {{w: number, h: number}} `out`
 */
export function rotatedSize(yawSteps, w, h, out) {
  const odd = (yawSteps & 1) === 1;
  out.w = odd ? h : w;
  out.h = odd ? w : h;
  return out;
}

/**
 * World cell (integer col/row) of the local cell (col, row) of the rotated
 * grid described by `frame` — see docs/coordinates.md section 5 for the
 * rotatedSize/rotateLevel mapping this composes with; here it is a plain
 * point transform of the cell's min corner.
 * @param {Frame} frame
 * @param {number} col
 * @param {number} row
 * @param {{x: number, y: number, z: number}} out caller-owned point, written in place
 * @returns {{x: number, y: number, z: number}} `out`
 */
export function localCellToWorld(frame, col, row, out) {
  return localToWorld(frame, col, row, 0, out);
}

/**
 * Structural equality of two frames (x, y, z, yawSteps all equal).
 * @param {Frame} a
 * @param {Frame} b
 * @returns {boolean}
 */
export function frameEquals(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yawSteps === b.yawSteps;
}

// ---- Transform sugar (entities/cameras; no matrices — yaw-only bodies) ----

/**
 * Yaw-rotate local point (lx, ly, lz) by `t.yawDeg` then translate by
 * (t.x, t.y, t.z). Used by eye/attach/model helpers that need a general
 * (non-quarter-turn) yaw, unlike Frame's exact quarter-turn table.
 * @param {Transform} t
 * @param {number} lx
 * @param {number} ly
 * @param {number} lz
 * @param {{x: number, y: number, z: number}} out caller-owned point, written in place
 * @returns {{x: number, y: number, z: number}} `out`
 */
export function transformPoint(t, lx, ly, lz, out) {
  const r = t.yawDeg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  out.x = t.x + c * lx - s * ly;
  out.y = t.y + s * lx + c * ly;
  out.z = t.z + lz;
  return out;
}
