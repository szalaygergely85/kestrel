// game/js/rts/sim/tick.js - RTS-01a fixed-step sim (28.8). One call = one STEP (1/60 s); never reads a frame dt,
// the camera or the DOM. RTS-01a has no orders, so a step only latches prev = cur for render interpolation;
// RTS-01b adds orders.js + steering between the latch and the tick counter.

/** @param {ReturnType<import('./units.js').createUnits>} u */
export function simStep(u) {
  const n = u.count, x = u.x, y = u.y, px = u.prevX, py = u.prevY;
  for (let i = 0; i < n; i++) { px[i] = x[i]; py[i] = y[i]; }
  u.tick++;
}
