// game/js/quest/sim/sight.js (US-079a, architecture.md 29.1). Thin wrapper over the engine's
// `hasLineOfSight(world, ax,ay,az, bx,by,bz)` (engine/world/interaction.js): that function samples at a fixed 0.1 m
// step, capped at 20 samples per call (LOS_MAX_SAMPLES) - so a single call over more than 2 m (20 * 0.1) already
// under-samples. `canSee` instead walks the segment in <= 5 m chunks (so each chunk's 20 samples land <= 0.25 m
// apart, matching the engine's own per-call cap) and fails fast on the first blocked chunk. No trig, no allocation
// (rule 15): only sqrt (not a trig function) and plain arithmetic.
import { hasLineOfSight } from '../../../../engine/index.js';

const CHUNK_M = 5;

/**
 * True if there is an unobstructed line of sight from (ax,ay,az) to (bx,by,bz) through `world` (level walls +
 * outside terrain, via `hasLineOfSight`). Zero allocation.
 * @param {any} world
 * @param {number} ax @param {number} ay @param {number} az
 * @param {number} bx @param {number} by @param {number} bz
 */
export function canSee(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= CHUNK_M) return hasLineOfSight(world, ax, ay, az, bx, by, bz);
  const chunks = Math.ceil(dist / CHUNK_M);
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= chunks; i++) {
    const t = i / chunks;
    const qx = ax + dx * t, qy = ay + dy * t, qz = az + dz * t;
    if (!hasLineOfSight(world, px, py, pz, qx, qy, qz)) return false;
    px = qx; py = qy; pz = qz;
  }
  return true;
}
