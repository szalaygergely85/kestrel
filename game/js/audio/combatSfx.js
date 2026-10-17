// EV17-01: combat feel audio. Pure event -> cue mapping + rate limiter over an injected synth
// ({ tone(opts), noise(opts) }); main.js passes the procedural WebAudio bursts (D-004). No audio files.
// 0 alloc in the trigger path: cue designs are frozen constants, the synth gets those objects directly.

const T = (freq, freqEnd, duration, release, peak, type = 'triangle') => Object.freeze({ type, freq, freqEnd, duration, attack: 0.002, release, peak });
const N = (duration, release, peak, filterType, filterFreq, filterQ = 0.8) => Object.freeze({ duration, attack: 0.002, release, peak, filterType, filterFreq, filterQ });

/** cue -> { tone?, noise?, minGapMs }. Peaks stay low (<= 0.3) so a full stack stays well under MASTER_GAIN headroom. */
export const COMBAT_CUES = Object.freeze({
  swing:     Object.freeze({ noise: N(0.12, 0.10, 0.12, 'bandpass', 1400, 0.7), tone: null, minGapMs: 120 }),
  hitLight:  Object.freeze({ tone: T(170, 90, 0.04, 0.09, 0.2), noise: N(0.03, 0.05, 0.1, 'lowpass', 1800), minGapMs: 60 }),
  hitHeavy:  Object.freeze({ tone: T(110, 50, 0.07, 0.18, 0.3, 'sine'), noise: N(0.05, 0.1, 0.16, 'lowpass', 1100), minGapMs: 60 }),
  hurt:      Object.freeze({ tone: T(90, 45, 0.08, 0.2, 0.3, 'sine'), noise: N(0.04, 0.08, 0.1, 'lowpass', 700), minGapMs: 150 }),
  beastDeath:Object.freeze({ tone: T(140, 55, 0.18, 0.35, 0.22, 'sawtooth'), noise: N(0.12, 0.2, 0.08, 'lowpass', 600), minGapMs: 200 }),
  heartbeat: Object.freeze({ tone: T(62, 42, 0.05, 0.12, 0.1, 'sine'), noise: null, minGapMs: 0 }),
});

export const HEARTBEAT = Object.freeze({ periodMs: 900, secondOffsetMs: 260 }); // lub-dub every 0.9 s

export function createCombatSfx({ tone, noise, isMuted = () => false, now = () => performance.now() }) {
  const last = { swing: -1e9, hitLight: -1e9, hitHeavy: -1e9, hurt: -1e9, beastDeath: -1e9, heartbeat: -1e9 };
  const counts = { swing: 0, hitLight: 0, hitHeavy: 0, hurt: 0, beastDeath: 0, heartbeat: 0 };
  let beatT = 0, beatOn = false, beatSecond = false;

  function play(name) {
    if (isMuted()) return false;
    const c = COMBAT_CUES[name], t = now();
    if (t - last[name] < c.minGapMs) return false;
    last[name] = t; counts[name]++;
    if (c.tone) tone(c.tone);
    if (c.noise) noise(c.noise);
    return true;
  }
  const api = {
    swing() { return play('swing'); },
    /** combat:hit payload: player hits -> light/heavy thud; hits on the player -> hurt thump. */
    hit(p) {
      if (!p) return false;
      if (p.target === 'player') return play('hurt');
      if (p.source === 'player') return play(p.heavy ? 'hitHeavy' : 'hitLight');
      return false;
    },
    beastDied() { return play('beastDeath'); },
    /** Once per tick. low = hurtFx low-hearts pulse active (<= 1 heart, alive). */
    step(dtMs, low) {
      if (!low) { beatOn = false; return; }
      if (!beatOn) { beatOn = true; beatT = HEARTBEAT.periodMs; beatSecond = false; } // first lub right away
      beatT += dtMs;
      if (beatSecond) { if (beatT >= HEARTBEAT.secondOffsetMs) { beatSecond = false; play('heartbeat'); } }
      else if (beatT >= HEARTBEAT.periodMs) { beatT = 0; beatSecond = true; play('heartbeat'); }
    },
    counts,
  };
  return api;
}
