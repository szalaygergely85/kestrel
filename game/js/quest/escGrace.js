// OB-049: shared "Esc closed a panel" grace. Under pointer lock Chrome eats Esc (releases the lock, no keydown reaches the page),
// so a panel that closes on lock loss must keep the pause menu down for that press; the next Esc (nothing open) opens pause.
// Usage per step: `if (g.lockLost(locked, panelOpenBeforeClose)) close();` then `g.tick(panelClosed, input)`; main.js reads `g.active`.
export function createEscGrace() {
  let prevLocked = false, active = false;
  return {
    get active() { return active; },
    /** Edge detect (true -> false) of the lock while a panel is up: returns true (and arms the grace) when the panel must close. */
    lockLost(locked, open) {
      if (typeof locked !== 'boolean') return false; // old callers / no lock support: never closes
      const lost = prevLocked && !locked && !!open;
      if (lost) active = true;
      if (locked) active = false; // re-locked: pause rules are normal again
      prevLocked = locked;
      return lost;
    },
    /** A second Esc with the panel closed ends the grace (pause opens as usual). */
    tick(closed, input) { if (active && closed && input && input.pressed('Escape')) active = false; },
    reset() { prevLocked = false; active = false; },
  };
}
