// engine/physics/swim.js (SWIM-03a, docs/architecture.md 38.54, D-070).
// Swimming branch of `integrate`. Stand-alone: physics never queries the
// world for water. The game writes plain numbers on the body before each
// step: `body.waterZ` (live surface z, NaN = no water) and
// `body.waterFloorZ` (floor under the water at x,y). Outputs on the body:
// `swimming`, `climbedOut` (one step). Diving/onBottom: SWIM-04a.
import { PHYSICS_DEFAULTS } from './config.js';
import { clamp } from '../core/math.js';

/** Defaults for old cfg objects without `swim`. */
export function swimCfg(cfg) { return cfg.swim || PHYSICS_DEFAULTS.swim; }

/** Create the swim fields (called from integrate's ensureScratch). */
export function ensureSwimFields(body) {
  if (typeof body.swimming !== 'boolean') body.swimming = false;
  if (typeof body.diving !== 'boolean') body.diving = false;
  if (typeof body.onBottom !== 'boolean') body.onBottom = false;
  if (typeof body.climbedOut !== 'boolean') body.climbedOut = false;
  if (typeof body.waterZ !== 'number') body.waterZ = NaN;
  if (typeof body.waterFloorZ !== 'number') body.waterFloorZ = NaN;
}

/** True when the game fed a water column this step. */
export function hasWater(body) {
  return body.waterZ === body.waterZ && body.waterFloorZ === body.waterFloorZ;
}

/**
 * Step 1b: enter/leave swimming with hysteresis (38.54 item 2).
 * Returns true if swimming this step.
 */
export function updateSwimState(body, z, P) {
  const S = swimCfg(P);
  body.climbedOut = false;
  if (!hasWater(body)) {
    if (body.swimming) leave(body);
    return false;
  }
  // Feet immersion: from the lower of feet / bed, so a body falling toward
  // deep water only turns swimming on once its feet are really under.
  const imm = body.waterZ - (z > body.waterFloorZ ? z : body.waterFloorZ);
  if (!body.swimming) {
    if (imm > S.swimIn) {
      body.swimming = true;
      body.vz *= 0.3;
      body.grounded = false;
      body.landed = false;
      body.fallDistance = 0;
      body.peakZ = z;
      body.coyote = 0;
      body.sliding = false;
    }
  } else if (imm < S.swimOut && body.waterFloorZ - z <= P.stepUpMax) {
    leave(body);
    body.grounded = true; // step 5 snaps to the floor (within stepUpMax)
  }
  return body.swimming;
}

function leave(body) {
  body.swimming = false;
  body.diving = false;
  body.onBottom = false;
  body.vz = 0;
  body.grounded = false;
}

/**
 * Step 5 replacement while swimming: climb-out, surface lock + buoyancy.
 * `t` = transform, `floorH`/`ceilH` from the support query at the new x,y.
 */
export function swimVertical(body, t, dt, P, floorH, ceilH) {
  const S = swimCfg(P);
  const wz = body.waterZ;
  // Climb-out (item 5): a floor above the feet by more than stepUpMax.
  if (floorH - t.z > P.stepUpMax) {
    if (floorH <= wz + S.climbOut) {
      t.z = floorH;
      body.vz = 0;
      body.grounded = true;
      body.swimming = false;
      body.diving = false;
      body.climbedOut = true;
      body.stepDelta = 0;
      return;
    }
    // Wall: revert the horizontal move.
    t.x = body.prevX;
    t.y = body.prevY;
    body.vx = 0;
    body.vy = 0;
    floorH = body.waterFloorZ; // the floor under the pre-move position (fed)
  }
  const floatZ = wz - S.floatDepth;
  body.vz = clamp((floatZ - t.z) * S.buoyK, -S.buoyMaxV, S.buoyMaxV);
  t.z += body.vz * dt;
  if (t.z < floorH) { t.z = floorH; if (body.vz < 0) body.vz = 0; }
  if (ceilH !== 'sky') {
    const maxZ = ceilH - P.height;
    if (t.z > maxZ) { t.z = maxZ; if (body.vz > 0) body.vz = 0; }
  }
  body.peakZ = t.z;
  body.fallDistance = 0;
}
