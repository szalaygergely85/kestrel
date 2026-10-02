// game/js/quest/sim/beastSim.js (US-079a, architecture.md 29.1). The beast brain: a flat SoA state machine
// (wander/notice/chase/windup/charge/recover/return) driven over an RE-05 NavGrid + A* path and RE-09 steering.
// Rule 15 (this whole sim/** tree): no Math.random, no trig (sin/cos/atan2), no wall clock, no Map iteration inside
// `step()`, integer step-count timers only (seconds are converted once at create via `beastConfig.toSteps`). Facing
// is a stored unit vector (fx, fy) derived by vector-normalise (sqrt, not trig); turning that into a yaw angle for
// rendering is `beastView.js`'s job, the one place trig is allowed (29.1).
//
// Position lives in the RE-09 steer SoA (steer.x/steer.y), not duplicated here - this file only adds the fields
// the state machine itself needs (29.1's field list). z is written straight into `entity.transform.z` every step
// from `world.supportAt` (the beast always stands on the ground/mesh, no vertical physics).
import { createAStar, findPath, smoothPath, createSteer, PHYSICS, SIM_STEP } from '../../../../engine/index.js';
import { BEAST_DEFAULTS, toSteps } from './beastConfig.js';
import { canSee } from './sight.js';

export const MAX_BEASTS = 16;
const PATH_SLOTS = 64; // waypoints kept per beast path (truncated, final = the exact goal - see `storePath`)

// ---- states -----------------------------------------------------------------------------------------------------
export const STATE_WANDER = 0;
export const STATE_NOTICE = 1;
export const STATE_CHASE = 2;
export const STATE_WINDUP = 3;
export const STATE_CHARGE = 4;
export const STATE_RECOVER = 5;
export const STATE_RETURN = 6;
export const STATE_STAGGER = 7; // US-078d amendment (D-034) "Stagger (beastSim, heavy only)"

const WALKING = -1; // sentinel for `timer` in STATE_WANDER: "currently walking to a chosen point" (not pausing)

// Tuning not in the AC's numbered list (architect note 29.1 does not pin these down - see the programmer's report
// "deviations" for why they exist): a default steer accel for everything except the charge sprint, and the A*
// `maxNodes` split between a short wander hop and a full chase/return path.
const DEFAULT_ACCEL = 12;   // m/s^2
const CHARGE_ACCEL = 70;    // m/s^2 (29.1 "Charge: waypoint pos + cd*20, accel 70")
const WANDER_MAX_NODES = 500;
const TRAVEL_MAX_NODES = 3000;
const WAYPOINT_ARRIVE = 0.5;     // m, setWaypoint's slow-down radius (29.1 step 4)
const WAYPOINT_ADVANCE_D2 = 0.36; // m^2 (0.6 m, 29.1 step 4 "advance to the next one within 0.6 m")
const CONTACT_PAD = 0.1;         // m (29.1 step 6 "dist2D <= radius + PHYSICS.radius + 0.1")
const WALL_SPEED_FRAC = 0.35;    // 29.1 step 6 "moved < 0.35*charge*STEP on 2 steps in a row = wall"
const WALL_STREAK = 2;

/**
 * @param {any} world engine World (terrain + structures; also the LOS/supportAt surface)
 * @param {{nav: {grid:any, astar:any}, rng: any, events: any, cfg?: Partial<typeof BEAST_DEFAULTS>}} opts
 * @returns {null | ReturnType<typeof buildSim>} `null` if no entity in `world` has `components.brain.kind === 'beast'`
 */
export function createBeastSim(world, opts) {
  const { nav, rng, events } = opts;
  const cfg = opts.cfg ? { ...BEAST_DEFAULTS, ...opts.cfg } : BEAST_DEFAULTS;

  /** @type {any[]} plain entity data objects, gathered once (rule 15: no Map iteration inside step()). */
  const beastEntities = [];
  world.forEachEntity((e) => {
    if (e.components && e.components.brain && e.components.brain.kind === 'beast') beastEntities.push(e);
  });
  if (beastEntities.length === 0) return null;

  const count = Math.min(beastEntities.length, MAX_BEASTS);
  if (beastEntities.length > MAX_BEASTS) {
    console.warn(`createBeastSim: ${beastEntities.length} beast entities, only the first ${MAX_BEASTS} get a brain.`);
  }

  // Q9 item 4 nit: a world with beast entities but no `nav` block (main.js only builds one when `worldDef.nav`
  // exists) used to throw on `nav.grid` below instead of just skipping the brain, same "no brain = no beasts in
  // this world" precedent as the `beastEntities.length === 0` early return above.
  if (!nav || !nav.grid) {
    console.warn('createBeastSim: beast entities present but no nav grid - skipping (no brain for this world).');
    return null;
  }

  const grid = nav.grid;
  const astar = nav.astar || createAStar(grid);
  const steer = createSteer({
    maxAgents: MAX_BEASTS,
    bounds: { x0: grid.x0, y0: grid.y0, w: grid.w * grid.cell, h: grid.h * grid.cell },
  });

  const sim = {
    world, grid, astar, steer, rng, events, cfg,
    cfgSteps: {
      pauseMin: toSteps(cfg.pauseMin),
      pauseMax: toSteps(cfg.pauseMax),
      notice: toSteps(cfg.noticeSec),
      windup: toSteps(cfg.windupSec),
      chargeMax: toSteps(cfg.chargeMaxSec),
      recover: toSteps(cfg.recoverSec),
      recoverWall: toSteps(cfg.recoverWallSec),
      loseSight: toSteps(cfg.loseSightSec),
      repath: toSteps(cfg.repathSec),
      stagger: toSteps(cfg.staggerSec), // US-078d amendment (D-034)
    },
    count,
    entities: beastEntities.slice(0, count),
    ids: beastEntities.slice(0, count).map((e) => e.id),

    state: new Uint8Array(MAX_BEASTS),
    timer: new Int32Array(MAX_BEASTS),
    unseen: new Int32Array(MAX_BEASTS), // also reused as the charge wall-slow streak counter (charge never needs "unseen")
    repathT: new Int32Array(MAX_BEASTS),
    homeX: new Float64Array(MAX_BEASTS),
    homeY: new Float64Array(MAX_BEASTS),
    fx: new Float64Array(MAX_BEASTS),
    fy: new Float64Array(MAX_BEASTS),
    cdx: new Float64Array(MAX_BEASTS),
    cdy: new Float64Array(MAX_BEASTS),
    goalX: new Float64Array(MAX_BEASTS),
    goalY: new Float64Array(MAX_BEASTS),
    prevX: new Float64Array(MAX_BEASTS),
    prevY: new Float64Array(MAX_BEASTS),
    path: new Float64Array(MAX_BEASTS * PATH_SLOTS * 2),
    pathLen: new Int32Array(MAX_BEASTS),
    pathIdx: new Int32Array(MAX_BEASTS),
    seen: new Uint8Array(MAX_BEASTS),
    pathReq: new Uint8Array(MAX_BEASTS),

    tick: 0,
    lastServed: -1,
    stats: { astar: 0, astarNodes: 0 },

    // Scratch (zero allocation after create): findPath's `outPath` must hold >= grid.w*grid.h entries (astar.js
    // contract); smoothPath's output is at most that many waypoints before truncation to PATH_SLOTS.
    _cellPath: new Int32Array(grid.w * grid.h),
    _xy: new Float64Array(grid.w * grid.h * 2),
    _hitPayload: beastEntities.slice(0, count).map((e) => ({ source: e.id, target: 'player', damage: 1 })),
  };

  for (let i = 0; i < count; i++) {
    const e = sim.entities[i];
    const home = (e.components.brain && e.components.brain.home) || [e.transform.x, e.transform.y];
    sim.homeX[i] = home[0];
    sim.homeY[i] = home[1];
    sim.fx[i] = 0; sim.fy[i] = -1; // facing north by default
    sim.state[i] = STATE_WANDER;
    sim.timer[i] = sim.cfgSteps.pauseMin; // short initial pause before the first wander leg
    steer.addAgent(e.transform.x, e.transform.y, cfg.radius, 0, DEFAULT_ACCEL);
  }

  // US-078d amendment (D-034) "Stagger (beastSim, heavy only)": one `combat:hit` listener registered at create,
  // id -> slot via a prebuilt plain-object lookup (no Map iteration in step()). Enters STATE_STAGGER from ANY
  // state on a heavy hit. `events` is one persistent instance for the whole run (main.js never recreates it on a
  // world reload, unlike `world`) - so, same precedent as `targeting.dispose()`/`vitals.dispose()`, this sim
  // exposes `dispose()` and the caller MUST drop the old sim's listener before creating the next one on a world
  // reload (flagged in the programmer report's main.js wiring section - this file alone cannot add that line).
  const idSlot = {};
  for (let i = 0; i < count; i++) idSlot[sim.ids[i]] = i;
  function onCombatHit(p) {
    if (!p || !p.heavy) return;
    const i = idSlot[p.target];
    if (i === undefined) return;
    enterStagger(sim, i, p.dirX, p.dirY);
  }
  const offCombatHit = events.on('combat:hit', onCombatHit);

  sim.step = function step(px, py, pz) { stepSim(sim, px, py, pz); };
  sim.dispose = function dispose() { offCombatHit(); };
  sim.hashInto = function hashInto(h) { hashSim(sim, h); };
  sim.save = function save() { return saveSim(sim); };
  sim.load = function load(obj) { loadSim(sim, obj); };
  /** US-080a1: every slot back to home, state wander, timers/paths cleared, steer positions reset. */
  sim.resetAll = function resetAll() { resetAllSim(sim); };

  return sim;
}

// ---- step pipeline (29.1 "Fixed-step order inside step") ----------------------------------------------------

function stepSim(sim, px, py, pz) {
  const n = sim.count;
  for (let i = 0; i < n; i++) perceiveOne(sim, i, px, py, pz);
  for (let i = 0; i < n; i++) transitionOne(sim, i, px, py);
  updatePathRequests(sim, px, py);
  servePathRequest(sim, px, py);
  for (let i = 0; i < n; i++) setSteerTarget(sim, i);
  sim.steer.step(SIM_STEP, sim.grid);
  for (let i = 0; i < n; i++) postOne(sim, i, px, py, pz);
  sim.tick++;
}

function perceiveOne(sim, i, px, py, pz) {
  const steer = sim.steer, cfg = sim.cfg;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d2 = dx * dx + dy * dy;
  const loseR2 = cfg.loseR * cfg.loseR;
  if (d2 > loseR2) {
    sim.seen[i] = 0;
  } else if (sim.tick % cfg.losEvery === i % cfg.losEvery) {
    const bz = pz; // ground z of the player is close enough to feet; targetZ offset below is what matters
    const ok = canSee(
      sim.world,
      steer.x[i], steer.y[i], zOf(sim, i) + cfg.eyeZ,
      px, py, bz + cfg.targetZ,
    ) ? 1 : 0;
    sim.seen[i] = ok;
    sim.unseen[i] = ok ? 0 : sim.unseen[i] + cfg.losEvery;
  }
}

/** The beast's current rendered z (read back from its entity transform - the sim's own authoritative z store). */
function zOf(sim, i) {
  return sim.entities[i].transform.z;
}

function noticedOf(sim, i, px, py) {
  const steer = sim.steer, cfg = sim.cfg;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d2 = dx * dx + dy * dy;
  if (d2 <= cfg.nearR * cfg.nearR) return true;
  if (d2 > cfg.noticeR * cfg.noticeR) return false;
  if (!sim.seen[i]) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-9) return true;
  const dot = (dx / d) * sim.fx[i] + (dy / d) * sim.fy[i];
  return dot >= cfg.coneCos;
}

function transitionOne(sim, i, px, py) {
  switch (sim.state[i]) {
    case STATE_WANDER: wanderStep(sim, i, px, py); break;
    case STATE_NOTICE: noticeStep(sim, i); break;
    case STATE_CHASE: checkChaseExit(sim, i, px, py); break;
    case STATE_WINDUP: windupStep(sim, i, px, py); break;
    case STATE_CHARGE: /* handled in postOne (needs the post-steer position) */ break;
    case STATE_RECOVER: recoverStep(sim, i, px, py); break;
    case STATE_RETURN: returnStep(sim, i, px, py); break;
    case STATE_STAGGER: staggerStep(sim, i); break;
    default: break;
  }
}

function staggerStep(sim, i) {
  sim.timer[i]--;
  if (sim.timer[i] <= 0) { if (sim.seen[i]) enterChase(sim, i); else enterReturn(sim, i); }
}

function wanderStep(sim, i, px, py) {
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  if (sim.timer[i] === WALKING) return; // following a path; arrival is handled by updatePathRequests/postOne
  sim.timer[i]--;
  if (sim.timer[i] <= 0) pickWanderTarget(sim, i);
}

function pickWanderTarget(sim, i) {
  const cfg = sim.cfg, grid = sim.grid, rng = sim.rng;
  const hx = sim.homeX[i], hy = sim.homeY[i];
  let gx = hx, gy = hy;
  for (let draw = 0; draw < 8; draw++) {
    const cx = hx + (rng.nextFloat() * 2 - 1) * cfg.wanderR;
    const cy = hy + (rng.nextFloat() * 2 - 1) * cfg.wanderR;
    const ddx = cx - hx, ddy = cy - hy;
    if (ddx * ddx + ddy * ddy > cfg.wanderR * cfg.wanderR) continue;
    const gcx = grid.cellX(cx), gcy = grid.cellY(cy);
    if (!grid.inBounds(gcx, gcy) || grid.cost[grid.index(gcx, gcy)] === 0) continue;
    gx = cx; gy = cy;
    break;
  }
  sim.goalX[i] = gx; sim.goalY[i] = gy;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.pathReq[i] = 1;
  sim.timer[i] = WALKING;
}

function noticeStep(sim, i) {
  sim.timer[i]--;
  if (sim.timer[i] <= 0) enterChase(sim, i);
}

function checkChaseExit(sim, i, px, py) {
  const cfg = sim.cfg, steer = sim.steer;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d2 = dx * dx + dy * dy;
  if (d2 <= cfg.windupR * cfg.windupR && sim.seen[i]) { enterWindup(sim, i); return; }
  if (d2 > cfg.loseR * cfg.loseR || sim.unseen[i] >= sim.cfgSteps.loseSight) enterReturn(sim, i);
}

function windupStep(sim, i, px, py) {
  void px; void py;
  sim.timer[i]--;
  if (sim.timer[i] <= 0) enterCharge(sim, i, px, py);
}

function recoverStep(sim, i, px, py) {
  void px; void py;
  sim.timer[i]--;
  if (sim.timer[i] <= 0) {
    enterChase(sim, i);
    checkChaseExit(sim, i, px, py); // 29.1: "chase's lose checks apply on its first step"
  }
}

function returnStep(sim, i, px, py) {
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  const dx = sim.homeX[i] - sim.steer.x[i], dy = sim.homeY[i] - sim.steer.y[i];
  if (dx * dx + dy * dy <= sim.cfg.homeArriveR * sim.cfg.homeArriveR) enterWander(sim, i);
}

// ---- state entry ------------------------------------------------------------------------------------------------

function enterNotice(sim, i) {
  sim.state[i] = STATE_NOTICE;
  sim.timer[i] = sim.cfgSteps.notice;
}

function enterChase(sim, i) {
  sim.state[i] = STATE_CHASE;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.repathT[i] = 0;
  sim.unseen[i] = 0;
  sim.pathReq[i] = 0; // (re)requested by updatePathRequests this same tick, since pathLen === 0
}

function enterWindup(sim, i) {
  sim.state[i] = STATE_WINDUP;
  sim.timer[i] = sim.cfgSteps.windup;
}

function enterCharge(sim, i, px, py) {
  const steer = sim.steer;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d = Math.sqrt(dx * dx + dy * dy);
  sim.cdx[i] = d > 1e-9 ? dx / d : sim.fx[i];
  sim.cdy[i] = d > 1e-9 ? dy / d : sim.fy[i];
  sim.state[i] = STATE_CHARGE;
  sim.timer[i] = sim.cfgSteps.chargeMax;
  sim.unseen[i] = 0; // reused as the wall-slow streak counter for the duration of the charge
  steer.accel[i] = CHARGE_ACCEL;
}

function enterRecover(sim, i, wall) {
  sim.state[i] = STATE_RECOVER;
  sim.timer[i] = wall ? sim.cfgSteps.recoverWall : sim.cfgSteps.recover;
  sim.steer.accel[i] = DEFAULT_ACCEL;
}

/** US-078d amendment (D-034): a heavy sword hit staggers the beast from ANY state (interrupts windup/charge - the
 * charge wall-slow streak counter, `unseen`, is reused and so must be cleared here too, same field `enterCharge`
 * resets). `steer.vx/vy` is ASSIGNED (not added) to the knockback direction * `staggerKnock`; `setSteerTarget`'s
 * STAGGER branch gives `maxSpeed = staggerKnock` so the steer clamp keeps the shove, which then decays by
 * `DEFAULT_ACCEL` (~0.67 m slide, per the amendment's own worked number). `dirX/dirY` fall back to the beast's
 * current facing if the hit carried no direction (defensive; `sword.js` always sets one). */
function enterStagger(sim, i, dirX, dirY) {
  const steer = sim.steer;
  const dx = typeof dirX === 'number' ? dirX : sim.fx[i];
  const dy = typeof dirY === 'number' ? dirY : sim.fy[i];
  sim.state[i] = STATE_STAGGER;
  sim.timer[i] = sim.cfgSteps.stagger;
  sim.unseen[i] = 0; // clears the charge wall-slow streak counter (reused field)
  steer.vx[i] = dx * sim.cfg.staggerKnock;
  steer.vy[i] = dy * sim.cfg.staggerKnock;
  steer.accel[i] = DEFAULT_ACCEL;
}

function enterReturn(sim, i) {
  sim.state[i] = STATE_RETURN;
  sim.goalX[i] = sim.homeX[i]; sim.goalY[i] = sim.homeY[i];
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.pathReq[i] = 0;
}

function enterWander(sim, i) {
  sim.state[i] = STATE_WANDER;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.timer[i] = sim.cfgSteps.pauseMin + sim.rng.int(sim.cfgSteps.pauseMax - sim.cfgSteps.pauseMin + 1);
}

// ---- paths (29.1 step 3) -------------------------------------------------------------------------------------

function updatePathRequests(sim, px, py) {
  const n = sim.count, cfg = sim.cfg;
  for (let i = 0; i < n; i++) {
    if (sim.repathT[i] > 0) sim.repathT[i]--;
    if (sim.pathReq[i]) continue;
    const st = sim.state[i];
    if (st === STATE_CHASE) {
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) {
        sim.goalX[i] = px; sim.goalY[i] = py; sim.pathReq[i] = 1;
      } else if (sim.repathT[i] <= 0) {
        const dx = px - sim.goalX[i], dy = py - sim.goalY[i];
        if (dx * dx + dy * dy > cfg.repathMoveM * cfg.repathMoveM) {
          sim.goalX[i] = px; sim.goalY[i] = py; sim.pathReq[i] = 1;
        }
      }
    } else if (st === STATE_RETURN) {
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) sim.pathReq[i] = 1;
    } else if (st === STATE_WANDER && sim.timer[i] === WALKING) {
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) sim.pathReq[i] = 1;
    }
  }
}

/** At most one `findPath` per tick, round robin from the slot after the last one served (29.1 step 3). */
function servePathRequest(sim, px, py) {
  void px; void py;
  const n = sim.count;
  if (n === 0) return;
  for (let k = 1; k <= n; k++) {
    const i = (sim.lastServed + k) % n;
    if (sim.pathReq[i]) {
      computePath(sim, i);
      sim.pathReq[i] = 0;
      sim.repathT[i] = sim.cfgSteps.repath;
      sim.lastServed = i;
      return;
    }
  }
}

function computePath(sim, i) {
  const grid = sim.grid, astar = sim.astar, steer = sim.steer;
  const sx = grid.cellX(steer.x[i]), sy = grid.cellY(steer.y[i]);
  const gx = grid.cellX(sim.goalX[i]), gy = grid.cellY(sim.goalY[i]);
  const maxNodes = sim.state[i] === STATE_WANDER ? WANDER_MAX_NODES : TRAVEL_MAX_NODES;
  const len = findPath(astar, sx, sy, gx, gy, sim._cellPath, { maxNodes });
  sim.stats.astar++;
  sim.stats.astarNodes += len; // approximation: findPath does not expose expanded-node count (see report deviations)
  const wn = len > 0 ? smoothPath(grid, sim._cellPath, len, sim._xy) : 0;
  storePath(sim, i, wn);
}

function storePath(sim, i, wn) {
  const base = i * PATH_SLOTS * 2;
  if (wn === 0) { sim.pathLen[i] = 0; sim.pathIdx[i] = 0; return; }
  let m = wn;
  if (m > PATH_SLOTS) {
    for (let w = 0; w < PATH_SLOTS - 1; w++) {
      sim.path[base + w * 2] = sim._xy[w * 2];
      sim.path[base + w * 2 + 1] = sim._xy[w * 2 + 1];
    }
    sim.path[base + (PATH_SLOTS - 1) * 2] = sim.goalX[i];
    sim.path[base + (PATH_SLOTS - 1) * 2 + 1] = sim.goalY[i];
    m = PATH_SLOTS;
  } else {
    for (let w = 0; w < m; w++) {
      sim.path[base + w * 2] = sim._xy[w * 2];
      sim.path[base + w * 2 + 1] = sim._xy[w * 2 + 1];
    }
  }
  sim.pathLen[i] = m;
  sim.pathIdx[i] = 0;
}

// ---- steer targets (29.1 step 4) -----------------------------------------------------------------------------

function setSteerTarget(sim, i) {
  const steer = sim.steer, cfg = sim.cfg, st = sim.state[i];
  sim.prevX[i] = steer.x[i];
  sim.prevY[i] = steer.y[i];

  if (st === STATE_CHARGE) {
    const wx = steer.x[i] + sim.cdx[i] * 20, wy = steer.y[i] + sim.cdy[i] * 20;
    steer.setWaypoint(i, wx, wy, 0);
    steer.maxSpeed[i] = cfg.charge;
    return;
  }

  // US-078d amendment: waypoint = own position (arrive 0), maxSpeed = staggerKnock - the steer clamp then keeps
  // the knockback velocity `enterStagger` assigned, decaying it by `accel` (DEFAULT_ACCEL) toward 0.
  if (st === STATE_STAGGER) {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
    steer.maxSpeed[i] = cfg.staggerKnock;
    return;
  }

  let speed = 0;
  if ((st === STATE_WANDER && sim.timer[i] === WALKING) || st === STATE_CHASE || st === STATE_RETURN) {
    advanceWaypoint(sim, i);
    const base = i * PATH_SLOTS * 2, idx = Math.min(sim.pathIdx[i], Math.max(0, sim.pathLen[i] - 1));
    const wx = sim.pathLen[i] > 0 ? sim.path[base + idx * 2] : steer.x[i];
    const wy = sim.pathLen[i] > 0 ? sim.path[base + idx * 2 + 1] : steer.y[i];
    steer.setWaypoint(i, wx, wy, WAYPOINT_ARRIVE);
    speed = st === STATE_CHASE ? cfg.chase : (st === STATE_RETURN ? cfg.returnSpeed : cfg.walk);
  } else {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
  }
  steer.maxSpeed[i] = speed;
}

function advanceWaypoint(sim, i) {
  const steer = sim.steer, base = i * PATH_SLOTS * 2;
  while (sim.pathIdx[i] < sim.pathLen[i] - 1) {
    const idx = sim.pathIdx[i];
    const dx = sim.path[base + idx * 2] - steer.x[i], dy = sim.path[base + idx * 2 + 1] - steer.y[i];
    if (dx * dx + dy * dy >= WAYPOINT_ADVANCE_D2) break;
    sim.pathIdx[i]++;
  }
}

// ---- post (29.1 step 6) ----------------------------------------------------------------------------------------

function postOne(sim, i, px, py, pz) {
  const steer = sim.steer, cfg = sim.cfg, world = sim.world;

  if (sim.state[i] === STATE_CHARGE) chargePost(sim, i, px, py);

  // Contact (any state, though only charge realistically reaches it): beast <-> player 2D distance.
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const contactR = cfg.radius + PHYSICS.radius + CONTACT_PAD;
  if (sim.state[i] === STATE_CHARGE && dx * dx + dy * dy <= contactR * contactR) {
    sim.events.emit('combat:hit', sim._hitPayload[i]);
    enterRecover(sim, i, false);
  }

  // Facing: velocity direction when moving; the player's direction in notice/windup; frozen while staggered
  // (US-078d amendment: "Facing frozen" - a knockback slide must not spin the beast to face the shove).
  if (sim.state[i] === STATE_STAGGER) {
    // frozen
  } else if (sim.state[i] === STATE_NOTICE || sim.state[i] === STATE_WINDUP) {
    const ddx = px - steer.x[i], ddy = py - steer.y[i];
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d > 1e-9) { sim.fx[i] = ddx / d; sim.fy[i] = ddy / d; }
  } else {
    const vx = steer.vx[i], vy = steer.vy[i];
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 0.1) { sim.fx[i] = vx / speed; sim.fy[i] = vy / speed; }
  }

  // Ground: supportAt reads the floor under the beast (terrain or mesh collider); z never integrates gravity.
  const t = sim.entities[i].transform;
  const support = world.supportAt(steer.x[i], steer.y[i], t.z + 0.6, true, _supportOpts);
  t.x = steer.x[i];
  t.y = steer.y[i];
  t.z = support.floorH;
}

const _supportOpts = { height: 0, stepUpMax: 1.0, walkCos: -1 };

function chargePost(sim, i, px, py) {
  void px; void py;
  const steer = sim.steer;
  const dx = steer.x[i] - sim.prevX[i], dy = steer.y[i] - sim.prevY[i];
  const moved2 = dx * dx + dy * dy;
  const chargeStep = sim.cfgSteps.chargeMax - sim.timer[i];
  const thresh = WALL_SPEED_FRAC * sim.cfg.charge * SIM_STEP;
  if (chargeStep >= 4) {
    if (moved2 < thresh * thresh) {
      sim.unseen[i]++;
      if (sim.unseen[i] >= WALL_STREAK) { enterRecover(sim, i, true); return; }
    } else {
      sim.unseen[i] = 0;
    }
  }
  sim.timer[i]--;
  if (sim.timer[i] <= 0 && sim.state[i] === STATE_CHARGE) enterRecover(sim, i, false);
}

// ---- hash / save / load / reset --------------------------------------------------------------------------------

function hashSim(sim, h) {
  const n = sim.count;
  h.u32(sim.tick);
  h.u8Array(sim.state, 0, n);
  h.u32Array(sim.timer, 0, n);
  h.u32Array(sim.unseen, 0, n);
  h.u32Array(sim.repathT, 0, n);
  for (let i = 0; i < n; i++) {
    h.f64(sim.homeX[i]); h.f64(sim.homeY[i]);
    h.f64(sim.fx[i]); h.f64(sim.fy[i]);
    h.f64(sim.cdx[i]); h.f64(sim.cdy[i]);
    h.f64(sim.goalX[i]); h.f64(sim.goalY[i]);
    h.f64(sim.prevX[i]); h.f64(sim.prevY[i]);
  }
  h.u32Array(sim.pathLen, 0, n);
  h.u32Array(sim.pathIdx, 0, n);
  h.u8Array(sim.seen, 0, n);
  h.u8Array(sim.pathReq, 0, n);
  sim.steer.hashInto(h);
}

function saveSim(sim) {
  const n = sim.count;
  const slice = (a) => Array.from(a.subarray(0, n));
  return {
    tick: sim.tick,
    lastServed: sim.lastServed,
    state: slice(sim.state), timer: slice(sim.timer), unseen: slice(sim.unseen), repathT: slice(sim.repathT),
    homeX: slice(sim.homeX), homeY: slice(sim.homeY), fx: slice(sim.fx), fy: slice(sim.fy),
    cdx: slice(sim.cdx), cdy: slice(sim.cdy), goalX: slice(sim.goalX), goalY: slice(sim.goalY),
    prevX: slice(sim.prevX), prevY: slice(sim.prevY),
    pathLen: slice(sim.pathLen), pathIdx: slice(sim.pathIdx), seen: slice(sim.seen), pathReq: slice(sim.pathReq),
    path: Array.from(sim.path.subarray(0, n * PATH_SLOTS * 2)),
    steer: {
      x: slice(sim.steer.x), y: slice(sim.steer.y), vx: slice(sim.steer.vx), vy: slice(sim.steer.vy),
      mode: slice(sim.steer.mode), tx: slice(sim.steer.tx), ty: slice(sim.steer.ty),
      arriveR: slice(sim.steer.arriveR), maxSpeed: slice(sim.steer.maxSpeed), accel: slice(sim.steer.accel),
    },
  };
}

function loadSim(sim, obj) {
  const n = sim.count;
  sim.tick = obj.tick;
  sim.lastServed = obj.lastServed;
  for (let i = 0; i < n; i++) {
    sim.state[i] = obj.state[i]; sim.timer[i] = obj.timer[i]; sim.unseen[i] = obj.unseen[i]; sim.repathT[i] = obj.repathT[i];
    sim.homeX[i] = obj.homeX[i]; sim.homeY[i] = obj.homeY[i]; sim.fx[i] = obj.fx[i]; sim.fy[i] = obj.fy[i];
    sim.cdx[i] = obj.cdx[i]; sim.cdy[i] = obj.cdy[i]; sim.goalX[i] = obj.goalX[i]; sim.goalY[i] = obj.goalY[i];
    sim.prevX[i] = obj.prevX[i]; sim.prevY[i] = obj.prevY[i];
    sim.pathLen[i] = obj.pathLen[i]; sim.pathIdx[i] = obj.pathIdx[i]; sim.seen[i] = obj.seen[i]; sim.pathReq[i] = obj.pathReq[i];
    sim.steer.x[i] = obj.steer.x[i]; sim.steer.y[i] = obj.steer.y[i]; sim.steer.vx[i] = obj.steer.vx[i]; sim.steer.vy[i] = obj.steer.vy[i];
    sim.steer.mode[i] = obj.steer.mode[i]; sim.steer.tx[i] = obj.steer.tx[i]; sim.steer.ty[i] = obj.steer.ty[i];
    sim.steer.arriveR[i] = obj.steer.arriveR[i]; sim.steer.maxSpeed[i] = obj.steer.maxSpeed[i]; sim.steer.accel[i] = obj.steer.accel[i];
    sim.entities[i].transform.x = sim.steer.x[i];
    sim.entities[i].transform.y = sim.steer.y[i];
  }
  sim.path.set(obj.path);
}

function resetAllSim(sim) {
  for (let i = 0; i < sim.count; i++) {
    sim.steer.x[i] = sim.homeX[i]; sim.steer.y[i] = sim.homeY[i];
    sim.steer.vx[i] = 0; sim.steer.vy[i] = 0;
    sim.steer.setIdle(i);
    sim.steer.accel[i] = DEFAULT_ACCEL;
    sim.state[i] = STATE_WANDER;
    sim.timer[i] = sim.cfgSteps.pauseMin;
    sim.unseen[i] = 0; sim.repathT[i] = 0; sim.seen[i] = 0; sim.pathReq[i] = 0;
    sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
    sim.entities[i].transform.x = sim.homeX[i];
    sim.entities[i].transform.y = sim.homeY[i];
  }
}
