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
        note: 'pose = tower.start (x 17.0, y 9.5, facingDeg 330, pitchDeg 30, eyeH 0.3, lying) + origin -> world (1497.0, 1027.5)' }
    ],

    // Initial world state, the thing US-017 restart deserializes back to (US-025 serialize round-trip).
    state: {
      'tower.lantern.taken': false,
      'tower.lever.pulled': false,
      'tower.grate.open': 0,                  // 0..1 progress of the dynamic ceiling
      'tower.beacon.lit': false,
      'hints.shown': []
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
