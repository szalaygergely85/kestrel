// game/js/entities/Player.js
//
// US-008 player entity: a vertical capsule with fixed-step gravity,
// walk/run, and grid collision (game/js/physics/capsule.js), tuned from
// game/js/physics/config.js. See the "Integration hook" note at the bottom
// of this file for how main.js (US-005 camera controls) is expected to
// drive this once it exists - this module has no dependency on engine/,
// render/, ui/ or main.js, and is fully testable headless (see
// game/js/physics/*.test.js and game/physics-test.html).
//
// US-009 (jump, step-up smoothing, landing dip, head bob) is NOT
// implemented yet - deliberately. The state this class keeps (`grounded`,
// `vz`, per-step floor tracking) is already exactly what US-009 needs to
// add jump/coyote-time/jump-buffer and a smoothed eye height on top,
// without restructuring the collision/gravity core built here.

import { PHYSICS } from '../physics/config.js';
import { moveCapsule, sectorOrOutside } from '../physics/capsule.js';

// Module-level scratch, built once from PHYSICS (architecture.md section 9:
// no per-step allocations). `moveCapsule`'s `opts` never changes at runtime
// (it's derived from the one tuning config, US-008 AC), so there is no
// reason to build a fresh `{height, stepUpMax}` object every physics step.
const COLLIDE_OPTS = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };

export class Player {
  /**
   * @param {import('../world/Level.js').Level} level
   */
  constructor(level) {
    const s = level.start;
    this.x = s.x;
    this.y = s.y;
    this.z = level.floorAt(s.x, s.y) ?? 0; // feet height
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = true;

    // Caller-owned scratch for moveCapsule's `out` parameter (US-008 ARCH
    // CHANGES rework #3 / architecture.md section 9: no per-step object
    // returns). Reused every physics step, never reallocated.
    this._move = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };

    // Camera-facing state. US-005 (mouse/keyboard look) owns turning the
    // player; until it exists, `update()`'s `controls.yawDeg`/`pitchDeg`
    // (when passed) simply overwrite these each step - see the bottom note.
    this.yawDeg = s.facingDeg;
    this.pitchDeg = s.pitchDeg;
    this.eyeH = s.eyeH; // base eye height above the feet (US-009 adds bob/dip on top of this)
  }

  /**
   * Advance the player by exactly one fixed physics step. Call this from a
   * 60 Hz accumulator loop (game/js/engine/loop.js) - dt is expected to be
   * PHYSICS.fixedDt, but the function itself doesn't assume that so it can
   * be unit-tested with any dt.
   *
   * @param {number} dt seconds
   * @param {{forward?:number, strafe?:number, run?:boolean, yawDeg?:number, pitchDeg?:number}} controls
   *   forward/strafe: -1..1 (W=+1/S=-1, D=+1/A=-1 - already combined per
   *   axis; diagonal input is normalized internally, so callers do not need
   *   to pre-normalize). run: Shift held. yawDeg/pitchDeg: if given,
   *   overwrite the player's facing this step (mouse/arrow-key look, US-005);
   *   if omitted, the player keeps its current facing.
   * @param {{sectorAt:Function, outsideSector?:Function, floorAt?:Function}} level
   *   a `Level` today; (D-008) any object with the same `sectorAt`/
   *   `outsideSector` shape works, so a future open-world `World` can be
   *   passed here unchanged - this method never assumes "outside the grid"
   *   itself, it always goes through `level.outsideSector()` (see
   *   physics/capsule.js's `sectorOrOutside`).
   */
  update(dt, controls, level) {
    const P = PHYSICS;
    if (controls) {
      if (typeof controls.yawDeg === 'number') this.yawDeg = controls.yawDeg;
      if (typeof controls.pitchDeg === 'number') this.pitchDeg = controls.pitchDeg;
    }

    // 1. Wish direction in world space, from yaw + forward/strafe.
    //    Compass convention (MAP_FORMAT.md section 1): yaw 0 = north (-y),
    //    90 = east (+x), clockwise.
    const forward = clamp(controls && controls.forward || 0, -1, 1);
    const strafe = clamp(controls && controls.strafe || 0, -1, 1);
    const run = !!(controls && controls.run);

    const yawRad = this.yawDeg * Math.PI / 180;
    const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad);
    const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad);

    let wishX = fwdX * forward + rightX * strafe;
    let wishY = fwdY * forward + rightY * strafe;
    const wishLen = Math.hypot(wishX, wishY);
    if (wishLen > 1e-6) { wishX /= wishLen; wishY /= wishLen; } // normalize diagonals, not faster

    const targetSpeed = (run ? P.runSpeed : P.walkSpeed) * Math.min(1, wishLen);
    const targetVelX = wishX * targetSpeed;
    const targetVelY = wishY * targetSpeed;

    // 2. Horizontal accel/decel toward the target velocity. Rate is derived
    //    from the tuning config so "reach full speed in accelTime" / "stop
    //    in decelTime" hold exactly for a constant input (GDD section 5).
    //    Airborne movement is scaled by airControl (US-009 AC3; harmless
    //    and already correct for US-008's ledge-falling case).
    const accelerating = wishLen > 1e-6;
    const baseSpeed = run ? P.runSpeed : P.walkSpeed;
    const rate = (baseSpeed / (accelerating ? P.accelTime : P.decelTime)) * (this.grounded ? 1 : P.airControl);

    this.vx = approach(this.vx, targetVelX, rate * dt);
    this.vy = approach(this.vy, targetVelY, rate * dt);

    // 3. Resolve horizontal movement against the grid (solid cells + the
    //    grounded-only step-up threshold), sliding along walls and around
    //    convex corners (US-008 ARCH CHANGES rework #3: iterative
    //    minimum-translation push-out + contact normal, replacing the old
    //    axis-separated sweep that could freeze on a corner).
    const footZAtStepStart = this.z;
    const groundedAtStepStart = this.grounded;
    const moved = moveCapsule(
      level, this.x, this.y, this.vx * dt, this.vy * dt,
      P.radius, footZAtStepStart, groundedAtStepStart, COLLIDE_OPTS, this._move
    );
    this.x = moved.x;
    this.y = moved.y;

    // Velocity response: zero a blocked (face-contact) axis outright, as
    // before; then, if the last contact this step was a corner, clip the
    // remaining velocity against its normal (Quake-style clip) rather than
    // zeroing both axes - that's what lets a diagonal push keep its
    // tangential component and slide around the corner instead of
    // freezing. Face normals are axis-aligned, so straight wall behaviour
    // (blockedX/blockedY alone) is unchanged.
    if (moved.blockedX) this.vx = 0;
    if (moved.blockedY) this.vy = 0;
    if (moved.nx || moved.ny) {
      const vn = this.vx * moved.nx + this.vy * moved.ny;
      if (vn < 0) {
        this.vx -= vn * moved.nx;
        this.vy -= vn * moved.ny;
      }
    }

    // 4. Vertical: follow the floor while grounded (small rises/drops,
    //    within stepUpMax, are walked smoothly - stairs); otherwise
    //    integrate gravity and land when the floor is reached (US-008 AC4).
    //    (D-008) No "outside the grid" special-case here: sectorOrOutside
    //    resolves it via world.outsideSector(), same as collision does.
    const sector = sectorOrOutside(level, this.x, this.y);
    const floorH = sector.floorH;

    if (groundedAtStepStart) {
      const floorDiff = floorH - footZAtStepStart;
      if (Math.abs(floorDiff) <= P.stepUpMax) {
        this.z = floorH; // walked the step (up or down), no fall
        this.vz = 0;
        this.grounded = true;
      } else {
        // Floor dropped away by more than a step: start falling from where
        // we are (do not snap down - that would skip the fall entirely).
        this.grounded = false;
        this.vz = 0; // free-fall starts at 0 vertical speed this step
      }
    }

    if (!this.grounded) {
      this.vz -= P.gravity * dt;
      this.z += this.vz * dt;

      // Ceiling bonk (numeric ceilings only): clamp so the head never
      // clips through, and kill upward velocity. Matters once US-009 adds
      // jumping; harmless (never triggered by pure falling) here.
      if (sector.ceilH !== 'sky') {
        const maxZ = sector.ceilH - P.height;
        if (this.z > maxZ) { this.z = maxZ; if (this.vz > 0) this.vz = 0; }
      }

      if (this.z <= floorH) {
        this.z = floorH;
        this.vz = 0;
        this.grounded = true;
      }
    }
  }

  /** Camera transform for the render/camera code (US-005/US-004) to consume. */
  getEyeTransform() {
    return {
      x: this.x,
      y: this.y,
      z: this.z + this.eyeH,
      yawDeg: this.yawDeg,
      pitchDeg: this.pitchDeg,
    };
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Move `value` toward `target` by at most `maxDelta` (sign-aware) - a
// constant-rate ramp, so a constant `rate` produces an exact "time to reach
// target" of target/rate seconds when starting from (or going to) 0.
function approach(value, target, maxDelta) {
  const diff = target - value;
  if (Math.abs(diff) <= maxDelta || maxDelta <= 0) return target;
  return value + Math.sign(diff) * maxDelta;
}

// ---------------------------------------------------------------------
// Integration hook for main.js (US-005 camera controls own this today):
//
//   import { loadLevel } from './world/Level.js';
//   import tower from './world/levels/tower.js'; // or test_room via ?level=
//   import { Player } from './entities/Player.js';
//   import { PHYSICS } from './physics/config.js';
//
//   const level = loadLevel(tower);
//   const player = new Player(level);
//
//   // Each fixed 60 Hz update() step (game/js/engine/loop.js already runs
//   // a fixed-step accumulator - call this from inside it, once per step,
//   // with dt = PHYSICS.fixedDt):
//   function update(dt) {
//     const controls = {
//       forward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
//       strafe: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
//       run: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
//       yawDeg: camera.yawDeg,     // US-005 owns mouse-look/arrow-key turning
//       pitchDeg: camera.pitchDeg,
//     };
//     player.update(dt, controls, level);
//   }
//
//   // Each render(alpha) frame, feed the raycaster/camera (US-004/US-005):
//   function render(alpha) {
//     const eye = player.getEyeTransform(); // {x, y, z, yawDeg, pitchDeg}
//     // raycastScene(rt, level, eye, ...);
//   }
//
// Notes for whoever wires this in:
// - `isSectorPassable` is exported from physics/capsule.js in case US-013's
//   boulder (a sphere on "the same [2.5D] model", D-002) wants the same
//   collision predicate with its own radius/height.
// - Player has no reference to Input/RenderTarget/Loop - it only needs a
//   plain `controls` object and a `Level` each step, which is what makes
//   game/physics-test.html able to drive it with a fake keyboard harness
//   instead of the real engine/input.js.
// ---------------------------------------------------------------------
