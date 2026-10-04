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
export const PICKUP_LIFE = 1200;   // steps, 20 s @ 60 Hz - despawns when life reaches 0
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
    sprite: { model: kind === 'mp' ? 'pickupMp' : 'pickupHp', anim: 'idle', frame: 0 },
  }, id);
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
    p.life--;
    if (p.life <= 0) { world.remove(id); slots[i] = null; continue; }
    const t = e.transform;
    const dx = t.x - pt.x, dy = t.y - pt.y, dz = p.baseZ - pt.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= COLLECT_RADIUS) {
      if (p.kind === 'hp' && health) health.hp = Math.min(health.max, health.hp + p.amount);
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
