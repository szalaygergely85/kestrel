// game/js/audio/sfx.gain.test.js
//
// PC-B fix pass (US-020a-fix, PO headroom/clipping AC): a real, meaningful
// test that the worst-case simultaneous mix of every sound design in
// sfx.js, once synth.js's MASTER_GAIN is applied, never sums past 1.0 peak
// gain. Reads the ACTUAL gain constants the game plays (sfx.js's
// GAIN_DESIGNS table and synth.js's MASTER_GAIN) - it does not hand-copy or
// guess numbers, so it can't silently drift out of sync with a future
// sound-design tweak.
//
// Plain Node ESM, no test framework, no build step (matches
// engine/physics/physics.test.js's pattern). Run with:
//
//   node game/js/audio/sfx.gain.test.js
//
// Exits 0 and prints "ALL PASS" if every check passes, exits 1 and lists
// failures otherwise.
import { GAIN_DESIGNS, MUTUALLY_EXCLUSIVE_GROUPS } from './sfx.js';
import { MASTER_GAIN } from './synth.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

// Sum of a design's own component peaks (e.g. lever's tone + noise, both
// always fired together from the same call - see playLeverClunk).
function designPeakSum(name) {
  const peaks = GAIN_DESIGNS[name];
  return peaks.reduce((a, b) => a + b, 0);
}

// ---- basic sanity: every listed design has at least one positive peak ----
for (const [name, peaks] of Object.entries(GAIN_DESIGNS)) {
  ok(`GAIN_DESIGNS.${name} is a non-empty array of positive numbers`,
    Array.isArray(peaks) && peaks.length > 0 && peaks.every((p) => typeof p === 'number' && p > 0),
    JSON.stringify(peaks));
}

ok('MASTER_GAIN is a positive number <= 1', typeof MASTER_GAIN === 'number' && MASTER_GAIN > 0 && MASTER_GAIN <= 1, String(MASTER_GAIN));

// ---- worst-case simultaneous mix -------------------------------------------
// Build the set of "independent" designs (every design name minus the
// members of each mutually-exclusive group), then add back the louder
// member of each group - since only one of a pair (e.g. footstepLanding vs
// footstepSwish - a single footstep call plays exactly one of the two, never
// both) can ever actually be sounding at the same instant.
const exclusiveMembers = new Set(MUTUALLY_EXCLUSIVE_GROUPS.flat());
const independentNames = Object.keys(GAIN_DESIGNS).filter((n) => !exclusiveMembers.has(n));

let worstCaseSum = independentNames.reduce((sum, n) => sum + designPeakSum(n), 0);
const chosenFromGroups = [];
for (const group of MUTUALLY_EXCLUSIVE_GROUPS) {
  let loudestName = group[0];
  let loudestSum = designPeakSum(group[0]);
  for (const n of group.slice(1)) {
    const s = designPeakSum(n);
    if (s > loudestSum) { loudestSum = s; loudestName = n; }
  }
  chosenFromGroups.push(loudestName);
  worstCaseSum += loudestSum;
}

const worstCasePeakGain = worstCaseSum * MASTER_GAIN;

ok(
  `worst-case simultaneous mix (${independentNames.concat(chosenFromGroups).sort().join(' + ')}) * MASTER_GAIN (${MASTER_GAIN}) stays <= 1.0 peak gain`,
  worstCasePeakGain <= 1.0,
  `raw sum=${worstCaseSum.toFixed(3)}, *MASTER_GAIN=${worstCasePeakGain.toFixed(3)}`
);

// ---- the PO's own named example: thud + a footstep + a ratchet event ------
// (a plausible real-gameplay overlap: pushing a boulder toward a lever-
// controlled gate while walking, with the gate ratcheting open nearby).
const thudSteadyRatchetSum =
  designPeakSum('thud') +
  Math.max(designPeakSum('footstepLanding'), designPeakSum('footstepSwish')) +
  Math.max(designPeakSum('ratchetTick'), designPeakSum('ratchetDone'));
const thudSteadyRatchetPeakGain = thudSteadyRatchetSum * MASTER_GAIN;
ok(
  'thud + footstep + ratchet (PO\'s named worst-case example) * MASTER_GAIN stays <= 1.0 peak gain',
  thudSteadyRatchetPeakGain <= 1.0,
  `raw sum=${thudSteadyRatchetSum.toFixed(3)}, *MASTER_GAIN=${thudSteadyRatchetPeakGain.toFixed(3)}`
);

// ---- no single design alone should be anywhere near clipping either -------
for (const name of Object.keys(GAIN_DESIGNS)) {
  const g = designPeakSum(name) * MASTER_GAIN;
  ok(`single design "${name}" alone * MASTER_GAIN stays well under 1.0 (< 0.5)`, g < 0.5, `=${g.toFixed(3)}`);
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
