// US-087 audit follow-up: blocked targeting freezes the whole sim, not only Q.
// Wheel input must still drain so closing a UI cannot replay a buffered cycle.

/**
 * @param {any} targeting
 * @param {number} dt
 * @param {any} input
 * @param {any} player
 * @param {any} look
 * @param {boolean} blocked pause/Settings/map/death/wake/end gate, resolved by the caller
 * @returns {boolean} whether targeting advanced this step
 */
export function stepTargetingInput(targeting, dt, input, player, look, blocked) {
  const wheel = input.consumeWheel();
  if (blocked || !targeting || !player || !look) return false;
  const cycleDir = (input.pressed('Tab')
    ? (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? -1 : 1) : 0) + wheel;
  targeting.step(dt, input.pressed('KeyQ'), cycleDir, player, look);
  return true;
}
