// game/js/quest/sim/beastKinds.js (BEAST-03a, architecture.md 38.64 (1), epic ep-bestiary.md table 1). Frozen data for the
// 32 roster kinds; only the kind lookup is used so far (BEAST-03b onwards read the numbers). Seconds / metres only.
// Fields: name (plain, shown to the player), arch (key of ARCHETYPES), model (voxel model id; todo !== '' = placeholder
// or variant the designer still owes), lv [min,max] zone level range, hpF/dmgF (x boar), group [min,max], respawn class,
// attacks (<= 3): { id, type, range, windupSec, activeSec, recoverSec, cooldownSec, dmgF, weight }, optional walk/run/
// keepMin/keepMax/medium/when (override the archetype), elite flag. Wind-ups are >= COMBAT_TARGETS.windupMinSec (0.4).
import { ARCHETYPES } from './archetypes.js';

const at = (id, type, range, windupSec, activeSec, recoverSec, cooldownSec, dmgF, weight = 1) =>
  Object.freeze({ id, type, range, windupSec, activeSec, recoverSec, cooldownSec, dmgF, weight });
const K = (name, arch, model, todo, lv, hpF, dmgF, group, respawn, attacks, extra = {}) =>
  Object.freeze({ name, arch, model, todo, lv: Object.freeze(lv), hpF, dmgF, group: Object.freeze(group), respawn, attacks: Object.freeze(attacks), ...extra });

export const KINDS = Object.freeze({
  boar: K('Boar', 'grazer', 'boarPlaceholder', '', [1, 3], 1, 1, [1, 2], 'grazer', [at('charge', 'charge', 5, 0.5, 1.2, 1.0, 1.5, 1)]),
  mountain_goat: K('Mountain Goat', 'grazer', 'goat', '', [8, 9], 0.8, 0.7, [1, 3], 'grazer', [at('headbutt', 'melee', 2, 0.5, 0.3, 1.0, 2, 0.7)]),
  aurochs: K('Aurochs', 'grazer', 'aurochs', 'designer D1: aurochs model', [2, 4], 2.5, 1.5, [3, 5], 'grazer', [at('stampede', 'charge', 7, 0.6, 1.4, 1.2, 2, 1.5)]),
  red_deer: K('Red Deer', 'skittish', 'redDeer', 'designer D1: red deer model', [1, 5], 0.8, 0.6, [2, 4], 'grazer', [at('kick', 'melee', 2, 0.5, 0.3, 1.0, 3, 0.6)]),
  fox: K('Fox', 'skittish', 'fox', '', [1, 3], 0.4, 0.3, [1, 1], 'grazer', [at('nip', 'melee', 1.5, 0.4, 0.2, 0.8, 2, 0.3)]),
  grey_wolf: K('Grey Wolf', 'packHunter', 'wolf', '', [4, 8], 0.9, 1, [3, 5], 'pack', [at('leap', 'lunge', 5, 0.5, 0.5, 1.5, 2, 1, 3), at('bite', 'melee', 1.8, 0.4, 0.2, 0.8, 1.5, 0.8, 2)], { walk: 1.95, run: 5.85 }),
  white_wolf: K('White Wolf', 'packHunter', 'wolf', 'variant: white fur, larger', [8, 10], 2, 1.4, [1, 1], 'elite', [at('leap', 'lunge', 5, 0.5, 0.5, 1.5, 2, 1.4, 3), at('howl', 'cast', 12, 0.8, 1.0, 1.0, 12, 0, 1)], { elite: true }),
  lynx: K('Lynx', 'ambusher', 'lynx', 'designer D2: lynx model', [5, 7], 0.8, 1.4, [1, 1], 'common', [at('pounce', 'lunge', 8, 0.4, 0.5, 1.5, 3, 1.4)]),
  black_bear: K('Black Bear', 'tank', 'bearBlack', '', [5, 9], 3.5, 2, [1, 1], 'common', [at('swipe', 'charge', 6, 0.8, 1.4, 1.5, 2, 2, 3), at('slam', 'aoe', 2.5, 0.8, 0.4, 1.5, 6, 2, 1)], { walk: 1.0, run: 4.0 }),
  cave_bear: K('Cave Bear', 'tank', 'bearBlack', 'variant: pale cave bear', [9, 10], 4.5, 2.4, [1, 1], 'elite', [at('swipe', 'charge', 6, 0.8, 1.4, 1.5, 2, 2.4, 3), at('roar', 'aoe', 6, 0.9, 0.4, 1.2, 10, 0.3, 1)], { elite: true, walk: 1.0, run: 4.0 }),
  river_crocodile: K('River Crocodile', 'waterAmbusher', 'crocodile', 'designer D1: crocodile model', [4, 7], 2.5, 2, [1, 1], 'common', [at('lunge', 'lunge', 4, 0.5, 0.4, 1.5, 3, 2), at('grab', 'grab', 2, 0.5, 3.0, 2.0, 8, 0.8)]),
  reed_eel: K('Reed Eel', 'swimmer', 'eel', 'designer D1: eel model', [5, 7], 0.7, 0.8, [1, 2], 'common', [at('bite', 'melee', 1.8, 0.4, 0.2, 1.0, 2, 0.8), at('coil', 'melee', 1.8, 0.6, 0.5, 1.2, 6, 0.4)]),
  snapping_turtle: K('Snapping Turtle', 'swimmer', 'tortoise', 'variant: snapping turtle', [3, 5], 2, 1.2, [1, 1], 'common', [at('snap', 'melee', 1.8, 0.6, 0.3, 1.5, 2.5, 1.2)], { walk: 0.8, run: 2.5 }),
  shore_crab: K('Shore Crab', 'swarm', 'crab', 'designer D1: crab model', [3, 4], 0.4, 0.5, [3, 6], 'pack', [at('pincer', 'melee', 1.2, 0.4, 0.2, 0.8, 1.5, 0.5)]),
  wood_spider: K('Wood Spider', 'ambusher', 'woodSpider', 'designer D2: spider model', [5, 7], 1, 1.1, [1, 1], 'common', [at('drop', 'lunge', 6, 0.5, 0.4, 1.2, 3, 1.1, 2), at('web', 'projectile', 12, 0.6, 0.3, 1.2, 5, 0.2, 1)]),
  spiderling: K('Spiderling', 'swarm', 'woodSpider', 'variant: spider x0.4', [5, 9], 0.15, 0.3, [6, 10], 'pack', [at('bite', 'melee', 1, 0.4, 0.2, 0.7, 1.2, 0.3)]),
  harpy: K('Harpy', 'flyer', 'harpy', 'designer D2: harpy model', [7, 9], 1.2, 1.3, [1, 2], 'common', [at('dive', 'dive', 15, 0.8, 0.8, 1.5, 5, 1.3, 3), at('screech', 'cast', 10, 0.6, 0.5, 1.0, 10, 0.1, 1)]),
  carrion_crow: K('Carrion Crow', 'flyer', 'crow', '', [3, 4], 0.2, 0.3, [5, 8], 'pack', [at('peck', 'dive', 8, 0.5, 0.5, 1.0, 3, 0.3)]),
  dusk_bat: K('Dusk Bat', 'swarm', 'bat', 'designer D2: bat model', [6, 10], 0.15, 0.3, [6, 10], 'pack', [at('swoop', 'dive', 6, 0.4, 0.5, 0.8, 2, 0.3)], { when: 'night', medium: 'air' }),
  skeleton_warrior: K('Skeleton Warrior', 'packHunter', 'skeleton', 'designer D3: skeleton model', [3, 10], 1.3, 1.2, [1, 3], 'common', [at('slash', 'melee', 2, 0.5, 0.3, 1.0, 1.5, 1.2)], { when: 'night', walk: 1.4, run: 4 }),
  skeleton_archer: K('Skeleton Archer', 'ranged', 'skeleton', 'designer D3: skeleton + bow', [3, 10], 0.8, 1, [1, 2], 'common', [at('volley', 'projectile', 18, 0.7, 0.3, 1.5, 3, 1)], { when: 'night' }),
  wisp: K('Wisp', 'caster', 'wisp', 'designer D3: wisp model', [5, 7], 0.5, 0.8, [1, 2], 'common', [at('burn', 'cast', 14, 1.0, 0.4, 1.5, 4, 0.8)], { when: 'night', medium: 'air', walk: 1.5, run: 3 }),
  treant: K('Treant', 'ambusher', 'treant', 'designer D2: treant model', [6, 7], 4, 1.8, [1, 1], 'elite', [at('rootslam', 'aoe', 3, 0.9, 0.4, 2.0, 5, 1.8)], { elite: true, walk: 0.8, run: 2.5 }),
  troll: K('Troll', 'tank', 'troll', 'designer D2: troll model', [8, 10], 5, 2.5, [1, 1], 'elite', [at('sweep', 'melee', 3, 0.8, 0.4, 1.5, 3, 2.5, 3), at('boulder', 'projectile', 20, 1.0, 0.4, 2.0, 8, 2, 1)], { elite: true }),
  goblin_warrior: K('Goblin Warrior', 'packHunter', 'goblin', '', [2, 8], 1.2, 1, [2, 4], 'camp', [at('slash', 'lunge', 3.5, 0.5, 0.3, 0.6, 1.5, 1), at('shove', 'melee', 1.5, 0.5, 0.2, 0.8, 4, 0.2)], { walk: 1.6, run: 5.175 }),
  goblin_spear_thrower: K('Goblin Spear Thrower', 'ranged', 'goblinSpear', '', [2, 8], 0.8, 1, [1, 3], 'camp', [at('throw', 'projectile', 14, 0.6, 0.3, 2.0, 2.5, 1)], { walk: 1.6, run: 5.175, keepMin: 7, keepMax: 14 }),
  goblin_archer: K('Goblin Archer', 'ranged', 'goblin', 'designer D3: goblin + bow', [4, 8], 0.7, 0.9, [1, 3], 'camp', [at('shoot', 'projectile', 20, 0.7, 0.3, 1.8, 2.5, 0.9)], { keepMin: 10, keepMax: 14 }),
  goblin_torch_bearer: K('Goblin Torch-Bearer', 'packHunter', 'goblinTorch', '', [2, 8], 1.2, 1.1, [1, 1], 'camp', [at('swing', 'melee', 2, 0.5, 0.3, 1.0, 2, 1.1), at('alarm', 'cast', 20, 0.6, 0.5, 1.0, 30, 0)], { walk: 1.6, run: 5.175 }),
  goblin_shaman: K('Goblin Shaman', 'caster', 'goblin', 'designer D3: goblin + staff/mask', [5, 8], 0.8, 0.8, [1, 1], 'camp', [at('heal', 'heal', 18, 1.2, 0.4, 1.0, 6, 0), at('hex', 'cast', 16, 1.0, 0.4, 1.5, 4, 0.8)]),
  goblin_chief: K('Goblin Chief', 'tank', 'goblin', 'designer D3: goblin x1.3 + armour', [3, 9], 3, 1.6, [1, 1], 'camp', [at('smash', 'melee', 2.5, 0.9, 0.4, 1.8, 3, 1.6, 3), at('warhorn', 'cast', 25, 0.8, 0.5, 1.0, 20, 0, 1)], { elite: true }),
  bandit_cutthroat: K('Bandit Cutthroat', 'packHunter', 'humanKit', 'designer D3: bandit outfit (human_kit)', [3, 8], 1.3, 1.2, [2, 4], 'pack', [at('combo', 'melee', 2, 0.4, 0.5, 1.0, 1.5, 1.2)], { walk: 1.6, run: 5 }),
  bandit_archer: K('Bandit Archer', 'ranged', 'humanKit', 'designer D3: bandit outfit + bow', [3, 8], 0.8, 1, [1, 2], 'pack', [at('shoot', 'projectile', 20, 0.7, 0.3, 1.8, 2.5, 1)], { keepMin: 10, keepMax: 14 }),
});

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
