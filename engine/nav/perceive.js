// AI-PERCEIVE-01 (US-085 slice): pure sight + hearing + leash. No allocation, no globals;
// not wired into beastSim yet (lane C BEAST-PERCEIVE-01w). Leaf module: imports nothing.
//
// agent  = { x, z, fx, fz (unit facing), halfAngle (rad), range, hearR, homeX, homeZ, homeR }
// target = { x, z, noise }   noise = hearing multiplier (1 idle, NOISE_SPRINT, NOISE_SWING)
// losFn(ax, az, tx, tz) -> boolean (game passes sight.canSee); missing = always clear.
// out    = { sees, hears, dist, returnHome } (reused, returned). Leash: agent farther than
//          homeR from home -> returnHome = true (caller steers home); senses stay honest.

export const NOISE_SPRINT = 2;
export const NOISE_SWING = 1.5;

export function perceive(agent, target, losFn, out) {
  const dx = target.x - agent.x, dz = target.z - agent.z;
  const d2 = dx * dx + dz * dz;
  const dist = Math.sqrt(d2);
  out.dist = dist;
  // hearing: radius scaled by noise, no LOS needed
  const hr = agent.hearR * (target.noise === undefined ? 1 : target.noise);
  out.hears = d2 <= hr * hr;
  // sight: range, cone (dot >= cos(halfAngle), edge inclusive), then LOS
  let sees = false;
  if (d2 <= agent.range * agent.range) {
    if (d2 < 1e-12) sees = true;
    else sees = (dx * agent.fx + dz * agent.fz) / dist >= Math.cos(agent.halfAngle) - 1e-9;
    if (sees && losFn && !losFn(agent.x, agent.z, target.x, target.z)) sees = false;
  }
  out.sees = sees;
  const hx = agent.x - agent.homeX, hz = agent.z - agent.homeZ;
  out.returnHome = agent.homeR > 0 && hx * hx + hz * hz > agent.homeR * agent.homeR;
  return out;
}
