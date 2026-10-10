// engine/entities/gait.js - WILD-02 (architecture.md 38.31 item 8): gait choice by speed, pure, no allocation.
// A gait is { clip, tunedMps, minMps, maxMps, rate: [lo, hi] } (design/models/voxel_wildlife.js).

export const GAIT_HYSTERESIS = 0.15;

/** Index of the gait for `speed`. The current gait `cur` is kept while speed stays within
 * [minMps - 0.15, maxMps + 0.15] (no flip-flop at a boundary); otherwise the first gait whose range holds
 * the speed, else the nearest range. */
export function pickGait(gaits, speed, cur) {
  const n = gaits.length;
  if (cur >= 0 && cur < n) {
    const g = gaits[cur];
    if (speed >= g.minMps - GAIT_HYSTERESIS && speed <= g.maxMps + GAIT_HYSTERESIS) return cur;
  }
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const g = gaits[i];
    if (speed >= g.minMps && speed <= g.maxMps) return i;
    const d = speed < g.minMps ? g.minMps - speed : speed - g.maxMps;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Playback rate for `speed`: speed / tunedMps clamped to gait.rate. */
export function gaitRate(gait, speed) {
  const r = speed / gait.tunedMps;
  const lo = gait.rate[0], hi = gait.rate[1];
  return r < lo ? lo : (r > hi ? hi : r);
}
