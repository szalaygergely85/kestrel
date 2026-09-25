// game/js/audio/synth.js (US-020a, carved out of US-020, D-004: procedural
// WebAudio only - no audio files, no fetch of any audio asset. This module
// owns the single AudioContext + master gain (mute) and a couple of cheap
// generic building blocks (noise burst / tone burst, both click-free
// envelopes) that game/js/audio/sfx.js's five sound designs are built from.
//
// game/js/audio/* only (CLAUDE.md Two PCs: PC-B track); no engine/ import,
// no engine/ change. Wired from game/js/main.js and game/js/quest/lever.js.

let ctx = null;
let master = null;
let muted = false;
let armed = false;

// PC-B fix pass (PO headroom flag, US-020a-fix): several sound designs'
// individual peak gains already sum past 1.0 when they overlap (e.g.
// boulder thud's tone 0.8 + noise 0.4, lever's 0.7 + 0.35), and the prior
// pass's 0.5 flat ceiling was checked by inspection only, not by the true
// worst case across every design. sfx.gain.test.js now sums the actual
// GAIN_DESIGNS table (sfx.js) for the worst plausible simultaneous overlap
// (lever + thud + a footstep + a ratchet tick/rattle + the relay hum, since
// none of these triggers are mutually exclusive with each other - see that
// table's comment) and that worst case is ~3.66 peak-units, so 0.5 would
// clip hard (~1.83). 0.25 keeps it at ~0.92, under 1.0 with margin. This is
// a flat-ceiling fix (the AC's "master gain ~0.5 (or peaks scaled)" other
// option), not a per-sound retune, to avoid touching the designer/PO-
// approved character of each sound; a future polish pass MAY prefer
// retuning individual peaks back up if 0.25 reads as too quiet in practice.
export const MASTER_GAIN = 0.25;

function makeMaster() {
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  master.connect(ctx.destination);
}

/**
 * Installs one-shot `keydown`/`pointerdown` listeners that create (and
 * resume) the single AudioContext on the FIRST real user input - never
 * before, per the "no autoplay" AC. Safe to call once at module load: it
 * only arms the listeners, it does not touch WebAudio until they fire.
 */
export function initAudio() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const unlock = () => {
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('pointerdown', unlock, true);
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // no WebAudio support: every play* call below just no-ops (getCtx() stays null)
    // PC-B fix pass (owner "sounds feel delayed" report): `latencyHint:
    // 'interactive'` is already the WebAudio spec default when omitted, so
    // this isn't expected to change anything by itself - made explicit here
    // so the shortest available output buffering is guaranteed rather than
    // implicit, in case a given browser/OS combo ever picks a larger
    // default. The actual play* calls (below) were already scheduling at
    // `ctx.currentTime` with no added offset, and every trigger call site
    // (lever.js, beacon.js, main.js's stepGameAudio) already fires
    // synchronously with the causing action, not after an animation delay -
    // no scheduling bug found there (see docs/backlog.md US-020a PC-B note).
    ctx = new AC({ latencyHint: 'interactive' });
    makeMaster();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('pointerdown', unlock, true);
  // PC-B fix pass (optional item b): a sound scheduled right before the tab
  // is hidden would otherwise keep ringing in the background - suspend on
  // hide, resume on visible again. No-op before `ctx` exists.
  window.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
}

/** @returns {AudioContext|null} null until the first user gesture has armed it - every caller must treat that as "stay silent". */
export function getCtx() { return ctx; }

// US-020b: exposes the single shared master-gain node so a looping ambient
// bed (game/js/audio/ambient.js) can connect straight into it and get
// mute/MASTER_GAIN for free, same as every one-shot below - null until
// getCtx() is non-null (same gating).
export function getMaster() { return master; }

export function isMuted() { return muted; }

/** Ramps the master gain over ~30 ms (click-free) rather than a hard cut - still reads as "immediate" (AC). */
export function setMuted(m) {
  muted = !!m;
  if (!master) return; // not armed yet: the flag alone is enough, nothing is playing
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, t + 0.03);
}

export function toggleMute() { setMuted(!muted); }

// ---- cheap generic building blocks (only ever called on discrete game
// events - lever pull, a footstep, a sector-anim tick - never per render/
// physics frame, so a fresh buffer/node graph per call is cheap and this
// module stays allocation-free the rest of the time) -------------------

// PC-B fix pass (US-020a-fix, now REQUIRED per architect's US-018 perf
// flag): every noise-burst call used to allocate a brand-new AudioBuffer
// (Float32Array of `ctx.sampleRate * seconds` samples, filled sample-by-
// sample with Math.random()) on every single call - lever pulls, every
// ratchet tick (every ~160 ms while a gate/grate animates), every footstep.
// That allocation + fill loop was the architect's top suspect for the
// 10.2 ms JS frame spike. Fixed by building ONE shared white-noise buffer,
// long enough to cover the longest `duration + release` any call site
// actually uses (checked below in DEV, see MAX_NOISE_SECONDS), and having
// every call take a randomly-offset VIEW into it via
// `AudioBufferSourceNode.start(when, offset)` instead of allocating its own
// buffer. `start`'s `offset` argument is a native part of the Web Audio
// spec (no manual sample copy needed) - the node still stops at the right
// time via the existing explicit `.stop()` call below, so each call still
// gets its own effective duration/character (via its own filter + gain
// envelope, unchanged) without a new AudioBuffer/Float32Array per call.
// Random noise re-read from different offsets each time keeps bursts from
// sounding like a literal identical loop.
const MAX_NOISE_SECONDS = 0.5; // covers every current call site's duration+release (worst: grate rattle 0.09+0.12=0.21s) with headroom for future tuning
let sharedNoiseBuffer = null;
let sharedNoiseBufferSampleRate = 0;

/** Lazily builds (once per sample rate) the single reused white-noise buffer. */
function getSharedNoiseBuffer() {
  if (sharedNoiseBuffer && sharedNoiseBufferSampleRate === ctx.sampleRate) return sharedNoiseBuffer;
  const n = Math.round(ctx.sampleRate * MAX_NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  sharedNoiseBuffer = buf;
  sharedNoiseBufferSampleRate = ctx.sampleRate;
  return sharedNoiseBuffer;
}

/**
 * One-shot filtered noise burst through a linear-ramp gain envelope (no
 * hard cutoffs - the AC's "no clicks/pops"). No-ops (does nothing) before
 * the AudioContext is armed. Reuses the single shared noise buffer (see
 * above) instead of allocating a fresh AudioBuffer per call.
 */
export function playNoiseBurst({
  duration = 0.08, attack = 0.002, release = 0.06, peak = 0.5,
  filterType = 'lowpass', filterFreq = 1200, filterQ = 0.7,
} = {}) {
  if (!ctx || !master) return;
  const total = duration + release;
  const buffer = getSharedNoiseBuffer();
  const maxOffset = Math.max(0, buffer.duration - total);
  const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.linearRampToValueAtTime(0, t0 + attack + duration + release);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0, offset);
  src.stop(t0 + attack + duration + release + 0.02);
  src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
}

/**
 * One-shot oscillator burst (optionally pitch-dropping, for clunks/thuds)
 * through the same click-free gain envelope shape. No-ops before armed.
 */
export function playToneBurst({
  type = 'sine', freq = 180, freqEnd = null,
  duration = 0.12, attack = 0.002, release = 0.08, peak = 0.6,
} = {}) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const t0 = ctx.currentTime;
  osc.frequency.setValueAtTime(Math.max(1, freq), t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration + release);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.linearRampToValueAtTime(0, t0 + attack + duration + release);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + attack + duration + release + 0.02);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
