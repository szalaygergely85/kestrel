// engine/fauna/groundBrain.js - WILD-04 (architecture.md 38.31 items 4 + 5): ground-animal brain for ambient
// fauna (rabbit, deer, fox). Plain preallocated slots, no allocation per step, no Math.random, no world access
// except the injected FaunaEnv (item 1). Imports engine/nav (perceive, leash) and engine/entities (clipPlayer, gait).
//
// Types: `sp` = a compiled species from compileFaunaDef (dist, times, speeds, flee, gaits[{clip,..}], clipFor,
// enter, blendMs, bodyR, drawM, hideOrDespawn). Optional species keys: homeR (wander radius; default
// min(25, flee.maxDistM * 0.4): rabbit 12, deer 25), minSlopeZ (default 0.8).
// `slot` = a spawner slot (spawner.js makeSlot) extended once by extendGroundSlot(). The spawner's `yaw` is in
// degrees at spawn; initGroundAnimal converts it, from then on slot.yaw is radians.
// `ctx` = one reusable object the caller updates every step:
//   { env, player: {x, y, sprinting}, rng, slots, n, tick (+1 per 60 Hz step), dt (s) }
// slot.despawnReq is true while the animal walks home after a flee and sp.hideOrDespawn is set; fauna.js
// despawns it as soon as it is out of view (item 3). Reset to false at HOME.

import { perceive, NOISE_SPRINT } from '../nav/perceive.js';
import { leashState, returnTarget, LEASH_HOME, LEASH_ENGAGE, LEASH_RETURN, LEASH_GIVEUP } from '../nav/leash.js';
import { createClipPlayer, clipPlay, clipStep } from '../entities/clipPlayer.js';
import { pickGait, gaitRate } from '../entities/gait.js';

export const ST_IDLE = 0, ST_GRAZE = 1, ST_MOVE = 2, ST_ALERT = 3, ST_FLEE = 4, ST_RETURN = 5;
export const GROUP_ALARM_M = 15;
export const NEAR_MOVECIRCLE_M = 40;
const DECISION_PERIOD = 6;       // 60 Hz / 6 = 10 Hz
const FAR_PERIOD = 30;           // 2 Hz beyond drawM
const FLEE_MIN_S = 2;            // a flee lasts at least this long (group alarm from far away)
const FIRST_BURST_S = 1;
const ACCEL = 14, BRAKE = 30;    // m/s^2
const TURN_DEFAULT = 4.2;        // rad/s outside a flee
const DEG = Math.PI / 180;
const TWO_PI = 6.283185307179586;
// feeler fallback offsets, first free one wins: +-30, +-60, +-90, 180 deg
const FEEL_DEG = [30, -30, 60, -60, 90, -90, 180];
const FEEL_COS = new Float64Array(FEEL_DEG.map((d) => Math.cos(d * DEG)));
const FEEL_SIN = new Float64Array(FEEL_DEG.map((d) => Math.sin(d * DEG)));

const _target = { x: 0, y: 0, noise: 1 };
const _sense = { sees: false, hears: false, dist: 0, returnHome: false };
const _mv = { x: 0, y: 0 };
const _ret = { x: 0, y: 0, speed: 0 };

/** Adds the brain fields to a spawner slot (once, at creation). Keeps existing spawner fields. */
export function extendGroundSlot(slot) {
  slot.leashDef = { homeX: 0, homeY: 0, homeR: 0, leashR: 0, aggroR: 0, loseScale: 1.25, returnSpeed: 0, giveUpT: 8 };
  slot.clip = createClipPlayer(); slot.pm = null; slot.wantClip = -1;
  slot.stateDur = 0; slot.goalYaw = 0; slot.wanderX = 0; slot.wanderY = 0; slot.hasWander = false; slot.watch = false;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0;
  slot.zigT = 0; slot.zigSign = 1; slot.yawBias = 0; slot.biasT = 0; slot.stuckT = 0; slot.expect = 0; slot.moved = 0;
  slot.alarmT = 0; slot.despawnReq = false;
  return slot;
}

export function groundHomeR(sp) {
  if (sp.homeR) return sp.homeR;
  const m = sp.flee && sp.flee.maxDistM ? sp.flee.maxDistM * 0.4 : 12;
  return m > 25 ? 25 : m;
}

/** Call after the spawner filled x, y, homeX, homeY, yaw (degrees) and group. `pm` = pose model (clips) or null. */
export function initGroundAnimal(slot, sp, pm) {
  const d = sp.dist, ld = slot.leashDef;
  slot.yaw = slot.yaw * DEG; slot.speed = 0; slot.gait = 0;
  slot.homeR = groundHomeR(sp);
  slot.coneCos = -0.5; slot.range = d.notice; slot.hearR = d.notice * 0.6;
  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw);
  slot.leashMode = LEASH_HOME; slot.leashT = 0;
  ld.homeX = slot.homeX; ld.homeY = slot.homeY; ld.homeR = slot.homeR;
  ld.leashR = sp.flee.maxDistM; ld.aggroR = d.flee; ld.loseScale = d.safe / d.flee;
  ld.returnSpeed = sp.speeds.wander; ld.giveUpT = 8;
  slot.pm = pm || null; slot.clip = createClipPlayer(); slot.wantClip = -1;
  slot.goalYaw = slot.yaw; slot.hasWander = false; slot.watch = false;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0;
  slot.zigT = 0; slot.zigSign = 1; slot.yawBias = 0; slot.biasT = 0; slot.stuckT = 0; slot.expect = 0; slot.moved = 0;
  slot.alarmT = 0; slot.despawnReq = false;
  slot.state = -1; slot.stateT = 0; slot.stateDur = 0;
}

function range(r, rng) { return r[0] + (r[1] - r[0]) * rng.nextFloat(); }

export function walkable(env, sp, x, y) {
  if (env.habitatAt(x, y) === 0) return false;
  if (env.slopeZ(x, y) < (sp.minSlopeZ || 0.8)) return false;
  return !env.blocked(x, y, sp.bodyR);
}

function setClip(slot, sp, idx, loop, next) {
  if (slot.wantClip === idx) return;
  slot.wantClip = idx;
  clipPlay(slot.clip, slot.pm, idx, loop, sp.blendMs, next);
}

function enter(slot, sp, ctx, st) {
  slot.state = st; slot.stateT = 0; slot.watch = false;
  const c = sp.clipFor, t = sp.times;
  if (st === ST_IDLE) { slot.stateDur = range(t.idle, ctx.rng); setClip(slot, sp, c.idle, true, -1); }
  else if (st === ST_GRAZE) { slot.stateDur = range(t.graze, ctx.rng); setClip(slot, sp, c.graze, true, -1); }
  else if (st === ST_ALERT) {
    slot.stateDur = range(t.alert, ctx.rng);
    const e = sp.enter.alert;
    if (e !== undefined) setClip(slot, sp, e, false, c.alert); else setClip(slot, sp, c.alert, true, -1);
  } else if (st === ST_FLEE) {
    slot.stateDur = 0; slot.zigT = 0; slot.zigSign = ctx.rng.nextFloat() < 0.5 ? -1 : 1; slot.hasWander = false;
  } else slot.stateDur = 0; // MOVE / RETURN: clip follows the gait every step
}

function startFlee(slot, sp, ctx) {
  if (slot.state === ST_FLEE) return;
  enter(slot, sp, ctx, ST_FLEE);
  slot.leashMode = LEASH_ENGAGE; slot.leashT = 0;
  // group alarm: members of the group within 15 m flee after 0.2-0.5 s
  const s = ctx.slots, n = ctx.n, r2 = GROUP_ALARM_M * GROUP_ALARM_M;
  for (let i = 0; i < n; i++) {
    const o = s[i];
    if (o === slot || !o.alive || o.group !== slot.group || o.state === ST_FLEE || o.alarmT > 0) continue;
    const dx = o.x - slot.x, dy = o.y - slot.y;
    if (dx * dx + dy * dy <= r2) o.alarmT = 0.2 + 0.3 * ctx.rng.nextFloat();
  }
}

/** First feeler heading from goal `g` that is free `look` metres ahead; NaN if all are blocked. */
function feel(slot, sp, env, g, look) {
  const x = slot.x, y = slot.y;
  if (walkable(env, sp, x + Math.cos(g) * look, y + Math.sin(g) * look)) return g;
  const c = Math.cos(g), s = Math.sin(g);
  for (let i = 0; i < FEEL_COS.length; i++) {
    const hx = c * FEEL_COS[i] - s * FEEL_SIN[i], hy = s * FEEL_COS[i] + c * FEEL_SIN[i];
    if (walkable(env, sp, x + hx * look, y + hy * look)) return Math.atan2(hy, hx);
  }
  return NaN;
}

function pickWander(slot, sp, ctx) {
  const w = sp.times.wanderM || sp.times.wanderHopM;
  for (let k = 0; k < 4; k++) {
    const a = ctx.rng.nextFloat() * TWO_PI, d = range(w, ctx.rng);
    const tx = slot.x + Math.cos(a) * d, ty = slot.y + Math.sin(a) * d;
    const hx = tx - slot.homeX, hy = ty - slot.homeY;
    if (hx * hx + hy * hy > slot.homeR * slot.homeR) continue;
    if (!walkable(ctx.env, sp, tx, ty)) continue;
    slot.wanderX = tx; slot.wanderY = ty; slot.hasWander = true;
    return true;
  }
  slot.hasWander = false;
  return false;
}

function tryMove(slot, sp, ctx) {
  if (pickWander(slot, sp, ctx)) enter(slot, sp, ctx, ST_MOVE); else enter(slot, sp, ctx, ST_IDLE);
}

function nextCalm(slot, sp, ctx) {
  const r = ctx.rng.nextFloat(), cur = slot.state;
  if (cur === ST_IDLE) { if (r < 0.6) enter(slot, sp, ctx, ST_GRAZE); else tryMove(slot, sp, ctx); }
  else if (cur === ST_GRAZE) { if (r < 0.5) enter(slot, sp, ctx, ST_IDLE); else tryMove(slot, sp, ctx); }
  else enter(slot, sp, ctx, r < 0.5 ? ST_GRAZE : ST_IDLE);
}

/** One decision tick (10 Hz near, 2 Hz far). `dtd` = time since this animal's previous decision. */
function decide(slot, sp, ctx, dtd) {
  const env = ctx.env, pl = ctx.player, dd = sp.dist;
  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw);
  _target.x = pl.x; _target.y = pl.y; _target.noise = pl.sprinting ? NOISE_SPRINT : 1;
  perceive(slot, _target, null, _sense);
  const d = _sense.dist;
  slot.dPlayer = d;
  const fleeR = pl.sprinting ? dd.fleeIfRunning : dd.flee;
  const react = _sense.sees || _sense.hears || d < dd.flee;

  // leash (ENGAGE = fleeing); a fresh flee is kept alive for FLEE_MIN_S
  if (slot.state === ST_FLEE && slot.stateT < FLEE_MIN_S) { slot.leashMode = LEASH_ENGAGE; slot.leashT = 0; }
  else leashState(slot, slot.leashDef, _target, dtd);
  // flee-override: a threat inside fleeR forces ENGAGE, also during RETURN / GIVEUP (leash.js ignores the target
  // there by design; prey must not)
  const threat = react && d < fleeR;
  if (threat) { slot.leashMode = LEASH_ENGAGE; slot.leashT = 0; }

  const lm = slot.leashMode;
  if (threat) {
    startFlee(slot, sp, ctx);
  } else if (slot.state === ST_FLEE) {
    if (lm !== LEASH_ENGAGE) enter(slot, sp, ctx, ST_RETURN); // safe distance / leash reached / gave up
  } else if (react && d < dd.alert) {
    if (slot.state !== ST_ALERT) enter(slot, sp, ctx, ST_ALERT);
    slot.goalYaw = Math.atan2(pl.y - slot.y, pl.x - slot.x);
  } else if (slot.state === ST_ALERT && slot.stateT < slot.stateDur) {
    // stay alert for the minimum time
  } else if (react && d < dd.notice) {
    // stop grazing, idle, turn towards the player
    if (slot.state !== ST_IDLE || !slot.watch) { enter(slot, sp, ctx, ST_IDLE); slot.stateDur = 1e9; slot.watch = true; }
    slot.goalYaw = Math.atan2(pl.y - slot.y, pl.x - slot.x);
  } else if (lm === LEASH_RETURN || lm === LEASH_GIVEUP) {
    if (slot.state !== ST_RETURN) enter(slot, sp, ctx, ST_RETURN);
  } else {
    if (slot.state === ST_RETURN || slot.state === ST_ALERT || slot.state < 0 || slot.watch) enter(slot, sp, ctx, ST_IDLE);
    else if (slot.stateT >= slot.stateDur) nextCalm(slot, sp, ctx);
    else if (slot.state === ST_MOVE) {
      const wx = slot.wanderX - slot.x, wy = slot.wanderY - slot.y;
      if (!slot.hasWander || wx * wx + wy * wy < 0.25) enter(slot, sp, ctx, ST_IDLE);
    }
  }
  if (lm === LEASH_HOME) slot.despawnReq = false;
  else if ((lm === LEASH_RETURN || lm === LEASH_GIVEUP) && sp.hideOrDespawn) slot.despawnReq = true;

  // goal heading for moving states + feeler probe
  const st = slot.state;
  if (st === ST_FLEE) slot.goalYaw = Math.atan2(slot.y - pl.y, slot.x - pl.x);
  else if (st === ST_RETURN) { returnTarget(slot.leashDef, _ret); slot.goalYaw = Math.atan2(_ret.y - slot.y, _ret.x - slot.x); }
  else if (st === ST_MOVE) slot.goalYaw = Math.atan2(slot.wanderY - slot.y, slot.wanderX - slot.x);
  if (st === ST_FLEE || st === ST_RETURN || st === ST_MOVE) {
    const look = Math.max(1, slot.speed * 0.5);
    const h = feel(slot, sp, env, slot.goalYaw, look);
    if (h === h) slot.goalYaw = h;
    else { // boxed in: turn away for a moment
      slot.yawBias = (ctx.rng.nextFloat() < 0.5 ? -1 : 1) * (1.5 + ctx.rng.nextFloat()); slot.biasT = 1; slot.speed = 0;
      if (st === ST_MOVE) enter(slot, sp, ctx, ST_IDLE);
    }
  }
}

function wrap(a) {
  if (a > Math.PI) a -= TWO_PI; else if (a < -Math.PI) a += TWO_PI;
  return a;
}

/** Advance one animal by one 60 Hz step (`ctx.dt`). */
export function groundStep(slot, sp, ctx) {
  if (!slot.alive) return;
  const dt = ctx.dt, env = ctx.env, pl = ctx.player;
  slot.stateT += dt; slot.thinkDt += dt;
  if (slot.alarmT > 0) {
    slot.alarmT -= dt;
    if (slot.alarmT <= 0) { slot.alarmT = 0; startFlee(slot, sp, ctx); }
  }
  // decision tick, staggered by slot id; animals beyond drawM think at 2 Hz
  const per = slot.dPlayer > sp.drawM ? FAR_PERIOD : DECISION_PERIOD;
  if (slot.fresh || ctx.tick % per === slot.id % per) {
    slot.fresh = false;
    const dtd = slot.thinkDt; slot.thinkDt = 0;
    decide(slot, sp, ctx, dtd);
  }
  const st = slot.state;

  let tgt = 0, turn = TURN_DEFAULT;
  if (st === ST_FLEE) {
    const sps = sp.speeds;
    tgt = slot.stateT < FIRST_BURST_S ? (sps.fleeBurst !== undefined ? sps.fleeBurst : (sps.nervous !== undefined ? sps.nervous : sps.flee)) : sps.flee;
    turn = sp.flee.turnDegPerS * DEG;
    if (sp.flee.zigzagDeg) {
      slot.zigT -= dt;
      if (slot.zigT <= 0) { slot.zigT = sp.flee.zigzagEveryS || 0.5; slot.zigSign = -slot.zigSign; }
    }
  } else if (st === ST_MOVE || st === ST_RETURN) tgt = sp.speeds.wander;

  // heading: feeler result + stuck bias + flee zigzag, limited turn rate
  let want = slot.goalYaw;
  if (slot.biasT > 0) { slot.biasT -= dt; want += slot.yawBias; }
  if (st === ST_FLEE && sp.flee.zigzagDeg) want += slot.zigSign * sp.flee.zigzagDeg * DEG;
  let diff = wrap(want - slot.yaw);
  const maxT = turn * dt;
  if (diff > maxT) diff = maxT; else if (diff < -maxT) diff = -maxT;
  slot.yaw = wrap(slot.yaw + diff);
  const rem = Math.abs(wrap(want - slot.yaw));
  if (tgt > 0 && rem > 0.8) { const k = 1 - (rem - 0.8) / 1.5; tgt *= k < 0.25 ? 0.25 : k; }

  if (slot.speed < tgt) { slot.speed += ACCEL * dt; if (slot.speed > tgt) slot.speed = tgt; }
  else if (slot.speed > tgt) { slot.speed -= BRAKE * dt; if (slot.speed < tgt) slot.speed = tgt; }

  if (slot.speed > 0.001) {
    const dx = Math.cos(slot.yaw) * slot.speed * dt, dy = Math.sin(slot.yaw) * slot.speed * dt;
    const near = Math.abs(slot.x - pl.x) < NEAR_MOVECIRCLE_M && Math.abs(slot.y - pl.y) < NEAR_MOVECIRCLE_M;
    let nx, ny, ok;
    if (near) { env.moveCircle(slot.x, slot.y, dx, dy, sp.bodyR, _mv); nx = _mv.x; ny = _mv.y; ok = walkable(env, sp, nx, ny); }
    else { // beyond 40 m collisions are invisible: habitat + slope only (water / roads have habitat 0)
      nx = slot.x + dx; ny = slot.y + dy;
      ok = env.habitatAt(nx, ny) !== 0 && env.slopeZ(nx, ny) >= (sp.minSlopeZ || 0.8);
    }
    if (ok) {
      const mx = nx - slot.x, my = ny - slot.y;
      slot.moved += Math.sqrt(mx * mx + my * my);
      slot.x = nx; slot.y = ny;
    } else slot.speed *= 0.5;
  }
  slot.z = env.groundAt(slot.x, slot.y);

  // stuck rule: moved < 25 % of the expected distance over 1 s -> turn (wander target dropped)
  if (tgt > 0) slot.expect += tgt * dt;
  slot.stuckT += dt;
  if (slot.stuckT >= 1) {
    if (slot.expect > 0.3 && slot.moved < 0.25 * slot.expect) {
      slot.yawBias = (ctx.rng.nextFloat() < 0.5 ? -1 : 1) * (1.2 + ctx.rng.nextFloat()); slot.biasT = 1;
      if (st === ST_MOVE) { slot.hasWander = false; enter(slot, sp, ctx, ST_IDLE); }
    }
    slot.stuckT = 0; slot.expect = 0; slot.moved = 0;
  }

  // gait + clip (rate = speed / tunedMps within the gait's rate[])
  if (st === ST_MOVE || st === ST_RETURN || st === ST_FLEE) {
    slot.gait = pickGait(sp.gaits, slot.speed, slot.gait);
    setClip(slot, sp, sp.gaits[slot.gait].clip, true, -1);
    slot.clip.rate = gaitRate(sp.gaits[slot.gait], slot.speed);
  } else slot.clip.rate = 1;
  clipStep(slot.clip, slot.pm, dt * 1000);
}
