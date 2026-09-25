// game/js/audio/surfaces.js (US-020c: footsteps per floor surface)
//
// Maps a sector's `floorMat` key (engine/world/World.js `sectorAt`/
// `outsideSector` - see sfx.js's `floorMatAt`) to one of the three footstep
// TIMBRES the AC actually asks for: 'stone' (current step, unchanged),
// 'wood' (lower, hollow knock), 'iron' (short metallic tick). Anything not
// explicitly wood/iron falls back to 'stone' (AC: "unknown material =
// stone") - this is a deliberate 3-bucket design, not a 4th "soft" category:
// the current level data (design/levels/tower.js) only has stone-like
// materials (floor, rubble, rock, ash, moss_top) and grass/moss (outside
// terrain) - none of these are wood or iron, so they all read as 'stone'
// through the same default, exactly like a real unknown key would. Wood/
// iron keys aren't in any level yet (those need designer materials added to
// level data first, per the backlog note) - this map is ready for them.
const WOOD_MATS = new Set(['wood', 'deck']);
const IRON_MATS = new Set(['iron', 'grate']);

/** floorMat key -> 'stone' | 'wood' | 'iron'. Unknown/missing = 'stone'. */
export function surfaceTimbre(mat) {
  if (WOOD_MATS.has(mat)) return 'wood';
  if (IRON_MATS.has(mat)) return 'iron';
  return 'stone';
}
