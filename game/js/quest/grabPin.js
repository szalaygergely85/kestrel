// game/js/quest/grabPin.js - BEAST-08b main hook (D-088): croc grab = MOVEMENT-ONLY pin. Look/attack/block/items are untouched.
// Pure + allocation-free per frame. main.js: `events.on('beast:grab', pin.onGrab)`, then each frame `pin.apply(controls, mashPressed)`.
export function createGrabPin(getSim) {
  const pin = {
    pinned: false,
    onGrab(p) { pin.pinned = !!(p && p.on); },
    reset() { pin.pinned = false; },
    /** While pinned: a movement/jump key press (`mashPressed`) feeds the escape counter; movement controls are zeroed. Returns true if blocked. */
    apply(c, mashPressed) {
      if (!pin.pinned) return false;
      if (mashPressed) { const s = getSim(); if (s && s.grabMash) s.grabMash(s.grabSlot()); }
      c.forward = 0; c.strafe = 0; c.run = false; c.jump = false; c.swimUp = 0;
      return true;
    },
  };
  return pin;
}
