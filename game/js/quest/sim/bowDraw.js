// game/js/quest/sim/bowDraw.js (EQ-09, architecture 38.41 item 9). Bow draw state: hold = draw (0..drawSteps), release = shot.
// Rule 15: integer counters, no trig/rng/clock, zero alloc in step().
export const BOW_NONE = 0, BOW_SHOT = 1, BOW_DRY = 2;
export const BOW_MIN_DRAW = 6;     // steps held before a release counts as a shot (0.1 s); less = cancelled
export const BOW_COOLDOWN = 15;    // steps after a shot before the next draw (0.25 s)

export function createBowDraw(cfg) {
  const max = cfg.drawSteps;
  let drawing = false, dryLatch = false, cooldown = 0;
  const sim = {
    tick: 0,
    drawSteps: 0,
    drawFrac: 0,        // 0..1 for the view / damage
    shotFrac: 0,        // draw fraction of the last shot
    shotTick: -1e9, dryTick: -1e9,
    get drawing() { return drawing; },
    /** @param {boolean} down LMB held @param {boolean} active bow set out and gate open @param {number} ammo quiver count
     *  @returns {number} BOW_NONE | BOW_SHOT (shotFrac valid) | BOW_DRY */
    step(down, active, ammo) {
      sim.tick++;
      if (cooldown > 0) cooldown--;
      if (!active) { drawing = false; sim.drawSteps = 0; sim.drawFrac = 0; dryLatch = false; return BOW_NONE; }
      let ev = BOW_NONE;
      if (down) {
        if (!drawing) {
          if (cooldown > 0) return BOW_NONE;
          if (ammo <= 0) { if (!dryLatch) { dryLatch = true; sim.dryTick = sim.tick; ev = BOW_DRY; } return ev; }
          drawing = true; sim.drawSteps = 0;
        }
        if (sim.drawSteps < max) sim.drawSteps++;
      } else {
        dryLatch = false;
        if (drawing) {
          drawing = false;
          if (sim.drawSteps >= BOW_MIN_DRAW) { sim.shotFrac = sim.drawSteps / max; sim.shotTick = sim.tick; cooldown = BOW_COOLDOWN; ev = BOW_SHOT; }
          sim.drawSteps = 0;
        }
      }
      sim.drawFrac = sim.drawSteps / max;
      return ev;
    },
    cancel() { drawing = false; sim.drawSteps = 0; sim.drawFrac = 0; dryLatch = false; },
    hashInto(h) { h.i32(sim.drawSteps); h.i32(cooldown); },
  };
  return sim;
}
