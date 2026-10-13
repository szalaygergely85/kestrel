// game/js/life/npcMover.js (LIFE-03, architecture.md 38.56 a): free-target walking of one villager on the beast NavGrid.
// Rule 15: no Math.random, no wall clock, 0 alloc per step. Plans are made by the caller (villagers.js queues them: <= 1 A* per step).
//   const m = createMover(x, y);  setGoal(m, gx, gy) -> true when a plan is needed;  planFor(m, grid, astar);
//   stepMover(m, dt, speedScale) -> true if it moved;  snapMover(m, x, y) puts it somewhere without walking.
// Fields: x, y, yawDeg, walking, arrived, pending, gx, gy.
import { createPathFollower, planPath } from '../../../engine/index.js';

export const PATH_CAP = 32;        // waypoints per route
export const MAX_NODES = 1500;     // A* node cap per request
export const WALK_SPEED = 1.6;     // m/s

export function createMover(x, y) {
  const buf = new Float64Array(PATH_CAP * 2);
  buf[0] = x; buf[1] = y;
  const f = createPathFollower(buf.subarray(0, 2), { speed: WALK_SPEED, arriveR: 0.4, turnRate: 360 });
  return { f, buf, x, y, yawDeg: 0, gx: x, gy: y, walking: false, arrived: true, pending: false };
}

/** New destination. Returns true when a path request is needed (not already there). */
export function setGoal(m, gx, gy) {
  m.gx = gx; m.gy = gy;
  const dx = gx - m.x, dy = gy - m.y;
  if (dx * dx + dy * dy < 0.09) { m.walking = false; m.arrived = true; m.pending = false; return false; }
  m.arrived = false; m.pending = true;
  return true;
}

/** Runs the (single) A* request for this mover; falls back to a straight leg if no path. */
export function planFor(m, grid, astar) {
  const buf = m.buf;
  let n = planPath(grid, astar, m.x, m.y, m.gx, m.gy, buf, MAX_NODES);
  if (n < 2) n = 2;
  buf[0] = m.x; buf[1] = m.y;                      // start exactly where it stands
  buf[(n - 1) * 2] = m.gx; buf[(n - 1) * 2 + 1] = m.gy; // end exactly on the spot (a stop is outside colliders)
  m.f.yawDeg = m.yawDeg;
  m.f.setPath(buf, n);
  m.walking = true; m.pending = false;
}

export function stepMover(m, dt, speedScale) {
  if (!m.walking) return false;
  const f = m.f, moved = f.step(dt, speedScale);
  m.x = f.x; m.y = f.y; m.yawDeg = f.yawDeg;
  if (f.done) { m.walking = false; m.arrived = true; }
  return moved;
}

export function snapMover(m, x, y) {
  m.x = x; m.y = y; m.gx = x; m.gy = y;
  m.walking = false; m.arrived = true; m.pending = false;
}

/** Moves the mover (and its follower) a little without changing the route (collision push-out). */
export function nudgeMover(m, x, y) { m.x = x; m.y = y; m.f.x = x; m.f.y = y; }
