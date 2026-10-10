// engine/fauna/flyerBrain.js - WILD-07a (architecture.md 38.31 item 6): bird brain for ambient fauna (kind 'flyer').
// Plain preallocated slots, no allocation per step, no Math.random, no world access except the injected FaunaEnv
// (env.perchNear(x, y, minR, maxR, out{x,y,z,tree}) -> bool; groundAt; habitatAt for HOP). Same slot / ctx conventions
// as groundBrain.js:  ctx = { env, player: {x, y, sprinting}, rng, slots, n, tick (+1 per 60 Hz step), dt (s) }
// Species keys used (compiled def): dist.flee / fleeIfRunning, speeds { flyMin 6, flyMax 9, hop }, clipFor
// { idle: perch idle, move: ground hop (optional: no HOP state without it), flee: flap }, extra { takeoff, glide,
// land }, blendMs, times.hopM (hop radius, default 3). Optional sp.perchSpawnM (ring searched for a perch at spawn, 25).
// States: PERCH / HOP -> TAKEOFF (per-bird 0-0.4 s delay for flock members) -> FLY (one quadratic Bezier, stepped
// by arc length) -> PERCH (land clip over the last 1.5 m). No perch within 70 m: fly out of view (FAR) with
// slot.despawnReq set; fauna.js despawns it once unseen. slot.yaw is radians from init on; slot.tree = perch tree id
// (flock members share the leader's tree).

import { createClipPlayer, clipPlay, clipStep } from '../entities/clipPlayer.js';

export const FS_PERCH = 10, FS_HOP = 11, FS_TAKEOFF = 12, FS_FLY = 13, FS_FAR = 14;
export const PERCH_MIN_M = 30, PERCH_MAX_M = 70, PERCH_FARTHER_M = 15;
export const LAND_M = 1.5;
const DECISION_PERIOD = 6;       // 10 Hz
const TAKEOFF_S = 0.35;
const FAR_M = 80;                // fly-out distance for the no-perch case
const DEG = Math.PI / 180;
const TWO_PI = 6.283185307179586;

const _pt = { x: 0, y: 0, z: 0, tree: -1 };

export function extendFlyerSlot(slot) {
  slot.clip = createClipPlayer(); slot.pm = null; slot.wantClip = -1;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0; slot.despawnReq = false;
  slot.tree = -1; slot.delayT = 0; slot.noPerch = false; slot.started = false;
  slot.p0x = 0; slot.p0y = 0; slot.p0z = 0; slot.cx = 0; slot.cy = 0; slot.cz = 0;
  slot.p1x = 0; slot.p1y = 0; slot.p1z = 0; slot.u = 0; slot.len = 1; slot.fspd = 6;
  slot.hopX = 0; slot.hopY = 0; slot.hopT = 0; slot.goalYaw = 0;
  return slot;
}

/** Call after the spawner filled x, y, homeX, homeY, yaw (degrees), group. `pm` = pose model or null.
 * Starts perched if a tree is within sp.perchSpawnM (the bird is moved onto it), else on the ground (HOP / idle). */
export function initFlyerBird(slot, sp, pm, env) {
  slot.yaw = slot.yaw * DEG; slot.speed = 0; slot.pm = pm || null; slot.clip = createClipPlayer(); slot.wantClip = -1;
  slot.thinkDt = 0; slot.fresh = true; slot.dPlayer = 0; slot.despawnReq = false; slot.tree = -1;
  slot.delayT = 0; slot.noPerch = false; slot.started = false; slot.u = 0; slot.hopT = 0; slot.goalYaw = slot.yaw;
  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw);
  if (env.perchNear && env.perchNear(slot.x, slot.y, 0, sp.perchSpawnM || 25, _pt)) {
    slot.x = _pt.x; slot.y = _pt.y; slot.z = _pt.z; slot.tree = _pt.tree;
    enter(slot, sp, FS_PERCH);
  } else {
    slot.z = env.groundAt(slot.x, slot.y);
    enter(slot, sp, sp.clipFor.move !== undefined ? FS_HOP : FS_PERCH);
  }
}

function setClip(slot, sp, idx, loop) {
  if (idx === undefined || slot.wantClip === idx) return;
  slot.wantClip = idx;
  clipPlay(slot.clip, slot.pm, idx, loop, sp.blendMs, -1);
}

function enter(slot, sp, st) {
  slot.state = st; slot.stateT = 0;
  if (st === FS_PERCH) { slot.speed = 0; setClip(slot, sp, sp.clipFor.idle, true); }
  else if (st === FS_HOP) { slot.hopT = 0; setClip(slot, sp, sp.clipFor.idle, true); }
}

/** Looks for a perch 30-70 m away that is >= 15 m farther from the player than the bird now. Fills _pt. */
function pickPerch(slot, ctx) {
  const env = ctx.env, pl = ctx.player;
  if (!env.perchNear) return false;
  let ax = slot.x - pl.x, ay = slot.y - pl.y;
  const al = Math.sqrt(ax * ax + ay * ay) || 1;
  ax /= al; ay /= al;
  const need = slot.dPlayer + PERCH_FARTHER_M;
  for (let k = 0; k < 4; k++) { // the ring centre slides away from the player so the far side is searched too
    if (!env.perchNear(slot.x + ax * k * 20, slot.y + ay * k * 20, PERCH_MIN_M, PERCH_MAX_M, _pt)) continue;
    const dx = _pt.x - pl.x, dy = _pt.y - pl.y;
    if (dx * dx + dy * dy >= need * need) return true;
  }
  return false;
}

function setupFlight(slot, sp, ctx, tx, ty, tz, noPerch, delay) {
  const env = ctx.env, rng = ctx.rng;
  slot.p0x = slot.x; slot.p0y = slot.y; slot.p0z = slot.z;
  // cruise height: highest of 3 ground samples along the path (and both ends) + 3-6 m
  let hz = slot.z > tz ? slot.z : tz;
  for (let i = 1; i <= 3; i++) {
    const f = i * 0.25, g = env.groundAt(slot.x + (tx - slot.x) * f, slot.y + (ty - slot.y) * f);
    if (g > hz) hz = g;
  }
  const cruise = hz + 3 + 3 * rng.nextFloat();
  slot.p1x = tx; slot.p1y = ty; slot.p1z = noPerch ? cruise + 4 : tz;
  slot.cx = (slot.p0x + tx) * 0.5; slot.cy = (slot.p0y + ty) * 0.5;
  slot.cz = 2 * cruise - (slot.p0z + slot.p1z) * 0.5; // the curve passes through `cruise` at u = 0.5
  const a = Math.hypot(slot.cx - slot.p0x, slot.cy - slot.p0y, slot.cz - slot.p0z) + Math.hypot(tx - slot.cx, ty - slot.cy, slot.p1z - slot.cz);
  const ch = Math.hypot(tx - slot.p0x, ty - slot.p0y, slot.p1z - slot.p0z);
  slot.len = (2 * ch + a) / 3 || 1;
  const spd = sp.speeds, lo = spd.flyMin || 6, hi = spd.flyMax || 9;
  slot.fspd = lo + (hi - lo) * rng.nextFloat();
  slot.u = 0; slot.noPerch = noPerch; slot.delayT = delay; slot.started = false;
  slot.yaw = Math.atan2(ty - slot.y, tx - slot.x);
  enter(slot, sp, FS_TAKEOFF);
}

/** The bird that notices the player takes off and drags its whole flock (same group) to the same tree. */
function startFlight(slot, sp, ctx) {
  const rng = ctx.rng, pl = ctx.player;
  const found = pickPerch(slot, ctx);
  let tx, ty, tz = 0;
  const tree = found ? _pt.tree : -1;
  if (found) { tx = _pt.x; ty = _pt.y; tz = _pt.z; }
  else { // no perch: straight away from the player, far enough to be out of view
    let ax = slot.x - pl.x, ay = slot.y - pl.y;
    const al = Math.sqrt(ax * ax + ay * ay);
    if (al < 0.01) { ax = Math.cos(slot.yaw); ay = Math.sin(slot.yaw); } else { ax /= al; ay /= al; }
    tx = slot.x + ax * FAR_M; ty = slot.y + ay * FAR_M;
  }
  slot.tree = tree; slot.despawnReq = !found;
  setupFlight(slot, sp, ctx, tx, ty, tz, !found, 0);
  const s = ctx.slots, n = ctx.n, k = found ? 1 : 2.5;
  for (let i = 0; i < n; i++) {
    const o = s[i];
    if (o === slot || !o.alive || o.group !== slot.group || o.species !== slot.species) continue;
    if (o.state !== FS_PERCH && o.state !== FS_HOP) continue;
    const ox = (rng.nextFloat() - 0.5) * 2.4 * k, oy = (rng.nextFloat() - 0.5) * 2.4 * k;
    o.tree = tree; o.dPlayer = slot.dPlayer; o.despawnReq = !found;
    setupFlight(o, sp, ctx, tx + ox, ty + oy, tz, !found, 0.4 * rng.nextFloat());
  }
}

/** Advance one bird by one 60 Hz step (`ctx.dt`). */
export function flyerStep(slot, sp, ctx) {
  if (!slot.alive) return;
  const dt = ctx.dt, pl = ctx.player;
  slot.stateT += dt; slot.thinkDt += dt;
  let st = slot.state;

  if (st === FS_PERCH || st === FS_HOP) {
    if (slot.fresh || ctx.tick % DECISION_PERIOD === slot.id % DECISION_PERIOD) {
      slot.fresh = false; slot.thinkDt = 0;
      const dx = slot.x - pl.x, dy = slot.y - pl.y, d = Math.sqrt(dx * dx + dy * dy);
      slot.dPlayer = d;
      if (d < (pl.sprinting ? sp.dist.fleeIfRunning : sp.dist.flee)) { startFlight(slot, sp, ctx); st = slot.state; }
    }
  }

  if (st === FS_HOP) { // ground forage: short hops inside a small radius around home
    const env = ctx.env, hopV = sp.speeds.hop || 1.2;
    if (slot.hopT <= 0) {
      const a = ctx.rng.nextFloat() * TWO_PI, r = (sp.times.hopM || 3) * ctx.rng.nextFloat();
      slot.hopX = slot.homeX + Math.cos(a) * r; slot.hopY = slot.homeY + Math.sin(a) * r;
      slot.hopT = 1.5 + 2.5 * ctx.rng.nextFloat();
      slot.goalYaw = Math.atan2(slot.hopY - slot.y, slot.hopX - slot.x);
    }
    slot.hopT -= dt;
    const wx = slot.hopX - slot.x, wy = slot.hopY - slot.y, wd = Math.sqrt(wx * wx + wy * wy);
    if (wd > 0.15 && env.habitatAt(slot.hopX, slot.hopY) !== 0) {
      const v = hopV * dt, step = v < wd ? v : wd;
      slot.x += (wx / wd) * step; slot.y += (wy / wd) * step;
      slot.yaw = slot.goalYaw; slot.speed = hopV;
      setClip(slot, sp, sp.clipFor.move, true);
    } else { slot.speed = 0; setClip(slot, sp, sp.clipFor.idle, true); }
    slot.z = env.groundAt(slot.x, slot.y);
  } else if (st === FS_TAKEOFF) {
    if (slot.delayT > 0) slot.delayT -= dt;
    else {
      if (!slot.started) { slot.started = true; slot.stateT = 0; setClip(slot, sp, sp.extra.takeoff, false); }
      if (slot.stateT >= TAKEOFF_S) { slot.state = FS_FLY; slot.stateT = 0; }
    }
  } else if (st === FS_FLY) {
    const u = slot.u, om = 1 - u;
    // B'(u) = 2(1-u)(C-P0) + 2u(P1-C); u advances by speed*dt/|B'| (arc-length stepping, no allocation)
    const dx = 2 * (om * (slot.cx - slot.p0x) + u * (slot.p1x - slot.cx));
    const dy = 2 * (om * (slot.cy - slot.p0y) + u * (slot.p1y - slot.cy));
    const dz = 2 * (om * (slot.cz - slot.p0z) + u * (slot.p1z - slot.cz));
    let m = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (m < 0.2 * slot.len) m = 0.2 * slot.len; // keep the step finite where the tangent nearly vanishes
    let nu = u + slot.fspd * dt / m;
    slot.speed = slot.fspd;
    if (dx * dx + dy * dy > 1e-6) slot.yaw = Math.atan2(dy, dx);
    if (nu >= 1) { // snap onto the end point: landing error is exactly 0
      slot.x = slot.p1x; slot.y = slot.p1y; slot.z = slot.p1z; slot.u = 1; slot.speed = 0;
      if (slot.noPerch) { slot.state = FS_FAR; slot.stateT = 0; } else enter(slot, sp, FS_PERCH);
    } else {
      slot.u = nu;
      const w = 1 - nu, a = w * w, b = 2 * w * nu, c = nu * nu;
      slot.x = a * slot.p0x + b * slot.cx + c * slot.p1x;
      slot.y = a * slot.p0y + b * slot.cy + c * slot.p1y;
      slot.z = a * slot.p0z + b * slot.cz + c * slot.p1z;
      const rx = slot.p1x - slot.x, ry = slot.p1y - slot.y, rz = slot.p1z - slot.z;
      if (!slot.noPerch && nu > 0.5 && rx * rx + ry * ry + rz * rz <= LAND_M * LAND_M) setClip(slot, sp, sp.extra.land, false);
      else if (dz > 0 && nu < 0.5) setClip(slot, sp, sp.clipFor.flee, true);
      else setClip(slot, sp, sp.extra.glide, true);
    }
  } else if (st === FS_FAR) slot.speed = 0; // out of reach; fauna.js despawns it once it is out of view

  slot.fx = Math.cos(slot.yaw); slot.fy = Math.sin(slot.yaw);
  clipStep(slot.clip, slot.pm, dt * 1000);
}
