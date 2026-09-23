// US-029 tech notes item 7: the fixed camera pose set used by both
// `bench-cast.mjs` (headless Node correctness/perf) and `?gpucompare=1`
// (browser parity page, `game/js/main.js`) - one source of truth so a pose
// change never lets the two drift apart. Moved out of bench-cast.mjs
// verbatim (US-029); behaviour of bench-cast.mjs is unchanged.
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
