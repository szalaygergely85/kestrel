// game/js/questPickups.js (QUESTS-01). Generic world pickup prop + quest pack bridge, as a gameHooks handler (D-050).
//  - Prop: any world entity with components.questPickup {item, n} (+ a sprite). E within REACH takes it: addItem to the
//    pack, world.remove(id) (content-aware: stays taken across save/load, never respawns), 'inventory:added' on the bus
//    (toast + the seam's item:got bridge, same path as boar loot).
//  - Counts: every POLL_STEPS ticks the pack count of each item a quest collects/delivers is fed as an absolute
//    `item:count` (idempotent: save/load, drops, deliveries and re-picks never double count). Also installs book.packOps
//    so a `deliver` objective can check and remove the items at hand-in.
//  - grantReward(reward): puts a hand-in reward ({items:[{id,n}]}) in the pack.
import { addItem, removeItem, countOf } from './quest/sim/inventory.js';
import { unlockFireball } from './quest/features.js';
import { spawnLeftoverDrop, setStackPickupSink } from './quest/sim/pickups.js';
import { floorZ, createResnap } from './quest/groundSnap.js'; // OB-155 runtime

export const REACH = 2.2, REACH_DZ = 3, POLL_STEPS = 10;

/** OB-137: display name for a pickup/inspect prompt: the item def's name; never a raw id (fallback: humanised id + one warning). */
const warnedIds = new Set();
export function itemLabel(defs, id) {
  const d = defs && defs[id];
  if (d && typeof d.name === 'string' && d.name) return d.name;
  const h = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim().toLowerCase();
  const out = h.charAt(0).toUpperCase() + h.slice(1);
  if (!warnedIds.has(id)) { warnedIds.add(id); console.warn('[pickup] no item def name for', id, '- using', out); }
  return out;
}

/** @param {{getBook: () => any, feed: (e:any) => any, defs: Record<string, any>}} o */
export function createQuestPickups({ getBook, feed, defs, isWorn }) {
  let ctx = null, props = [], tick = 0, ops = null, opsInv = null, lastAdded = 0, resnap = null;

  const groundFn = () => (ctx && ctx.world ? (x, y) => floorZ(ctx.world, x, y, ctx.player && ctx.player.transform ? ctx.player.transform.z : null) : null); // structure/mesh floor too
  function pack() { return (ctx && ctx.inventory) || null; }
  function leftover(id, n) { // same as grantReward's leftover: ground drop at the player's feet (never despawns) + inventory:full
    const t = ctx && ctx.player && ctx.player.transform, canDrop = !!(t && ctx.world && ctx.world.spawn);
    if (canDrop) spawnLeftoverDrop(ctx.world, id, n, t.x, t.y, t.z, true, groundFn());
    if (ctx && ctx.events) ctx.events.emit('inventory:full', { id, n, dropped: canDrop });
  }
  function setShown(pr, on) {
    if (pr.shown === on) return;
    pr.shown = on;
    const e = ctx.world.entity(pr.id), v = e && e.components && e.components.voxel;
    if (v) { v.hidden = !on; if (ctx.world.renderVersion !== undefined) ctx.world.renderVersion++; }
    if (!ctx.world.addInteractable) return;
    ctx.world.removeInteractable('qp.' + pr.id);
    if (on) ctx.world.addInteractable(pr.ia);
  }
  function sync() {
    const book = getBook(), inv = pack();
    if (!book || !inv) return;
    if (!ops || opsInv !== inv) { opsInv = inv; ops = { count: (id) => countOf(inv, id), remove: (id, n) => removeItem(inv, id, n),
      add: (id, n) => { const k = addItem(inv, defs, id, n); lastAdded = k; if (k > 0 && ctx && ctx.events) ctx.events.emit('inventory:added', { id, n: k });
        if (k < n && defs[id]) leftover(id, n - k); // CH12-CONTENT-01: full pack must not swallow a handed-over quest item (sq.fc.cog): leftover lies at the feet
        return k; }, // QL-04: add = giveOnAccept
      equipped: (id) => !!(isWorn && ctx && ctx.player && isWorn(ctx.player.components && ctx.player.components.equipment, id)) }; } // QL-WIRE: EQ-13 requireEquipped
    if (book.packOps !== ops) book.packOps = ops;
    syncGivers(book);
    for (const id of book.countedItems()) feed({ type: 'item:count', id, n: countOf(inv, id) });
  }
  function syncGivers(book) {
    for (let i = props.length - 1; i >= 0; i--) { // accepted another way (E on the object): the packet leaves the world too
      const pr = props[i];
      if (!pr.acceptQuest || !ctx.world.entity(pr.id)) continue;
      const st = book.statusOf(pr.acceptQuest);
      if (st > 1) { ctx.world.remove(pr.id); if (ctx.world.removeInteractable) ctx.world.removeInteractable('qp.' + pr.id); props.splice(i, 1); continue; }
      setShown(pr, st !== 0); // OB-216: an object giver whose quest is not open yet (opensAfter) is not in the world: no dead '[E] Pick up' prompt
    }
  }

  const hook = {
    onBoot(c) {
      ctx = c; props = []; tick = 0; ops = null; resnap = createResnap(c.world);
      // EQ-23: leftover stacks lying on the ground re-enter the pack through the normal path (partial fit allowed).
      setStackPickupSink((id, n) => {
        const inv = pack(); if (!inv) return 0;
        const got = addItem(inv, defs, id, n);
        if (got > 0 && c.events) c.events.emit('inventory:added', { id, n: got });
        return got;
      });
      c.world.forEachEntity((e, id) => {
        const q = e.components && e.components.questPickup; if (!q || !e.transform) return;
        // QL-05: "[E] Pick" prompt (the take itself stays in onTick; the behaviour 'pickup.take' is a no-op that only shows the prompt)
        const ia = { key: 'qp.' + id, name: 'pickup.take', x: e.transform.x, y: e.transform.y, z: e.transform.z + 0.3, radius: REACH, prompt: ('[E] Pick up ' + itemLabel(defs, q.item)).slice(0, 28), def: { pickupId: id }, bodyId: id, bodyR: 0.35, bodyH: 0.7 }; // OB-084: [E] on the whole item
        resnap.track(() => e.transform, (z) => { e.transform.z = z; ia.z = z + 0.3; }); // re-seat when near terrain streams in late
        props.push({ id, tr: e.transform, item: q.item, n: q.n || 1, acceptQuest: q.acceptQuest || null, ia, shown: null });
        if (!c.world.addInteractable) return;
        c.world.removeInteractable('qp.' + id);
        if (!q.acceptQuest) c.world.addInteractable(ia); // OB-216: object givers get theirs from sync() once the quest is open
      });
      const b0 = getBook(); if (b0) syncGivers(b0);
    },
    onTick() {
      if (!ctx || !ctx.player) return;
      if (resnap) resnap.step();
      if (++tick % POLL_STEPS === 0) sync();
      if (!ctx.state.interactPressed || !props.length) return;
      const p = ctx.player.transform, inv = pack();
      if (!inv) return;
      let best = -1, bd = REACH * REACH;
      for (let i = 0; i < props.length; i++) {
        const t = props[i].tr, dx = t.x - p.x, dy = t.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 <= bd && props[i].shown !== false && Math.abs((t.z || 0) - p.z) <= REACH_DZ && ctx.world.entity(props[i].id)) { bd = d2; best = i; }
      }
      if (best < 0) return;
      const pr = props[best];
      if (pr.acceptQuest) { // OB-155p: the pickup IS the accept; the quest's giveOnAccept puts the item in the pack (no second copy)
        const b = getBook();
        lastAdded = 0;
        if (!b || !b.accept(pr.acceptQuest)) return; // not available yet / already taken: stays
        if (lastAdded < 1) return; // BH-S6: pack full -> leftover lies on the ground; prop goes at the next sync (status > 1), no toast
      } else if (addItem(inv, defs, pr.item, pr.n) < 1) return; // pack full: stays in the world
      ctx.world.remove(pr.id); if (ctx.world.removeInteractable) ctx.world.removeInteractable('qp.' + pr.id);
      props.splice(best, 1);
      if (!pr.acceptQuest && ctx.events) ctx.events.emit('inventory:added', { id: pr.item, n: pr.n }); // BH-S6: the accept path's add already emitted
      sync();
    },
    /** Hand-in reward ({items:[{id,n}]}) -> pack (+ toast event). Returns the number of item stacks granted. */
    grantReward(reward) {
      const inv = pack(); let k = 0;
      if (!inv || !reward || !reward.items) return 0;
      if (reward.unlock && ctx.world && ctx.events && reward.unlock.includes('fireball')) unlockFireball(ctx.world, ctx.events); // FB-02: `unlock:fireball` reward; the flag writer is idempotent (once, never double-given)
      for (const it of reward.items) {
        const got = addItem(inv, defs, it.id, it.n);
        if (got > 0) { k++; if (ctx.events) ctx.events.emit('inventory:added', { id: it.id, n: got }); }
        // Never lose a reward silently (full pack / stackMax already held): report the leftover on the bus.
        if (got < it.n) {
          // EQ-23: ... and put the leftover on the ground at the player's feet (never despawns).
          const t = ctx.player && ctx.player.transform, canDrop = !!(t && ctx.world && ctx.world.spawn);
          if (canDrop) spawnLeftoverDrop(ctx.world, it.id, it.n - got, t.x, t.y, t.z, true, groundFn());
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
