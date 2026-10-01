// US-005 first-person look: pointer-lock mouse look with an arrow-key
// fallback (used whenever pointer lock isn't currently active - either the
// browser doesn't support it, or the player hasn't clicked yet / pressed
// Esc). Produces `{yawDeg, pitchDeg}` for `Player.update()`'s `controls`
// (see the "Integration hook" note at the bottom of entities/Player.js) -
// this module owns turning, Player owns moving.

import { yawFromDelta, shortestArcDeg, RAD2DEG } from './transform.js';

const MOUSE_SENS_DEG_PER_PX = 0.15;
const ARROW_YAW_SPEED = 120; // deg/s
const ARROW_PITCH_SPEED = 60; // deg/s
const PITCH_CLAMP = 35; // degrees, matches US-004's y-shear clamp

function clampPitch(p, clampDeg = PITCH_CLAMP) {
  return Math.max(-clampDeg, Math.min(clampDeg, p));
}

export class PlayerLook {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./input.js').Input} input
   * @param {number} initialYawDeg
   * @param {number} [initialPitchDeg]
   * @param {{pitchClampDeg?: number}} [opts] pitchClampDeg: 35 (shear, default) | 70 (pitched, 28.1 A2 item 6)
   */
  constructor(canvas, input, initialYawDeg, initialPitchDeg = 0, opts = {}) {
    this.pitchClampDeg = opts.pitchClampDeg || PITCH_CLAMP;
    // US-128a (architecture 29.2) look lock: turn toward a point, mouse becomes a damped offset.
    this.lockTurnDegPerSec = opts.lockTurnDegPerSec ?? 360;
    this.lockMouseScale = opts.lockMouseScale ?? 0.25;
    this.lockOffsetYawDeg = opts.lockOffsetYawDeg ?? 20;
    this.lockOffsetPitchDeg = opts.lockOffsetPitchDeg ?? 10;
    /** @type {boolean} read-only: true between setLockPoint() and clearLock() */
    this.lockActive = false;
    this._lockYaw = 0;
    this._lockPitch = 0;
    this._offYaw = 0;
    this._offPitch = 0;
    this.canvas = canvas;
    this.input = input;
    this.yawDeg = initialYawDeg;
    this.pitchDeg = clampPitch(initialPitchDeg, this.pitchClampDeg);
    // Already-locked canvas (e.g. a PlayerLook rebuilt on a world restart,
    // US-017): no 'pointerlockchange' will fire, so read the state directly.
    this.locked = typeof document !== 'undefined' && document.pointerLockElement === canvas;
    this.supported = !!(canvas.requestPointerLock && document.exitPointerLock);

    this._onClick = () => {
      if (this.locked || !this.supported) return;
      // requestPointerLock() can fail two different ways depending on the
      // browser/embedding context (an iframe'd preview pane, for one, is a
      // real case in this project's own tooling): a synchronous throw, or a
      // rejected Promise (WrongDocumentError, permission denied, ...),
      // without 'pointerlockerror' ever firing for either. Handle both so a
      // denied/unavailable request never surfaces as an uncaught exception
      // or rejection - the arrow-key fallback covers look either way.
      try {
        const result = canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') {
          result.catch(() => { this.locked = false; });
        }
      } catch (err) {
        this.locked = false;
      }
    };
    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) {
        // Discard whatever raw mouse movement piled up in Input while we
        // were unlocked (before this click, or in the async gap between
        // requestPointerLock() and this event actually firing) - otherwise
        // update()'s first locked step applies it all in one jump. See
        // PO REJECT #1 on US-005.
        this.input.consumeMouseDelta();
      }
    };
    this._onPointerLockError = () => {
      this.locked = false;
    };

    canvas.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
  }

  /**
   * US-128a: aim at a world point (eye e, target t; x/y ground plane, z up). Call every
   * step while locked, before update(). First call after clearLock() resets the offsets.
   */
  setLockPoint(ex, ey, ez, tx, ty, tz) {
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    // compass: 0 = N = -y, clockwise; same as Player forward (sin, -cos)
    this._lockYaw = yawFromDelta(dx, dy);
    this._lockPitch = Math.atan2(dz, Math.sqrt(dx * dx + dy * dy)) * RAD2DEG;
    if (!this.lockActive) {
      this.lockActive = true;
      this._offYaw = 0;
      this._offPitch = 0;
    }
  }

  /** US-128a: release; yaw/pitch stay where they are (no jump), full mouse look returns. */
  clearLock() {
    this.lockActive = false;
  }

  /** @param {number} dt seconds */
  update(dt) {
    const k = this.lockActive ? this.lockMouseScale : 1;
    let dYaw = 0, dPitch = 0;
    if (this.locked) {
      const d = this.input.consumeMouseDelta();
      dYaw = d.dx * MOUSE_SENS_DEG_PER_PX * k;
      dPitch = -d.dy * MOUSE_SENS_DEG_PER_PX * k; // mouse up (dy<0) -> look up (pitch+)
    } else {
      // Mouse movement made while unlocked is not look input (there's no
      // pointer lock to give it meaning) - discard it here every step so it
      // never accumulates into a snap when locking resumes.
      this.input.consumeMouseDelta();
      if (this.input.isDown('ArrowLeft')) dYaw -= ARROW_YAW_SPEED * dt * k;
      if (this.input.isDown('ArrowRight')) dYaw += ARROW_YAW_SPEED * dt * k;
      if (this.input.isDown('ArrowUp')) dPitch += ARROW_PITCH_SPEED * dt * k;
      if (this.input.isDown('ArrowDown')) dPitch -= ARROW_PITCH_SPEED * dt * k;
    }
    if (this.lockActive) {
      this._offYaw = Math.max(-this.lockOffsetYawDeg, Math.min(this.lockOffsetYawDeg, this._offYaw + dYaw));
      this._offPitch = Math.max(-this.lockOffsetPitchDeg, Math.min(this.lockOffsetPitchDeg, this._offPitch + dPitch));
      const maxStep = this.lockTurnDegPerSec * dt;
      const dy = shortestArcDeg(this.yawDeg, this._lockYaw + this._offYaw); // (-180, 180]
      this.yawDeg += Math.max(-maxStep, Math.min(maxStep, dy));
      const dp = this._lockPitch + this._offPitch - this.pitchDeg;
      this.pitchDeg += Math.max(-maxStep, Math.min(maxStep, dp));
    } else {
      this.yawDeg += dYaw;
      this.pitchDeg += dPitch;
    }
    this.yawDeg = ((this.yawDeg % 360) + 360) % 360;
    this.pitchDeg = clampPitch(this.pitchDeg, this.pitchClampDeg);
  }

  dispose() {
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
  }
}
