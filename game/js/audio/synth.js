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

// PC-B fix pass (PO headroom flag): several sounds' individual peak gains
// already sum past 1.0 when they overlap (e.g. boulder thud's tone 0.8 +
// noise 0.4, lever's 0.7 + 0.35) - a flat master ceiling well under full
// scale is cheaper and safer than re-tuning every playToneBurst/playNoiseBurst
// call site's peak, and still leaves plenty of headroom above the mix.
const MASTER_GAIN = 0.5;

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

/** A short mono white-noise buffer, `seconds` long. */
function noiseBuffer(seconds) {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * One-shot filtered noise burst through a linear-ramp gain envelope (no
 * hard cutoffs - the AC's "no clicks/pops"). No-ops (does nothing) before
 * the AudioContext is armed.
 */
export function playNoiseBurst({
  duration = 0.08, attack = 0.002, release = 0.06, peak = 0.5,
  filterType = 'lowpass', filterFreq = 1200, filterQ = 0.7,
} = {}) {
  if (!ctx || !master) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration + release);
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
  src.start(t0);
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
