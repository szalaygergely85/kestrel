// game/js/quest/bowConfig.js (EQ-08, docs/architecture.md 38.41). Pure data for the arrow sim (sim/arrows.js).
// Step counts are 60 Hz steps; lengths in metres, speeds in m/s.
/** @type {Readonly<Record<string, any>>} */
export const BOW_CFG = Object.freeze({
  vMin: 20,            // m/s at draw 0
  vMax: 45,            // m/s at full draw
  g: 9.8,              // m/s^2
  drawSteps: 48,       // 0.8 s to a full draw (the view / EQ-09 uses it)
  maxFlightSteps: 240, // 4 s in the air, then the arrow is lost
  stickSteps: 1800,    // 30 s stuck, then it vanishes
  survivePct: 70,      // % of stuck arrows that can be picked up again
  maxFlying: 8,
  maxStuck: 16,
  hitPad: 0.05,        // m added to a target cylinder
  stuckBack: 0.05,     // m the stuck arrow sits in front of the surface
});
