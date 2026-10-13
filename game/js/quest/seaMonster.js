// SWIM-06b (D-070, architecture.md 38.54): sea monster state machine. hidden -> circle (warn band) -> rise (kill band) -> strike
// -> vitals.kill('eaten'). Integer step timers, no Math.random, edge check at 4 Hz (every 15th step), 0 alloc per step.
// Pure logic: the entity (id 'seaMonster', clips circle/rise/strike) is optional; without it only the state machine runs.
import { createSeaEdgeOut, seaEdgeState } from './seaEdge.js';

export const SEA_MONSTER_ID = 'seaMonster';
export const SEA_MONSTER_CONFIG = {
  checkEvery: 15,      // steps between edge checks (4 Hz at 60 Hz)
  orbitR: 12,          // m from the player while circling (10-14)
  orbitRad: 0.6,       // rad/s
  orbitWobble: 2,      // +-m radius wobble
  circleDepth: 1.0,    // z = surfaceZ - this while circling (only the back/fin shows)
  riseSteps: 48,       // 0.8 s
  riseTopM: 1.5,       // above the surface at the top of the rise
  frontM: 3,           // distance in front of the player when rising
  strikeSteps: 36,     // 0.6 s after the rise: kill
  rippleEvery: 30,     // steps (0.5 s)
  hideZ: -500,
};
export const HIDDEN = 0, CIRCLE = 1, RISE = 2, STRIKE = 3;
const NAMES = ['hidden', 'circle', 'rise', 'strike'];

/** Entity def to place once in world data (parked). Model 'seaMonster' comes from the designer. */
export function seaMonsterEntityDef(x, y, hideZ = SEA_MONSTER_CONFIG.hideZ) {
  return { id: SEA_MONSTER_ID, type: 'seaMonster', x, y, z: hideZ };
}

/**
 * @param {{kill:Function, dead:boolean}} vitals
 * @param {object} shore createShore(coast)
 * @param {{ent?:object, ripples?:{add:Function}, cfg?:object}} [opts] ent = world entity data (transform {x,y,z}); optional
 */
export function createSeaMonster(vitals, shore, opts = {}) {
  const cfg = opts.cfg || SEA_MONSTER_CONFIG, ripples = opts.ripples || null;
  const edge = createSeaEdgeOut(), pos = { x: 0, y: 0 };
  const m = { state: HIDDEN, name: 'hidden', ent: opts.ent || null, edge, x: 0, y: 0, z: cfg.hideZ, clip: null };
  let n = 0, timer = 0, ang = 0, fx = 1, fy = 0;

  function set(s) { m.state = s; m.name = NAMES[s]; timer = 0; }
  function apply() {
    const e = m.ent, t = e && e.transform;
    if (t) { t.x = m.x; t.y = m.y; t.z = m.z; }
    if (e && m.clip) e.clip = m.clip;
  }
  function park() { set(HIDDEN); m.z = cfg.hideZ; m.clip = null; edge.state = 0; apply(); }

  /** Respawn / world load. */
  m.reset = function reset() { n = 0; ang = 0; park(); };

  /**
   * One fixed step (1/60). p = { x, y, swimming, inSea, surfaceZ } (inSea = waterAt(...).region === 'sea'); simTime seconds.
   * Returns the state index.
   */
  m.step = function step(p, simTime) {
    if (vitals.dead) { if (m.state !== HIDDEN) park(); return m.state; }
    n++;
    if (m.state !== STRIKE && n % cfg.checkEvery === 0) {
      let lvl = 0;
      if (p.swimming && p.inSea) { pos.x = p.x; pos.y = p.y; lvl = seaEdgeState(pos, shore, edge, cfg.edge).state; } else edge.state = 0;
      if (lvl === 0) { if (m.state !== HIDDEN) park(); }
      else if (m.state === HIDDEN) { set(CIRCLE); m.clip = 'circle'; }
      else if (m.state === CIRCLE && lvl === 2) {
        const dx = edge.spawnX - p.x, dy = edge.spawnY - p.y, l = Math.hypot(dx, dy) || 1;
        fx = dx / l; fy = dy / l; set(RISE); m.clip = 'rise';
      }
    }
    const s = m.state;
    if (s === CIRCLE) {
      timer++; ang += cfg.orbitRad / 60;
      const r = cfg.orbitR + cfg.orbitWobble * Math.sin(timer * 0.021);
      m.x = p.x + Math.cos(ang) * r; m.y = p.y + Math.sin(ang) * r; m.z = p.surfaceZ - cfg.circleDepth;
      if (ripples && timer % cfg.rippleEvery === 0) ripples.add(m.x, m.y, 0.6, simTime);
    } else if (s === RISE || s === STRIKE) {
      timer++;
      m.x = p.x + fx * cfg.frontM; m.y = p.y + fy * cfg.frontM;
      if (s === RISE) {
        const k = timer / cfg.riseSteps;
        m.z = p.surfaceZ - cfg.circleDepth + (cfg.circleDepth + cfg.riseTopM) * (k > 1 ? 1 : k);
        if (timer >= cfg.riseSteps) { set(STRIKE); m.clip = 'strike'; }
      } else if (timer >= cfg.strikeSteps) {
        vitals.kill('eaten'); // dead next step -> parked
      }
    }
    if (s !== HIDDEN) apply();
    return m.state;
  };
  m.reset();
  return m;
}

// NEEDS B1-main: (1) after the world loads: `const sm = createSeaMonster(vitals, createShore(world_geo.coast), { ent: world.get('seaMonster')?.data, ripples })`
//   with `seaMonsterEntityDef(x, y)` placed once out at sea in the world data (needs the designer's model id 'seaMonster'; skip if not registered);
//   (2) once per fixed step after the swim feed: `sm.step({ x, y, swimming: body.swimming, inSea: waterAt(x,y).region === 'sea', surfaceZ }, simTime)`;
//   (3) on respawn/world load: `sm.reset()`.
