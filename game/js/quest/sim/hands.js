// game/js/quest/sim/hands.js (HANDS-01b, docs/architecture.md 37.8a, D-040). The hands router: LMB drives the
// item in the LEFT hand, RMB the item in the RIGHT hand. The source of truth is `player.components.inventory`
// (`left`/`right` item ids, sim/inventory.js); this module only caches the ids, tells the item sims when they
// change hand, and turns the raw buttons + the input gate into one `down` flag per item.
//
// Tap/hold belongs to the item sim (sword 0.4 s, fireball 0.6 s): the router passes the raw `down` every step
// (`downOf(itemId)`), each item derives its own edges. Every registered item must be stepped EVERY step by the
// caller (`down` is false when it is in no hand), so ring ages and timers keep running.
//
// Rule 15: no Math.random, no trig, no wall clock; `step` allocates nothing (one preallocated event payload).
import { swapHands } from './inventory.js';

/**
 * @param {{emit: (name: string, payload: any) => void}} events
 */
export function createHands(events) {
  /** @type {Map<string, {sim: any, down: number}>} */
  const items = new Map();
  const list = []; // same entries as `items`, for allocation-free loops
  let inv = null;               // the inventory object seen last step (swap() acts on it)
  let left = null, right = null; // cached hand ids
  let armedL = false, armedR = false; // a hand fires only after its physical button was seen up with the gate open
  const payload = { left: null, right: null };

  function cancelOf(id) {
    const it = id !== null ? items.get(id) : undefined;
    if (it) { it.sim.cancel(); it.down = 0; }
  }

  /** Cancel first (a held charge must not fire on the release edge), then drop the arming of both hands. */
  function disarm() {
    cancelOf(left); cancelOf(right);
    armedL = false; armedR = false;
  }

  function bindHand(id, hand) {
    const it = id !== null ? items.get(id) : undefined;
    if (it) it.sim.setHand(hand);
  }

  const api = {
    /** @param {string} itemId @param {{cancel: ()=>void, setHand: (h:'left'|'right')=>void}} itemSim */
    register(itemId, itemSim) {
      const it = { sim: itemSim, down: 0 };
      const old = items.get(itemId);
      if (old) list[list.indexOf(old)] = it; else list.push(it);
      items.set(itemId, it);
      if (left === itemId) itemSim.setHand('left');
      else if (right === itemId) itemSim.setHand('right');
    },

    /**
     * @param {any} player plain entity data (`{components: {inventory}}`)
     * @param {boolean} rawL LMB held (`isDown || pressed`)
     * @param {boolean} rawR RMB held
     * @param {boolean} gateOpen main.js gate (look locked, no UI, not paused/ending/cinematic...)
     */
    step(player, rawL, rawR, gateOpen) {
      const cur = player && player.components && player.components.inventory;
      inv = cur || null;
      let nl = cur ? cur.left : null, nr = cur ? cur.right : null;
      if (nl === undefined) nl = null;
      if (nr === undefined) nr = null;
      if (nl !== null && nl === nr) nr = null; // one item is never in both hands (the left one wins)

      if (nl !== left || nr !== right) {
        const ol = left, or = right;
        cancelOf(ol); cancelOf(or); cancelOf(nl); cancelOf(nr);
        left = nl; right = nr;
        if (nl !== ol) bindHand(nl, 'left');
        if (nr !== or) bindHand(nr, 'right');
        // A held button must be re-pressed for whatever now sits in the hand.
        armedL = false; armedR = false;
        payload.left = left; payload.right = right;
        events.emit('hands:changed', payload);
      }

      if (!gateOpen) disarm();
      else {
        if (!rawL) armedL = true;
        if (!rawR) armedR = true;
      }

      for (let i = 0; i < list.length; i++) list[i].down = 0;
      if (gateOpen) {
        if (left !== null && armedL && rawL) { const it = items.get(left); if (it) it.down = 1; }
        if (right !== null && armedR && rawR) { const it = items.get(right); if (it) it.down = 1; }
      }
    },

    /** @param {string} itemId @returns {boolean} the raw `down` for that item's own step */
    downOf(itemId) { const it = items.get(itemId); return !!it && it.down === 1; },

    /** @param {string} itemId @returns {'left'|'right'|null} */
    handOf(itemId) { return itemId === left ? 'left' : itemId === right ? 'right' : null; },

    disarm,

    /** Dev (`?debug=1` + H): swaps the two hand slots; the next `step` sees the change. */
    swap() { if (inv) swapHands(inv); },

    hashInto(h) {
      h.u32(armedL ? 1 : 0); h.u32(armedR ? 1 : 0);
      for (let i = 0; i < list.length; i++) h.u32(list[i].down);
    },
  };
  return api;
}

/** A hand item with no behaviour yet (SPELL-01a replaces the fireball stub). `onDown(down)` runs each step. */
export function createStubItemSim(onDown) {
  return { cancel() {}, setHand() {}, step(down) { if (onDown) onDown(down); } };
}
