/*
 * ASCII Quest - Milestone 1 world definition (US-025, D-007)
 * Plain script: sets ASSETS.worlds.world_m1. game/js/main.js passes it to World.load() via the AssetRegistry.
 * JSON-safe plain data only (the future editor reads/writes this shape; US-026 exports it as JSON).
 *
 * Frame: world metres, x east, y south, z up. The terrain recipe's z = 0 IS the tower ground floor,
 * so the tower is placed with origin z = 0: its outer ring (2.4 m) meets the terrain crown (2.4 m) exactly
 * (US-016b handover, mismatch 0).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.worlds = A.worlds || {};

  A.worlds.world_m1 = {
    name: 'world_m1',
    version: 1,
    title: 'The Emberlands - Milestone 1',

    terrain: 'overworld_far',                 // ASSETS.levels.overworld_far (seed + recipe + overrides)
    time: 'morning',                          // palette timeOfDay key; sun direction comes from the placed tower's level.sun in M1

    structures: [
      { id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0,
        note: 'level (0,0) -> world (1480, 1018); footprint 24 x 14 m = world x 1480..1504, y 1018..1032; matches overworld_far.structures[0]' }
    ],

    // Entities in world coordinates. Structure-local things (props, lights, interactables, triggers, the boulder)
    // come from the placed level's own data, offset by its origin; they are not duplicated here.
    entities: [
      { id: 'player', type: 'player', spawn: { structure: 'tower', from: 'start' },
        note: 'pose = tower.start (x 17.0, y 9.5, facingDeg 330, pitchDeg 30, eyeH 0.3, lying) + origin -> world (1497.0, 1027.5)' },

      // US-016: the dark second tower, 800 m WSW of the breach, drawn via the sprite pass (architecture.md 14.4 item 7).
      // Static, unlit, no light, no interaction, never touched by US-022. z = overworld_far.farTower.baseZ (the hill2 crown
      // sits at about -10..-8 m there; a 2 m offset is < 0.2 rows at 800 m). The sprite anchor is its bottom-centre cell.
      { id: 'farTower', type: 'billboard', x: 713.8, y: 1232.1, z: -8, model: 'farTower',
        unlit: true, fogModel: 'far', fogMax: 0.40,
        sizeM: { w: 14, h: 42 }, minCells: { w: 3, h: 4 }, detailRows: 12,
        note: 'matches overworld_far.farTower (azimuth 255 from the breach, 15 deg left of centre, top ~1.9 deg above the horizon)' }
    ],

    // Initial world state, the thing US-017 restart deserializes back to (US-025 serialize round-trip).
    state: {
      'tower.lantern.taken': false,
      'tower.lever.pulled': false,
      // US-014 tech note 4: no 'tower.grate.open' key here - `structure.
      // dynamics['grate']` (serialized on the structure itself) is the only
      // truth for the grate's open/closed state.
      'tower.beacon.lit': false,
      'hints.shown': [],
      // US-017: -1 = not ending; `quest.end` (game/js/quest/end.js) sets it
      // to 0 on the end trigger's enter edge, then it counts up in seconds.
      // Restart = deserialize(initialState) (US-025 serialize round trip),
      // which resets this back to -1 for free.
      'quest.endT': -1,
      'ui.mapCard.shown': false
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
