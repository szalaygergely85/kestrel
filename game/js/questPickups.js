// game/js/questPickups.js (QUESTS-01). Generic world pickup prop + quest pack bridge, as a gameHooks handler (D-050).
//  - Prop: any world entity with components.questPickup {item, n} (+ a sprite). E within REACH takes it: addItem to the
//    pack, world.remove(id) (content-aware: stays taken across save/load, never respawns), 'inventory:added' on the bus
//    (toast + the seam's item:got bridge, same path as boar loot).
//  - Counts: every POLL_STEPS ticks the pack count of each item a quest collects/delivers is fed as an absolute
//    `item:count` (idempotent: save/load, drops, deliveries and re-picks never double count). Also installs book.packOps
//    so a `deliver` objective can check and remove the items at hand-in.
//  - grantReward(reward): puts a hand-in reward ({items:[{id,n}]}) in the pack.
import { addItem, removeItem, countOf } from './quest/sim/inventory.js';
import { spawnLeftoverDrop, setStackPickupSink } from './quest/sim/pickups.js';

export const REACH = 2.2, REACH_DZ = 3, POLL_STEPS = 10;

/** @param {{getBook: () => any, feed: (e:any) => any, defs: Record<string, any>}} o */
export function createQuestPickups({ getBook, feed, defs, isWorn }) {
  let ctx = null, props = [], tick = 0, ops = null, opsInv = null;

  function pack() { return (ctx && ctx.inventory) || null; }
  function sync() {
    const book = getBook(), inv = pack();
    if (!book || !inv) return;
    if (!ops || opsInv !== inv) { opsInv = inv; ops = { count: (id) => countOf(inv, id), remove: (id, n) => removeItem(inv, id, n),
      add: (id, n) => { const k = addItem(inv, defs, id, n); if (k > 0 && ctx && ctx.events) ctx.events.emit('inventory:added', { id, n: k }); return k; }, // QL-04: add = giveOnAccept
      equipped: (id) => !!(isWorn && ctx && ctx.player && isWorn(ctx.player.components && ctx.player.components.equipment, id)) }; } // QL-WIRE: EQ-13 requireEquipped
    if (book.packOps !== ops) book.packOps = ops;
    for (const id of book.countedItems()) feed({ type: 'item:count', id, n: countOf(inv, id) });
  }

  const hook = {
    onBoot(c) {
      ctx = c; props = []; tick = 0; ops = null;
      // EQ-23: leftover stacks lying on the ground re-enter the pack through the normal path (partial fit allowed).
      setStackPickupSink((id, n) => {
        const inv = pack(); if (!inv) return 0;
        const got = addItem(inv, defs, id, n);
        if (got > 0 && c.events) c.events.emit('inventory:added', { id, n: got });
        return got;
      });
      c.world.forEachEntity((e, id) => {
        const q = e.components && e.components.questPickup; if (!q || !e.transform) return;
        props.push({ id, tr: e.transform, item: q.item, n: q.n || 1 });
        // QL-05: "[E] Pick" prompt (the take itself stays in onTick; the behaviour 'pickup.take' is a no-op that only shows the prompt)
        if (!c.world.addInteractable) return;
        c.world.removeInteractable('qp.' + id);
        c.world.addInteractable({ key: 'qp.' + id, name: 'pickup.take', x: e.transform.x, y: e.transform.y, z: e.transform.z + 0.3, radius: REACH, prompt: ('[E] Pick up ' + String(q.item).replace(/[._]/g, ' ')).slice(0, 28), def: { pickupId: id } });
      });
    },
    onTick() {
      if (!ctx || !ctx.player) return;
      if (++tick % POLL_STEPS === 0) sync();
      if (!ctx.state.interactPressed || !props.length) return;
      const p = ctx.player.transform, inv = pack();
      if (!inv) return;
      let best = -1, bd = REACH * REACH;
      for (let i = 0; i < props.length; i++) {
        const t = props[i].tr, dx = t.x - p.x, dy = t.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 <= bd && Math.abs((t.z || 0) - p.z) <= REACH_DZ && ctx.world.entity(props[i].id)) { bd = d2; best = i; }
      }
      if (best < 0) return;
      const pr = props[best];
      if (addItem(inv, defs, pr.item, pr.n) < 1) return; // pack full: stays in the world
      ctx.world.remove(pr.id); if (ctx.world.removeInteractable) ctx.world.removeInteractable('qp.' + pr.id);
      props.splice(best, 1);
      if (ctx.events) ctx.events.emit('inventory:added', { id: pr.item, n: pr.n });
      sync();
    },
    /** Hand-in reward ({items:[{id,n}]}) -> pack (+ toast event). Returns the number of item stacks granted. */
    grantReward(reward) {
      const inv = pack(); let k = 0;
      if (!inv || !reward || !reward.items) return 0;
      for (const it of reward.items) {
        const got = addItem(inv, defs, it.id, it.n);
        if (got > 0) { k++; if (ctx.events) ctx.events.emit('inventory:added', { id: it.id, n: got }); }
        // Never lose a reward silently (full pack / stackMax already held): report the leftover on the bus.
        if (got < it.n) {
          // EQ-23: ... and put the leftover on the ground at the player's feet (never despawns).
          const t = ctx.player && ctx.player.transform, canDrop = !!(t && ctx.world && ctx.world.spawn);
          if (canDrop) spawnLeftoverDrop(ctx.world, it.id, it.n - got, t.x, t.y, t.z, true);
          if (ctx.events) ctx.events.emit('inventory:full', { id: it.id, n: it.n - got, dropped: canDrop });
        }
      }
      return k;
    },
    get props() { return props; },
    sync,
  };
  return hook;
}
