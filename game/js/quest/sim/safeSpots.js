// OB-140: last-safe-spot ring buffer for the pause-menu "Unstuck" action. Pure, no allocation per step (flat Float64Array ring).
// step() is called every sim step with the player pose + a `safe` flag (grounded, not swimming/deep, alive); a sample is stored at most
// every `intervalSec` and only when the player moved >= `minMove` m from the previous sample. pick() returns the newest entry >= minDist
// from the current position that passes the optional isFree(x,y,z) check (falls back to the newest far-enough entry, else null).
export const SAFE_CFG = Object.freeze({ size: 8, intervalSec: 2, minMove: 1, minDist: 3 });

export function createSafeSpots(cfg = SAFE_CFG) {
  const n = cfg.size, buf = new Float64Array(n * 4), out = { x: 0, y: 0, z: 0, yawDeg: 0 };
  let head = 0, count = 0, acc = 0; // head = next write slot
  const newest = (k) => ((head - 1 - k) % n + n) % n; // k = 0 newest
  return {
    get count() { return count; },
    reset() { head = 0; count = 0; acc = 0; },
    step(dt, x, y, z, yawDeg, safe) {
      if (!safe) { acc = 0; return false; }
      acc += dt;
      if (acc < cfg.intervalSec) return false;
      if (count > 0) {
        const i = newest(0) * 4, dx = x - buf[i], dy = y - buf[i + 1], dz = z - buf[i + 2];
        if (dx * dx + dy * dy + dz * dz < cfg.minMove * cfg.minMove) return false; // keep waiting; stays armed
      }
      acc = 0;
      const o = head * 4; buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = yawDeg;
      head = (head + 1) % n; if (count < n) count++;
      return true;
    },
    /** Shared result object (do not hold). */
    pick(x, y, z, isFree) {
      const d2 = cfg.minDist * cfg.minDist;
      let first = -1;
      for (let k = 0; k < count; k++) {
        const i = newest(k) * 4, dx = x - buf[i], dy = y - buf[i + 1], dz = z - buf[i + 2];
        if (dx * dx + dy * dy + dz * dz < d2) continue;
        if (first < 0) first = i;
        if (!isFree || isFree(buf[i], buf[i + 1], buf[i + 2])) { first = i; break; }
      }
      if (first < 0) return null;
      out.x = buf[first]; out.y = buf[first + 1]; out.z = buf[first + 2]; out.yawDeg = buf[first + 3];
      return out;
    },
  };
}
