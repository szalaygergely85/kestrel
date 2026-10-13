// US-087 audit follow-up: blocked targeting freezes the whole sim, not only Q.
// Wheel input must still drain so closing a UI cannot replay a buffered cycle.

/**
 * @param {any} targeting
 * @param {number} dt
 * @param {any} input
 * @param {any} player
 * @param {any} look
 * @param {boolean} blocked pause/Settings/map/death/wake/end gate, resolved by the caller
 * @param {string} [lockKey] EQ-07: Q became the weapon-set swap, so main.js passes the lockTarget binding (R)
 * @returns {boolean} whether targeting advanced this step
 */
export function stepTargetingInput(targeting, dt, input, player, look, blocked, lockKey = 'KeyQ') {
  const wheel = input.consumeWheel();
  if (blocked || !targeting || !player || !look) return false;
  const cycleDir = (input.pressed('Tab')
    ? (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? -1 : 1) : 0) + wheel;
  targeting.step(dt, input.pressed(lockKey), cycleDir, player, look);
  return true;
}
