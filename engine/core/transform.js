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

/** Wrap degrees into [0, 360). */
export function wrapDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Shortest signed arc from `fromDeg` to `toDeg`, result in (-180, 180]. */
export function shortestArcDeg(fromDeg, toDeg) {
  let d = (toDeg - fromDeg) % 360;
  if (d <= -180) d += 360;
  else if (d > 180) d -= 360;
  return d;
}

/**
 * Compass yaw (deg) of a direction (dx, dy): 0 = north (-y), 90 = east (+x),
 * clockwise. Replaces the 4 hand-written `atan2(dx, -dy)` copies.
 */
export function yawFromDelta(dx, dy) {
  return wrapDeg(Math.atan2(dx, -dy) * RAD2DEG);
}

/** Forward unit vector for a compass yaw: (sin yaw, -cos yaw). */
export function forwardOf(yawDeg, out) {
  const r = yawDeg * DEG2RAD;
  out[0] = Math.sin(r);
  out[1] = -Math.cos(r);
  return out;
}

/** Right unit vector for a compass yaw: (cos yaw, sin yaw). */
export function rightOf(yawDeg, out) {
  const r = yawDeg * DEG2RAD;
  out[0] = Math.cos(r);
  out[1] = Math.sin(r);
  return out;
}

/** Rotate vector (x, y) by compass yaw `yawDeg` (same convention as forward/right). */
export function rotateVec2(yawDeg, x, y, out) {
  const r = yawDeg * DEG2RAD;
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
 */
export function dirFromAzEl(azimuthDeg, elevationDeg, out) {
  const az = azimuthDeg * DEG2RAD, el = elevationDeg * DEG2RAD;
  const cel = Math.cos(el);
  out[0] = Math.sin(az) * cel;
  out[1] = -Math.cos(az) * cel;
  out[2] = Math.sin(el);
  return out;
}

// ---- Frame (local <-> world; rotation about the frame origin, then translation) ----

/** Build a validated plain Frame object. Throws on non-finite x/y/z or a non-0..3 integer yawSteps. */
export function makeFrame(x, y, z, yawSteps = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`makeFrame: x/y/z must be finite (got ${x}, ${y}, ${z})`);
  }
  if (!Number.isInteger(yawSteps) || yawSteps < 0 || yawSteps > 3) {
    throw new Error(`makeFrame: yawSteps must be an integer 0..3 (got ${yawSteps})`);
  }
  return { x, y, z, yawSteps };
}

/** Local point (lx, ly, lz) of `frame` -> world point, written into `out`. */
export function localToWorld(frame, lx, ly, lz, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  out.x = frame.x + c * lx - s * ly;
  out.y = frame.y + s * lx + c * ly;
  out.z = frame.z + lz;
  return out;
}

/** World point (wx, wy, wz) -> local point of `frame` (exact inverse, integer table -> no drift). */
export function worldToLocal(frame, wx, wy, wz, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  const dx = wx - frame.x, dy = wy - frame.y;
  // Inverse rotation of [[c,-s],[s,c]] is [[c,s],[-s,c]] (orthonormal).
  out.x = c * dx + s * dy;
  out.y = -s * dx + c * dy;
  out.z = wz - frame.z;
  return out;
}

/** Rotate a local direction (dx, dy) of `frame` into world (rotation only, no translation). */
export function localDirToWorld(frame, dx, dy, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  out[0] = c * dx - s * dy;
  out[1] = s * dx + c * dy;
  return out;
}

/** Local compass yaw of `frame` -> world compass yaw. */
export function localYawToWorld(frame, yawDeg) {
  return wrapDeg(yawDeg + 90 * frame.yawSteps);
}

/** World compass yaw -> local compass yaw of `frame`. */
export function worldYawToLocal(frame, yawDeg) {
  return wrapDeg(yawDeg - 90 * frame.yawSteps);
}

/**
 * Axis-aligned world bounding box of the local rectangle [0,w) x [0,h) of
 * `frame`. Integers stay integers (exact quarter-turn table). Writes
 * {x0,y0,x1,y1} into `out`.
 */
export function frameBBox(frame, w, h, out) {
  const c = QUARTER_COS[frame.yawSteps], s = QUARTER_SIN[frame.yawSteps];
  // Corners of [0,w]x[0,h] rotated by the frame, then translated.
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const lx = corners[i][0], ly = corners[i][1];
    const wx = frame.x + c * lx - s * ly;
    const wy = frame.y + s * lx + c * ly;
    if (wx < x0) x0 = wx;
    if (wy < y0) y0 = wy;
    if (wx > x1) x1 = wx;
    if (wy > y1) y1 = wy;
  }
  out.x0 = x0;
  out.y0 = y0;
  out.x1 = x1;
  out.y1 = y1;
  return out;
}

/** Rotated size of a local w x h rectangle for `yawSteps` (swapped for odd steps). */
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
 */
export function localCellToWorld(frame, col, row, out) {
  return localToWorld(frame, col, row, 0, out);
}

/** Structural equality of two frames (x, y, z, yawSteps all equal). */
export function frameEquals(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yawSteps === b.yawSteps;
}

// ---- Transform sugar (entities/cameras; no matrices — yaw-only bodies) ----

/**
 * Yaw-rotate local point (lx, ly, lz) by `t.yawDeg` then translate by
 * (t.x, t.y, t.z). Used by eye/attach/model helpers that need a general
 * (non-quarter-turn) yaw, unlike Frame's exact quarter-turn table.
 */
export function transformPoint(t, lx, ly, lz, out) {
  const r = t.yawDeg * DEG2RAD;
  const c = Math.cos(r), s = Math.sin(r);
  out.x = t.x + c * lx - s * ly;
  out.y = t.y + s * lx + c * ly;
  out.z = t.z + lz;
  return out;
}
