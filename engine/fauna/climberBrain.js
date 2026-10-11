// engine/fauna/climberBrain.js - WILD-05 (architecture.md 38.31): squirrel brain for ambient fauna (kind 'climber').
// Plain preallocated slots, no allocation per step, no Math.random, no world access except the injected FaunaEnv
// (env.trunkNear(x, y, maxR, out{x, y, r, tree}) -> bool = nearest tree trunk; groundAt; habitatAt; blocked; moveCircle).
// Same slot / ctx conventions as groundBrain.js. Compiled species keys used: clipFor { idle, graze (forage), move (hop),
// flee (run), alert }, extra { climb, peek }, climb { tunedMps, rate, heightM, bodyLiftM }, gaits, speeds { wander, flee },
// dist { alert, flee, fleeIfRunning, safe }, times { idle, graze, alert, wanderHopM, peek }, bodyR, blendMs.
// States: FORAGE (idle / forage / short hops around home, which sits at a trunk) -> ALERT (player inside dist.alert)
// -> RUN (player inside dist.flee: run to the nearest trunk) -> CLIMB (up to climb.heightM) -> PEEK (clip `peek`, until the
// player has left dist.alert and times.peek elapsed) -> DESCEND (climb clip, z falls) -> FORAGE. No trunk within
// TRUNK_SEARCH_M: the squirrel just runs away for a few seconds and goes back to FORAGE.
// Climb pose (designer note): the clip pitches the body -90 deg; instance yaw faces the trunk (heading, radians), x / y on
// the trunk surface, z = height of the paws minus climb.bodyLiftM. The climb clip also plays while descending.

import { createClipPlayer, clipPlay, clipStep } from '../entities/clipPlayer.js';
import { pickGait, gaitRate } from '../entities/gait.js';

export const CS_FORAGE = 20, CS_ALERT = 21, CS_RUN = 22, CS_CLIMB = 23, CS_PEEK = 24, CS_DESCEND = 25;
export const TRUNK_SEARCH_M = 14;
const DECISION_PERIOD = 6;       // 10 Hz
const TURN = 9;                  // rad/s
const RUN_AWAY_S = 3;
const PEEK_MAX_S = 40;
const DEG = Math.PI / 180;
const TWO_PI = 6.283185307179586;

const _tr = { x: 0, y: 0, r: 0, tree: -1 };
const _mv = { x: 0, y: 0 };

export function extendClimberSlot(slot) {
  slot.clip = createClipPlayer(); slot.pm = null; slot.wantClip = -1;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0; slot.despawnReq = false;
  slot.tx = 0; slot.ty = 0; slot.tr = 0; slot.hasTrunk = false; slot.climbH = 0; slot.climbTo = 3; slot.stateDur = 0;
  slot.wanderX = 0; slot.wanderY = 0; slot.hasWander = false; slot.goalYaw = 0; slot.bearing = 0;
  return slot;
}

function range(r, rng) { return r[0] + (r[1] - r[0]) * rng.nextFloat(); }
function wrap(a) { if (a > Math.PI) a -= TWO_PI; else if (a < -Math.PI) a += TWO_PI; return a; }

function setClip(slot, sp, idx, loop) {
  if (idx === undefined || slot.wantClip === idx) return;
  slot.wantClip = idx;
  clipPlay(slot.clip, slot.pm, idx, loop, sp.blendMs, -1);
}

/** Call after the spawner filled x, y, homeX, homeY, yaw (degrees). The squirrel is moved next to the nearest trunk (home). */
export function initClimberAnimal(slot, sp, pm, env) {
  slot.yaw = slot.yaw * DEG; slot.speed = 0; slot.gait = 0; slot.pm = pm || null; slot.clip = createClipPlayer(); slot.wantClip = -1;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0; slot.despawnReq = false; slot.climbH = 0; slot.hasWander = false;
  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw); slot.goalYaw = slot.yaw;
  slot.hasTrunk = false;
  if (env.trunkNear && env.trunkNear(slot.x, slot.y, TRUNK_SEARCH_M, _tr)) {
    slot.hasTrunk = true; slot.tx = _tr.x; slot.ty = _tr.y; slot.tr = _tr.r;
    // stand 0.7 m off the bark, on the side the spawn point lies on
    let dx = slot.x - _tr.x, dy = slot.y - _tr.y; const l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l; dy /= l;
    const nx = _tr.x + dx * (_tr.r + 0.7), ny = _tr.y + dy * (_tr.r + 0.7);
    if (!env.blocked(nx, ny, sp.bodyR)) { slot.x = nx; slot.y = ny; }
    slot.homeX = slot.x; slot.homeY = slot.y;
  }
  slot.z = env.groundAt(slot.x, slot.y);
  enter(slot, sp, null, CS_FORAGE);
}

function enter(slot, sp, ctx, st) {
  slot.state = st; slot.stateT = 0;
  const c = sp.clipFor;
  if (st === CS_FORAGE) { slot.stateDur = ctx ? range(sp.times.graze, ctx.rng) : 1; slot.hasWander = false; setClip(slot, sp, ctx ? c.graze : c.idle, true); }
  else if (st === CS_ALERT) setClip(slot, sp, c.alert, true);
  else if (st === CS_CLIMB || st === CS_DESCEND) setClip(slot, sp, sp.extra.climb, true);
  else if (st === CS_PEEK) { slot.stateDur = range(sp.times.peek || [3, 8], ctx.rng); setClip(slot, sp, sp.extra.peek !== undefined ? sp.extra.peek : sp.extra.climb, true); }
}

function startFlee(slot, sp, ctx) {
  if (slot.state === CS_RUN || slot.state === CS_CLIMB || slot.state === CS_PEEK || slot.state === CS_DESCEND) return;
  slot.state = CS_RUN; slot.stateT = 0; slot.hasWander = false;
  if (ctx.env.trunkNear && ctx.env.trunkNear(slot.x, slot.y, TRUNK_SEARCH_M, _tr)) {
    slot.hasTrunk = true; slot.tx = _tr.x; slot.ty = _tr.y; slot.tr = _tr.r;
    slot.climbTo = range(sp.climb.heightM, ctx.rng);
  } else slot.hasTrunk = false;
}

function pickHop(slot, sp, ctx) {
  const env = ctx.env, w = sp.times.wanderHopM || [0.5, 3];
  for (let k = 0; k < 4; k++) {
    const a = ctx.rng.nextFloat() * TWO_PI, d = range(w, ctx.rng);
    const tx = slot.x + Math.cos(a) * d, ty = slot.y + Math.sin(a) * d;
    const hx = tx - slot.homeX, hy = ty - slot.homeY;
    if (hx * hx + hy * hy > 9) continue;                 // stay within 3 m of the trunk home
    if (env.habitatAt(tx, ty) === 0 || env.blocked(tx, ty, sp.bodyR)) continue;
    slot.wanderX = tx; slot.wanderY = ty; slot.hasWander = true; return true;
  }
  slot.hasWander = false; return false;
}

function decide(slot, sp, ctx) {
  const pl = ctx.player, dd = sp.dist, st = slot.state;
  const dx = slot.x - pl.x, dy = slot.y - pl.y, d = Math.sqrt(dx * dx + dy * dy);
  slot.dPlayer = d;
  if (st === CS_CLIMB || st === CS_DESCEND) return;
  if (st === CS_PEEK) {
    if (slot.stateT >= slot.stateDur && (d > dd.alert || slot.stateT > PEEK_MAX_S)) enter(slot, sp, ctx, CS_DESCEND);
    return;
  }
  if (st === CS_RUN) return;
  if (d < (pl.sprinting ? dd.fleeIfRunning : dd.flee)) { startFlee(slot, sp, ctx); return; }
  if (d < dd.alert) { if (st !== CS_ALERT) enter(slot, sp, ctx, CS_ALERT); slot.goalYaw = Math.atan2(-dy, -dx); return; }
  if (st === CS_ALERT) { enter(slot, sp, ctx, CS_FORAGE); return; }
  if (slot.stateT >= slot.stateDur) {
    if (pickHop(slot, sp, ctx)) slot.state = 26, slot.stateT = 0;     // 26 = hop (a FORAGE sub-state)
    else enter(slot, sp, ctx, CS_FORAGE);
  } else if (st === 26) {
    const wx = slot.wanderX - slot.x, wy = slot.wanderY - slot.y;
    if (!slot.hasWander || wx * wx + wy * wy < 0.04) enter(slot, sp, ctx, CS_FORAGE);
  }
}

/** Advance one squirrel by one 60 Hz step (`ctx.dt`). */
export function climberStep(slot, sp, ctx) {
  if (!slot.alive) return;
  const dt = ctx.dt, env = ctx.env;
  slot.stateT += dt; slot.thinkDt += dt;
  const per = DECISION_PERIOD;
  if (slot.fresh || ctx.tick % per === slot.id % per) { slot.fresh = false; slot.thinkDt = 0; decide(slot, sp, ctx); }
  let st = slot.state;
  const cl = sp.climb;
  let tgt = 0, want = slot.yaw, direct = false;

  if (st === CS_RUN) {
    let gx, gy;
    if (slot.hasTrunk) { gx = slot.tx; gy = slot.ty; }
    else { gx = slot.x + (slot.x - ctx.player.x); gy = slot.y + (slot.y - ctx.player.y); }
    const dx = gx - slot.x, dy = gy - slot.y, dist = Math.sqrt(dx * dx + dy * dy);
    want = Math.atan2(dy, dx); tgt = sp.speeds.flee;
    direct = slot.hasTrunk && dist < slot.tr + sp.bodyR + 0.6; // the last stretch to the bark ignores the trunk's own collision circle
    if (slot.hasTrunk && dist <= slot.tr + 0.12) { // reached the bark: snap onto the surface, face the trunk
      slot.bearing = Math.atan2(slot.y - slot.ty, slot.x - slot.tx);
      slot.x = slot.tx + Math.cos(slot.bearing) * (slot.tr + 0.02); slot.y = slot.ty + Math.sin(slot.bearing) * (slot.tr + 0.02);
      slot.yaw = slot.bearing + Math.PI; slot.climbH = 0; slot.speed = 0;
      enter(slot, sp, ctx, CS_CLIMB);
    } else if (!slot.hasTrunk && slot.stateT > RUN_AWAY_S) { enter(slot, sp, ctx, CS_FORAGE); slot.homeX = slot.x; slot.homeY = slot.y; }
  } else if (st === 26) {
    want = Math.atan2(slot.wanderY - slot.y, slot.wanderX - slot.x); tgt = sp.speeds.wander;
  } else if (st === CS_ALERT) want = slot.goalYaw;
  st = slot.state; // RUN may have reached the trunk this step

  if (st === CS_CLIMB || st === CS_DESCEND || st === CS_PEEK) { // on the trunk
    const rate = 1;
    if (st === CS_CLIMB) { slot.climbH += cl.tunedMps * rate * dt; if (slot.climbH >= slot.climbTo) { slot.climbH = slot.climbTo; enter(slot, sp, ctx, CS_PEEK); } }
    else if (st === CS_DESCEND) {
      slot.climbH -= cl.tunedMps * 1.4 * dt;
      if (slot.climbH <= 0) { // back on the ground, one body length off the bark
        slot.climbH = 0;
        slot.x = slot.tx + Math.cos(slot.bearing) * (slot.tr + 0.7); slot.y = slot.ty + Math.sin(slot.bearing) * (slot.tr + 0.7);
        slot.homeX = slot.x; slot.homeY = slot.y; slot.yaw = slot.bearing;
        if (env.blocked(slot.x, slot.y, sp.bodyR)) { slot.x = slot.tx + Math.cos(slot.bearing) * (slot.tr + 0.2); slot.y = slot.ty + Math.sin(slot.bearing) * (slot.tr + 0.2); }
        slot.speed = 0; slot.clip.rate = 1; enter(slot, sp, ctx, CS_FORAGE);
      }
    }
    if (slot.state === CS_CLIMB || slot.state === CS_DESCEND || slot.state === CS_PEEK) {
      slot.z = env.groundAt(slot.x, slot.y) + slot.climbH - cl.bodyLiftM;
      slot.clip.rate = 1;
    }
  } else {
    let diff = wrap(want - slot.yaw); const maxT = (st === CS_RUN ? TURN * 2 : TURN) * dt;
    if (diff > maxT) diff = maxT; else if (diff < -maxT) diff = -maxT;
    slot.yaw = wrap(slot.yaw + diff);
    if (Math.abs(wrap(want - slot.yaw)) > 1.2) tgt *= 0.3;
    if (slot.speed < tgt) { slot.speed += 14 * dt; if (slot.speed > tgt) slot.speed = tgt; }
    else if (slot.speed > tgt) { slot.speed -= 30 * dt; if (slot.speed < tgt) slot.speed = tgt; }
    if (slot.speed > 0.001) {
      const mx = Math.cos(slot.yaw) * slot.speed * dt, my = Math.sin(slot.yaw) * slot.speed * dt;
      if (direct) { _mv.x = slot.x + mx; _mv.y = slot.y + my; } else env.moveCircle(slot.x, slot.y, mx, my, sp.bodyR, _mv);
      if (env.habitatAt(_mv.x, _mv.y) !== 0) { slot.x = _mv.x; slot.y = _mv.y; } else slot.speed *= 0.5;
    }
    slot.z = env.groundAt(slot.x, slot.y);
    if (st === CS_RUN || st === 26) {
      slot.gait = pickGait(sp.gaits, slot.speed, slot.gait);
      setClip(slot, sp, sp.gaits[slot.gait].clip, true);
      slot.clip.rate = gaitRate(sp.gaits[slot.gait], slot.speed);
    } else slot.clip.rate = 1;
  }
  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw);
  clipStep(slot.clip, slot.pm, dt * 1000);
}
