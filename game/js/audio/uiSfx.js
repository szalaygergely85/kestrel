// EV17-02: quest + pickup + pause-menu audio cues. Same pattern as combatSfx.js: a frozen cue table, a rate limiter
// and an injected synth ({ tone(opts) }); muted = nothing scheduled. Multi-step cues schedule later steps through the injected `later`.

const T = (freq, duration, release, peak, type = 'sine', freqEnd = freq) => Object.freeze({ type, freq, freqEnd, duration, attack: 0.004, release, peak });
const S = (delayMs, tone) => Object.freeze({ delayMs, tone });

/** cue -> { steps:[{delayMs,tone}], minGapMs }. Peaks <= 0.16: quiet UI layer; menu tick is the softest. */
export const UI_CUES = Object.freeze({
  questAccepted: Object.freeze({ steps: Object.freeze([S(0, T(392, 0.09, 0.14, 0.14)), S(110, T(587, 0.12, 0.2, 0.15))]), minGapMs: 400 }),   // rising two-tone G4 -> D5
  questReady:    Object.freeze({ steps: Object.freeze([S(0, T(988, 0.1, 0.35, 0.09)), S(70, T(1319, 0.14, 0.45, 0.07))]), minGapMs: 400 }),    // soft chime B5 + E6
  questDone:     Object.freeze({ steps: Object.freeze([S(0, T(262, 0.18, 0.4, 0.12, 'triangle')), S(0, T(330, 0.18, 0.4, 0.1, 'triangle')), S(0, T(392, 0.18, 0.4, 0.1, 'triangle')), S(140, T(523, 0.22, 0.55, 0.12))]), minGapMs: 600 }), // C major chord + octave
  itemGet:       Object.freeze({ steps: Object.freeze([S(0, T(1568, 0.04, 0.12, 0.07)), S(55, T(2093, 0.04, 0.12, 0.06)), S(110, T(2637, 0.05, 0.2, 0.05))]), minGapMs: 250 }), // sparkle arpeggio
  menuMove:      Object.freeze({ steps: Object.freeze([S(0, T(660, 0.012, 0.03, 0.035))]), minGapMs: 40 }),
  menuConfirm:   Object.freeze({ steps: Object.freeze([S(0, T(520, 0.02, 0.05, 0.05)), S(40, T(780, 0.02, 0.07, 0.05))]), minGapMs: 80 }),
});

/** quest book event name -> cue. */
export const QUEST_EVENT_CUE = Object.freeze({ 'quest:accepted': 'questAccepted', 'quest:ready': 'questReady', 'quest:done': 'questDone' });

export function createUiSfx({ tone, isMuted = () => false, now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms) }) {
  const last = {}, counts = {};
  for (const k of Object.keys(UI_CUES)) { last[k] = -1e9; counts[k] = 0; }
  function play(name) {
    const c = UI_CUES[name];
    if (!c || isMuted()) return false;
    const t = now();
    if (t - last[name] < c.minGapMs) return false;
    last[name] = t; counts[name]++;
    for (let i = 0; i < c.steps.length; i++) {
      const s = c.steps[i];
      if (s.delayMs <= 0) tone(s.tone); else later(() => { if (!isMuted()) tone(s.tone); }, s.delayMs);
    }
    return true;
  }
  return {
    /** Quest book onChange(name, id): accepted / ready / done each map to one cue; other names are ignored. */
    quest(name) { const c = QUEST_EVENT_CUE[name]; return c ? play(c) : false; },
    itemGet() { return play('itemGet'); },
    menuMove() { return play('menuMove'); },
    menuConfirm() { return play('menuConfirm'); },
    counts,
  };
}
