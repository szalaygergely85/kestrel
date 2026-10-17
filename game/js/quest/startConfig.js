// game/js/quest/startConfig.js (HANDS-01b, 37.8a): the two start states of the player's inventory. main.js picks
// `?demo=0` -> START_FULL (empty, play from scratch), otherwise START_DEMO (owner answer 2: the fireball is
// known from the start in the right hand; the sword is taken in the tower and goes to the left hand).
export const START_DEMO = Object.freeze({ pack: Object.freeze([Object.freeze({ id: 'spell.fireball', n: 1 })]), left: null, right: 'spell.fireball' });
export const START_FULL = Object.freeze({ pack: Object.freeze([]), left: null, right: null });

/** FB-01 review: while the fireball is locked the right hand starts empty (pack starts empty: OB-217, no locked cell); `?fireball=1` / a saved unlock keeps START_DEMO. */
const START_DEMO_LOCKED = Object.freeze({ pack: Object.freeze([]), left: null, right: null }); // OB-217: no locked spell cell in the pack; the unlock grants the spell straight into the off hand
export function startFor(demoOn, fireballUnlocked) {
  if (!demoOn) return START_FULL;
  return fireballUnlocked ? START_DEMO : START_DEMO_LOCKED;
}

/** OB-217: removes a stray `spell.fireball` from the pack (old saves kept it as a locked cell). Returns how many cells were cleared. */
export function stripPackSpell(inv, id = 'spell.fireball') {
  let n = 0;
  if (inv && inv.slots) for (const s of inv.slots) if (s.id === id) { s.id = null; s.n = 0; n++; }
  return n;
}

/** OB-217: magic unlocked -> the spell goes straight into the free off hand (pack contents unchanged). `equip`/`add` are injected. Returns true when equipped. */
export function grantSpellHand(inv, eq, defs, equip, add, id = 'spell.fireball') {
  if (!inv || !eq || eq.off !== null || eq.set === 'ranged' || eq.main === id) return false;
  if (!inv.slots.some((c) => c.id === id) && add(inv, defs, id, 1) < 1) return false; // needs one free cell for the swap (skipped when it already sits in the pack)
  if (equip(inv, eq, defs, id)) return true;
  stripPackSpell(inv, id);
  return false;
}
