// game/js/quest/spellHandView.js (HANDS-01c, architecture.md 37.8a + D-042 item 1).
// The spell hand's idle view as a view-model handle (second handle next to the sword). Presentation only:
// shown whenever the spell item is in a hand (`hands.handOf(ITEM) !== null`), on that hand's side via
// `vm.setHand` (authored LEFT; the engine mirrors it for the right hand - never mirror data), hidden otherwise.
// Charge/cast clips belong to SPELL-01b; this file only plays `idle`. No allocation per frame.

export const SPELL_HAND_ITEM = 'spell.fireball';

/**
 * Resolves the handle once (boot). `def` = `ASSETS.viewModels.spellHand`; its model `spellHandL` must be in `pool`.
 * @returns {{vm:any, h:number, clip:{idle:number}}}
 */
export function loadSpellHandView(vm, def, pool) {
  const h = vm.load('spellHand', def, pool);
  vm.setHand(h, 'left'); // authored hand = no mirror until the router says otherwise
  vm.hide(h);
  return { vm, h, clip: { idle: vm.clipId(h, 'idle') } };
}

/**
 * Per frame. `hand` = `hands.handOf('spell.fireball')` ('left' | 'right' | null).
 * @param {{vm:any,h:number,clip:{idle:number}}|null} vmh
 * @param {'left'|'right'|null} hand
 * @param {number} simTime seconds, continuous (idle breathing only)
 * @param {number} bobPhase walk-bob phase (same one the sword uses)
 * @param {boolean} moving player is walking this frame
 */
export function presentSpellHand(vmh, hand, simTime, bobPhase, moving) {
  if (!vmh) return;
  const { vm, h } = vmh;
  if (hand !== 'left' && hand !== 'right') { vm.hide(h); return; }
  if (vm.handOf(h) !== hand) vm.setHand(h, hand);
  vm.show(h, vmh.clip.idle, simTime * 1000, false);
  vm.setBob(bobPhase, moving ? 1 : 0, h);
}
