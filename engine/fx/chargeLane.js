// engine/fx/chargeLane.js (TELEGRAPH-GROUND-01): pure shape generator for a ground telegraph lane
// (a rectangle from an attacker along its facing). Params only, no entity knowledge. Not wired yet.
// Callers pass length = speed * maxSec (e.g. 7 m/s * 1.2 s = 8.4 m).
export const LANE_CELL_M = 0.5;      // default decal cell size (no engine-wide ground cell constant exists)
export const LANE_ALPHA_MAX = 0.8;

/**
 * Fill `out` with [dx, dz] integer cell offsets (relative to the cell containing (x,z)) of every grid cell
 * whose centre lies in the rectangle: forward 0..length, sideways +-width/2. Forward = (sin yaw, cos yaw).
 * Returns the cell count n (out holds 2n ints; truncated to out.length/2). No allocation.
 */
export function laneCells(x, z, yaw, length, width, out, cellM = LANE_CELL_M) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), hw = width * 0.5;
  const ox = Math.floor(x / cellM), oz = Math.floor(z / cellM);
  const ex = Math.abs(fx) * length + Math.abs(fz) * hw, ez = Math.abs(fz) * length + Math.abs(fx) * hw;
  const x0 = Math.floor((x - ex) / cellM), x1 = Math.floor((x + ex) / cellM);
  const z0 = Math.floor((z - ez) / cellM), z1 = Math.floor((z + ez) / cellM);
  const cap = out.length >> 1, eps = 1e-9;
  let n = 0;
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const dx = (ix + 0.5) * cellM - x, dz = (iz + 0.5) * cellM - z;
      const u = dx * fx + dz * fz, v = dx * fz - dz * fx;
      if (u < -eps || u > length + eps || Math.abs(v) > hw - eps) continue;
      if (n >= cap) return n;
      out[n * 2] = ix - ox; out[n * 2 + 1] = iz - oz; n++;
    }
  }
  return n;
}

/** Telegraph alpha: linear 0 -> 0.8 over the windup, 0 outside (before start / after windup). */
export function laneAlpha(tMs, windupSec) {
  const w = windupSec * 1000;
  if (!(w > 0) || tMs < 0 || tMs >= w) return 0;
  return LANE_ALPHA_MAX * (tMs / w);
}
