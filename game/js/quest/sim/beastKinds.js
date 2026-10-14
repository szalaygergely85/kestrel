// game/js/quest/sim/beastKinds.js (BEAST-03a, architecture.md 38.64 (1), epic ep-bestiary.md table 1). Frozen data for the
// 32 roster kinds; only the kind lookup is used so far (BEAST-03b onwards read the numbers). Seconds / metres only.
// Fields: name (plain, shown to the player), arch (key of ARCHETYPES), model (voxel model id; todo !== '' = placeholder
// or variant the designer still owes), lv [min,max] zone level range, hpF/dmgF (x boar), group [min,max], respawn class,
// attacks (<= 3): { id, type, range, windupSec, activeSec, recoverSec, cooldownSec, dmgF, weight }, optional walk/run/
// keepMin/keepMax/medium/when (override the archetype), elite flag. Wind-ups are >= COMBAT_TARGETS.windupMinSec (0.4).
import { ARCHETYPES } from './archetypes.js';

// ED-AI-01: the numbers live in content/beasts/kinds.json (edited by tools/editor/ai/model.js); same table as before.
import kindData from '../../../../content/beasts/kinds.json' with { type: 'json' };

const K = (k) => Object.freeze({ ...k, lv: Object.freeze([...k.lv]), group: Object.freeze([...k.group]), attacks: Object.freeze(k.attacks.map((a) => Object.freeze({ ...a }))) });

export const KINDS = Object.freeze(Object.fromEntries(Object.keys(kindData).map((n) => [n, K(kindData[n])])));

/** Stable order = the kindIdx stored per slot (Uint8). Append only; never reorder. */
export const KIND_NAMES = Object.freeze(Object.keys(KINDS));
export const kindIndex = (name) => KIND_NAMES.indexOf(name);

/** Kind name of a beast entity: explicit `brain.beastKind`, else the legacy species/role of the four built-in brains
 * (boar by default). Cold path (create time). */
export function kindOfEntity(e) {
  const b = e && e.components && e.components.brain;
  if (b && typeof b.beastKind === 'string' && KINDS[b.beastKind]) return b.beastKind;
  if (b && b.species === 'wolf') return 'grey_wolf';
  if (b && b.species === 'bear') return 'black_bear';
  if (b && b.species === 'goblin') return b.role === 'thrower' ? 'goblin_spear_thrower' : 'goblin_warrior';
  return 'boar';
}

/** Archetype object of a kind. */
export function archetypeOf(kind) { return ARCHETYPES[KINDS[kind].arch]; }
