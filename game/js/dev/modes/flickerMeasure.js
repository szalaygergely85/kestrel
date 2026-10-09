// FLICKER-WG-01: pure measuring math for `?flicker=1` (Node-testable, no GPU/DOM).
// A "series" casts a base frame, then STEPS camera moves; after each move the new frame is compared with the
// previous one (frame N vs N-1) via flickerStep and the changed-glyph share (totalPct) is averaged.
// `castFrame(cam)` may be sync or async and returns { GI, fg }.
import { flickerStep } from '../../../../engine/index.js';

export async function motionSeries(castFrame, base, d, steps, cols, rows, opts = {}) {
  const { onStart, collect } = opts;
  if (onStart) onStart(); // e.g. wg.invalidateHistory(): each series starts with a camera cut
  let cam = { ...base };
  let prev = await castFrame(cam);
  let sumInterior = 0, sumTotal = 0;
  const out = {};
  for (let s = 0; s < steps; s++) {
    cam = { x: cam.x + d.dx, y: cam.y + d.dy, z: cam.z, yawDeg: cam.yawDeg + d.dyaw, pitchDeg: cam.pitchDeg };
    const cur = await castFrame(cam);
    flickerStep(prev.GI, prev.fg, cur.GI, cur.fg, cols, rows, out);
    sumInterior += out.pct; sumTotal += out.totalPct;
    if (collect) collect.push({ step: s + 1, x: cam.x, pct: out.pct, totalPct: out.totalPct });
    prev = cur;
  }
  return { interior: sumInterior / steps, total: sumTotal / steps };
}

/** fwd / strafe / yaw series -> one row (main numbers = totalPct, interior kept informational). */
export async function runRow(castFrame, base, motions, steps, cols, rows, opts = {}) {
  const fwd = await motionSeries(castFrame, base, motions.fwd, steps, cols, rows, { ...opts });
  const strafe = await motionSeries(castFrame, base, motions.strafe, steps, cols, rows, { onStart: opts.onStart });
  const yaw = await motionSeries(castFrame, base, motions.yaw, steps, cols, rows, { onStart: opts.onStart });
  const avg = (k) => (fwd[k] + strafe[k] + yaw[k]) / 3;
  return {
    fwd: fwd.total, strafe: strafe.total, yaw: yaw.total, avg: avg('total'),
    fwdInterior: fwd.interior, strafeInterior: strafe.interior, yawInterior: yaw.interior, avgInterior: avg('interior'),
  };
}

/** stable/off share ratio (US-073 target <= 0.6); NaN when the off share is 0. */
export function stableRatio(onShare, offShare) { return offShare > 0 ? onShare / offShare : NaN; }
