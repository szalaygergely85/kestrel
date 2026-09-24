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

      // US-016: the SIGNAL TOWER (D-011 addendum), 800 m WSW of the breach, drawn via the sprite pass (architecture.md 14.4 item 7).
      // Body static, dark, unlit (fog cap 0.40); its crown-notch light cells (model keys L/G) are emissive aether teal with their
      // own key fogMax 0.20. No point light, no interaction, never touched by US-022. z = overworld_far.farTower.baseZ (the hill2
      // crown sits at about -10..-8 m there; a 2 m offset is < 0.2 rows at 800 m). The sprite anchor is its bottom-centre cell.
      { id: 'farTower', type: 'billboard', x: 713.8, y: 1232.1, z: -8, model: 'farTower',
        unlit: true, fogModel: 'far', fogMax: 0.40,
        sizeM: { w: 14, h: 42 }, minCells: { w: 3, h: 4 }, detailRows: 12,
        note: 'the signal tower; matches overworld_far.farTower (azimuth 255 from the breach, 15 deg left of centre, top ~1.9 deg above the horizon)' }
    ],

    // Horizon billboards (US-016 D-011 addendum; design/README.md 4.3). A separate list, NOT `entities`: they have no world
    // position (placed by angle), so World.load's entity path (transform / x,y / spawn) does not apply. World.load ignores
    // this key today; the US-016 renderer reads it (engine note for the architect: pass it through like `terrain`).
    horizon: [
      // FERRUM'S LIGHTS: placed by angle, not by metres,
      // beyond the terrain far limit (Ferrum is ~9 km E). Drawn after terrain, only on sky cells (never over structure or
      // terrain), with a FIXED fog amount (it is past fog.far.full, so distance fog would erase it); emissive light keys cap it
      // at their own fogMax. Not a point light. Bearing 87.6 = behind the player at the breach (breach yaw 270), centred so the
      // Crown sits in the lowest notch of the east wall silhouette (the sun-crack wall top, 8.0 m, cells K 21..22,6): from the
      // breach the Crown + upper tiers show over that wall top; from the summit walkway east edge the Crown row; from the relay
      // plinth most of the band (preview/overworld.html "Ferrum visibility" check prints the rows).
      { id: 'ferrumLights', type: 'horizon', model: 'ferrumLights',
        bearingDeg: 87.6, elevDeg: 1.0, angular: { wDeg: 13.2, hDeg: 2.2 },
        unlit: true, fog: 0.55, fogColor: 'fogFar', drawOver: 'sky', distanceM: 9000,
        note: 'bearing = compass deg of the band centre, elevDeg = its bottom edge above the horizon (eye-independent: at infinity). ' +
              'Cells: az = cam yaw + atan((col + 0.5 - cols/2) / focalCols), el = atan((horizonRow - row - 0.5) / planeDistY); ' +
              'sample the model by angle fraction (nearest), tier by projected rows (hDeg * rows/deg / size.h < 0.75 -> lods.half). ' +
              'M1 only: the band base floats 1.0 deg up, hidden behind the east wall from every M1 viewpoint; M2 (outside) adds a hill row or elevDeg 0' }
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
      'ui.mapCard.shown': false,
      // US-015: true once M has opened the card; the "Press M to read the chart." hint is skipped/removed on it
      // (title.js uiStyle.storyHints chart.on.skipIfState). Restart resets it with the rest of the state.
      'ui.mapCard.opened': false
    }
    // US-016 D-011 addendum, envelope below the breach: the torn Kestrel envelope (model envelopeHeap) is a STRUCTURE-local
    // prop of design/levels/tower.js (props[] id envelopeHeap at level (3.0, 6.5) = world (1483.0, 1024.5), on the rock outside
    // the broken west wall), placed by the US-011 levelPatch; per the rule above it is not duplicated here. Seen looking down
    // from the breach (about 22 deg below level, inside the pitch clamp); preview/overworld.html checks the sightline.
  };
})(typeof window !== 'undefined' ? window : globalThis);
