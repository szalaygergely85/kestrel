// game/js/world/levels/test_room.js
//
// US-003 reference test level: 16x16, flat floor at 0m, a 3-step staircase
// (0.3 m risers), a raised 1.0 m platform, a solid pillar, and a sky-ceiling
// region. Exercises every Sector field the format defines. See
// game/js/world/MAP_FORMAT.md for the authoring format itself.
//
// Legend key -> meaning:
//   #  outer wall (solid)
//   .  flat floor, 0.0 m, normal stone ceiling at 3.0 m
//   ^  sky-ceiling region (roofless), floor stays 0.0 m
//   O  solid pillar
//   S  player wake/start marker (flat floor, facing east)
//   1  staircase step 1, floor 0.3 m
//   2  staircase step 2, floor 0.6 m
//   3  staircase step 3, floor 0.9 m
//   P  raised platform, floor 1.0 m

const legend = {
  '#': { floorH: 0,   ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: true },
  '.': { floorH: 0,   ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  '^': { floorH: 0,   ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
  'O': { floorH: 0,   ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: true },
  'S': { floorH: 0,   ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false, start: true, facingDeg: 0 },
  '1': { floorH: 0.3, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  '2': { floorH: 0.6, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  '3': { floorH: 0.9, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  'P': { floorH: 1.0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
};

// 16 rows x 16 cols. Row 0 is the north edge (y=0); column 0 is the west edge (x=0).
const rows = [
  '################',
  '#..............#',
  '#..............#',
  '#....^^^^......#',
  '#....^^^^......#',
  '#....^^^^......#',
  '#....^^^^......#',
  '#.......O......#',
  '#S.............#',
  '#..............#',
  '#...........PP.#',
  '#...........PP.#',
  '#..123.........#',
  '#..............#',
  '#..............#',
  '################',
];

export default {
  name: 'test_room',
  legend,
  rows,
};
