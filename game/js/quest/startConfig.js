// game/js/quest/startConfig.js (HANDS-01b, 37.8a): the two start states of the player's inventory. main.js picks
// `?demo=0` -> START_FULL (empty, play from scratch), otherwise START_DEMO (owner answer 2: the fireball is
// known from the start in the right hand; the sword is taken in the tower and goes to the left hand).
export const START_DEMO = Object.freeze({ pack: Object.freeze([]), left: null, right: 'spell.fireball' });
export const START_FULL = Object.freeze({ pack: Object.freeze([]), left: null, right: null });

/** FB-01 review: while the fireball is locked the right hand starts empty (SPELLBOOK-01: the spell is in the spellbook once learned, never in the pack); `?fireball=1` / a saved unlock keeps START_DEMO. */
const START_DEMO_LOCKED = Object.freeze({ pack: START_DEMO.pack, left: null, right: null }); // the unlock (magic.unlocked) learns the spell
export function startFor(demoOn, fireballUnlocked) {
  if (!demoOn) return START_FULL;
  return fireballUnlocked ? START_DEMO : START_DEMO_LOCKED;
}
