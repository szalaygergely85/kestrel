// EQ-10: the real chests of world_m1. Anchors (props named chest*) are placed by tools/gen-poi-props.mjs; this module
// turns the ones present in a loaded world into createChests() defs. Pure: reads world.entity(id) only (no mutation).
// Tables: three heart-piece chests (QL-08: 4 pieces = +1 heart), Rook's roof chest (arrows + a sturdy gear roll),
// the hidden chest (a fine gear roll). `gear.tier` is fixed; the slot is rolled from the chest's own seeded stream.
import { forwardOf } from '../../../../engine/index.js';
import { CHEST_DEFAULTS as C } from './lootConfig.js';

const HEART = { fixed: [{ item: 'heart.piece', n: 1 }], weighted: [] };
// OB-179: fewer, bigger chests inside places (the 4 Ch1-2 secrets merged into secretRook in campEast, the 3 Outwall ones into secretOw2 in campNorth).
// Reward = the merged arrows + a guaranteed gear piece one tier above the old roll (Ch1-2 plain/worn roll -> 'sturdy'; Outwall 8 % 'fine' -> 'fine' always).
export const SECRET_TABLE = { fixed: [{ item: 'arrow', n: 16 }], weighted: [], gear: { tier: 'sturdy' } };
export const OUTWALL_SECRET_TABLE = { fixed: [{ item: 'arrow', n: 12 }], weighted: [], gear: { tier: 'fine' } };
export const CHEST_TABLES = {
  secretRook: SECRET_TABLE, secretOw2: OUTWALL_SECRET_TABLE,
  chestMeadow: HEART,
  chestBend: HEART,
  chestCrossroads: HEART,
  chestRook: { fixed: [{ item: 'arrow', n: 15 }], weighted: [], gear: { tier: 'sturdy' } },
  chestBoots: { fixed: [{ item: 'gear.feet.riverBoots', n: 1 }], weighted: [] }, // QL-16: River Boots (unique, never rolled)
  chestWest: { fixed: [{ item: 'arrow', n: 10 }], weighted: [], gear: { tier: 'sturdy' } }, // OB-141: the one chest of the west gatehouse ruin
  // UNDER-03 (OB-191): the three small crates of the Ford trade post cellar (food, a little ammunition, one potion; no coin item exists yet)
  chestCellar1: { fixed: [{ item: 'berry.blue', n: 3 }, { item: 'honeycomb', n: 1 }], weighted: [] },
  chestCellar2: { fixed: [{ item: 'boar.meat', n: 2 }, { item: 'arrow', n: 8 }], weighted: [] },
  chestCellar3: { fixed: [{ item: 'potion.hp', n: 1 }], weighted: [] },
  chestCrypt: { fixed: [{ item: 'arrow', n: 10 }, { item: 'potion.hp', n: 1 }], weighted: [], gear: { tier: 'sturdy' } }, // UNDER-02: the earned crypt chest (opens after room 3's skeletons are dead; modest gear reward)
  chestBearDen: { fixed: [{ item: 'arrow', n: 12 }, { item: 'potion.hp', n: 1 }], weighted: [], gear: { tier: 'sturdy' } }, // UNDER-04: the stash behind the sleeping bear (guarded by the bear home, not by depth)
  chestStrandCave: { fixed: [{ item: 'arrow', n: 10 }, { item: 'potion.hp', n: 1 }], weighted: [], gear: { tier: 'sturdy' } }, // UNDER-05: the smugglers' chest at the back of the Long Strand sea cave (guarded by the tortoise homes)
  chestGoblinTunnel: { fixed: [{ item: 'arrow', n: 12 }, { item: 'potion.hp', n: 1 }], weighted: [], gear: { tier: 'sturdy' } }, // UNDER-06: the goblins' stash in the tunnel between campNorth and campEast (earned: opens when the 3 tunnel goblins are dead)
  chestHidden: { fixed: [], weighted: [], gear: { tier: 'fine' } },
  chestBed: { fixed: [{ item: 'arrow', n: 10 }], weighted: [], gear: { tier: 'sturdy' } }, // SWIM-04d: Glasswater lake-bed chest (needsBottom)
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
      id, x: t.x, y: t.y, z: t.z, frontX: f[0], frontY: f[1], propId: id, needsBottom: id === 'chestBed',
      interact: { radius: C.radius, facingDeg: C.facingDeg, facingCos: C.facingCos }, table: CHEST_TABLES[id],
    });
  }
  return out;
}
