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

function canPlay() { return !!getCtx() && !isMuted(); }

// ---- 1. lever clunk (one-shot, called directly from lever.js) -------------
export function playLeverClunk() {
  if (!canPlay()) return;
  playToneBurst({ type: 'triangle', freq: 140, freqEnd: 70, duration: 0.05, attack: 0.001, release: 0.09, peak: 0.7 });
  playNoiseBurst({ duration: 0.03, attack: 0.001, release: 0.05, peak: 0.35, filterType: 'lowpass', filterFreq: 700 });
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
  playToneBurst({ type: 'square', freq: 620 + Math.random() * 60, duration: 0.015, attack: 0.001, release: 0.02, peak: 0.18 }); // gear tick
  playNoiseBurst({ duration: 0.02, attack: 0.001, release: 0.03, peak: 0.22, filterType: 'bandpass', filterFreq: 2200, filterQ: 1.2 }); // iron clack under it
}

export function onSectorAnimDone(evt) {
  if (!evt || evt.tag !== 'grate' || !canPlay()) return;
  playNoiseBurst({ duration: 0.09, attack: 0.002, release: 0.12, peak: 0.3, filterType: 'bandpass', filterFreq: 1500, filterQ: 0.9 }); // settling rattle
  playToneBurst({ type: 'triangle', freq: 300, freqEnd: 160, duration: 0.06, attack: 0.001, release: 0.1, peak: 0.25 });
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
  playToneBurst({ type: 'sine', freq: 90, freqEnd: 45, duration: 0.09, attack: 0.001, release: 0.16, peak: 0.8 });
  playNoiseBurst({ duration: 0.05, attack: 0.001, release: 0.1, peak: 0.4, filterType: 'lowpass', filterFreq: 500 });
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
let footAccum = 0;

function playFootstep(landing) {
  const jitter = 0.92 + Math.random() * 0.16; // +/-8% pitch variation (AC: "not a metronome")
  if (landing) {
    playNoiseBurst({ duration: 0.03, attack: 0.001, release: 0.05, peak: 0.32, filterType: 'lowpass', filterFreq: 500 * jitter });
    playToneBurst({ type: 'sine', freq: 110 * jitter, freqEnd: 70 * jitter, duration: 0.03, attack: 0.001, release: 0.06, peak: 0.3 });
  } else {
    playNoiseBurst({ duration: 0.02, attack: 0.001, release: 0.04, peak: 0.18, filterType: 'lowpass', filterFreq: 650 * jitter });
  }
}

function stepFootstepAudio(entity) {
  const body = entity.components && entity.components.body;
  if (!body) return;
  if (body.landed) {
    footAccum = 0; // a landing footfall does not also double-count toward the next stride
    if (canPlay()) playFootstep(true);
    return;
  }
  if (!body.grounded) return; // airborne: silent
  const dx = entity.transform.x - body.prevX;
  const dy = entity.transform.y - body.prevY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) return; // standing still: silent
  footAccum += dist;
  if (footAccum >= STRIDE_M) {
    footAccum -= STRIDE_M;
    if (canPlay()) playFootstep(false);
  }
}

function resetFootstepAudio() {
  footAccum = 0;
}

// ---- combined per-fixed-step poll (main.js's update(), once per step) -----
export function stepGameAudio(playerEntity) {
  if (playerEntity) stepFootstepAudio(playerEntity);
  stepBoulderAudio();
}

// ---- combined reset (main.js's 'world:loaded' handler - runs on the first
// load AND every restart, architecture.md 7.4's "module-level game
// variables are reset only in the 'world:loaded' handler" rule) -----------
export function resetGameAudio(world) {
  resetSectorAudio();
  resetFootstepAudio();
  resetBoulderAudio(world);
}
