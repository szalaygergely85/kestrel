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

// RE-02a / PC-B Q6 item 11: same focus-driven eye math as gpucompare.js's
// `rtsHillPose(-58)` (engine/dev.js `pitchedEyeFromFocus`), but the eye
// distance depends on the live aspect ratio (`rt.cols/rows`, `pxCellW/H`),
// which differs per `--variant world` grid size (400x150 vs 240x90) - so,
// unlike every other GATE_POSES entry, `cam` here is a function of
// `(rt, world)`, not a static object. `main.js`'s one `gatePose.cam` call
// site resolves either shape.
import { pitchedEyeFromFocus, PROJ_PITCHED_VFOV_DEG } from '../engine/dev.js';
const RTS_HILL_FX = 1440, RTS_HILL_FY = 1040, RTS_HILL_YAW = 20, RTS_HILL_PITCH = -58, RTS_HILL_WIDTH_M = 30;

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
  // ME-15c: signal tower seen from the NNW looking SE (towards the sun), its sun shadow (az 135) lies on the grass between, for the sun shadow map captures (`?pose=towerShadow&shadows=map`, sun az 135 el 30 set by the capture script)
  { slug: 'towerShadow', name: 'signal tower + its NW shadow, seen from the NNW (ME-15c)', cam: { x: 1474, y: 1006, z: 9.0, yawDeg: 137, pitchDeg: -17, groundEye: true } },
  // NPC-BEAR-01: Burl the bear at (1471, 1029.1), seen from 3.2 m east on the path (he faces east, towards the breach).
  { slug: 'burl', name: 'Burl the bear on the walk-out path (NPC-BEAR-01)', cam: { x: 1474.2, y: 1029.4, z: 1.7, yawDeg: 270, pitchDeg: 4, groundEye: true } },
  { slug: 'roadSouth', name: 'walk-out road, looking west-south-west at the cleaned south verge + placed meshes (ME-14c3)', cam: { x: 1466, y: 1035, z: 1.7, yawDeg: 240, pitchDeg: 6, groundEye: true } },
  { slug: 'roadBend', name: 'road bend, looking west at the relay waystone (WS1-08 gate pose)', cam: { x: 1268, y: 1040, z: 1.7, yawDeg: 270, pitchDeg: 0, groundEye: true } },
  // WS1-08 / CH1-10 C perf-gate poses (tools/perf-pose.mjs default --poses): interior = the brazier view inside the tower (same cam as 'brazier'); exterior = from the walk-out meadow 29 m west of the tower, looking east (+x) with the towerCrown prop (world_m1 entity at 1497,1025, z 12-14) in view (pitch +14).
  { slug: 'towerInterior', name: 'tower interior, brazier view (WS1-08 perf pose)', cam: { x: 1496.0, y: 1024.5, z: EYE_H, yawDeg: 90, pitchDeg: -5 } },
  { slug: 'towerExterior', name: 'tower from the meadow, crown in view (WS1-08 perf pose)', cam: { x: 1468, y: 1025.5, z: 1.7, yawDeg: 90, pitchDeg: 14, groundEye: true } },
  { slug: 'roadLeft', name: 'walk-out road, looking south-west across the left (south) verge scatter roadL### (tools/gen-roadside-meshes.mjs)', cam: { x: 1440, y: 1030, z: 1.7, yawDeg: 215, pitchDeg: 4, groundEye: true } },
  { slug: 'hillside', name: 'hillside outside (owner pose A)', cam: { x: 1464.33, y: 1045.50, z: 3.92, yawDeg: 54, pitchDeg: 19 } },
  // waystoneLookBack: eye 2 m back along -forward from (1428, 1040) so it is not inside the model
  { slug: 'waystone', name: 'waystone', cam: { x: 1428 - 2 * Math.sin(yawR(76)), y: 1040 + 2 * Math.cos(yawR(76)), z: EYE_H, yawDeg: 76, pitchDeg: 5, groundEye: true } },
  // RE-02a / PC-B Q6 item 11: RTS hillside bench pose, same framing as
  // gpucompare's `rtsHill58` (mesh renderer only - pitch -58 needs
  // `?renderer=mesh`, resolveProjection's default pitched-on-mesh rule).
  { slug: 'rtsHill58', name: 'RTS hillside, pitched -58 (RE-02a bench pose)',
    cam: (rt, world) => {
      const fz = world.terrain ? world.terrain.groundAt(RTS_HILL_FX, RTS_HILL_FY) : 0;
      const aspect = (rt.cols * (rt.pxCellW || 1)) / (rt.rows * (rt.pxCellH || 1));
      const tanHalfX = Math.tan((PROJ_PITCHED_VFOV_DEG * Math.PI) / 360) * aspect;
      const e = pitchedEyeFromFocus(RTS_HILL_FX, RTS_HILL_FY, fz, RTS_HILL_YAW, RTS_HILL_PITCH, RTS_HILL_WIDTH_M / (2 * tanHalfX), [0, 0, 0]);
      return { x: e[0], y: e[1], z: e[2], yawDeg: RTS_HILL_YAW, pitchDeg: RTS_HILL_PITCH };
    } },
];
