// US-005 first-person look: pointer-lock mouse look with an arrow-key
// fallback (used whenever pointer lock isn't currently active - either the
// browser doesn't support it, or the player hasn't clicked yet / pressed
// Esc). Produces `{yawDeg, pitchDeg}` for `Player.update()`'s `controls`
// (see the "Integration hook" note at the bottom of entities/Player.js) -
// this module owns turning, Player owns moving.

const MOUSE_SENS_DEG_PER_PX = 0.15;
const ARROW_YAW_SPEED = 120; // deg/s
const ARROW_PITCH_SPEED = 60; // deg/s
const PITCH_CLAMP = 35; // degrees, matches US-004's y-shear clamp

function clampPitch(p) {
  return Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, p));
}

export class PlayerLook {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./input.js').Input} input
   * @param {number} initialYawDeg
   * @param {number} [initialPitchDeg]
   */
  constructor(canvas, input, initialYawDeg, initialPitchDeg = 0) {
    this.canvas = canvas;
    this.input = input;
    this.yawDeg = initialYawDeg;
    this.pitchDeg = clampPitch(initialPitchDeg);
    this.locked = false;
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

  /** @param {number} dt seconds */
  update(dt) {
    if (this.locked) {
      const d = this.input.consumeMouseDelta();
      this.yawDeg += d.dx * MOUSE_SENS_DEG_PER_PX;
      this.pitchDeg -= d.dy * MOUSE_SENS_DEG_PER_PX; // mouse up (dy<0) -> look up (pitch+)
    } else {
      // Mouse movement made while unlocked is not look input (there's no
      // pointer lock to give it meaning) - discard it here every step so it
      // never accumulates into a snap when locking resumes.
      this.input.consumeMouseDelta();
      if (this.input.isDown('ArrowLeft')) this.yawDeg -= ARROW_YAW_SPEED * dt;
      if (this.input.isDown('ArrowRight')) this.yawDeg += ARROW_YAW_SPEED * dt;
      if (this.input.isDown('ArrowUp')) this.pitchDeg += ARROW_PITCH_SPEED * dt;
      if (this.input.isDown('ArrowDown')) this.pitchDeg -= ARROW_PITCH_SPEED * dt;
    }
    this.yawDeg = ((this.yawDeg % 360) + 360) % 360;
    this.pitchDeg = clampPitch(this.pitchDeg);
  }

  dispose() {
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
  }
}
