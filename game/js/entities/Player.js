// game/js/entities/Player.js
//
// Player entity: a vertical capsule with fixed-step gravity, walk/run, grid
// collision (game/js/physics/capsule.js), jump/coyote/buffer, step-up eye
// smoothing and landing feel (game/js/entities/EyeFeel.js), tuned from
// game/js/physics/config.js. See the "Integration hook" note at the bottom
// of this file for how main.js drives this - this module has no dependency
// on engine/, render/, ui/ or main.js, and is fully testable headless (see
// game/js/physics/*.test.js, game/js/entities/eyeFeel.test.js and
// game/physics-test.html).
//
// Step order (normative, docs/architecture.md section 7.1 - tests depend on
// this exact sequence):
//   1. Facing from controls. Timers (coyote only while airborne, buffer
//      always). Clear per-step flags (jumped, landed, stepDelta).
//   2. Jump decision (edge-detected here, not by Input - AC9 "holding does
//      not auto-repeat" is then a property of the entity).
//   3. Horizontal accel toward wish velocity (post jump-decision grounded,
//      so the take-off step already uses airControl).
//   4. moveCapsule against the grid (same post-decision grounded).
//   5. Vertical, gated on the CURRENT grounded (mutated in place through
//      steps 2/5, never a separately-captured step-start value - see the
//      note in step 5 below for why).
//   6. updateEyeFeel (visual only).

import { PHYSICS } from '../physics/config.js';
import { moveCapsule, sectorOrOutside } from '../physics/capsule.js';
import { createEyeFeel, updateEyeFeel } from './EyeFeel.js';

// Module-level scratch, built once from PHYSICS (architecture.md section 9:
// no per-step allocations). `moveCapsule`'s `opts` never changes at runtime
// (it's derived from the one tuning config, US-008 AC), so there is no
// reason to build a fresh `{height, stepUpMax}` object every physics step.
const COLLIDE_OPTS = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };

// Float noise tolerance for the buffer/coyote ">" compares (architecture.md
// 7.1 step 2) - e.g. `0.1 - 6/60` is not exactly 0.
const EPS = 1e-6;

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

    // Jump/coyote/buffer state (US-009).
    this.coyote = 0;          // s remaining a jump is still allowed after a drop
    this.buffer = 0;          // s remaining a jump press is remembered before landing
    this.jumpHeldPrev = false; // edge detection for controls.jump (a HELD level - see Controls typedef)
    this.peakZ = this.z;      // highest z reached during the current airborne phase

    // Per-step hooks (plain fields, no event objects - architecture.md
    // section 9 rule 9.3). Read by EyeFeel this step, and available for
    // sound (US-020)/camera code later.
    this.jumped = false;
    this.landed = false;
    this.stepDelta = 0;
    this.fallDistance = 0;

    // First-person eye feel (step smoothing, landing dip, head bob) - built
    // once, mutated in place every step, never touches collision.
    this.feel = createEyeFeel();

    // Caller-owned scratch for moveCapsule's `out` parameter (US-008 ARCH
    // CHANGES rework #3 / architecture.md section 9: no per-step object
    // returns). Reused every physics step, never reallocated.
    this._move = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };

    // Camera-facing state. US-005 (mouse/keyboard look) owns turning the
    // player; until it exists, `update()`'s `controls.yawDeg`/`pitchDeg`
    // (when passed) simply overwrite these each step - see the bottom note.
    this.yawDeg = s.facingDeg;
    this.pitchDeg = s.pitchDeg;
    this.eyeH = s.eyeH; // base eye height above the feet (feel.offset adds bob/dip/step on top)
  }

  /**
   * Advance the player by exactly one fixed physics step. Call this from a
   * 60 Hz accumulator loop (game/js/engine/loop.js) - dt is expected to be
   * PHYSICS.fixedDt, but the function itself doesn't assume that so it can
   * be unit-tested with any dt.
   *
   * @param {number} dt seconds
   * @param {{forward?:number, strafe?:number, run?:boolean, jump?:boolean, yawDeg?:number, pitchDeg?:number}} controls
   *   forward/strafe: -1..1 (W=+1/S=-1, D=+1/A=-1 - already combined per
   *   axis; diagonal input is normalized internally, so callers do not need
   *   to pre-normalize). run: Shift held. jump: Space HELD this step (a
   *   level, not an edge - the caller ORs in the edge-trigger so a sub-step
   *   tap is not lost; this method does its own edge detection via
   *   `jumpHeldPrev`, see architecture.md section 5 Controls typedef).
   *   yawDeg/pitchDeg: if given, overwrite the player's facing this step
   *   (mouse/arrow-key look, US-005); if omitted, the player keeps its
   *   current facing.
   * @param {{sectorAt:Function, outsideSector?:Function, floorAt?:Function}} level
   *   a `Level` today; (D-008) any object with the same `sectorAt`/
   *   `outsideSector` shape works, so a future open-world `World` can be
   *   passed here unchanged - this method never assumes "outside the grid"
   *   itself, it always goes through `level.outsideSector()` (see
   *   physics/capsule.js's `sectorOrOutside`).
   */
  update(dt, controls, level) {
    const P = PHYSICS;

    // ---- 1. Facing, timers, per-step flags --------------------------------
    if (controls) {
      if (typeof controls.yawDeg === 'number') this.yawDeg = controls.yawDeg;
      if (typeof controls.pitchDeg === 'number') this.pitchDeg = controls.pitchDeg;
    }
    if (!this.grounded) this.coyote = Math.max(0, this.coyote - dt);
    this.buffer = Math.max(0, this.buffer - dt);
    this.jumped = false;
    this.landed = false;
    this.stepDelta = 0;

    // ---- 2. Jump decision --------------------------------------------------
    // Edge detection lives here (not in Input) so "holding does not
    // auto-repeat" (AC9) is a property of this entity, testable headless
    // with a level input and usable by the physics-test harness (which only
    // has a key Set, no frame-edge concept).
    const jumpHeld = !!(controls && controls.jump);
    const pressed = jumpHeld && !this.jumpHeldPrev;
    this.jumpHeldPrev = jumpHeld;
    if (pressed) this.buffer = P.jumpBufferTime;
    if (this.buffer > EPS && (this.grounded || this.coyote > EPS)) {
      this.vz = P.jumpSpeed; // SET, not added - a coyote jump from a falling step still reaches a full apex
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.jumped = true;
      this.peakZ = this.z;
    }

    // ---- 3. Horizontal accel toward wish velocity --------------------------
    // Compass convention (MAP_FORMAT.md section 1): yaw 0 = north (-y),
    // 90 = east (+x), clockwise.
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

    // Rate uses the POST-DECISION `grounded` (architecture.md 7.1 step 3):
    // the take-off step already applies airControl, same as every other
    // airborne step.
    const accelerating = wishLen > 1e-6;
    const baseSpeed = run ? P.runSpeed : P.walkSpeed;
    const rate = (baseSpeed / (accelerating ? P.accelTime : P.decelTime)) * (this.grounded ? 1 : P.airControl);

    this.vx = approach(this.vx, targetVelX, rate * dt);
    this.vy = approach(this.vy, targetVelY, rate * dt);

    // ---- 4. Resolve horizontal movement against the grid -------------------
    // (US-008 ARCH CHANGES rework #3: iterative minimum-translation
    // push-out + contact normal, sliding along walls and around convex
    // corners.) footZ is `this.z` - unchanged since step 5 (vertical) hasn't
    // run yet this step. `grounded` is the same post-decision value used
    // above, per architecture.md 7.1 step 4.
    const moved = moveCapsule(
      level, this.x, this.y, this.vx * dt, this.vy * dt,
      P.radius, this.z, this.grounded, COLLIDE_OPTS, this._move
    );
    this.x = moved.x;
    this.y = moved.y;

    // Velocity response: zero a blocked (face-contact) axis outright; then,
    // if the last contact this step was a corner, clip the remaining
    // velocity against its normal (Quake-style clip) rather than zeroing
    // both axes - that's what lets a diagonal push keep its tangential
    // component and slide around the corner instead of freezing. Face
    // normals are axis-aligned, so straight wall behaviour (blockedX/Y
    // alone) is unchanged.
    if (moved.blockedX) this.vx = 0;
    if (moved.blockedY) this.vy = 0;
    if (moved.nx || moved.ny) {
      const vn = this.vx * moved.nx + this.vy * moved.ny;
      if (vn < 0) {
        this.vx -= vn * moved.nx;
        this.vy -= vn * moved.ny;
      }
    }

    // ---- 5. Vertical, gated on the CURRENT grounded ------------------------
    // Deliberately NOT a step-start snapshot: on the take-off step, step 2
    // already flipped `grounded` to false, so this reads that fresh value
    // and falls straight into the airborne branch below (integrating
    // gravity against the just-set jump velocity the same step) instead of
    // re-grounding via the floor-follow branch and eating the jump.
    const sector = sectorOrOutside(level, this.x, this.y);
    const floorH = sector.floorH;

    if (this.grounded) {
      const floorDiff = floorH - this.z; // positive = floor rose (a stair up)
      if (Math.abs(floorDiff) <= P.stepUpMax) {
        this.stepDelta = floorDiff; // walked the step (up or down), no fall - EyeFeel smooths this
        this.z = floorH;
        this.vz = 0;
      } else {
        // Floor dropped away by more than a step: start falling from where
        // we are (do not snap down - that would skip the fall entirely).
        // Coyote is granted ONLY here (a drop), never from a jump.
        this.grounded = false;
        this.vz = 0;
        this.coyote = P.coyoteTime;
        this.peakZ = this.z;
      }
    }

    if (!this.grounded) {
      this.vz -= P.gravity * dt;
      this.z += this.vz * dt;
      if (this.z > this.peakZ) this.peakZ = this.z;

      // Ceiling bonk (numeric ceilings only): clamp so the head never clips
      // through, and kill upward velocity (a rise under a ceiling - AC5).
      // A side hit into a wall above a lintel is a horizontal face block
      // instead (blockedX/Y above, vy/vx zeroed) - the jump arc continues,
      // per the PO ruling (ASK PO 1).
      if (sector.ceilH !== 'sky') {
        const maxZ = sector.ceilH - P.height;
        if (this.z > maxZ) { this.z = maxZ; if (this.vz > 0) this.vz = 0; }
      }

      if (this.z <= floorH) {
        this.z = floorH;
        this.vz = 0;
        this.grounded = true;
        this.coyote = 0;
        this.landed = true;
        this.fallDistance = this.peakZ - this.z; // apex-to-landing (ASK PO 3 / PO ruling)
      }
    }

    // ---- 6. Eye feel (visual only, never touches collision) ---------------
    updateEyeFeel(this.feel, dt, this, P);
  }

  /** Camera transform for the render/camera code (US-005/US-004) to consume. */
  getEyeTransform() {
    return {
      x: this.x,
      y: this.y,
      z: this.z + this.eyeH + this.feel.offset,
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
// Integration hook for main.js (US-005 camera controls own turning):
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
//   // with dt = PHYSICS.fixedDt). `controls` is reused, never rebuilt per
//   // step (architecture.md section 9 rule 9.3):
//   function update(dt) {
//     controls.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
//     controls.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
//     controls.run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
//     controls.jump = input.isDown('Space') || input.pressed('Space'); // OR in the edge so a sub-step tap isn't lost
//     controls.yawDeg = camera.yawDeg;     // US-005 owns mouse-look/arrow-key turning
//     controls.pitchDeg = camera.pitchDeg;
//     player.update(dt, controls, level);
//   }
//
//   // Each render(alpha) frame, feed the raycaster/camera (US-004/US-005):
//   function render(alpha) {
//     const eye = player.getEyeTransform(); // {x, y, z, yawDeg, pitchDeg} - z already includes feel.offset
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
