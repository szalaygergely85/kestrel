// AI-LEASH-01 (US-085 slice): pure home area + leash state machine. No allocation, no globals;
// not wired into beastSim yet (lane C). Leaf module: imports nothing. Pairs with perceive.js.
//
// def   = { homeX, homeZ, homeR (calm radius: "at home"), leashR (> homeR: hard leash),
//           aggroR (engage distance to target), loseScale (>1, default 1.25: drop target at
//           aggroR*loseScale), returnSpeed (speed scale while going home), giveUpT (s engaged) }
// agent = { x, z, leashMode (int, init LEASH_HOME), leashT (s engaged, init 0) }  - mutated.
// target= { x, z }
// Hysteresis: HOME->ENGAGE needs target within aggroR AND agent within homeR; ENGAGE ends at
// aggroR*loseScale or past leashR; RETURN/GIVEUP ignore the target until back within homeR.

export const LEASH_HOME = 0, LEASH_ENGAGE = 1, LEASH_RETURN = 2, LEASH_GIVEUP = 3;

export function leashState(agent, def, target, dt) {
  const hx = agent.x - def.homeX, hz = agent.z - def.homeZ;
  const h2 = hx * hx + hz * hz;
  const tx = target.x - agent.x, tz = target.z - agent.z;
  const t2 = tx * tx + tz * tz;
  let m = agent.leashMode;
  if (m === LEASH_RETURN || m === LEASH_GIVEUP) {
    if (h2 <= def.homeR * def.homeR) { m = LEASH_HOME; agent.leashT = 0; }
  } else if (m === LEASH_ENGAGE) {
    const lose = def.aggroR * (def.loseScale === undefined ? 1.25 : def.loseScale);
    agent.leashT += dt;
    if (agent.leashT > def.giveUpT) m = LEASH_GIVEUP;
    else if (h2 > def.leashR * def.leashR || t2 > lose * lose) m = LEASH_RETURN;
  } else { // HOME
    if (t2 <= def.aggroR * def.aggroR && h2 <= def.homeR * def.homeR) { m = LEASH_ENGAGE; agent.leashT = 0; }
  }
  agent.leashMode = m;
  return m;
}

// Steering goal for RETURN / GIVEUP: home point + speed scale. Fills and returns `out` {x, z, speed}.
export function returnTarget(def, out) {
  out.x = def.homeX; out.z = def.homeZ; out.speed = def.returnSpeed;
  return out;
}
