// Feature flags (owner D-065, 2026-10-10; D-069 / FB-01, architecture 38.53): the fireball spell (fist charge cast, projectile,
// explosion, MP cost, MP bar, mana potion, spell slot) is locked until Burl unlocks it (~level 5). `?fireball=1` stays the dev override.
// The unlock is `world.state['magic.fireball'] === true` (saved with WorldState, no schema bump); read live, never captured at boot.
export function featuresFromParams(params) {
  return { fireball: !!params && params.get('fireball') === '1' };
}

export const FIREBALL_FLAG = 'magic.fireball';
const UNLOCK_EV = Object.freeze({ spell: 'fireball' });

/** True when the fireball is usable: dev override or the persisted unlock flag. 0 alloc. */
export function fireballOn(world, features) {
  return (features !== null && features !== undefined && features.fireball === true) || (!!world && !!world.state && world.state[FIREBALL_FLAG] === true);
}

/** The ONLY writer of the unlock flag. Returns true (and emits 'magic.unlocked' once) on the first call, false afterwards. */
export function unlockFireball(world, events) {
  if (world.state[FIREBALL_FLAG] === true) return false;
  world.state[FIREBALL_FLAG] = true;
  events.emit('magic.unlocked', UNLOCK_EV);
  return true;
}
