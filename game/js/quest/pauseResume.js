// OB-068 / OB-072: Esc in the pause menu = Resume. Chrome refuses requestPointerLock on an Esc keydown (not an activation gesture) and for
// ~1 s after the user left the lock with Esc, so after the Esc the menu stays hidden ("resumed-unlocked") until the next click or normal
// key press (gesture()) takes the lock; a failed request just keeps us waiting for the next gesture. One quiet retry fires ~1.1 s after the Esc.
// Soft pause (keyboard-lock path, fullscreen): Esc arrives as a keydown while the pointer stays locked; the menu opens without losing the lock.
// While active, main.js's pauseUp() is false; a second Esc (or getting the lock) ends it; the second Esc opens pause as usual.
export const RETRY_MS = 1100;
export function createPauseResume(requestLock, timers = null) {
  let active = false, soft = false, timer = null;
  const tm = timers || { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };
  const lock = () => { try { requestLock && requestLock(); } catch (e) { /* wait for the next gesture */ } };
  const stopTimer = () => { if (timer !== null) { tm.clear(timer); timer = null; } };
  return {
    get active() { return active; },
    get soft() { return soft; },
    /** Esc pressed while the pause menu is up: hide it, try the lock now (usually refused), retry once after Chrome's cooldown. */
    resume() {
      if (soft) { soft = false; return; } // lock was never lost: nothing to take back
      active = true; lock(); stopTimer();
      timer = tm.set(() => { timer = null; if (active) lock(); }, RETRY_MS);
    },
    /** Keyboard-lock path: Esc keydown while locked opens the pause menu without releasing the lock. */
    softPause() { soft = true; },
    /** Click while resumed-unlocked: a real activation gesture, take the lock. */
    click() { if (active) lock(); },
    /** pointerdown / keydown anywhere (document): any gesture except Esc retries the lock. True = gesture consumed (swallow the click). */
    gesture(code) { if (!active || code === 'Escape') return false; lock(); return true; },
    /** Once per step, BEFORE the pause keys: lock taken -> done; Esc while resumed-unlocked -> pause opens again. */
    tick(locked, input) {
      if (!locked) soft = false;
      if (locked) { active = false; stopTimer(); } else if (active && input && input.pressed('Escape')) {
        active = false; stopTimer(); if (input.consumePressed) input.consumePressed(); // this Esc only closes the resumed state; the pause keys must not see it
      }
    },
    reset() { active = false; soft = false; stopTimer(); },
  };
}
