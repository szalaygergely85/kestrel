// TELEGRAPH-STYLE-01 (taken from lane C, offline): pure DATA for the boar attack telegraphs. No mechanism here:
// the entity tint (engine/entities/tintEnvelope.js, 38.23), the ground lane (engine/fx/chargeLane.js) and the wiring
// (game/js/fx/telegraphWire.js) already exist; this module only names the envelopes and supplies colours + timing.
// WebGPU-only (D-053). Colours are checked >= 3:1 against the ground colours in telegraphStyle.test.js (3 ground
// colours, 240x90 grid). A hot orange (#ff8c1a, the tint envelope's rgb) cannot reach 3:1 against turf (luminances
// ~0.37 vs ~0.30), so step 1 is a dark ember; NEEDS PO: owner look (preview design/preview/telegraph.html).
// NEEDS B2: names -- the string lists below mirror tintEnvelope TINT_NAMES / chargeLane laneAlpha (test asserts it).

/** Boar windup: 3 steps over the windup, then off. t0/t1 are fractions of the windup (1 = end of windup). */
export const WINDUP_STEPS = [
  { id: 'ember', color: '#3a0600', t0: 0.0,  t1: 0.45 },   // dark ember red: reads on grass at low res
  { id: 'flash', color: '#ffffff', t0: 0.45, t1: 0.85 },   // white flash: the "now" cue
  { id: 'off',   color: null,      t0: 0.85, t1: 1.0 },    // gap before the charge starts (dodge window)
];

export const TINT_ENVELOPES = { windup: 'windup', hit: 'hit', hurt: 'hurt' };  // names of engine tintEnvelope entries
export const LANE_STYLE = {
  color: '#3a0600',            // charge-lane ground colour (blended with alpha)
  alphaCurve: 'laneAlpha',     // engine/fx/chargeLane.js: linear 0 -> LANE_ALPHA_MAX over the windup
  alphaMax: 0.8,               // must equal LANE_ALPHA_MAX
};

/** Colour (hex string or null) of the windup step active at fraction u of the windup. */
export function windupColorAt(u) {
  for (const s of WINDUP_STEPS) if (u >= s.t0 && u < s.t1) return s.color;
  return null;
}
