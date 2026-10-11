// OB-068: Esc in the pause menu = Resume. Chrome refuses requestPointerLock on an Esc keydown (not an activation gesture), so after
// the Esc the menu stays hidden and the world un-paused-looking ("resumed-unlocked") until the next click takes the lock.
// While active, main.js's pauseUp() is false; a second Esc (or getting the lock) ends it; the second Esc opens pause as usual.
export function createPauseResume(requestLock) {
  let active = false;
  const lock = () => { try { requestLock && requestLock(); } catch (e) { /* click to lock */ } };
  return {
    get active() { return active; },
    /** Esc pressed while the pause menu is up: hide it, try the lock now (usually refused, handled quietly). */
    resume() { active = true; lock(); },
    /** Click while resumed-unlocked: a real activation gesture, take the lock. */
    click() { if (active) lock(); },
    /** Once per step, BEFORE the pause keys: lock taken -> done; Esc while resumed-unlocked -> pause opens again. */
    tick(locked, input) { if (locked) active = false; else if (active && input && input.pressed('Escape')) active = false; },
    reset() { active = false; },
  };
}
