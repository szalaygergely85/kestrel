// ANIM-STATE-01a (US-083 slice): pure animation state machine, no render, no allocation per step.
// def = { states: { idle, walk, windup, attack, hurt, die: { clip, frames, frameMs, loop?,
//         events?: [{ frame, name }] } }, transitions?: { windup: 'attack', ... } }
// `clip` is an animation.js clip name (resolved by the caller); this module never touches it.
// Priority die > hurt > attack > windup > walk > idle. A non-looping state that finishes goes to
// def.transitions[name] if set, else back to the base locomotion state (last idle/walk request).
// die is terminal. Frame events fire once per play (a looping clip re-arms on wrap).

export const PRIORITY = { idle: 0, walk: 1, windup: 2, attack: 3, hurt: 4, die: 5 };
export const BLEND_MS = 80;

/** Weight (0..1) of the new state `tMs` after a switch; monotone, linear. */
export function blend(tMs) { return tMs <= 0 ? 0 : tMs >= BLEND_MS ? 1 : tMs / BLEND_MS; }

export function createAnimState(def) {
  const s = {
    def, name: 'idle', prev: 'idle', base: 'idle', t: 0, frame: 0, fired: -1,
    sinceSwitchMs: BLEND_MS, dead: false, finished: false,
    request, update, blend: (tMs) => blend(tMs === undefined ? s.sinceSwitchMs : tMs),
  };
  function enter(name) {
    s.prev = s.name; s.name = name; s.t = 0; s.frame = 0; s.fired = -1;
    s.sinceSwitchMs = 0; s.finished = false;
  }
  /** Returns true if the state changed. Lower priority requests only update the base state. */
  function request(name) {
    if (s.dead || PRIORITY[name] === undefined || !def.states[name]) return false;
    if (name === 'idle' || name === 'walk') {
      s.base = name;
      if (s.name === 'idle' || s.name === 'walk') { if (s.name === name) return false; enter(name); return true; }
      return false;
    }
    if (name === s.name) return false;
    if (PRIORITY[name] < PRIORITY[s.name]) return false;
    if (name === 'die') s.dead = true;
    enter(name);
    return true;
  }
  /** Advance dtMs; onEvent(eventName, stateName) is called for each frame event crossed. */
  function update(dtMs, onEvent) {
    s.sinceSwitchMs += dtMs;
    const st = def.states[s.name];
    s.t += dtMs;
    const total = st.frames * st.frameMs;
    let last = Math.floor(s.t / st.frameMs);
    let wrapped = false;
    if (last >= st.frames) {
      if (st.loop) { s.t %= total; last = Math.floor(s.t / st.frameMs); wrapped = true; }
      else last = st.frames - 1;
    }
    const ev = st.events;
    if (ev) {
      // wrapped: finish the old lap's remaining events, then the new lap's start
      for (let pass = 0; pass < (wrapped ? 2 : 1); pass++) {
        const upTo = wrapped && pass === 0 ? st.frames - 1 : last;
        for (let i = 0; i < ev.length; i++) {
          const f = ev[i].frame;
          if (f > s.fired && f <= upTo && onEvent) onEvent(ev[i].name, s.name);
        }
        s.fired = wrapped && pass === 0 ? -1 : upTo;
      }
    }
    s.frame = last;
    if (!st.loop && s.t >= total && !s.dead) {
      s.finished = true;
      const nx = def.transitions && def.transitions[s.name];
      enter(nx && def.states[nx] ? nx : s.base);
    } else if (!st.loop && s.t >= total) s.finished = true; // die: hold last frame
  }
  return s;
}
