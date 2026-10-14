// game/js/quest/sim/pickups.js (US-080b, docs/architecture.md 30.2). HP/MP restore drops: spawn, countdown life,
// collect within radius. Rule 15 (this file, game/js/quest/sim/**): no Math.random, no trig (sin/cos/atan2/tan/
// pow/hypot - direction/distance maths use Math.sqrt only, same convention as vitals.js/beastSim.js), no wall
// clock, integer step timers, zero allocation per step after setup.
//
// A pickup is a real world entity: `world.spawn('pickup', transform, {pickup: {kind, amount, life}, sprite: {...}})`
// so the existing SpritePool draws it with no extra wiring (World.js documents the same `components.sprite`
// shape for a content `type: 'billboard'` entity). `components.pickup {kind, amount, life}` is the single source
// of truth, serialized with the entity like `components.health`/`components.mana` (vitals.js's own convention).
//
// This module keeps its own module-level slot table of up to MAX_DROPS live pickup ids (same "module-level game
// state, reset only from main.js's 'world:loaded' handler" convention as hints.js's `resetHints()`/queue), so
// `stepPickups` never scans the whole world: it walks its own fixed <=16-length array. When a 17th drop spawns,
// the slot with the least life remaining (the oldest - every drop starts at the same `life` and only counts
// down) is evicted first (`world.remove`).

export const PICKUP_AMOUNT = 10;   // hp or mp restored on collect
export const PICKUP_LIFE = 3600;   // steps, 60 s @ 60 Hz (EQ-23 AC) - despawns when life reaches 0
export const COLLECT_RADIUS = 0.8; // m, 3D distance
export const MAX_DROPS = 16;

const slots = new Array(MAX_DROPS).fill(null); // entity id per slot, null = empty

/** Rebuilds runtime-only state from retained drops on every world load; no world clears fixture state. */
export function resetPickups(world) {
  for (let i = 0; i < MAX_DROPS; i++) slots[i] = null;
  if (!world) return;
  world.forEachEntity((e, id) => {
    const p = e.components && e.components.pickup;
    if (!p) return;
    const slot = findSlot(world, p.life);
    if (slot < 0) world.remove(id);
    else slots[slot] = id;
  });
}

/** Finds a free slot or evicts the least-life drop. On load, reject an incoming drop older than all slots. */
function findSlot(world, incomingLife = Infinity) {
  for (let i = 0; i < MAX_DROPS; i++) if (slots[i] === null) return i;
  let minI = 0, minLife = Infinity;
  for (let i = 0; i < MAX_DROPS; i++) {
    const e = world.entity(slots[i]);
    const life = e && e.components.pickup ? e.components.pickup.life : -1;
    if (life < minLife) { minLife = life; minI = i; }
  }
  if (incomingLife < minLife) return -1;
  if (world.entity(slots[minI])) world.remove(slots[minI]);
  return minI;
}

let nextId = 1;

/**
 * Spawns a +10 hp or +10 mp drop at `(x, y, z)`. Called by US-079's beast death (its own seeded RNG) once a beast
 * is implemented to call it; nothing else spawns a pickup today.
 * @param {import('../../../../engine/index.js').World} world
 * @param {'hp'|'mp'} kind
 */
export function spawnDrop(world, kind, x, y, z) {
  let id;
  do { id = `pickup_${nextId++}`; } while (world.entity(id));
  const slot = findSlot(world);
  slots[slot] = id;
  world.spawn('pickup', { x, y, z, yawDeg: 0, pitchDeg: 0 }, {
    // `baseZ` = the drop point's own z, kept separate from `transform.z` so the view's hover/bob (presentPickups,
    // which writes `transform.z` every render frame for presentation only) can never feed back into the sim's
    // own collect-distance check below - the sim always measures from the drop point, not the bobbing sprite.
    pickup: { kind, amount: PICKUP_AMOUNT, life: PICKUP_LIFE, baseZ: z },
    voxel: { model: pickupModel(kind === 'mp' ? 'potion.mp' : 'potion.hp'), anim: 'idle', loop: true },
  }, id);
  return id;
}

/** OB-132: voxel model for a drop (design/models/pickups_voxel.js). Unknown item -> pickup.gear.body + one warning. */
let warnedModel = false;
function pickupModel(itemId, slot) {
  const pv = globalThis.ASSETS && globalThis.ASSETS.pickupsVoxel;
  const m = pv && pv.pickupModelFor(itemId, slot);
  if (m) return m;
  if (!warnedModel) { warnedModel = true; console.warn('[pickup] no voxel model for', itemId, '- using pickup.gear.body'); }
  return 'pickup.gear.body';
}
function itemSlot(itemId) {
  const items = globalThis.ASSETS && globalThis.ASSETS.items;
  const def = items && items.defs && items.defs[itemId];
  return def && def.equip && def.equip.slot;
}

/**
 * EQ-10: a gear drop = a world pickup of kind 'item' (`itemId`, amount 1). Same slot table, life and bob as the
 * orbs. Sprite 'pickupGear' (design/models/m3_props.js; clips idle = worn, sturdy, fine).
 */
export function spawnItemDrop(world, itemId, x, y, z, tier = 'worn') {
  let id;
  do { id = `pickup_${nextId++}`; } while (world.entity(id));
  const slot = findSlot(world);
  slots[slot] = id;
  world.spawn('pickup', { x, y, z, yawDeg: 0, pitchDeg: 0 }, {
    pickup: { kind: 'item', itemId, amount: 1, life: PICKUP_LIFE, baseZ: z },
    voxel: { model: pickupModel(itemId, itemSlot(itemId)), anim: 'idle', loop: true },
  }, id);
  return id;
}

/** EQ-10: loot.js installs (per world load) the function that moves a collected item drop into the pack. Returns false = pack full, drop stays. */
let itemSink = null;
export function setItemPickupSink(fn) { itemSink = fn; }

/** EQ-23: stack sink (installed per world load by questPickups.js). (itemId, n) -> number actually put in the pack (0..n). */
let stackSink = null;
export function setStackPickupSink(fn) { stackSink = fn; }

// 8 fixed ring offsets at 0.6 m (no trig: Rule 15). Drops of a full pack pick the first one not already occupied.
const RING = [[0.6, 0], [0.424, 0.424], [0, 0.6], [-0.424, 0.424], [-0.6, 0], [-0.424, -0.424], [0, -0.6], [0.424, -0.424]];

/**
 * EQ-23: a leftover stack (pack full / partly full) lands at the player's feet as a world pickup {itemId, amount}.
 * `questReward` drops never despawn; loot leftovers use the normal life. Same-id drops at the spot merge.
 */
export function spawnLeftoverDrop(world, itemId, n, x, y, z, questReward = false, groundFn = null) {
  let best = 0, bestD = -1;
  for (let k = 0; k < RING.length; k++) {
    const px = x + RING[k][0], py = y + RING[k][1];
    let nearest = Infinity;
    for (let i = 0; i < MAX_DROPS; i++) {
      const e = slots[i] !== null ? world.entity(slots[i]) : null;
      if (!e) continue;
      const dx = e.transform.x - px, dy = e.transform.y - py, d = dx * dx + dy * dy;
      if (d < nearest) nearest = d;
    }
    if (nearest > 0.09) { best = k; bestD = nearest; break; }
    if (nearest > bestD) { bestD = nearest; best = k; }
  }
  const gx = x + RING[best][0], gy = y + RING[best][1];
  const gz = groundFn ? groundFn(gx, gy) : z; // OB-155f: baseZ from the ring point's own ground, not the player's z
  const id = spawnItemDrop(world, itemId, gx, gy, Number.isFinite(gz) ? gz : z);
  const p = world.entity(id).components.pickup;
  p.amount = n;
  if (questReward) p.questReward = true;
  return id;
}

/**
 * Decrements every live drop's life (despawns at 0) and collects any drop within COLLECT_RADIUS of `player`,
 * applying `+amount` to the matching health/mana component (clamped to max).
 * @param {import('../../../../engine/index.js').World} world
 * @param {any} player plain entity data (`world.get('player').data`-shaped: `{transform, components}`)
 */
export function stepPickups(world, player) {
  if (!player || !player.transform) return;
  const pt = player.transform;
  const health = player.components && player.components.health;
  const mana = player.components && player.components.mana;
  for (let i = 0; i < MAX_DROPS; i++) {
    const id = slots[i];
    if (id === null) continue;
    const e = world.entity(id);
    if (!e) { slots[i] = null; continue; }
    const p = e.components.pickup;
    if (!p) { slots[i] = null; continue; }
    if (!p.questReward) p.life--;
    if (p.life <= 0) { world.remove(id); slots[i] = null; continue; }
    const t = e.transform;
    const dx = t.x - pt.x, dy = t.y - pt.y, dz = p.baseZ - pt.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= COLLECT_RADIUS) {
      if (p.kind === 'item') {
        // Sinks may return a boolean (all-or-nothing) or the count actually stored (partial fit): the rest stays lying.
        let took = 0;
        if (p.amount > 1 && stackSink) took = stackSink(p.itemId, p.amount);
        else if (itemSink) { const r = itemSink(p.itemId, p.amount); took = r === true ? p.amount : r === false ? 0 : (r | 0); }
        if (took < p.amount) { p.amount -= Math.max(0, took); continue; }
      } else if (p.kind === 'hp' && health) health.hp = Math.min(health.max, health.hp + p.amount);
      else if (p.kind === 'mp' && mana) mana.mp = Math.min(mana.max, mana.mp + p.amount);
      world.remove(id);
      slots[i] = null;
    }
  }
}

/** Test/debug hook: ids of every currently live drop slot, in slot order (`null` for an empty slot). */
export function liveDropIds() {
  return slots.slice();
}
