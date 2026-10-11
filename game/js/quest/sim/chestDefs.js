// EQ-10: the real chests of world_m1. Anchors (props named chest*) are placed by tools/gen-poi-props.mjs; this module
// turns the ones present in a loaded world into createChests() defs. Pure: reads world.entity(id) only (no mutation).
// Tables: three heart-piece chests (QL-08: 4 pieces = +1 heart), Rook's roof chest (arrows + a sturdy gear roll),
// the hidden chest (a fine gear roll). `gear.tier` is fixed; the slot is rolled from the chest's own seeded stream.
import { forwardOf } from '../../../../engine/index.js';
import { CHEST_DEFAULTS as C } from './lootConfig.js';

const HEART = { fixed: [{ item: 'heart.piece', n: 1 }], weighted: [] };
// US-104a: the Ch1-2 hidden chests use the loot.json `chest` source: 4 arrows always, a gear roll with chance 0.08 (tier from the band: Ch1-2 = band 1-2 = T1, the plain weighted roll).
export const SECRET_TABLE = { fixed: [{ item: 'arrow', n: 4 }], weighted: [], gear: { chance: 0.08 } };
export const CHEST_TABLES = {
  secretRook: SECRET_TABLE, secretBend: SECRET_TABLE, secretField: SECRET_TABLE, secretBank: SECRET_TABLE,
  chestMeadow: HEART,
  chestBend: HEART,
  chestCrossroads: HEART,
  chestRook: { fixed: [{ item: 'arrow', n: 15 }], weighted: [], gear: { tier: 'sturdy' } },
  chestBoots: { fixed: [{ item: 'gear.feet.riverBoots', n: 1 }], weighted: [] }, // QL-16: River Boots (unique, never rolled)
  chestHidden: { fixed: [], weighted: [], gear: { tier: 'fine' } },
  chestForge: { fixed: [{ item: 'gear.main.sword.sturdy', n: 1 }], weighted: [] }, // EQ-20: Outwall forge chest (a sturdy sword). Band 5+ chests: add `weapon: { tier: 'fine' }`.
};

/** @param {{entity: (id: string) => any}} world @returns {any[]} createChests defs (propId = the entity id) */
export function buildChestDefs(world) {
  const out = [], f = [0, 0];
  for (const id of Object.keys(CHEST_TABLES)) {
    const e = world.entity(id);
    if (!e || !e.transform) continue;
    const t = e.transform;
    forwardOf(t.yawDeg || 0, f);
    out.push({
      id, x: t.x, y: t.y, z: t.z, frontX: f[0], frontY: f[1], propId: id,
      interact: { radius: C.radius, facingDeg: C.facingDeg, facingCos: C.facingCos }, table: CHEST_TABLES[id],
    });
  }
  return out;
}
