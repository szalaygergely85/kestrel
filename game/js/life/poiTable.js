// POI-01 (OB-141, D-088): kind templates + the per-site table for the generated points of interest. Data only.
// A POI is built from a `world_geo.sites` row (matched by name `n`); position = nearest valid ground to the site (poiSites.js).
// Text: every POI has a plain `name` (shown to the player) and a text key `poi.<id>.text` -> NEEDS WRITER until docs/story.md has it.
// Rewards use existing item ids only (loot tables mirror chestDefs.js tables; band-tiered gear via `gear.tier`).

/** Kind templates: props = voxel models placed around the anchor (at = [dx, dy] metres); `smoke` = particle emitter preset; `chest` marks the lootable prop. */
export const KINDS = Object.freeze({
  chest: { props: [{ model: 'chestSmall', anim: 'closed', at: [0, 0], chest: true }] },
  inspect: { props: [] },
  brazier: { props: [{ model: 'brazier', anim: 'burn', at: [0, 0], light: 'torch' }, { smoke: 'farSmoke', at: [0, 0] }] },
  camp: { props: [{ model: 'brazier', anim: 'burn', at: [0, 0], light: 'torch' }, { smoke: 'farSmoke', at: [0, 0] }, { model: 'chestSmall', anim: 'closed', at: [2.5, 1.5], chest: true }] },
  beast: { props: [] },
  view: { props: [] },
  puzzle: { props: [{ model: 'chestSmall', anim: 'closed', at: [0, 0], chest: true }] },
  npc: { props: [] },
});

/** Loot tables for POI chests (item ids as in chestDefs.js). */
export const POI_TABLES = Object.freeze({
  potion2: { fixed: [{ item: 'potion.health', n: 2 }], weighted: [] },
  heart: { fixed: [{ item: 'heart.piece', n: 1 }], weighted: [] },
  arrowsGear: { fixed: [{ item: 'arrow', n: 10 }], weighted: [], gear: { tier: 'sturdy' } },
  arrows: { fixed: [{ item: 'arrow', n: 10 }], weighted: [] },
  gearFine: { fixed: [], weighted: [], gear: { tier: 'fine' } },
  lootSturdy: { fixed: [{ item: 'arrow', n: 6 }], weighted: [], gear: { tier: 'sturdy' } },
});

/**
 * One row per site: site (world_geo sites `n`), key (id part), name (shown), region (world_geo region id; clamps the placement rect, null = bounds only),
 * kind (KINDS), table (POI_TABLES key), fight {species, n, guardian?} (small fight: respawns after 3 days; guardian never), band = level hint.
 */
export const POI_ROWS = Object.freeze([
  // heartland, tower side (lv 2-3)
  { site: 'river farm', key: 'riverFarm', name: 'River Farm', region: null, kind: 'npc', table: 'potion2' },
  { site: 'boar wallow', key: 'boarWallow', name: 'Boar Wallow', region: null, kind: 'camp', table: 'arrowsGear', fight: { species: 'boar', n: 4 } },
  { site: 'flower meadow', key: 'flowerMeadow', name: 'Flower Meadow', region: null, kind: 'view' },
  { site: 'old bridge piers', key: 'bridgePiers', name: 'Old Bridge Piers', region: null, kind: 'puzzle', table: 'heart' },
  // Thornwood (lv 6-7)
  { site: 'charcoal burners', key: 'charcoalBurners', name: 'Charcoal Burners', region: 'thornwood', kind: 'camp', table: 'lootSturdy', fight: { species: 'goblin', n: 3 } },
  { site: 'the hollow oak', key: 'hollowOak', name: 'Hollow Oak', region: 'thornwood', kind: 'chest', table: 'gearFine' },
  { site: "hunter's lodge", key: 'hunterLodge', name: "Hunter's Lodge", region: 'thornwood', kind: 'chest', table: 'arrows' },
  { site: 'moss shrine', key: 'mossShrine', name: 'Moss Shrine', region: 'thornwood', kind: 'puzzle', table: 'heart' },
  { site: "woodcutters' camp", key: 'woodcutters', name: "Woodcutters' Camp", region: null, area: 'thornwood', kind: 'brazier' },
  // Ford-west: Outwall fields, the north look, the stepping stones
  { site: 'orchard', key: 'orchard', name: 'The Orchard', region: 'outwall', kind: 'inspect' },
  { site: 'goose farm', key: 'gooseFarm', name: 'Goose Farm', region: 'outwall', kind: 'brazier' },
  { site: 'Outwall barley farm', key: 'barleyFarm', name: 'Barley Farm', region: 'outwall', kind: 'chest', table: 'arrows' },
  { site: 'north look', key: 'northLook', name: 'North Look', region: null, kind: 'view' },
  { site: 'stepping stones', key: 'steppingStones', name: 'Stepping Stones', region: 'ford', kind: 'inspect' },
]);
