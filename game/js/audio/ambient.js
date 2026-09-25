// game/js/audio/ambient.js (US-020b: burner crackle-and-hiss + breach wind)
//
// Two looping ambient beds, each driven by the PLAYER'S DISTANCE to a
// position read from level data - never a literal coordinate (AC):
//   - burner crackle+hiss: distance to the tower's `lights` entry whose id
//     is 'brazier' (design/levels/tower.js - the Kestrel's copper burner,
//     torch preset). Full at <= BRAZIER_FULL_M, silent at >= BRAZIER_SILENT_M.
//   - breach wind: distance to the tower's `markers.breach`, silent below
//     the summit floor (read from the `hintExit` trigger's own `zMin`,
//     falling back to a constant only if that trigger is ever removed),
//     rising over the last WIND_FADE_M metres to the breach.
//
// Both beds route through synth.js's shared MASTER GAIN node (getMaster()),
// same as every US-020a one-shot - `N` (mute) silences them for free, no
// separate mute plumbing here. Each bed's node graph (noise source, filter,
// gain(s), and - for wind - an LFO for "slow gusts") is built ONCE, lazily,
// the first time stepAmbientAudio() runs with a live AudioContext (i.e.
// after the first user gesture, same gesture-gated rule as every other
// sound - see synth.js's initAudio) and left running; per-frame work is
// only a couple of property reads plus `gain.setTargetAtTime()` calls (no
// buffer/node allocation per frame - AC). The wind's "gusts" are pure
// audio-rate modulation (an OscillatorNode feeding the gain AudioParam), so
// they cost nothing extra per JS frame either.
//
// Torn down and rebuilt by resetAmbientAudio(world), called from sfx.js's
// resetGameAudio(world) - the one place (architecture.md 7.4) both the
// first load AND every restart (`R`) go through, so a restart cannot double
// up loops (see ambient.restart.test.js).
import { getCtx, getMaster, isMuted, playNoiseBurst } from './synth.js';

// ---- tuning constants (distances/peaks are tuning, not level data - only
// the brazier/breach POSITIONS themselves come from level data, per AC) ----
const BRAZIER_FULL_M = 2;
const BRAZIER_SILENT_M = 12;
const WIND_FADE_M = 6.0; // last stretch of the summit ring into the breach
const SUMMIT_ZMIN_FALLBACK = 5.9; // only used if a level ever drops the hintExit trigger
const GAIN_SMOOTH_TC = 0.3; // setTargetAtTime time constant (s) - no zipper noise
const CRACKLE_MIN_GAP_MS = 150;
const CRACKLE_MAX_EXTRA_MS = 400;
const CRACKLE_AUDIBLE_GAIN = 0.02; // below this, skip scheduling bursts entirely (inaudible anyway)

// Peak gains (same units/convention as sfx.js's GAIN_DESIGNS: the node's own
// gain BEFORE synth.js's MASTER_GAIN) - exported so sfx.js's GAIN_DESIGNS
// (and its worst-case-sum test) reads the real numbers, not a copy.
export const HISS_BED_PEAK = 0.05;
export const CRACKLE_BURST_PEAK = 0.07;
export const WIND_BED_PEAK = 0.09;

const HISS_BUFFER_SECONDS = 2.0;
const WIND_BUFFER_SECONDS = 3.0;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---- pure gain math (exported: directly unit-testable without a real/mock
// AudioContext - see ambient.restart.test.js's gain-curve checks) ----------
/** 0..1: 1 at <= BRAZIER_FULL_M from the burner, 0 at >= BRAZIER_SILENT_M, linear between. */
export function brazierGainFor(distance3D) {
  return clamp01((BRAZIER_SILENT_M - distance3D) / (BRAZIER_SILENT_M - BRAZIER_FULL_M));
}
/** 0..1: 0 below the summit floor (playerZ < summitZMin), else 1 at the breach fading to 0 over WIND_FADE_M. */
export function windGainFor(playerZ, horizontalDistanceToBreach, summitZMin) {
  if (playerZ < summitZMin) return 0;
  return clamp01(1 - horizontalDistanceToBreach / WIND_FADE_M);
}

// ---- level-data lookups (no literal coordinates - AC) ----------------------
function findWorldLight(world, lightId) {
  for (const s of world.structures) {
    const def = s.level && s.level.def;
    const ld = def && def.lights && def.lights.find((l) => l.id === lightId);
    if (ld) return { x: ld.x + s.origin.x, y: ld.y + s.origin.y, z: ld.z + s.origin.z };
  }
  return null;
}

function findWorldMarker(world, markerId) {
  for (const s of world.structures) {
    const def = s.level && s.level.def;
    const m = def && def.markers && def.markers[markerId];
    if (m) return { x: m.x + s.origin.x, y: m.y + s.origin.y, z: (m.z || 0) + s.origin.z };
  }
  return null;
}

function findSummitZMin(world) {
  for (const s of world.structures) {
    const def = s.level && s.level.def;
    const trig = def && def.triggers && def.triggers.find((t) => t.id === 'hintExit');
    if (trig && typeof trig.zMin === 'number') return trig.zMin + s.origin.z;
  }
  return SUMMIT_ZMIN_FALLBACK;
}

// ---- node graph (built once, torn down on restart) -------------------------
let hiss = null; // { source, filter, gain }
let wind = null; // { source, filter, distGain, gustGain, gustLfo, gustDepth }
let nextCrackleAt = 0;

let brazierPos = null;
let breachPos = null;
let summitZMin = SUMMIT_ZMIN_FALLBACK;

function makeLoopingNoiseSource(ctx, seconds) {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function buildHiss(ctx, master) {
  const source = makeLoopingNoiseSource(ctx, HISS_BUFFER_SECONDS);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2500;
  filter.Q.value = 0.5;
  const gain = ctx.createGain();
  gain.gain.value = 0; // silent until the first distance update ramps it
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();
  return { source, filter, gain };
}

function buildWind(ctx, master) {
  const source = makeLoopingNoiseSource(ctx, WIND_BUFFER_SECONDS);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.6;
  const distGain = ctx.createGain(); // per-frame distance target (setTargetAtTime)
  distGain.gain.value = 0;
  const gustGain = ctx.createGain(); // base 1, modulated by the LFO below - audio-rate, no per-frame JS cost
  gustGain.gain.value = 1;
  const gustLfo = ctx.createOscillator();
  gustLfo.type = 'sine';
  gustLfo.frequency.value = 0.07 + Math.random() * 0.05; // one slow gust every ~11-20 s
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.35; // gusts swing gustGain +-0.35 around 1 (never fully drop mid-gust)
  gustLfo.connect(gustDepth);
  gustDepth.connect(gustGain.gain);
  gustLfo.start();
  source.connect(filter);
  filter.connect(distGain);
  distGain.connect(gustGain);
  gustGain.connect(master);
  source.start();
  return { source, filter, distGain, gustGain, gustLfo, gustDepth };
}

function stopNode(n) {
  try { n.stop(); } catch (e) { /* already stopped / not a source - fine */ }
  try { n.disconnect(); } catch (e) { /* fine */ }
}

function teardownAmbient() {
  if (hiss) {
    stopNode(hiss.source);
    try { hiss.filter.disconnect(); } catch (e) { /* fine */ }
    try { hiss.gain.disconnect(); } catch (e) { /* fine */ }
    hiss = null;
  }
  if (wind) {
    stopNode(wind.source);
    stopNode(wind.gustLfo);
    try { wind.filter.disconnect(); } catch (e) { /* fine */ }
    try { wind.distGain.disconnect(); } catch (e) { /* fine */ }
    try { wind.gustGain.disconnect(); } catch (e) { /* fine */ }
    try { wind.gustDepth.disconnect(); } catch (e) { /* fine */ }
    wind = null;
  }
}

function ensureBuilt(ctx, master) {
  if (!hiss) hiss = buildHiss(ctx, master);
  if (!wind) wind = buildWind(ctx, master);
}

/**
 * Reads the brazier/breach world positions (+ the summit floor height) from
 * the just-(re)loaded world's level data, and tears down any previous node
 * graph so a restart (`R`) cannot leave doubled loops running - the next
 * stepAmbientAudio() call rebuilds fresh nodes lazily. Call from the same
 * 'world:loaded' handler as every other US-020a reset (architecture.md 7.4).
 */
export function resetAmbientAudio(world) {
  teardownAmbient();
  nextCrackleAt = 0;
  brazierPos = world ? findWorldLight(world, 'brazier') : null;
  breachPos = world ? findWorldMarker(world, 'breach') : null;
  summitZMin = world ? findSummitZMin(world) : SUMMIT_ZMIN_FALLBACK;
}

/**
 * Per-fixed-step update (called from sfx.js's stepGameAudio). No-ops until
 * the AudioContext exists (first user gesture). Builds the node graph on
 * its first real call, then only reads the player's position and a couple
 * of level-data-derived targets, and ramps the two distance gains via
 * `setTargetAtTime` - no per-frame allocation.
 */
export function stepAmbientAudio(playerEntity) {
  const ctx = getCtx();
  const master = getMaster();
  if (!ctx || !master) return; // no gesture yet: stay silent, nothing built yet
  ensureBuilt(ctx, master);
  if (!playerEntity || !playerEntity.transform) return;
  const px = playerEntity.transform.x, py = playerEntity.transform.y, pz = playerEntity.transform.z;
  const now = ctx.currentTime;

  if (brazierPos) {
    const d = Math.hypot(px - brazierPos.x, py - brazierPos.y, pz - brazierPos.z);
    const g = brazierGainFor(d);
    hiss.gain.gain.setTargetAtTime(g * HISS_BED_PEAK, now, GAIN_SMOOTH_TC);
    if (!isMuted() && g > CRACKLE_AUDIBLE_GAIN && performance.now() >= nextCrackleAt) {
      playNoiseBurst({
        duration: 0.02 + Math.random() * 0.03, attack: 0.001, release: 0.05 + Math.random() * 0.05,
        peak: CRACKLE_BURST_PEAK * g, filterType: 'bandpass', filterFreq: 1800 + Math.random() * 2200, filterQ: 1.0,
      });
      nextCrackleAt = performance.now() + CRACKLE_MIN_GAP_MS + Math.random() * CRACKLE_MAX_EXTRA_MS;
    }
  }

  if (breachPos) {
    const d = Math.hypot(px - breachPos.x, py - breachPos.y);
    const g = windGainFor(pz, d, summitZMin);
    wind.distGain.gain.setTargetAtTime(g * WIND_BED_PEAK, now, GAIN_SMOOTH_TC);
  }
}

// ---- test-only hooks (ambient.restart.test.js): drive the real build/
// teardown logic with a mocked ctx/master, without needing a real
// AudioContext or synth.js's window-gesture gating. Never called from game
// code. ----------------------------------------------------------------
export function __test_build(ctx, master) { ensureBuilt(ctx, master); }
export function __test_teardown() { teardownAmbient(); }
// Exposes the real level-data lookups so a test can assert the positions
// resolved from a real, loaded world (design/levels/tower.js) match that
// level's own lights/markers/triggers data - i.e. "read from level data",
// not a hand-typed literal (US-020b AC).
export function __test_resolvePositions(world) {
  return { brazierPos: findWorldLight(world, 'brazier'), breachPos: findWorldMarker(world, 'breach'), summitZMin: findSummitZMin(world) };
}
export function __test_liveNodeCount() {
  let n = 0;
  if (hiss) n += Object.keys(hiss).length;
  if (wind) n += Object.keys(wind).length;
  return n;
}
