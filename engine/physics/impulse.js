// engine/physics/impulse.js - US-136 (architecture.md 32.4). Stand-alone: touches
// only the `body` object (components.body), imports nothing.
export const IMPULSE_MAX_H = 12; // m/s; 12*STEP = 0.2 m/step < PHYSICS.radius 0.3 -> moveCapsule/moveCircleMesh never skip a wall
export const IMPULSE_MAX_V = 8;  // m/s; the ceiling clamp in integrate step 5 bounds it

/**
 * Adds a velocity impulse to a capsule body (components.body), same convention
 * as the 30.2 knockback (`body.vx/vy +=`). iz > 0 lifts off: grounded=false,
 * coyote=0, sliding=false, vz=max(vz, min(iz, IMPULSE_MAX_V)). peakZ=footZ when the
 * body was grounded (an already airborne body keeps its higher peak, so no
 * fall damage is lost or invented). Horizontal speed after the add is clamped
 * to IMPULSE_MAX_H. Walls/ceilings stay with `integrate`. Zero alloc.
 * @param {Object} body @param {number} footZ
 * @param {number} ix @param {number} iy @param {number} iz
 */
export function applyImpulse(body, footZ, ix, iy, iz) {
  let vx = (body.vx || 0) + ix, vy = (body.vy || 0) + iy;
  const s2 = vx * vx + vy * vy;
  if (s2 > IMPULSE_MAX_H * IMPULSE_MAX_H) {
    const k = IMPULSE_MAX_H / Math.sqrt(s2);
    vx *= k; vy *= k;
  }
  body.vx = vx; body.vy = vy;
  if (iz > 0) {
    const lift = iz < IMPULSE_MAX_V ? iz : IMPULSE_MAX_V;
    const vz = body.vz || 0;
    body.vz = vz > lift ? vz : lift;
    if (body.grounded !== false) body.peakZ = footZ;
    else if (!(body.peakZ >= footZ)) body.peakZ = footZ;
    body.grounded = false;
    body.coyote = 0;
    body.sliding = false;
  }
}
