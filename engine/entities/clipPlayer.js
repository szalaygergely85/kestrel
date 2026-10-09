// engine/entities/clipPlayer.js - WILD-02 (architecture.md 38.31 item 8): per-instance clip state with a
// crossfade, for ambient fauna (not World entities). Plain struct, no allocation after createClipPlayer().
// Clip semantics follow stepAnimations (durMs per frame, step guard); no events in v1.
//   const p = createClipPlayer(); clipPlay(p, pm, idx, true, 120); clipStep(p, pm, dtMs);
//   const i = pool.pushInstance(.., p.clip, p.frame, p.tMs); if (p.fadeT < p.fadeMs) pool.blendInstance(i, p.fromClip, p.fromFrame, p.fromTMs, clipFromW(p));

const MAX_STEPS_PER_CALL = 64;

export function createClipPlayer() {
  return { clip: -1, frame: 0, tMs: 0, loop: true, rate: 1, next: -1,
    fromClip: -1, fromFrame: 0, fromTMs: 0, fadeMs: 0, fadeT: 0 };
}

function clipOf(pm, idx) {
  return idx >= 0 && pm && pm.clips && idx < pm.clips.length ? pm.clips[idx] : null;
}

/** Starts `clipIdx` (frame 0). The current pose becomes the from-clip of a `fadeMs` crossfade (0 = hard cut).
 * `next` (>= 0) is played (looping) when a non-loop clip ends. */
export function clipPlay(p, pm, clipIdx, loop, fadeMs, next = -1) {
  if (fadeMs > 0 && p.clip >= 0) {
    p.fromClip = p.clip; p.fromFrame = p.frame; p.fromTMs = p.tMs;
    p.fadeMs = fadeMs; p.fadeT = 0;
  } else {
    p.fromClip = -1; p.fadeMs = 0; p.fadeT = 0;
  }
  p.clip = clipIdx; p.frame = 0; p.tMs = 0; p.loop = !!loop; p.next = next;
}

// advance one (clip, frame, tMs) by dtMs; returns true when a non-loop clip reached its end this call
function advance(clip, st, dtMs, loop) {
  if (!clip || clip.n === 0) return false;
  const n = clip.n;
  if (st.frame >= n) st.frame = n - 1;
  st.tMs += dtMs;
  let steps = 0;
  while (st.tMs >= clip.durMs[st.frame] && steps++ < MAX_STEPS_PER_CALL) {
    st.tMs -= clip.durMs[st.frame];
    st.frame++;
    if (st.frame >= n) {
      if (loop) { st.frame = 0; } else { st.frame = n - 1; st.tMs = 0; return true; }
    }
  }
  return false;
}

const _st = { frame: 0, tMs: 0 };
const _fs = { frame: 0, tMs: 0 };

/** Advances the current clip (and the from-clip while fading) by `dtMs * rate`. */
export function clipStep(p, pm, dtMs) {
  const d = dtMs * p.rate;
  const clip = clipOf(pm, p.clip);
  _st.frame = p.frame; _st.tMs = p.tMs;
  const ended = advance(clip, _st, d, p.loop);
  p.frame = _st.frame; p.tMs = _st.tMs;
  if (ended && p.next >= 0) {
    const nx = p.next;
    p.clip = nx; p.frame = 0; p.tMs = 0; p.loop = true; p.next = -1;
  }
  if (p.fromClip >= 0) {
    p.fadeT += d;
    if (p.fadeT >= p.fadeMs) { p.fromClip = -1; p.fadeMs = 0; p.fadeT = 0; }
    else {
      _fs.frame = p.fromFrame; _fs.tMs = p.fromTMs;
      advance(clipOf(pm, p.fromClip), _fs, d, true);
      p.fromFrame = _fs.frame; p.fromTMs = _fs.tMs;
    }
  }
}

/** Sets the current position to a 0..1 fraction of the clip's total length (random start phase). */
export function clipSetPhase(p, pm, phase01) {
  const clip = clipOf(pm, p.clip);
  if (!clip || clip.n === 0) { p.frame = 0; p.tMs = 0; return; }
  let total = 0;
  for (let i = 0; i < clip.n; i++) total += clip.durMs[i];
  let t = (phase01 - Math.floor(phase01)) * total;
  let f = 0;
  while (f < clip.n - 1 && t >= clip.durMs[f]) { t -= clip.durMs[f]; f++; }
  p.frame = f; p.tMs = t;
}

/** Weight of the old pose: 1 - smoothstep(fadeT / fadeMs); 0 when not fading. */
export function clipFromW(p) {
  if (p.fromClip < 0 || p.fadeMs <= 0) return 0;
  let u = p.fadeT / p.fadeMs;
  if (u >= 1) return 0;
  if (u < 0) u = 0;
  return 1 - u * u * (3 - 2 * u);
}
