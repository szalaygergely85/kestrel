// game/js/audio/sfx.js (US-020a: minimal sound slice, carved out of US-020).
// Five procedural sounds + the glue that ties each one to an
// ALREADY-EXISTING engine hook - no engine change (D-004, CLAUDE.md Two PCs
// PC-B track). Wired from game/js/main.js (event subscriptions once at
// startup + one per-fixed-step poll call) and game/js/quest/lever.js (the
// lever's own direct one-shot call).
//
// Hooks used (docs/backlog.md US-020a):
//   1. lever clunk       - called directly from lever.js's `leverPull`.
//   2/3. gear ratchet /  - `world:sectorAnimated` (rate-limited tick) /
//        grate rattle      `world:sectorAnimDone` (settle rattle), tag 'grate'.
//   4. boulder thud      - game-side poll of the `tower.boulder` roller
//                          body's speed each fixed step (no `roller:rest`
//                          engine event exists - see engine/physics/roller.js).
//   5. footsteps         - game-side horizontal-distance accumulator using
//                          `body.landed`/the step's own x,y delta against
//                          `body.prevX/prevY` (engine/physics/integrate.js).
import { getCtx, isMuted, playNoiseBurst, playToneBurst } from './synth.js';
// US-020b: burner crackle+hiss / breach wind - two looping ambient beds,
// each driven by distance to a level-data position (game/js/audio/ambient.js).
import { HISS_BED_PEAK, CRACKLE_BURST_PEAK, WIND_BED_PEAK, resetAmbientAudio, stepAmbientAudio } from './ambient.js';
// US-020c: floor-material -> footstep timbre (stone/wood/iron), game/js/audio/surfaces.js.
import { surfaceTimbre } from './surfaces.js';

function canPlay() { return !!getCtx() && !isMuted(); }

// ---- PC-B fix pass (US-020a-fix): named peak-gain constants, one per tone/
// noise component of each sound design, used by the play*() calls below AND
// exported (as GAIN_DESIGNS) so sfx.gain.test.js reads the REAL values the
// game plays, not a hand-copied duplicate list that could drift out of sync.
// "Mutually exclusive" variants of the same trigger (a footstep is either a
// landing thump OR a mid-stride swish, never both from one call; a sector
// anim event is either a tick OR a settle-rattle) are still listed
// separately below - the test takes the louder of each such pair when it
// computes the worst simultaneous case, since only ONE of a pair can ever
// actually be sounding at a given instant.
const LEVER_TONE_PEAK = 0.7, LEVER_NOISE_PEAK = 0.35;
const RATCHET_TICK_TONE_PEAK = 0.18, RATCHET_TICK_NOISE_PEAK = 0.22;
const RATCHET_DONE_NOISE_PEAK = 0.3, RATCHET_DONE_TONE_PEAK = 0.25;
const THUD_TONE_PEAK = 0.8, THUD_NOISE_PEAK = 0.4;
const FOOTSTEP_LANDING_NOISE_PEAK = 0.32, FOOTSTEP_LANDING_TONE_PEAK = 0.3;
const FOOTSTEP_SWISH_NOISE_PEAK = 0.18;
const RELAY_HUM_LOW_PEAK = 0.16, RELAY_HUM_HIGH_PEAK = 0.08;

/**
 * Every sound design's peak gain(s), grouped by trigger. Read by
 * sfx.gain.test.js (game/js/audio/sfx.gain.test.js) to compute the true
 * worst-case simultaneous mix and assert it stays <= 1.0 once MASTER_GAIN
 * (synth.js) is applied - see that file and synth.js's MASTER_GAIN comment.
 */
export const GAIN_DESIGNS = {
  lever: [LEVER_TONE_PEAK, LEVER_NOISE_PEAK],
  ratchetTick: [RATCHET_TICK_TONE_PEAK, RATCHET_TICK_NOISE_PEAK],
  ratchetDone: [RATCHET_DONE_NOISE_PEAK, RATCHET_DONE_TONE_PEAK],
  thud: [THUD_TONE_PEAK, THUD_NOISE_PEAK],
  footstepLanding: [FOOTSTEP_LANDING_NOISE_PEAK, FOOTSTEP_LANDING_TONE_PEAK],
  footstepSwish: [FOOTSTEP_SWISH_NOISE_PEAK],
  relayHum: [RELAY_HUM_LOW_PEAK, RELAY_HUM_HIGH_PEAK],
  // US-020b: both beds can sound at the same time as any one-shot above (and
  // as each other) - neither belongs to a MUTUALLY_EXCLUSIVE_GROUPS pair, so
  // the worst-case-sum test below always adds both in full.
  burnerCrackle: [HISS_BED_PEAK, CRACKLE_BURST_PEAK],
  breachWind: [WIND_BED_PEAK],
};
// Pairs of mutually-exclusive designs (never sound at the same instant as
// each other) - the test picks the louder member of each pair, instead of
// summing both, when building the worst-case simultaneous total.
export const MUTUALLY_EXCLUSIVE_GROUPS = [
  ['ratchetTick', 'ratchetDone'],
  ['footstepLanding', 'footstepSwish'],
];

// ---- 1. lever clunk (one-shot, called directly from lever.js) -------------
export function playLeverClunk() {
  if (!canPlay()) return;
  playToneBurst({ type: 'triangle', freq: 140, freqEnd: 70, duration: 0.05, attack: 0.001, release: 0.09, peak: LEVER_TONE_PEAK });
  playNoiseBurst({ duration: 0.03, attack: 0.001, release: 0.05, peak: LEVER_NOISE_PEAK, filterType: 'lowpass', filterFreq: 700 });
}

// ---- 2/3. gear ratchet + grate rattle (sector-anim events, tag 'grate') ----
// Rate-limited to ~1 tick per 0.16 s of travel (target 0.12-0.2 s, story
// item 2) so it reads as a ratchet, not a per-physics-step buzz -
// `world:sectorAnimated` fires every moving fixed step (60 Hz while tweening).
// Uses `performance.now()` (wall clock), not `ctx.currentTime`: the rate
// limit must hold even if the AudioContext's own clock is throttled/not yet
// advancing (e.g. no audio device) - it gates SCHEDULING, not playback.
const TICK_INTERVAL_MS = 160;
let lastTickTime = -Infinity;

export function onSectorAnimated(evt) {
  if (!evt || evt.tag !== 'grate' || !canPlay()) return;
  const now = performance.now();
  if (now - lastTickTime < TICK_INTERVAL_MS) return;
  lastTickTime = now;
  playToneBurst({ type: 'square', freq: 620 + Math.random() * 60, duration: 0.015, attack: 0.001, release: 0.02, peak: RATCHET_TICK_TONE_PEAK }); // gear tick
  playNoiseBurst({ duration: 0.02, attack: 0.001, release: 0.03, peak: RATCHET_TICK_NOISE_PEAK, filterType: 'bandpass', filterFreq: 2200, filterQ: 1.2 }); // iron clack under it
}

export function onSectorAnimDone(evt) {
  if (!evt || evt.tag !== 'grate' || !canPlay()) return;
  playNoiseBurst({ duration: 0.09, attack: 0.002, release: 0.12, peak: RATCHET_DONE_NOISE_PEAK, filterType: 'bandpass', filterFreq: 1500, filterQ: 0.9 }); // settling rattle
  playToneBurst({ type: 'triangle', freq: 300, freqEnd: 160, duration: 0.06, attack: 0.001, release: 0.1, peak: RATCHET_DONE_TONE_PEAK });
}

function resetSectorAudio() {
  lastTickTime = -Infinity; // so the first tick after a fresh load/restart fires immediately, not after waiting TICK_INTERVAL
}

// ---- 4. boulder thud (game-side speed watch on 'tower.boulder', polled) ---
// `roller.sleeping` (engine/physics/roller.js) flips false->true on its own
// the moment friction/tilt can hold the spot for `sleepTime` - including at
// level load, with the boulder never touched (speed already 0). `everMoved`
// gates the thud on "was actually rolling at some point since the last
// settle", so a fresh/idle boulder never fires one on its own.
const BOULDER_ID = 'tower.boulder';
const BOULDER_MOVE_SPEED = 0.15; // m/s: comfortably above sleep/friction noise

let boulderEntity = null;
let boulderPrevSleeping = true;
let boulderEverMoved = false;

function resetBoulderAudio(world) {
  boulderEntity = (world && world.entity(BOULDER_ID)) || null;
  const roller = boulderEntity && boulderEntity.components && boulderEntity.components.roller;
  boulderPrevSleeping = roller ? !!roller.sleeping : true;
  boulderEverMoved = false;
}

function playBoulderThud() {
  playToneBurst({ type: 'sine', freq: 90, freqEnd: 45, duration: 0.09, attack: 0.001, release: 0.16, peak: THUD_TONE_PEAK });
  playNoiseBurst({ duration: 0.05, attack: 0.001, release: 0.1, peak: THUD_NOISE_PEAK, filterType: 'lowpass', filterFreq: 500 });
}

function stepBoulderAudio() {
  if (!boulderEntity) return;
  const roller = boulderEntity.components && boulderEntity.components.roller;
  const body = boulderEntity.components && boulderEntity.components.body;
  if (!roller || !body) return;
  const speed = Math.hypot(body.vx, body.vy);
  if (!roller.sleeping && speed > BOULDER_MOVE_SPEED) boulderEverMoved = true;
  if (roller.sleeping && !boulderPrevSleeping && boulderEverMoved) {
    if (canPlay()) playBoulderThud();
    boulderEverMoved = false; // one thud per settle - needs fresh movement before the next one
  }
  boulderPrevSleeping = roller.sleeping;
}

// ---- 5. footsteps (game-side distance accumulator) -------------------------
// Stride distance (within the 0.7-0.9 m target) is fixed; "faster while
// running" falls out of the same accumulator naturally (more metres per
// second in -> steps fire more often), no separate run-speed branch needed.
const STRIDE_M = 0.8;
// PC-B fix pass (owner "sounds feel delayed" report): the FIRST step after
// standing still used to wait for the same full 0.8 m stride as every step
// after it, which reads as "walking starts late" the instant the player
// begins moving from a stop. `footWasStill` tracks whether the player was
// stationary (or just spawned/reset) since the last footstep, so that one
// first step fires at a much shorter distance - every step after it goes
// back to the normal stride.
const FIRST_STEP_M = 0.35;
let footAccum = 0;
let footWasStill = true;
// US-020c: the world reference used to look up the floor material under the
// player - set once per load/restart by resetFootstepAudio(world) (same
// 'world:loaded' entry point as boulderEntity/ambient positions below), read
// only at the moment a footstep actually plays (not every fixed step).
let footWorld = null;

// Per-timbre tone/noise shape ('stone' keeps the original US-020a numbers
// byte-for-byte - AC "stone (the current step)"). Peaks (loudness) are NOT
// varied per timbre - only pitch/duration/filtering - so sfx.gain.test.js's
// worst-case-sum stays valid for every surface without a copy per timbre.
const FOOTSTEP_TIMBRES = {
  stone: {
    toneType: 'sine', toneFreq: 110, toneFreqEnd: 70, toneDuration: 0.03, toneRelease: 0.06,
    noiseFilterType: 'lowpass', noiseFilterFreq: 500, noiseFilterQ: 0.7, noiseDuration: 0.03, noiseRelease: 0.05,
    swishFilterType: 'lowpass', swishFilterFreq: 650, swishFilterQ: 0.7, swishDuration: 0.02, swishRelease: 0.04,
  },
  // wood/deck: lower pitch + a bandpass "box" resonance instead of a plain
  // lowpass, longer release - reads as a hollow knock next to stone's thud.
  wood: {
    toneType: 'triangle', toneFreq: 70, toneFreqEnd: 45, toneDuration: 0.05, toneRelease: 0.09,
    noiseFilterType: 'bandpass', noiseFilterFreq: 280, noiseFilterQ: 1.1, noiseDuration: 0.04, noiseRelease: 0.07,
    swishFilterType: 'bandpass', swishFilterFreq: 350, swishFilterQ: 1.1, swishDuration: 0.025, swishRelease: 0.05,
  },
  // iron/grate: short and high - a square-wave tick over a tight, high
  // bandpass noise burst, both much shorter than stone/wood.
  iron: {
    toneType: 'square', toneFreq: 500, toneFreqEnd: 340, toneDuration: 0.015, toneRelease: 0.03,
    noiseFilterType: 'bandpass', noiseFilterFreq: 2200, noiseFilterQ: 1.4, noiseDuration: 0.015, noiseRelease: 0.03,
    swishFilterType: 'bandpass', swishFilterFreq: 1800, swishFilterQ: 1.4, swishDuration: 0.012, swishRelease: 0.025,
  },
};

function playFootstep(landing, mat) {
  const d = FOOTSTEP_TIMBRES[surfaceTimbre(mat)];
  const jitter = 0.92 + Math.random() * 0.16; // +/-8% pitch variation (AC: "not a metronome")
  if (landing) {
    playNoiseBurst({ duration: d.noiseDuration, attack: 0.001, release: d.noiseRelease, peak: FOOTSTEP_LANDING_NOISE_PEAK, filterType: d.noiseFilterType, filterFreq: d.noiseFilterFreq * jitter, filterQ: d.noiseFilterQ });
    playToneBurst({ type: d.toneType, freq: d.toneFreq * jitter, freqEnd: d.toneFreqEnd * jitter, duration: d.toneDuration, attack: 0.001, release: d.toneRelease, peak: FOOTSTEP_LANDING_TONE_PEAK });
  } else {
    playNoiseBurst({ duration: d.swishDuration, attack: 0.001, release: d.swishRelease, peak: FOOTSTEP_SWISH_NOISE_PEAK, filterType: d.swishFilterType, filterFreq: d.swishFilterFreq * jitter, filterQ: d.swishFilterQ });
  }
}

// US-020c: the floor material under (x,y), via the confirmed public World
// query (docs/backlog.md row 28c / architecture.md 18): `sectorAt` inside a
// structure, else `outsideSector`'s reused scratch object (never allocated -
// read once, synchronously, right here) for open terrain. No world loaded
// yet (footWorld null, e.g. very first fixed step before 'world:loaded')
// falls back to the plain 'floor' key, which surfaceTimbre() maps to 'stone'.
function floorMatAt(x, y) {
  if (!footWorld) return 'floor';
  const sec = footWorld.sectorAt(x, y) || footWorld.outsideSector(x, y);
  return sec.floorMat;
}

function stepFootstepAudio(entity) {
  const body = entity.components && entity.components.body;
  if (!body) return;
  if (body.landed) {
    footAccum = 0; // a landing footfall does not also double-count toward the next stride
    footWasStill = false; // the landing thump itself already read as "a step" - next one is a normal-cadence stride, not another short first-step
    if (canPlay()) playFootstep(true, floorMatAt(entity.transform.x, entity.transform.y));
    return;
  }
  if (!body.grounded) return; // airborne: silent
  const dx = entity.transform.x - body.prevX;
  const dy = entity.transform.y - body.prevY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) {
    // Standing still: silent, and reset the "distance since standstill"
    // count so the next step (whenever movement resumes) uses the short
    // FIRST_STEP_M threshold measured from THIS standstill, not leftover
    // accumulation from before the player stopped.
    footWasStill = true;
    footAccum = 0;
    return;
  }
  footAccum += dist;
  const threshold = footWasStill ? FIRST_STEP_M : STRIDE_M;
  if (footAccum >= threshold) {
    footAccum -= threshold;
    footWasStill = false;
    if (canPlay()) playFootstep(false, floorMatAt(entity.transform.x, entity.transform.y));
  }
}

function resetFootstepAudio(world) {
  footAccum = 0;
  footWasStill = true; // the very first step after a fresh load/restart also uses the short FIRST_STEP_M threshold
  footWorld = world || null;
}

// ---- US-022 (sprint-2 "adds a relay hum to #2 if cheap"): one-shot swell,
// called directly from game/js/quest/beacon.js's `beaconLight` at the moment
// the player wakes the relay - no new engine hook (reuses `playToneBurst`'s
// existing attack/release envelope, just a slower attack than any of the
// five US-020a sounds use), no sustained node graph to track/stop across a
// restart (a long `attack`+`release` one-shot swell reads as a hum without
// needing per-frame upkeep). A perfect fifth (220/330 Hz), not a single
// tone, so it reads as "magic" next to the lever/boulder/footstep thuds.
export function playRelayHum() {
  if (!canPlay()) return;
  playToneBurst({ type: 'sine', freq: 220, duration: 0.6, attack: 1.0, release: 1.4, peak: RELAY_HUM_LOW_PEAK });
  playToneBurst({ type: 'sine', freq: 330, duration: 0.6, attack: 1.0, release: 1.4, peak: RELAY_HUM_HIGH_PEAK });
}

// ---- combined per-fixed-step poll (main.js's update(), once per step) -----
export function stepGameAudio(playerEntity) {
  if (playerEntity) stepFootstepAudio(playerEntity);
  stepBoulderAudio();
  stepAmbientAudio(playerEntity); // US-020b: burner crackle+hiss / breach wind
}

// ---- combined reset (main.js's 'world:loaded' handler - runs on the first
// load AND every restart, architecture.md 7.4's "module-level game
// variables are reset only in the 'world:loaded' handler" rule) -----------
export function resetGameAudio(world) {
  resetSectorAudio();
  resetFootstepAudio(world);
  resetBoulderAudio(world);
  resetAmbientAudio(world); // US-020b: re-reads brazier/breach positions, tears down + will lazily rebuild the two loops
}

// ---- US-020c test-only hooks (no game code calls these - same __test_
// pattern as ambient.js) - let a Node test drive the real floor-material
// lookup and timbre selection with a fake `world` (no real WebAudio/
// AudioContext needed), instead of only unit-testing surfaceTimbre() in
// isolation. ------------------------------------------------------------
export function __test_setFootWorld(world) { footWorld = world; }
export function __test_floorMatAt(x, y) { return floorMatAt(x, y); }
export function __test_footstepDesignFor(mat) { return FOOTSTEP_TIMBRES[surfaceTimbre(mat)]; }
