/*
 * ASCII Quest - US-003 reference test level (v2), 20x18 (moved from
 * game/js/world/levels/test_room.js by US-024, D-006: content lives in
 * design/, loaded as a classic script like palette.js). Exercises every
 * Sector field the format defines, including the v2 extensions (solid wall
 * height, topH/upperMat, gaps). See engine/world/MAP_FORMAT.md for the
 * authoring format.
 *
 * Legend key -> meaning:
 *   #  outer wall / room walls, solid, top 3.0 m (top face = floorMat)
 *   .  flat floor, 0.0 m, stone ceiling at 3.0 m
 *   ^  sky-ceiling region (roofless), floor stays 0.0 m
 *   O  solid pillar, top 3.0 m
 *   w  solid LOW wall, top 1.0 m - stand south of it and look north over it
 *      into the sky region (v2 "solid cells have a height" check)
 *   m  solid wall stub, stone_moss, top 3.0 m (US-004 tintBand check)
 *   D  lintel/doorway: ceilH 2.2, topH 3.0 (stone mass above the opening)
 *   S  player wake/start marker (flat floor, facing east = facingDeg 90)
 *   1  staircase step 1, floor 0.3 m (also reused as the +0.3 m gap landing)
 *   2  staircase step 2, floor 0.6 m
 *   3  staircase step 3, floor 0.9 m
 *   P  raised platform, floor 1.0 m
 *   v  void/pit (open gap), floor -0.6 m, non-solid - fall in if you miss the
 *      jump. Raised from -1.0 m (US-009 AC6, from the US-003 review): -0.6 m
 *      is more than stepUpMax (0.45 m) below the surrounding 0.0 m floor, so
 *      it still can't be walked out of, but the 6.5 m/s jump clears it
 *      easily (apex 1.056 m), so it's not a test-room trap.
 *
 * Gap tests (US-009): row 15 is a 1-cell (1 m) gap from 0.0 m onto +0.3 m;
 * row 16 is a 2-cell (2 m) gap at equal height (0.0 m to 0.0 m).
 */
(function (root) {
  'use strict';
  var ASSETS = root.ASSETS = root.ASSETS || {};
  ASSETS.levels = ASSETS.levels || {};

  var legend = {
    '#': { floorH: 3.0, ceilH: 'sky', wallMat: 'stone',      floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0,   ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    '^': { floorH: 0,   ceilH: 'sky', wallMat: 'stone',      floorMat: 'floor', ceilMat: 'sky', solid: false },
    'O': { floorH: 3.0, ceilH: 'sky', wallMat: 'stone',      floorMat: 'floor', ceilMat: 'sky', solid: true },
    'w': { floorH: 1.0, ceilH: 'sky', wallMat: 'stone',      floorMat: 'floor', ceilMat: 'sky', solid: true },
    'm': { floorH: 3.0, ceilH: 'sky', wallMat: 'stone_moss', floorMat: 'floor', ceilMat: 'sky', solid: true },
    'D': { floorH: 0,   ceilH: 2.2,   wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, topH: 3.0 },
    'S': { floorH: 0,   ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, start: true, facingDeg: 90 },
    '1': { floorH: 0.3, ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    '2': { floorH: 0.6, ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    '3': { floorH: 0.9, ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    'P': { floorH: 1.0, ceilH: 3,     wallMat: 'stone',      floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    'v': { floorH: -0.6, ceilH: 3,    wallMat: 'rubble',     floorMat: 'rubble', ceilMat: 'ceiling_timber', solid: false },
  };

  // 20 cols x 18 rows. Row 0 is the north edge (y=0); column 0 is the west edge (x=0).
  var rows = [
    '####################',
    '#..................#',
    '#.S.....^^^^.......#',
    '#.......^^^^.......#',
    '#.......^^^^.......#',
    '#.......^^^^.......#',
    '#.......wwww.......#',
    '#.............O....#',
    '#..##D###..........#',
    '#............m.....#',
    '#............m.....#',
    '#..................#',
    '#..................#',
    '#..123........PP...#',
    '#.............PP...#',
    '#........v1........#',
    '#........vv........#',
    '####################',
  ];

  // US-006 AC: "test_room has one torch light" - on the raised platform (P,
  // rows 13-14 cols 14-15), 1.2 m up, so walking around it (0..6 m) shows
  // warm falloff against the cool ambient elsewhere.
  var lights = [
    { id: 'torch', preset: 'torch', x: 14.5, y: 13.5, z: 1.2, on: true },
  ];

  var level = {
    name: 'test_room',
    legend: legend,
    rows: rows,
    lights: lights,
  };

  ASSETS.levels.test_room = level;
  if (typeof module === 'object' && module && module.exports) module.exports = level;
})(typeof window !== 'undefined' ? window : globalThis);
