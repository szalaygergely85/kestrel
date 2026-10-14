// game/js/quest/sim/sight.js (US-079a, architecture.md 29.1). Thin wrapper over the engine's
// `hasLineOfSight(world, ax,ay,az, bx,by,bz)` (engine/world/interaction.js): that function samples at a fixed 0.1 m
// step, capped at 20 samples per call (LOS_MAX_SAMPLES) - so a single call over more than 2 m (20 * 0.1) already
// under-samples. `canSee` instead walks the segment in <= 5 m chunks (so each chunk's 20 samples land <= 0.25 m
// apart, matching the engine's own per-call cap) and fails fast on the first blocked chunk. No trig, no allocation
// (rule 15): only sqrt (not a trig function) and plain arithmetic.
import { hasLineOfSightRay } from '../../../../engine/index.js';

const CHUNK_M = 5;

/**
 * True if there is an unobstructed line of sight from (ax,ay,az) to (bx,by,bz) through `world` (level walls +
 * outside terrain, via `hasLineOfSight`). Zero allocation.
 * @param {any} world
 * @param {number} ax @param {number} ay @param {number} az
 * @param {number} bx @param {number} by @param {number} bz
 */
export function canSee(world, ax, ay, az, bx, by, bz) {
  const r = SEE_RAY; r[0] = ax; r[1] = ay; r[2] = az; r[3] = bx; r[4] = by; r[5] = bz;
  return canSeeRay(world, r);
}

const SEE_RAY = new Float64Array(6);
const CHUNK_RAY = new Float64Array(6); // NAV-ALLOC-01: chunk endpoints (hasLineOfSightRay input)

/**
 * `canSee` for the per-tick caller (beastSim): `r` = Float64Array [ax,ay,az,bx,by,bz] (7 double args box, arch 38.61 2b).
 * Same chunking and answers. Not re-entrant with itself on `r` = the shared scratch.
 * @param {any} world @param {Float64Array} r
 */
export function canSeeRay(world, r) {
  const ax = r[0], ay = r[1], az = r[2];
  const dx = r[3] - ax, dy = r[4] - ay, dz = r[5] - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= CHUNK_M) return hasLineOfSightRay(world, r);
  const chunks = Math.ceil(dist / CHUNK_M);
  const c = CHUNK_RAY;
  c[3] = ax; c[4] = ay; c[5] = az; // previous chunk end = this chunk start
  for (let i = 1; i <= chunks; i++) {
    const t = i / chunks;
    c[0] = c[3]; c[1] = c[4]; c[2] = c[5];
    c[3] = ax + dx * t; c[4] = ay + dy * t; c[5] = az + dz * t;
    if (!hasLineOfSightRay(world, c)) return false;
  }
  return true;
}
