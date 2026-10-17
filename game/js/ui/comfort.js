// SETTINGS-APPLY-01: the Settings "COMFORT" rows. `reduceMotion` is a live module flag (set at boot from the saved
// blob, and by the Settings panel on change); `textSize` maps to the UI glyph grid width (the only text-size knob:
// engine createUiLayer fixes its cols at engine creation, so a change applies on the next load).
let reduce = false;
export function setReduceMotion(v) { reduce = !!v; }
export function isReduceMotion() { return reduce; }

/** Eye-height head-bob component (m) that EyeFeel added this step (same formula as engine/entities/EyeFeel.js). */
export function headBobOffset(body, cfg) {
  if (!body || !body.feel || !body.grounded) return 0;
  const env = Math.min(1, Math.hypot(body.vx || 0, body.vy || 0) / cfg.walkSpeed);
  return cfg.headBobAmplitude * env * Math.sin(body.feel.bobPhase);
}
/** Eye z with the bob removed when reduce-motion is on (step smoothing + landing dip stay: they hide pops). */
export function eyeZ(z, body, cfg) { return reduce ? z - headBobOffset(body, cfg) : z; }
/** Pitch kick (deg) after the reduce-motion gate. */
export function gateKick(deg) { return reduce ? 0 : deg; }

export const TEXT_SIZE_COLS_SCALE = Object.freeze({ small: 1.25, normal: 1, large: 0.8 });
/** UI grid cols for a text size: fewer cols = bigger glyphs. Engine clamps to [96, 320]. */
export function textSizeCols(baseCols, size) {
  return Math.round(baseCols * (TEXT_SIZE_COLS_SCALE[size] || 1));
}
