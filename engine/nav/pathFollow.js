// CH1-E1 (architecture 38.37 item 5): pure polyline follower for walking NPCs. No world, no allocation per
// step, deterministic (no random, no clock). Imports only core/transform.js (yawFromDelta).
//
// createPathFollower(points /* Float64Array x,y pairs, >= 1 point */, opts) -> follower
//   opts: speed (m/s), arriveR (corner look-ahead radius, default 0.4), turnRate (deg/s, default 360),
//         waitFar (stop when the target is farther than this, default Infinity), resumeNear (resume once the
//         target is closer than this, default = waitFar), onArrive(wpIndex) (called when a waypoint is reached).
//   follower.step(dt, speedScale = 1, px = NaN, py = NaN) -> true if it moved. (px,py) = the player to wait for.
//   follower fields: x, y, yawDeg, seg (index of the last waypoint reached; heads for seg+1), s (metres walked),
//                    done, waiting.  reset(seg) puts it on waypoint `seg` and clears done/waiting.
import { yawFromDelta } from '../core/transform.js';

export function createPathFollower(points, opts = {}) {
  const n = points.length >> 1;
  if (n < 1) throw new Error('createPathFollower: need at least one point');
  const speed = opts.speed ?? 1, arriveR = opts.arriveR ?? 0.4, turnRate = opts.turnRate ?? 360;
  const waitFar = opts.waitFar ?? Infinity, resumeNear = opts.resumeNear ?? waitFar;
  const onArrive = opts.onArrive || null;
  const f = {
    x: points[0], y: points[1], yawDeg: 0, seg: 0, s: 0, done: n === 1, waiting: false,
    reset(seg = 0) {
      const k = seg < 0 ? 0 : seg > n - 1 ? n - 1 : seg | 0;
      f.seg = k; f.x = points[k * 2]; f.y = points[k * 2 + 1]; f.done = k === n - 1; f.waiting = false;
      return f;
    },
    step(dt, speedScale = 1, px = NaN, py = NaN) {
      if (f.done) return false;
      if (px === px) { // wait-for-target (hysteresis)
        const d2 = (px - f.x) * (px - f.x) + (py - f.y) * (py - f.y);
        if (!f.waiting) { if (d2 > waitFar * waitFar) f.waiting = true; }
        else if (d2 < resumeNear * resumeNear) f.waiting = false;
        if (f.waiting) return false;
      }
      let move = speed * speedScale * dt;
      if (!(move > 0)) return false;
      // Consume the budget, possibly crossing waypoints (a long dt never skips a corner).
      let moved = false;
      for (let guard = 0; guard < 8 && move > 0 && !f.done; guard++) {
        const t = f.seg + 1, tx = points[t * 2], ty = points[t * 2 + 1];
        const dx = tx - f.x, dy = ty - f.y, d = Math.sqrt(dx * dx + dy * dy);
        const last = t === n - 1;
        if (d > 1e-9) {
          // turn towards the heading, limited by turnRate
          const want = yawFromDelta(dx, dy);
          let diff = want - f.yawDeg;
          diff -= 360 * Math.round(diff / 360);
          const maxTurn = turnRate * dt;
          f.yawDeg += diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff;
          if (f.yawDeg > 180) f.yawDeg -= 360; else if (f.yawDeg <= -180) f.yawDeg += 360;
        }
        const step = move < d ? move : d;
        if (d > 1e-9) { f.x += dx / d * step; f.y += dy / d * step; }
        f.s += step; move -= step; moved = moved || step > 0;
        const rem = d - step;
        // corners round off inside arriveR; the final point needs an exact arrival
        if (rem <= (last ? 1e-9 : arriveR)) {
          f.seg = t;
          if (last) { f.done = true; f.x = tx; f.y = ty; }
          if (onArrive) onArrive(t);
        } else break;
      }
      return moved;
    },
  };
  return f;
}
