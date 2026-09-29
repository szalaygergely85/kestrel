// US-048 (docs/backlog.md, PC-B QUEUE 4 item 2): the fixed camera pose set
// shared by `tools/bench-poses.js` (headless Node correctness/perf,
// `tools/bench-cast.mjs`) and `game/js/dev/modes/*.js` (browser dev-mode
// pages: `?gpucompare=1|shade|mesh`, `?pose=<slug>`). Lives under
// `content/` on purpose - `tools/check-deps.mjs` only scans engine/, game/,
// tools/, design/, so a plain data module here can be imported by both
// sides without crossing either the `game -> tools` or `tools -> game`
// boundary (there is no check-deps rule for either direction today, but
// crossing one on purpose would still be the wrong shape - see the story's
// Programmer notes). Content moved here VERBATIM from the old
// tools/bench-poses.js (US-029/ME-08c) - tools/bench-poses.js now just
// re-exports this module so every existing importer (tools/bench-cast.mjs,
// game/js/dev/spritesPage.js) keeps working unchanged.
//
// Poses are in test_room LOCAL meters (test_room is 20x18; 'S' start is at
// col 2, row 2 -> x=2.5, y=2.5, facing east/yawDeg 90). eyeH 1.60 m matches
// physics/config.js `eyeHeight`.
export const EYE_H = 1.60;

export const POSES = [
  { name: 'start pose (S, facing east, level)', x: 2.5, y: 2.5, z: EYE_H, yawDeg: 90, pitchDeg: 0,
    probes: [
      { desc: 'columns 120/132 rows 22-25: far ceiling, not sky', cols: [120, 132], rows: [22, 25], kind: 'finite', min: 9.5, max: 16.5 },
    ] },
  { name: 'facing stair + 1.0m platform', x: 2.5, y: 13.5, z: EYE_H, yawDeg: 90, pitchDeg: 0 },
  { name: 'sky over the low wall, pitch +20', x: 9.5, y: 7.5, z: EYE_H, yawDeg: 0, pitchDeg: 20 },
  // minDistinct 9: US-028a (block-keyed hashes) cuts alternates on purpose; architect ruling 2026-09-23.
  { name: 'long diagonal, pitch -35', x: 1.5, y: 1.5, z: EYE_H, yawDeg: 45, pitchDeg: -35, minDistinct: 9 },
  { name: 'low wall sky, (10, 7.5) yaw 45 pitch +25', x: 10, y: 7.5, z: EYE_H, yawDeg: 45, pitchDeg: 25,
    probes: [
      { desc: 'column 116 rows 0-3: sky over the w cell, not the far ceiling', cols: [116], rows: [0, 3], kind: 'infinite' },
    ] },
];

// ME-08c (27.16 item 10): the 6 phase-1 gate poses, WORLD metres (world_m1),
// same cams as the `?gpucompare=1` rows they reuse. `cam.z` = EYE height;
// `groundEye: true` = z is "terrain groundAt(x, y) + 1.6" (main.js resolves
// it, the terrain lives in the world). Used by `?pose=<slug>` (main.js) and
// `game/sidebyside.html`.
const yawR = (d) => d * Math.PI / 180;
export const GATE_POSES = [
  { slug: 'crash', name: 'crash room', cam: { x: 1497.5, y: 1026.5, z: EYE_H, yawDeg: 30, pitchDeg: 5 } },
  { slug: 'stairs', name: 'stairs (stair edge, lever half occluded)', cam: { x: 1497.3, y: 1026.6, z: EYE_H, yawDeg: 90, pitchDeg: 40 } },
  // tower.level.json light 'brazier' local (18.5, 6.5) -> world (1498.5, 1024.5); eye 2.5 m west, facing east (+x)
  { slug: 'brazier', name: 'brazier (2.5 m in front)', cam: { x: 1496.0, y: 1024.5, z: EYE_H, yawDeg: 90, pitchDeg: -5 } },
  { slug: 'breach', name: 'breach (looking out)', cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: 0 } },
  { slug: 'hillside', name: 'hillside outside (owner pose A)', cam: { x: 1464.33, y: 1045.50, z: 3.92, yawDeg: 54, pitchDeg: 19 } },
  // waystoneLookBack: eye 2 m back along -forward from (1428, 1040) so it is not inside the model
  { slug: 'waystone', name: 'waystone', cam: { x: 1428 - 2 * Math.sin(yawR(76)), y: 1040 + 2 * Math.cos(yawR(76)), z: EYE_H, yawDeg: 76, pitchDeg: 5, groundEye: true } },
];
