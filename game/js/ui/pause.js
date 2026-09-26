// game/js/ui/pause.js (US-062: real pause, docs/backlog.md PC-B QUEUE 2 item 3)
//
// Today's pause overlay (ui/pauseOverlay.js, drawn whenever the pointer
// isn't locked) and the Settings panel (ui/settings.js, only openable while
// that same condition holds) are purely visual - main.js's fixed-step
// `update()` keeps ticking physics/quest/animations underneath them. This
// module supplies the pure gate + the small stateful bits main.js needs to
// make that pause real, without any engine/ change:
//   - `isPaused(ctx)`: the exact "overlay/Settings is up" condition, pulled
//     out of main.js's own draw calls (`!look.locked && !isMapOpen()`, never
//     true while `ending`) so it can be unit-tested in isolation.
//   - `resetSimAccumulator(engine)`: zeroes `engine.loop._accumulator`
//     (engine/core/loop.js's `Loop`, a plain field - no public API needed)
//     so leaving pause never applies a burst of queued fixed steps.
//   - `duckAudio`/`unduckAudio`: suspend/resume the single shared
//     AudioContext (game/js/audio/synth.js's `getCtx()`), the exact
//     mechanism synth.js's own `visibilitychange` listener already uses to
//     silence ambient sound in a hidden tab - reused here for every pause,
//     not only a hidden tab.
//   - `installAutoPause()`: window blur / `visibilitychange` hidden during
//     play releases pointer lock (which flips `look.locked` false via
//     PlayerLook's own `pointerlockchange` listener, so the very next fixed
//     step already sees `isPaused()` true) - it never re-locks the pointer
//     itself, so resuming always needs an explicit player click, same as
//     every other way out of pause (never auto-resume).

import { getCtx } from '../audio/synth.js';

// True once THIS module suspended the AudioContext - so `unduckAudio` never
// fights synth.js's own visibilitychange resume (e.g. tab still hidden when
// the player "resumes" some other way).
let suspendedByPause = false;

/**
 * @param {{ending: boolean, look: {locked: boolean}|null, isMapOpen: () => boolean}} ctx
 * @returns {boolean} true while the pause overlay or the Settings panel is up.
 */
export function isPaused(ctx) {
  return !ctx.ending && !!ctx.look && !ctx.look.locked && !ctx.isMapOpen();
}

/** Suspends the shared AudioContext (no-op before it exists / already suspended). */
export function duckAudio() {
  const ctx = getCtx();
  if (ctx && ctx.state === 'running') {
    ctx.suspend().catch(() => {});
    suspendedByPause = true;
  }
}

/** Resumes the shared AudioContext, but only the suspend THIS module made. */
export function unduckAudio() {
  if (!suspendedByPause) return;
  suspendedByPause = false;
  const ctx = getCtx();
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (ctx && ctx.state === 'suspended' && !hidden) ctx.resume().catch(() => {});
}

/**
 * Zeroes the fixed-step accumulator so the frame right after pause ends
 * never sees a big backlog of queued `update(dt)` calls (no catch-up burst /
 * teleport). `engine.loop` is `engine/core/loop.js`'s `Loop` instance;
 * `_accumulator` is a plain (non-private) field, so this needs no engine API.
 * @param {{loop?: {_accumulator: number}}|null} engine
 */
export function resetSimAccumulator(engine) {
  if (engine && engine.loop) engine.loop._accumulator = 0;
}

/**
 * Installs the window blur / tab-hidden -> forced pause listeners. Call once
 * per page (gameplay mode only - never for `?bench=`/`?gpucompare=`/
 * `?voxelbench=`, which must stay unaffected).
 */
export function installAutoPause() {
  if (typeof window === 'undefined') return;
  const forcePause = () => {
    if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  };
  window.addEventListener('blur', forcePause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) forcePause(); });
  return forcePause; // exposed for tests
}
