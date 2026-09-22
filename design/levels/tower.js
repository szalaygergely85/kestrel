/*
 * ASCII Quest - US-010 "The Hollow Watchtower" layout (design data, v1)
 * Owner: Designer. Human-readable companion: design/levels/tower_layout.md
 * Format: game/js/world/MAP_FORMAT.md v1 (level = { name, legend, rows, start }), plus optional
 * extensions that loadLevel ignores (see tower_layout.md section 6).
 * Plain script: sets window.ASSETS.levels.tower. The programmer ports it to
 * game/js/world/levels/tower.js as `export default <this object>` - no content changes needed.
 * The preview (design/preview/tower.html) runs it through the real loadLevel when served over http.
 *
 * COORDINATES: 1 cell = 1 m. rows[y][x]; x grows EAST (columns), y grows SOUTH (rows).
 * Cell (x,y) spans [x, x+1] x [y, y+1] m. z = height in m (0 = tower ground floor).
 * Yaw: compass degrees, 0 = north (-y), 90 = east (+x), clockwise.
 */
(function (root) {
  'use strict';
  var ASSETS = root.ASSETS = root.ASSETS || {};
  ASSETS.levels = ASSETS.levels || {};

  // helper for the legend (keeps entries short). Guarantees the 6 MAP_FORMAT fields on every entry:
  // floorH, ceilH (number | 'sky'), wallMat, floorMat, ceilMat (always a material key; 'sky' on open cells), solid.
  function S(o) {
    if (o.ceilH === undefined) o.ceilH = 'sky';
    if (o.ceilMat == null) o.ceilMat = 'sky';
    if (o.solid === undefined) o.solid = false;
    return o;
  }
  function wall(top, mat, desc) { return S({ solid: true, floorH: top, wallMat: mat, floorMat: 'rubble', ceilMat: null, zone: 'wall', desc: desc }); }
  function step(h, mat, zone, desc) { return S({ floorH: h, wallMat: mat, floorMat: 'floor', ceilMat: null, zone: zone, desc: desc }); }

  ASSETS.levels.tower = {
    name: 'tower',
    title: 'The Hollow Watchtower',
    version: 1,
    cellSize: 1,
    size: { w: 24, h: 14 },

    //        0         1         2
    //        012345678901234567890123
    rows: [
      ',,;;;;;;;;,,,,,,,,,,,,,,', // 0
      ',;;vvvvvv;;,,,unmnmu,,,,', // 1
      ',;vvwwwwvv;,,unuRzmn%,,,', // 2
      ';vwwwwwwwwv,un_s1234%#,,', // 3
      ';vwwwwPPPPP!$oo_ccc56%#,', // 4
      ';vwwwYP====!!o_...:.7##,', // 5
      ';lkjxXb=OO=!z....:*:8KK,', // 6
      ';lkjxXb=OO=dJI....:.9##,', // 7
      ';vwwwYP====$!HR....rg##,', // 8
      ';vwwwwPPPPP!$FE....LL%#,', // 9
      ';;vvwwwwwvv,$&DCBAGLL%,,', // 10
      ',;;vvvvv;;,,,&$&%%&%#,,,', // 11
      ',,;;;;;,,,,,,,$&$&%&,,,,', // 12
      ',,,,,,,,,,,,,,,,,,,,,,,,'  // 13
    ],

    legend: {
      // ---- tower walls: solid; floorH = broken wall top (for rendering the silhouette) ----
      '#': wall(8.5, 'stone', 'tower wall, top 8.5 m (east / sun side: tall, casts the shaft edge)'),
      '%': wall(8.0, 'stone', 'tower wall, top 8.0 m'),
      '&': wall(7.5, 'stone', 'tower wall, top 7.5 m'),
      '$': wall(7.0, 'stone', 'tower wall, top 7.0 m'),
      '!': wall(6.5, 'stone', 'tower wall, top 6.5 m (west: broken low beside the summit)'),
      'm': wall(8.5, 'stone_moss', 'north tower wall, top 8.5 m, moss band near the floor'),
      'n': wall(8.0, 'stone_moss', 'north tower wall, top 8.0 m, moss'),
      'u': wall(7.5, 'stone_moss', 'north tower wall, top 7.5 m, moss'),
      'c': S({ solid: true, floorH: 1.4, wallMat: 'stone_moss', floorMat: 'floor', ceilMat: null, zone: 'wall',
               desc: 'stair cheek wall (solid, 1.4 m): the first steps can only be entered from the stair base' }),
      'P': S({ solid: true, floorH: 7.0, wallMat: 'stone', floorMat: 'floor', ceilMat: null, zone: 'wall',
               desc: 'summit parapet, waist high (1.0 m above the walkway), solid so it cannot be climbed' }),

      // ---- level 0: ground floor ----
      '.': S({ floorH: 0.0, wallMat: 'stone', floorMat: 'floor', ceilMat: null, zone: 'ground', desc: 'flagstone floor' }),
      ':': S({ floorH: 0.0, wallMat: 'stone', floorMat: 'ash', ceilMat: null, zone: 'ground', desc: 'floor with cold ash around the brazier' }),
      's': S({ floorH: 0.0, wallMat: 'stone', floorMat: 'floor', ceilMat: null, zone: 'ground', tag: 'stairBase',
               desc: 'stair base: boulder start. Only entrance to the stair' }),
      '_': S({ floorH: -0.15, wallMat: 'stone_moss', floorMat: 'floor', ceilMat: null, zone: 'ground', tag: 'slope',
               desc: 'slope apron from the stair base down to the hollow' }),
      'o': S({ floorH: -0.3, wallMat: 'stone_moss', floorMat: 'rubble', ceilMat: null, zone: 'ground', tag: 'hollow',
               desc: 'NW hollow: the boulder\'s only resting place' }),
      'r': S({ floorH: 0.3, wallMat: 'rubble', floorMat: 'rubble', ceilMat: null, zone: 'ground', tag: 'rubble', desc: 'rubble heap 0.3 m' }),
      'R': S({ floorH: 0.6, wallMat: 'rubble', floorMat: 'rubble', ceilMat: null, zone: 'ground', tag: 'rubble', desc: 'rubble heap 0.6 m' }),
      'z': S({ floorH: 0.9, wallMat: 'rubble', floorMat: 'rubble', ceilMat: null, zone: 'ground', tag: 'rubble', desc: 'rubble heap 0.9 m' }),
      '*': S({ floorH: 0.5, wallMat: 'stone_scorched', floorMat: 'ash', ceilMat: null, zone: 'ground', tag: 'brazier',
               desc: 'stone ring under the brazier (0.5 m: not steppable, only jumpable)' }),

      // ---- level 1: lower stair 0.3 -> 2.7, gap, mid ledge 3.0 (clockwise: N wall eastward, then E wall southward) ----
      '1': step(0.3, 'stone_moss', 'stair', 'step 1'),
      '2': step(0.6, 'stone_moss', 'stair', 'step 2'),
      '3': step(0.9, 'stone_moss', 'stair', 'step 3'),
      '4': step(1.2, 'stone_moss', 'stair', 'step 4'),
      '5': step(1.5, 'stone', 'stair', 'step 5'),
      '6': step(1.8, 'stone', 'stair', 'step 6'),
      '7': step(2.1, 'stone_scorched', 'stair', 'step 7 (faces the brazier)'),
      '8': step(2.4, 'stone_scorched', 'stair', 'step 8 (lantern hook on its west face)'),
      '9': step(2.7, 'stone_scorched', 'stair', 'step 9: jump-off edge of the gap'),
      'g': S({ floorH: 0.6, wallMat: 'rubble', floorMat: 'rubble', ceilMat: null, zone: 'stair', tag: 'gap',
               desc: 'THE GAP: collapsed step, debris pile 0.6 m below. Falling lands here, walk off to the ground' }),
      'L': step(3.0, 'stone', 'ledge', 'mid ledge 2x2 in the SE wall niche (lever)'),
      'G': S({ floorH: 3.0, ceilH: 3.0, wallMat: 'stone', floorMat: 'floor', ceilMat: 'iron', zone: 'upper', tag: 'grate',
               topH: 6.6, upperMat: 'grate', dynamic: { ceilOpen: 5.4, openTime: 1.5, ease: 'inOut' },
               desc: 'GRATE (portcullis) cell: closed ceilH = floorH (impassable); lever raises ceilH to 5.4 m' }),

      // ---- level 2: upper stair 3.3 -> 5.7 (S wall westward, then W wall northward), summit 6.0 ----
      'A': step(3.3, 'stone', 'upper', 'upper step 1'),
      'B': step(3.6, 'stone', 'upper', 'upper step 2'),
      'C': step(3.9, 'stone', 'upper', 'upper step 3 (scrawl below on its north face)'),
      'D': step(4.2, 'stone', 'upper', 'upper step 4'),
      'E': step(4.5, 'stone', 'upper', 'upper step 5'),
      'F': step(4.8, 'stone', 'upper', 'upper step 6'),
      'H': step(5.1, 'stone', 'upper', 'upper step 7'),
      'I': step(5.4, 'stone', 'upper', 'upper step 8'),
      'J': step(5.7, 'stone', 'upper', 'upper step 9'),
      'd': step(6.0, 'stone', 'summit', 'doorway through the west wall onto the summit (10th rise)'),
      '=': step(6.0, 'stone', 'summit', 'summit walkway (ring around the beacon bowl)'),
      'O': S({ floorH: 6.6, wallMat: 'iron', floorMat: 'ash', ceilMat: null, zone: 'summit', tag: 'beaconBowl',
               desc: 'beacon bowl 2x2 m: iron sides 0.6 m, full of grey ash' }),
      'b': S({ floorH: 6.0, wallMat: 'rubble', floorMat: 'rubble', ceilMat: null, zone: 'summit', tag: 'breach',
               desc: 'THE BREACH: 2 m hole in the west parapet' }),
      'K': S({ floorH: 4.0, ceilH: 6.4, topH: 8.0, wallMat: 'stone', floorMat: 'rubble', ceilMat: 'stone', zone: 'wall', tag: 'sunCrack',
               desc: 'sun crack through the east wall (4.0-6.4 m). Out of reach: >= 1.3 m above any reachable floor' }),

      // ---- outside ----
      'X': S({ floorH: 6.0, wallMat: 'rock', floorMat: 'rock', ceilMat: null, zone: 'outside', tag: 'trigger:end',
               desc: 'outcrop just past the breach: END TRIGGER' }),
      'Y': S({ floorH: 5.4, wallMat: 'rock', floorMat: 'rock', ceilMat: null, zone: 'outside', tag: 'trigger:end',
               desc: 'rock beside the outcrop, also END TRIGGER (a diagonal step off the breach must not skip the ending)' }),
      'x': S({ floorH: 6.0, wallMat: 'rock', floorMat: 'rock', ceilMat: null, zone: 'outside', desc: 'outcrop (end camera walks here)' }),
      'j': S({ floorH: 5.4, wallMat: 'rock', floorMat: 'grass', ceilMat: null, zone: 'outside', desc: 'hill path down, 5.4 m' }),
      'k': S({ floorH: 4.6, wallMat: 'rock', floorMat: 'grass', ceilMat: null, zone: 'outside', desc: 'hill path, 4.6 m' }),
      'l': S({ floorH: 3.6, wallMat: 'rock', floorMat: 'grass', ceilMat: null, zone: 'outside', desc: 'hill path, 3.6 m' }),
      'w': S({ floorH: 5.4, wallMat: 'rock', floorMat: 'rock', ceilMat: null, zone: 'outside', desc: 'rock spur under the summit, 5.4 m' }),
      'v': S({ floorH: 4.2, wallMat: 'rock', floorMat: 'rock', ceilMat: null, zone: 'outside', desc: 'rock slope, 4.2 m' }),
      ';': S({ floorH: 2.4, wallMat: 'rock', floorMat: 'grass', ceilMat: null, zone: 'outside', desc: 'hillside grass, 2.4 m' }),
      ',': S({ floorH: 1.0, wallMat: 'rock', floorMat: 'grass', ceilMat: null, zone: 'outside', desc: 'hillside grass around the tower, 1.0 m' })
    },

    // Boulder tilt layer (extension). One char per cell, numpad directions:
    // 8 N, 2 S, 4 W, 6 E, 7 NW, 9 NE, 1 SW, 3 SE, 5 = sink (pull toward hollow.center), '.' = none.
    // The heights alone already trap the boulder (step threshold 0, see tower_layout.md 5);
    // the tilt only keeps it rolling so it never rests on the stair base or the apron.
    layers: {
      tilt: [
        '........................',
        '........................',
        '........................',
        '..............21........',
        '.............554........',
        '.............54.........',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................'
      ]
    },
    tilt: { grade: 0.05, hollowCenter: { x: 13.9, y: 4.7 } },

    // player start (MAP_FORMAT 2.3, explicit form): lying on the straw pallet against the south stair wall,
    // looking up at the sun shaft. facingDeg is compass (0 = north, 90 = east), as the camera code uses it.
    // Explicit rather than a legend start char because the pallet centre lies on a cell edge (x = 17.0).
    // Extra fields (eye, eyeStand, pitchDeg, pose) are US-015 wake-sequence data; loadLevel ignores them.
    start: { x: 17.0, y: 9.5, facingDeg: 330, eye: 0.3, eyeStand: 1.6, pitchDeg: 30, pose: 'lying' },

    sun: { preset: 'sun', elevation: 60, azimuth: 112.5 },
    ambient: { preset: 'ambient' },
    lights: [
      { id: 'brazier', preset: 'torch', x: 18.5, y: 6.5, z: 1.2, on: true },
      { id: 'beacon', preset: 'beacon', x: 9.0, y: 7.0, z: 7.4, on: false, note: 'US-022 only' }
      // the lantern light is created by US-012 when the lantern is taken (preset 'lantern', carried)
    ],

    // props: model = US-011 asset name; x,y,z = anchor (feet) position; facing = compass deg the front looks at
    props: [
      { id: 'pallet', model: 'pallet', x: 17.0, y: 9.5, z: 0.0, facing: 0, note: 'straw pallet, long axis E-W; walk-over (no collision)' },
      { id: 'brazier', model: 'brazier', x: 18.5, y: 6.5, z: 0.5, facing: 180, collide: 'sector', note: 'on the stone ring (*); torch light source' },
      { id: 'lantern', model: 'lantern', variant: 'unlit', x: 19.9, y: 6.5, z: 1.3, facing: 270, hook: true,
        interact: { prompt: '[E] Take lantern', radius: 1.8 }, note: 'on a hook on the west face of step 8, 1.4 m from the brazier' },
      { id: 'boulder', model: 'boulder', x: 15.55, y: 3.5, z: 0.0, radius: 0.6, dynamic: true,
        note: 'on the stair base, 5 cm onto step 1: blocks the only stair entrance' },
      { id: 'lever', model: 'lever', pose: 'up', x: 19.25, y: 9.3, z: 3.0, facing: 90,
        interact: { prompt: '[E] Pull lever', radius: 1.8 }, note: 'post at the NW corner of the ledge; pulled facing west, grate 30 deg left of view centre' },
      { id: 'chains', model: 'chains', from: { x: 19.25, y: 9.3, z: 3.2 }, to: { x: 19.0, y: 10.5, z: 5.4 }, note: 'decal/sprite: chain from lever to grate head' },
      { id: 'beaconBowl', model: 'beaconBowl', x: 9.0, y: 7.0, z: 6.6, facing: 90, note: 'bowl sprite sits on the O cells (iron sides + ash floor are sector geometry)' },
      { id: 'rubble1', model: 'rubble', variant: 0, x: 19.5, y: 8.5, z: 0.3 },
      { id: 'rubble2', model: 'rubble', variant: 1, x: 14.5, y: 8.5, z: 0.6 },
      { id: 'rubble3', model: 'rubble', variant: 2, x: 12.5, y: 6.5, z: 0.9 },
      { id: 'rubble4', model: 'rubble', variant: 1, x: 16.5, y: 2.5, z: 0.6 },
      { id: 'rubble5', model: 'rubble', variant: 0, x: 20.5, y: 8.5, z: 0.6, note: 'debris in the gap' },
      { id: 'scrawl', model: 'decal:KEEP THE LIGHT', wall: { x0: 15.2, x1: 17.8, y: 10.0, z0: 0.45, z1: 0.95 }, facing: 0,
        note: 'US-021: on the north face of upper steps C/B, right above the pallet' }
    ],

    triggers: [
      { id: 'end', type: 'end', cells: [[5, 5], [5, 6], [5, 7], [5, 8]], walkTo: { x: 4.5, y: 7.0 }, pitchTo: -12,
        note: 'trigger = every cell of the "trigger:end" tag; X = straight out of the breach, Y = diagonal steps off it' }
    ],

    markers: {
      gapEdge: { x: 20.5, y: 8.0, z: 2.7, note: 'US-015 jump hint within 2 m of here' },
      hollowCenter: { x: 13.9, y: 4.7, z: -0.3 },
      sunCrack: { x: 21.5, y: 6.5, z: 5.2 },
      breach: { x: 6.5, y: 7.0, z: 6.0 },
      dustVolume: { x0: 13, x1: 17.5, y0: 4, y1: 8.5, z0: 0.2, z1: 6.0, note: 'US-019: motes only where sunlit' }
    },

    // the intended route, cell by cell ([x,y]); used by the preview's checks and the stair profile
    route: [
      [15, 3], [16, 3], [17, 3], [18, 3], [19, 3], [19, 4], [20, 4], [20, 5], [20, 6], [20, 7],
      [20, 9], [19, 9], [19, 10], [18, 10],
      [17, 10], [16, 10], [15, 10], [14, 10], [14, 9], [13, 9], [13, 8], [13, 7], [12, 7],
      [11, 7], [10, 7], [10, 8], [9, 8], [8, 8], [7, 8], [7, 7], [6, 7], [5, 7]
    ],
    // a route step of 2 cells in a straight line = the gap jump over the cell between
    routeNotes: { '20,9': 'landed: jumped the gap (2.7 over the debris cell to 3.0)', '18,10': 'grate (needs lever)',
                  '11,7': 'doorway 6.0', '6,7': 'breach', '5,7': 'end trigger' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
