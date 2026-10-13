// tools/editor/camera.js - US-031 fly-cam (docs/architecture.md 24.5).
// `CameraPose` is explicit, serializable, plain data (the AC's own wording) -
// never implicit view state buried in a camera object. `updateCamera` is
// pure over `pose` so it is Node-testable with a fake `input` (see
// camera.test.mjs) - no DOM/canvas/pointer-lock here, `main.js` owns that.
import { Camera, HFOV_DEG, localToWorld, pitchedEyeFromFocus } from '../../engine/index.js';

const DEG2RAD = Math.PI / 180;
export const ORTHO_PITCH_CLAMP_DEG = 90;
export const ORTHO_HALF_H_MIN = 2, ORTHO_HALF_H_MAX = 400;

/**
 * @typedef {{x:number, y:number, z:number, yawDeg:number, pitchDeg:number, fov:number}} CameraPose
 */

/** A fresh CameraPose, `fov` fixed at `HFOV_DEG` (the editor never changes it, 24.5). */
export function createCameraPose(overrides = {}) {
  return { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0, fov: HFOV_DEG, ...overrides };
}

/** Plain-data copy (for `localStorage`/undo-adjacent snapshots - never a live reference). */
export function clonePose(pose) {
  return { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg, fov: pose.fov };
}

/**
 * 24.5 "Start pose": tower placement `s` looking north (yaw 0) from above
 * and slightly south of it, pitched down. `level` is the placed structure's
 * `Level` (has `.width`/`.height` in metres), `frame` its authored `Frame`
 * (CO-7: routed through `localToWorld` instead of hand-written `+ origin`
 * math - identical numbers while `yawSteps` is always 0).
 */
export function startPoseForStructure(frame, level) {
  const p = localToWorld(frame, level.width / 2, level.height + 10, 8, { x: 0, y: 0, z: 0 });
  return createCameraPose({ x: p.x, y: p.y, z: p.z, yawDeg: 0, pitchDeg: -15 });
}

/**
 * Pure fly-cam step (24.5): `updateCamera(pose, input, dt, { speed, lookDx,
 * lookDy })`. `input` only needs `isDown(code)` (matches `engine/core/
 * input.js`'s `Input`, so `main.js` can pass the real one, or a test can
 * pass a fake with the same shape). No gravity, no collision (US-031 AC).
 * Mutates `pose` in place; returns `true` if any field changed (main.js sets
 * `dirty = true` on a `true` return - the idle-skip signal, 24.4).
 * @param {CameraPose} pose
 * @param {{isDown:(code:string)=>boolean}} input
 * @param {number} dt
 * @param {{speed:number, lookDx?:number, lookDy?:number, pitchClampDeg?:number}} opts
 * @returns {boolean} changed
 */
export function updateCamera(pose, input, dt, opts) {
  const ortho = pose.projection === 'ortho';
  const speed = opts.speed;
  const lookDx = opts.lookDx || 0;
  const lookDy = opts.lookDy || 0;
  let changed = false;

  const yawRad = pose.yawDeg * DEG2RAD;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad); // compass yaw 0 = N = -y, clockwise (24.5)
  const rightX = -dirY, rightY = dirX;

  let mult = 1;
  if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) mult *= 4;
  if (input.isDown('ControlLeft') || input.isDown('ControlRight')) mult *= 0.25;
  const v = speed * mult * dt;

  const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  const vert = (input.isDown('KeyR') ? 1 : 0) - (input.isDown('KeyF') ? 1 : 0);

  if (ortho && (fwd || strafe || vert)) {
    // US-068d: pan in the VIEW plane (screen up U / right R); x/y/z IS the focus in ortho
    const sp = Math.sin(pose.pitchDeg * DEG2RAD), cp = Math.cos(pose.pitchDeg * DEG2RAD);
    const up = fwd + vert;
    pose.x += (-Math.sin(yawRad) * sp * up + Math.cos(yawRad) * strafe) * v;
    pose.y += (Math.cos(yawRad) * sp * up + Math.sin(yawRad) * strafe) * v;
    pose.z += cp * up * v;
    syncOrthoFocus(pose);
    changed = true;
  } else if (fwd) {
    pose.x += dirX * fwd * v;
    pose.y += dirY * fwd * v;
    changed = true;
  }
  if (!ortho && strafe) {
    pose.x += rightX * strafe * v;
    pose.y += rightY * strafe * v;
    changed = true;
  }
  if (!ortho && vert) {
    pose.z += vert * v;
    changed = true;
  }

  if (lookDx || lookDy) {
    pose.yawDeg = ((pose.yawDeg + lookDx * 0.15) % 360 + 360) % 360;
    pose.pitchDeg = Camera.clampPitch(pose.pitchDeg - lookDy * 0.15, ortho ? ORTHO_PITCH_CLAMP_DEG : opts.pitchClampDeg);
    if (ortho) syncOrthoFocus(pose);
    changed = true;
  }

  return changed;
}

/** Mouse-wheel speed adjust (24.5): x1.25 per notch, clamped to [0.5, 200]. `deltaY > 0` = zoom out (slower). */
export function adjustSpeed(speed, wheelDeltaY) {
  const factor = wheelDeltaY > 0 ? 1 / 1.25 : 1.25;
  return Math.max(0.5, Math.min(200, speed * factor));
}

/** US-068c view presets (docs/architecture.md 38.19): compass yaw 0 = N clockwise, pitch + = up. */
export const VIEW_PRESETS = Object.freeze({
  TOP: Object.freeze({ yawDeg: 0, pitchDeg: -90 }),
  FRONT: Object.freeze({ yawDeg: 0, pitchDeg: 0 }),
  ISO: Object.freeze({ yawDeg: 45, pitchDeg: -Math.atan(1 / Math.SQRT2) / DEG2RAD }), // -35.264
});

/**
 * Set yaw/pitch to a named preset ('TOP' | 'FRONT' | 'ISO'). In perspective pitch is clamped to +-`pitchClampDeg` (default
 * 70 = PITCH_CLAMP_PITCHED_DEG): TOP shows -70; in ortho (x/y/z = focus) the clamp is 90 and TOP is -90. If `focus` ({x,y,z}) is given
 * the eye is re-placed at the current distance from it along the new view
 * direction; otherwise only yaw/pitch change. Unknown name THROWS (a typo is
 * a bug, not a silent no-op). Mutates `pose`; returns it.
 */
export function applyViewPreset(pose, name, focus = null, pitchClampDeg = 70) {
  const p = Object.prototype.hasOwnProperty.call(VIEW_PRESETS, name) ? VIEW_PRESETS[name] : null;
  if (!p) throw new Error(`applyViewPreset: unknown preset '${name}'`);
  let dist = 0;
  if (focus) dist = Math.hypot(pose.x - focus.x, pose.y - focus.y, pose.z - focus.z);
  pose.yawDeg = p.yawDeg;
  const ortho = pose.projection === 'ortho';
  const lim = ortho ? ORTHO_PITCH_CLAMP_DEG : pitchClampDeg;
  pose.pitchDeg = Math.max(-lim, Math.min(lim, p.pitchDeg));
  if (ortho) { syncOrthoFocus(pose); return pose; } // x/y/z is the focus: yaw/pitch only
  if (focus) {
    const y = pose.yawDeg * DEG2RAD, pt = pose.pitchDeg * DEG2RAD;
    pose.x = focus.x - Math.sin(y) * Math.cos(pt) * dist;
    pose.y = focus.y + Math.cos(y) * Math.cos(pt) * dist;
    pose.z = focus.z - Math.sin(pt) * dist;
  }
  return pose;
}

/** Ortho: the engine eye is derived from `focusX/Y/Z` (projection.js); the pose x/y/z IS the focus. */
export function syncOrthoFocus(pose) { pose.focusX = pose.x; pose.focusY = pose.y; pose.focusZ = pose.z; return pose; }

/**
 * US-068d Numpad5: toggle perspective <-> ortho around `focus` ({x,y,z}; the
 * caller passes selection centre / pivot). persp -> ortho: x/y/z become the
 * focus, the old eye distance is remembered in `perspDist`. ortho -> persp:
 * the eye returns to `focus - perspDist*F` (focus preserved). Mutates; returns pose.
 */
export function toggleOrtho(pose, focus) {
  if (pose.projection === 'ortho') {
    const dist = pose.perspDist > 0 ? pose.perspDist : 10;
    const e = pitchedEyeFromFocus(pose.x, pose.y, pose.z, pose.yawDeg, pose.pitchDeg, dist, [0, 0, 0]);
    pose.x = e[0]; pose.y = e[1]; pose.z = e[2];
    pose.pitchDeg = Math.max(-70, Math.min(70, pose.pitchDeg));
    delete pose.projection; delete pose.orthoHalfH; delete pose.focusX; delete pose.focusY; delete pose.focusZ;
    return pose;
  }
  pose.perspDist = Math.max(1, Math.hypot(pose.x - focus.x, pose.y - focus.y, pose.z - focus.z));
  pose.x = focus.x; pose.y = focus.y; pose.z = focus.z;
  pose.projection = 'ortho';
  pose.orthoHalfH = Math.max(ORTHO_HALF_H_MIN, Math.min(ORTHO_HALF_H_MAX, pose.perspDist));
  return syncOrthoFocus(pose);
}

/** Wheel in ortho: orthoHalfH x1.15 per notch (deltaY > 0 = out = bigger), clamp 2..400 m. */
export function adjustOrthoHalfH(halfH, wheelDeltaY) {
  const f = wheelDeltaY > 0 ? 1.15 : 1 / 1.15;
  return Math.max(ORTHO_HALF_H_MIN, Math.min(ORTHO_HALF_H_MAX, halfH * f));
}

/**
 * Gizmo axis label click: view FROM the + side of the axis (Blender convention,
 * F = -axis), ortho on. X -> yaw 270, Y -> yaw 0 (north, = FRONT), Z -> TOP (pitch -90).
 */
export function lookAlongAxis(pose, axis, focus) {
  const a = { x: [270, 0], y: [0, 0], z: [0, -90] }[axis];
  if (!a) throw new Error(`lookAlongAxis: unknown axis '${axis}'`);
  if (pose.projection !== 'ortho') toggleOrtho(pose, focus);
  pose.yawDeg = a[0]; pose.pitchDeg = a[1];
  return syncOrthoFocus(pose);
}
