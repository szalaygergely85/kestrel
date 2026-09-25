// engine/physics/integrate.js (US-025, docs/architecture.md 7.1/section 5).
// Generic entity integrator: the same fixed-step rules as
// `engine/entities/Player.js#update` (kept verbatim there for the existing
// US-008/009 tests, per the tech notes' "keep Player.js as-is"), lifted onto
// plain `Entity` data (`entity.transform`, `entity.components.body`) so any
// entity with a `body` component can walk/fall/collide against a `World`,
// not just the singleton Player. Step order (7.1, tests depend on it):
//   1. Facing from controls; timers; clear per-step flags.
//   2. Jump decision (edge-detected here).
//   3. Horizontal accel toward wish velocity.
//   4. moveCapsule against the grid.
//   4b. Walk bound (US-026a, architecture.md 23.3) - only when `world.bounds`.
//   5. Vertical, gated on the CURRENT grounded; terrain slope rule (US-026a).
//   6. updateEyeFeel (visual only).
import { moveCapsule, sectorOrOutside } from './capsule.js';
import { updateEyeFeel } from '../entities/EyeFeel.js';

const EPS = 1e-6;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Move `value` toward `target` by at most `maxDelta` (sign-aware).
function approach(value, target, maxDelta) {
  const diff = target - value;
  if (Math.abs(diff) <= maxDelta || maxDelta <= 0) return target;
  return value + Math.sign(diff) * maxDelta;
}

// Per-body scratch (architecture.md section 9: no per-step allocations) -
// created once per entity (on first `integrate` call for it) and reused
// every step after. Plain JSON-safe fields only, so a full-tree
// `structuredClone` of `components` (serialize.js) stays correct even though
// it copies this scratch too (harmless - it is rebuilt as reused the moment
// the entity moves again after a load).
function ensureScratch(body, cfg) {
  if (!body._move) body._move = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };
  if (!body.feel) body.feel = { stepOffset: 0, dipT: 0, dipAmount: 0, bobPhase: 0, offset: 0 };
  if (!body._collideOpts || body._collideOpts.height !== cfg.height || body._collideOpts.stepUpMax !== cfg.stepUpMax) {
    body._collideOpts = { height: cfg.height, stepUpMax: cfg.stepUpMax };
  }
  if (typeof body.vx !== 'number') body.vx = 0;
  if (typeof body.vy !== 'number') body.vy = 0;
  if (typeof body.vz !== 'number') body.vz = 0;
  if (typeof body.grounded !== 'boolean') body.grounded = true;
  if (typeof body.coyote !== 'number') body.coyote = 0;
  if (typeof body.buffer !== 'number') body.buffer = 0;
  if (typeof body.jumpHeldPrev !== 'boolean') body.jumpHeldPrev = false;
  if (typeof body.peakZ !== 'number') body.peakZ = 0;
  if (typeof body.speedScale !== 'number') body.speedScale = 1; // US-013: <1 while pushing a roller
  if (typeof body.prevX !== 'number') body.prevX = 0;
  if (typeof body.prevY !== 'number') body.prevY = 0;
  if (typeof body.sliding !== 'boolean') body.sliding = false; // US-026a slope rule (23.3)
  if (typeof body.slideNx !== 'number') body.slideNx = 0; // downhill unit (x, y), set in step 5, read by step 3 next step
  if (typeof body.slideNy !== 'number') body.slideNy = 0;
  if (typeof body.boundsHit !== 'boolean') body.boundsHit = false; // US-026a walk bound (23.3 step 4b)
}

/**
 * Advances one entity by exactly one fixed physics step against `world`
 * (any `WorldQuery`: `Level` or `World`, D-008).
 * @param {Object} entity - plain Entity data; needs `components.body`
 *   ({radius, height, eyeH, stepUpMax? unused - cfg owns tuning, vx, vy, vz, grounded, ...}).
 * @param {number} dt seconds
 * @param {{forward?:number, strafe?:number, run?:boolean, jump?:boolean, yawDeg?:number, pitchDeg?:number}} [controls]
 * @param {{sectorAt:Function, outsideSector?:Function}} world
 * @param {Object} cfg - a PHYSICS-shaped tuning object (engine/physics/config.js)
 */
export function integrate(entity, dt, controls, world, cfg) {
  const body = entity.components && entity.components.body;
  if (!body) throw new Error(`integrate: entity "${entity.id}" has no components.body`);
  ensureScratch(body, cfg);
  const t = entity.transform;
  const P = cfg;

  // US-013 ARCH CHANGES #1: record the step-start position BEFORE any of
  // this step's movement, so `resolveBodyContacts`' restore-on-failure
  // fallback has a true pre-integrate position to restore to (not a no-op).
  body.prevX = t.x;
  body.prevY = t.y;

  // ---- 1. Facing, timers, per-step flags --------------------------------
  if (controls) {
    if (typeof controls.yawDeg === 'number') t.yawDeg = controls.yawDeg;
    if (typeof controls.pitchDeg === 'number') t.pitchDeg = controls.pitchDeg;
  }
  if (!body.grounded) body.coyote = Math.max(0, body.coyote - dt);
  body.buffer = Math.max(0, body.buffer - dt);
  body.jumped = false;
  body.landed = false;
  body.stepDelta = 0;

  // ---- 2. Jump decision ---------------------------------------------------
  const jumpHeld = !!(controls && controls.jump);
  const pressed = jumpHeld && !body.jumpHeldPrev;
  body.jumpHeldPrev = jumpHeld;
  if (pressed) body.buffer = P.jumpBufferTime;
  if (body.buffer > EPS && (body.grounded || body.coyote > EPS)) {
    body.vz = P.jumpSpeed; // SET, not added
    body.grounded = false;
    body.coyote = 0;
    body.buffer = 0;
    body.jumped = true;
    body.peakZ = t.z;
  }

  // ---- 3. Horizontal accel toward wish velocity ---------------------------
  const forward = clamp((controls && controls.forward) || 0, -1, 1);
  const strafe = clamp((controls && controls.strafe) || 0, -1, 1);
  const run = !!(controls && controls.run);

  const yawRad = t.yawDeg * Math.PI / 180;
  const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad);

  let wishX = fwdX * forward + rightX * strafe;
  let wishY = fwdY * forward + rightY * strafe;
  const wishLen = Math.hypot(wishX, wishY);
  if (wishLen > 1e-6) { wishX /= wishLen; wishY /= wishLen; }

  // US-026a (23.3): while sliding on a too-steep terrain slope, the wish
  // direction loses its uphill component (pushing W into the slope does
  // nothing) - `body.sliding`/`slideNx`/`slideNy` are set in THIS entity's
  // step 5 of the PREVIOUS call, from the real ground normal at its
  // position then (never a hard-coded direction). When that leaves no wish
  // at all (idle, or driving straight into the slope), the normal
  // accel/decel "approach toward target" below is skipped for this step
  // instead of chasing a zero target: `decelTime` is tuned for a snappy
  // arcade stop (reaches 0 in about 5 steps even from a few cm/s), which
  // would otherwise erase the slide accel step 5 adds every single step
  // before it can ever build toward `slideMaxSpeed` - only step 5's slide
  // accel and its own cap govern vx/vy while there is no real wish left. A
  // partial (cross-slope) wish still drives normal accel/decel as usual.
  let slideFreeze = false;
  if (body.sliding) {
    const s = wishX * body.slideNx + wishY * body.slideNy;
    if (s < 0) { wishX -= s * body.slideNx; wishY -= s * body.slideNy; }
    if (Math.hypot(wishX, wishY) <= 1e-6) slideFreeze = true;
  }

  const targetSpeed = (run ? P.runSpeed : P.walkSpeed) * Math.min(1, wishLen) * body.speedScale; // US-013
  const targetVelX = wishX * targetSpeed;
  const targetVelY = wishY * targetSpeed;

  const accelerating = wishLen > 1e-6;
  const baseSpeed = run ? P.runSpeed : P.walkSpeed;
  const rate = (baseSpeed / (accelerating ? P.accelTime : P.decelTime)) * (body.grounded ? 1 : P.airControl);

  if (!slideFreeze) {
    body.vx = approach(body.vx, targetVelX, rate * dt);
    body.vy = approach(body.vy, targetVelY, rate * dt);
  }

  // ---- 4. Resolve horizontal movement against the grid --------------------
  const moved = moveCapsule(
    world, t.x, t.y, body.vx * dt, body.vy * dt,
    body.radius, t.z, body.grounded, body._collideOpts, body._move
  );
  t.x = moved.x;
  t.y = moved.y;

  if (moved.blockedX) body.vx = 0;
  if (moved.blockedY) body.vy = 0;
  if (moved.nx || moved.ny) {
    const vn = body.vx * moved.nx + body.vy * moved.ny;
    if (vn < 0) {
      body.vx -= vn * moved.nx;
      body.vy -= vn * moved.ny;
    }
  }

  // ---- 4b. Walk bound (US-026a, architecture.md 23.1 decision 4, 23.3) ----
  // Data-driven (`world.bounds`), enforced here as a projection with
  // velocity clipping - no wall sectors, no spring, no hint/callback from
  // inside integrate (flags only; `world.triggers`' `'bounds'` shape reads
  // position against `world.bounds` separately, per 23.5).
  if (world.bounds) {
    const bx = world.bounds.x, by = world.bounds.y, r = world.bounds.r;
    const dx = t.x - bx, dy = t.y - by;
    const d = Math.hypot(dx, dy);
    const lim = r - body.radius;
    if (d > lim && d > EPS) {
      const nx2 = dx / d, ny2 = dy / d;
      t.x = bx + nx2 * lim;
      t.y = by + ny2 * lim;
      const vn = body.vx * nx2 + body.vy * ny2;
      if (vn > 0) {
        body.vx -= vn * nx2;
        body.vy -= vn * ny2;
      }
      body.boundsHit = true;
    } else {
      body.boundsHit = false;
    }
  } else {
    body.boundsHit = false;
  }

  // ---- 5. Vertical, gated on the CURRENT grounded --------------------------
  const sector = sectorOrOutside(world, t.x, t.y);
  const floorH = sector.floorH;

  if (body.grounded) {
    const floorDiff = floorH - t.z;
    if (Math.abs(floorDiff) <= P.stepUpMax) {
      body.stepDelta = floorDiff;
      t.z = floorH;
      body.vz = 0;

      // US-026a (23.3): slope rule, terrain sectors only (Level sectors have
      // no `terrain` field). `isSectorPassable` already lets any slope
      // through horizontally (decision 3) - steepness is decided here, at
      // the actor's own position, from the real ground normal.
      if (sector.terrain) {
        const nz = sector.nz;
        if (nz < P.slideStartCos) body.sliding = true;
        else if (nz > P.slideStopCos) body.sliding = false;
        if (body.sliding) {
          const dLen = Math.hypot(sector.nx, sector.ny);
          if (dLen > EPS) {
            const dhx = sector.nx / dLen, dhy = sector.ny / dLen;
            body.slideNx = dhx;
            body.slideNy = dhy;
            const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
            body.vx += dhx * P.slideAccel * horiz * dt;
            body.vy += dhy * P.slideAccel * horiz * dt;
            const speed = Math.hypot(body.vx, body.vy);
            if (speed > P.slideMaxSpeed) {
              const scale = P.slideMaxSpeed / speed;
              body.vx *= scale;
              body.vy *= scale;
            }
          }
        }
      } else {
        body.sliding = false;
      }
    } else {
      body.grounded = false;
      body.vz = 0;
      body.coyote = P.coyoteTime;
      body.peakZ = t.z;
    }
  }

  if (!body.grounded) {
    body.vz -= P.gravity * dt;
    t.z += body.vz * dt;
    if (t.z > body.peakZ) body.peakZ = t.z;

    if (sector.ceilH !== 'sky') {
      const maxZ = sector.ceilH - P.height;
      if (t.z > maxZ) { t.z = maxZ; if (body.vz > 0) body.vz = 0; }
    }

    if (t.z <= floorH) {
      t.z = floorH;
      body.vz = 0;
      body.grounded = true;
      body.coyote = 0;
      body.landed = true;
      body.fallDistance = body.peakZ - t.z;
    }
  }

  // ---- 6. Eye feel (visual only) -------------------------------------------
  updateEyeFeel(body.feel, dt, body, P);
}
