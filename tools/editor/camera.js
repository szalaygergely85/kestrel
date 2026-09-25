// tools/editor/camera.js - US-031 fly-cam (docs/architecture.md 24.5).
// `CameraPose` is explicit, serializable, plain data (the AC's own wording) -
// never implicit view state buried in a camera object. `updateCamera` is
// pure over `pose` so it is Node-testable with a fake `input` (see
// camera.test.mjs) - no DOM/canvas/pointer-lock here, `main.js` owns that.
import { Camera, HFOV_DEG } from '../../engine/index.js';

const DEG2RAD = Math.PI / 180;

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
 * `Level` (has `.width`/`.height` in metres), `origin` its world placement.
 */
export function startPoseForStructure(origin, level) {
  return createCameraPose({
    x: origin.x + level.width / 2,
    y: origin.y + level.height + 10,
    z: origin.z + 8,
    yawDeg: 0,
    pitchDeg: -15,
  });
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
 * @param {{speed:number, lookDx?:number, lookDy?:number}} opts
 * @returns {boolean} changed
 */
export function updateCamera(pose, input, dt, opts) {
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

  if (fwd) {
    pose.x += dirX * fwd * v;
    pose.y += dirY * fwd * v;
    changed = true;
  }
  if (strafe) {
    pose.x += rightX * strafe * v;
    pose.y += rightY * strafe * v;
    changed = true;
  }
  if (vert) {
    pose.z += vert * v;
    changed = true;
  }

  if (lookDx || lookDy) {
    pose.yawDeg = ((pose.yawDeg + lookDx * 0.15) % 360 + 360) % 360;
    pose.pitchDeg = Camera.clampPitch(pose.pitchDeg - lookDy * 0.15);
    changed = true;
  }

  return changed;
}

/** Mouse-wheel speed adjust (24.5): x1.25 per notch, clamped to [0.5, 200]. `deltaY > 0` = zoom out (slower). */
export function adjustSpeed(speed, wheelDeltaY) {
  const factor = wheelDeltaY > 0 ? 1 / 1.25 : 1.25;
  return Math.max(0.5, Math.min(200, speed * factor));
}
