// engine/physics/roller.js (US-013, docs/architecture.md 7.4 "Rollers").
//
// Generic rolling-sphere dynamics over `World`/`Level` data: gravity along
// the level's `tilt` layer, rolling friction that decelerates speed toward
// zero without ever reversing it, restitution on a face or corner hit,
// sleep/wake, and non-overlapping contact resolution against a capsule
// actor (the player). Entities: `components.roller` (tuning + rollDist +
// sleep state) + `components.body` (radius, vx/vy/vz, grounded, z = the
// sphere's bottom, capsule-footZ convention, same as `moveSphere`).
//
// No per-step allocation (architecture.md section 9): every scratch object
// below is module-level and reused across all rollers and all steps -
// nothing here returns or captures a fresh object per call.
import { sectorOrOutside } from './capsule.js';
import { moveCapsule } from './capsule.js';
import { moveSphere } from './sphere.js';

const EPS = 1e-9;
const OVERLAP_EPS = 1e-3; // architecture.md 7.4: "if more than 1e-3 m still overlaps"

const _tilt = { x: 0, y: 0 };
const _sphereOpts = { height: 0, stepUpMax: 0 };
const _sphereMove = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };
const _actorOpts = { height: 0, stepUpMax: 0 };
const _actorMove = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };

/** floor(rollDist / (2*PI*radius) * nFrames) mod nFrames, always in [0, nFrames). */
export function rollFrame(rollDist, radius, nFrames) {
  if (!(nFrames > 0)) return 0;
  const circumference = 2 * Math.PI * radius;
  const turns = rollDist / circumference;
  let f = Math.floor(turns * nFrames) % nFrames;
  if (f < 0) f += nFrames;
  return f;
}

function ensureRoller(roller, defaults) {
  if (typeof roller.rollDist !== 'number') roller.rollDist = 0;
  if (typeof roller.sleeping !== 'boolean') roller.sleeping = false;
  if (typeof roller.sleepT !== 'number') roller.sleepT = 0;
  if (typeof roller.restitution !== 'number') roller.restitution = defaults.restitution;
  if (typeof roller.rollFriction !== 'number') roller.rollFriction = defaults.rollFriction;
  if (typeof roller.sleepSpeed !== 'number') roller.sleepSpeed = defaults.sleepSpeed;
}

function ensureBody(body) {
  if (typeof body.vx !== 'number') body.vx = 0;
  if (typeof body.vy !== 'number') body.vy = 0;
  if (typeof body.vz !== 'number') body.vz = 0;
  if (typeof body.grounded !== 'boolean') body.grounded = true;
}

/** Level-local `tiltAt`, resolved through whichever structure (x, y) falls inside; (0, 0) outside any. */
function tiltAt(world, x, y, out) {
  out.x = 0;
  out.y = 0;
  const s = world.structureAt ? world.structureAt(x, y) : null;
  if (s && s.level && s.level.tiltAt) s.level.tiltAt(x - s.origin.x, y - s.origin.y, out);
  return out;
}

/**
 * Advances every `{roller, body}` entity in `world` by one fixed step
 * (architecture.md 7.4 order: called after `integrate(player)`, before
 * `resolveBodyContacts`).
 * @param {import('../world/World.js').World} world
 * @param {number} dtSec
 * @param {Object} cfg - PHYSICS-shaped tuning (engine/physics/config.js): `gravity`, `rollerDefaults`, `rollFrames` (default 8)
 */
export function stepRollers(world, dtSec, cfg) {
  const gravity = (cfg && cfg.gravity) || 0;
  const defaults = (cfg && cfg.rollerDefaults) || {};
  const sleepTime = typeof defaults.sleepTime === 'number' ? defaults.sleepTime : 0.25;
  const nFrames = (cfg && cfg.rollFrames) || 8;

  world.forEachEntity((e) => {
    const roller = e.components && e.components.roller;
    const body = e.components && e.components.body;
    if (!roller || !body) return;
    ensureRoller(roller, defaults);
    ensureBody(body);
    const t = e.transform;

    if (!roller.sleeping) {
      tiltAt(world, t.x, t.y, _tilt);

      // a = g * tilt (friction is applied as a magnitude clamp below, so it
      // can never reverse the velocity it's decelerating).
      body.vx += gravity * _tilt.x * dtSec;
      body.vy += gravity * _tilt.y * dtSec;

      const speed = Math.hypot(body.vx, body.vy);
      if (speed > EPS) {
        const newSpeed = Math.max(0, speed - roller.rollFriction * dtSec);
        const scale = newSpeed / speed;
        body.vx *= scale;
        body.vy *= scale;
      }

      // ---- horizontal: moveSphere against the grid, stepUpMax 0 ----------
      const x0 = t.x, y0 = t.y;
      const moved = moveSphere(world, t.x, t.y, body.vx * dtSec, body.vy * dtSec, body.radius, t.z, _sphereOpts, _sphereMove);
      t.x = moved.x;
      t.y = moved.y;

      // Face hit: v_axis = -e * v_axis. Corner hit: reflect the normal
      // component with restitution e.
      if (moved.blockedX) body.vx = -roller.restitution * body.vx;
      if (moved.blockedY) body.vy = -roller.restitution * body.vy;
      if (moved.nx || moved.ny) {
        const vn = body.vx * moved.nx + body.vy * moved.ny;
        if (vn < 0) {
          body.vx -= (1 + roller.restitution) * vn * moved.nx;
          body.vy -= (1 + roller.restitution) * vn * moved.ny;
        }
      }

      const dx = t.x - x0, dy = t.y - y0;
      const distMoved = Math.hypot(dx, dy);
      if (distMoved > EPS) {
        roller.rollDist += distMoved;
        // Compass heading of the motion (0 = north = -y, 90 = east = +x, clockwise).
        t.yawDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
      }
      const sprite = e.components.sprite;
      if (sprite) {
        sprite.frame = rollFrame(roller.rollDist, body.radius, nFrames);
        sprite.playing = false;
      }

      // ---- sleep: slow, and friction can hold this spot, for sleepTime ---
      // "Tilt 0" (architecture.md 7.4) means the friction available here can
      // fully cancel the tilt-driven acceleration every step, not literal
      // zero tilt: a sink cell (Level.tiltAt) tapers to zero only exactly at
      // its centre, so a discrete simulation settles NEAR that point, never
      // exactly on it, and gating sleep on a float-zero tilt would never
      // fire there - the boulder would sit at v = 0 (friction already wins
      // the tug-of-war every step, see below) yet never be marked asleep. A
      // full-grade ramp cell is `gravity*grade > rollFriction` by design
      // ("the tilt only keeps it rolling", tower_layout.md 5) and so is
      // correctly never sleep-eligible either way.
      const speedNow = Math.hypot(body.vx, body.vy);
      const tiltMag = Math.hypot(_tilt.x, _tilt.y);
      if (body.grounded && speedNow < roller.sleepSpeed && gravity * tiltMag < roller.rollFriction) {
        roller.sleepT += dtSec;
        if (roller.sleepT >= sleepTime) {
          body.vx = 0;
          body.vy = 0;
          roller.sleeping = true;
          roller.sleepT = 0;
        }
      } else {
        roller.sleepT = 0;
      }
    }

    // ---- vertical: 7.1 step 5 pattern, stepUpMax 0 (drops fall and land) ---
    const sector = sectorOrOutside(world, t.x, t.y);
    const floorH = sector.floorH;
    if (body.grounded) {
      const floorDiff = floorH - t.z;
      if (Math.abs(floorDiff) <= EPS) {
        t.z = floorH;
        body.vz = 0;
      } else {
        body.grounded = false;
        body.vz = 0;
      }
    }
    if (!body.grounded) {
      body.vz -= gravity * dtSec;
      t.z += body.vz * dtSec;
      if (sector.ceilH !== 'sky') {
        const maxZ = sector.ceilH - body.radius * 2;
        if (t.z > maxZ) { t.z = maxZ; if (body.vz > 0) body.vz = 0; }
      }
      if (t.z <= floorH) {
        t.z = floorH;
        body.vz = 0;
        body.grounded = true;
      }
    }
  });
}

/**
 * Actor capsule vs every roller: horizontal circle-vs-circle, only when the
 * z ranges overlap. `n = unit(actor - roller)`. Pushing into a roller at
 * >= `cfg.pushMinSpeed` wakes it and gives it that speed along -n; the
 * actor gets `body.speedScale = cfg.pushSpeedScale` for the next step
 * (`1` otherwise - reset here every call, architecture.md 7.4). Separation
 * always runs when overlapping (independent of the push threshold): the
 * roller is moved out along -n, then any remaining overlap is moved out of
 * the actor along +n; if more than `OVERLAP_EPS` still overlaps, the actor
 * is restored to its step-start x, y (non-overlapping by induction) and its
 * velocity component toward the roller is zeroed.
 * @param {import('../world/World.js').World} world
 * @param {Object} actor - plain entity data (the player): `transform`, `components.body`
 * @param {Object} cfg - PHYSICS-shaped tuning: `pushMinSpeed`, `pushSpeedScale`, `height`, `stepUpMax`
 */
export function resolveBodyContacts(world, actor, cfg) {
  const actorBody = actor.components && actor.components.body;
  if (!actorBody) return;
  actorBody.speedScale = 1;

  const pushMinSpeed = (cfg && cfg.pushMinSpeed) || 0;
  const pushSpeedScale = typeof (cfg && cfg.pushSpeedScale) === 'number' ? cfg.pushSpeedScale : 1;
  const actorHeight = (cfg && cfg.height) || 0;
  const actorStepUpMax = (cfg && cfg.stepUpMax) || 0;

  const at = actor.transform;
  // US-013 ARCH CHANGES #1: `integrate` records the true pre-step position in
  // `body.prevX/prevY` (this call's `at.x/y` are already post-`integrate`, so
  // they cannot serve as the "step-start" the 7.4 induction argument needs).
  const startX = actorBody.prevX, startY = actorBody.prevY;

  world.forEachEntity((e) => {
    const roller = e.components && e.components.roller;
    const body = e.components && e.components.body;
    if (!roller || !body) return;
    const t = e.transform;

    const actorZ0 = at.z, actorZ1 = at.z + actorHeight;
    const rollerZ0 = t.z, rollerZ1 = t.z + body.radius * 2;
    if (actorZ1 <= rollerZ0 || actorZ0 >= rollerZ1) return; // no vertical overlap

    const dx = at.x - t.x, dy = at.y - t.y;
    const dist = Math.hypot(dx, dy);
    const minSep = actorBody.radius + body.radius;
    if (dist >= minSep) return; // not touching
    if (dist < EPS) return; // degenerate (exactly coincident) - defensive, should not happen

    const nx = dx / dist, ny = dy / dist; // unit(actor - roller)

    // ---- push: actor velocity INTO the roller (along -n) ------------------
    const vIntoRoller = actorBody.vx * -nx + actorBody.vy * -ny;
    if (vIntoRoller >= pushMinSpeed) {
      const vn = body.vx * -nx + body.vy * -ny;
      const newVn = Math.max(vn, vIntoRoller);
      const deltaVn = newVn - vn;
      body.vx += deltaVn * -nx;
      body.vy += deltaVn * -ny;
      roller.sleeping = false;
      roller.sleepT = 0;
      actorBody.speedScale = pushSpeedScale;
    }

    // ---- separation: roller out along -n, then actor out along +n ---------
    const overlap = minSep - dist;
    const rollerMoved = moveSphere(world, t.x, t.y, -nx * overlap, -ny * overlap, body.radius, t.z, _sphereOpts, _sphereMove);
    t.x = rollerMoved.x;
    t.y = rollerMoved.y;

    const newDist = Math.hypot(at.x - t.x, at.y - t.y);
    const remaining = minSep - newDist;
    if (remaining > OVERLAP_EPS) {
      _actorOpts.height = actorHeight;
      _actorOpts.stepUpMax = actorStepUpMax;
      const actorMoved = moveCapsule(world, at.x, at.y, nx * remaining, ny * remaining, actorBody.radius, at.z, actorBody.grounded, _actorOpts, _actorMove);
      at.x = actorMoved.x;
      at.y = actorMoved.y;

      const finalDist = Math.hypot(at.x - t.x, at.y - t.y);
      if (minSep - finalDist > OVERLAP_EPS) {
        // Squeezed: restore the actor to its step-start position (proven
        // non-overlapping by induction) and zero its velocity toward the roller.
        at.x = startX;
        at.y = startY;
        const vn2 = actorBody.vx * nx + actorBody.vy * ny;
        if (vn2 < 0) {
          actorBody.vx -= vn2 * nx;
          actorBody.vy -= vn2 * ny;
        }
      }
    }
  });
}
