# TOWER-BOULDER-01 - remove the tower boulder

Date: 2026-10-06 | Branch: `pc-b` | Base: `1df96e3` (master `a1b6a86` merged) | Author: PC-B (DeepSeek trial)

Owner request (2026-10-05): *"what is that ball skiing around the floor? shouldn't it be rolling? also
remove it later"*. The roller physics moved the boulder as a sphere, but the voxel model never rotated, so
it slid. The prop is gone; if a rolling boulder is ever wanted again, rotate the voxel model by
distance/radius about the travel axis.

## What changed

| File | Change |
|---|---|
| `content/levels/tower.level.json` | Removed the `{"id": "boulder", "dynamic": true, ...}` prop (the only `dynamic` prop in the level). `layers.tilt` + `tilt` are kept (see Deviations). |
| `game/js/quest/boulder.test.js` | Deleted - it tested the real tower boulder puzzle (settle in the hollow, one-way trap, restart position). 176 lines. |
| `game/js/quest/restart.test.js` | Section 3 is now "the boulder is gone" (4 checks: no prop, no entity, no `dynamic` prop, no roller entity anywhere) instead of the push-the-boulder step. Section 9 gained `9-pre` (the fixture world really carries the removed pair) and `9d` (an older save does not restore the removed boulder). Dropped the now-unused `stepRollers`/`resolveBodyContacts`/`PHYSICS_DEFAULTS` imports. |
| `tools/testing/dynamic-tower.mjs` | The existing TOWER-LEVER-01 test-only fixture now also re-adds the boulder prop, so the generic dynamic-prop coverage stays live after the content removal. |
| `engine/physics/roller.test.js` | The ME-11b grid-vs-mesh roll-trace case now builds its world from the fixture (the slope it rolls on is still real tower data). |
| `game/js/dev/modes/gpucompare.js` | Removed the `world_m1: boulder mid-roll` pose (and the now-unused `animComponent` import). |
| `tools/route-walk.mjs` | Leg 2 renamed `2 stair base (east corridor)`; `findBoulder`/`boulderPos` -> `anyRoller`; `info.boulder`/`boulderSleeping` -> `info.stairBaseClear`; the reload probe's `boulderEqual` -> `rollerAbsent`; the 480-step settle wait dropped (nothing to settle). |
| `tools/route-walk-browser.mjs` | Same leg rename and `info.rollerAbsent`; `idle(480)` dropped. The ME-15d static-shadow probe that follows it is unchanged (`idle(30)` warms it up). |
| `game/js/main.js` | Comments only: the boulder removed from the audio-reset, clip-player, restart and `?voxelbench` prop lists; the voxel-prop counts in the `?voxelbench` comment are now 9 of 11 in the cluster / 10 of 11 on screen. |

## Checks

- **`node tools/run-tests.mjs`: 223/223 suites PASS, 0 FAIL, 0 TIMEOUT, 0 WARN.** HEAD had 221 tracked
  `*.test.js|mjs` files and 224 suites; this change deletes one test file, so 220 + 3 = 223 (the 3 are
  `check-deps.mjs`, `validate-content.mjs`, `typecheck.mjs`).
- `node tools/check-deps.mjs` OK, `tools/typecheck.mjs` PASS, `node tools/validate-content.mjs` -> `content OK (666 checks, 2 mesh-only model(s))`.
- Focused: `engine/physics/roller.test.js` 33/33, `engine/world/world.test.js` 96/96,
  `engine/world/scale.test.js` 25/25, `game/js/quest/restart.test.js` 35/35,
  `tools/content-smoke.test.mjs` 30/30, `tools/tower-prop-colliders.test.mjs` 1112 PASS / 1019 clearance
  samples / 187 capsule steps / 176 triangles.
- **Old saves:** `restart.test.js` section 9 loads a pre-removal save (built with the fixture) and the
  engine logs `deserialize: dropped 2 saved entities no longer in content: tower.lever, tower.boulder`.
  `9d` asserts the restored world has no `tower.boulder`.
- **Node route walk (`node tools/route-walk.mjs`):** all 9 legs complete in both physics modes, grid vs
  mesh max trace difference 0.000, `stairBaseClear: true`, `endTrigger: true`, reload
  `{ rollerAbsent: true, probeMismatches: 0 }`.
- **Mesh browser route walk** (`node tools/route-walk-browser.mjs --port 9601`, 400x150): wake + all 9 legs
  complete, `endTriggered: true`, `physicsMode: mesh`, `rollerAbsent: true`, colliders
  `tower, scatter:trunks, scatter:detail, props:static`, 485 trees / 17014 detail placements, ME-15d static
  shadow probe `{ frames: 120, renders: 36, skips: 84 }`, no console errors.
- **`?gpucompare=1`** (`node tools/capture-browser.mjs --mode gpucompare`, headless, RTX 4060 D3D11,
  ANGLE d3d11): **no new FAIL rows, no previously passing row regressed.** Compared row-by-row against a
  clean baseline captured at `1df96e3` in a temporary worktree with the same command:

  | | baseline `1df96e3` | with this change |
  |---|---|---|
  | rows | 140 | 138 |
  | FAIL rows | 7 | 7 (the same 7) |

  Rows removed: `world_m1: boulder mid-roll` and `world_m1: boulder mid-roll [shadow depth parity]`.
  Rows added: none. Regressions: none. Improvements: none. Shadow-depth items 55 -> 54 (the boulder was one
  shadow caster). The 7 FAILs are pre-existing on master under D-043 (sun shadow maps are the default):
  `crash room`, `lamp empty`, `voxel half occluded (stair edge)`, `rtsHill60`, `cloth`, `viewModel rest
  pitch 20 PITCHED`, `forestWalk`. Recorded as known-FAIL per D-039; not caused by this item.

## Owner-visible check (400x150, mesh, real GPU)

Visible: **yes** - the stair base, the step flight and the hollow behind it render as clean stone/moss
steps and floor with no leftover boulder sprite, no floating or half-buried geometry and no hole where the
prop was. Two poses were checked against the live game: the corridor approach local (15.6, 5.0) yaw 356
pitch -18 (where the route walks) and local (13.5, 4.5) yaw 64.5 pitch -20 (the framing of the removed
`boulder mid-roll` pose). The tower interior is dark under its torch light, as before this change - the
steps and the green turf read normally, and the empty hollow is the dark recess in the upper middle.
Screenshots are not committed (temporary files).

## Deviations and things deliberately left

1. **The model asset stays.** `design/models/boulder.js`, `content/vox/boulder.vox`(+`.map.json`) and both
   script tags (`game/index.html`, `tools/editor/index.html`) are untouched, plus `tools/vox-export*`,
   `tools/validate-content.mjs` and `tools/export-content.mjs` keep listing it. This follows TOWER-LEVER-01
   exactly (the lever model also stayed); deleting the model would rewrite ~40 test-registration imports and
   the editor/export lists, which is not this item.
2. **`layers.tilt` + `tilt` stay in `content/levels/tower.level.json`.** They are the boulder's authored
   roll slope (US-013) and `design/levels/tower_layout.md` documents them; the test-only fixture now rolls
   the engine's boulder on that real geometry, so the ME-11b trace parity keeps testing real slope data.
   In shipping play this data is now unused. If the janitor wants it gone, the fixture needs its own slope.
3. **`game/js/audio/sfx.js` keeps the boulder-thud watch** (lines ~109-146: `BOULDER_ID`,
   `resetBoulderAudio`, `stepBoulderAudio`). It is dead but harmless - with no roller entity it returns at
   the first guard. Removing it would also force a rewrite of the PO-named worst-case gain test
   (`sfx.gain.test.js` uses `designPeakSum('thud')` as "the PO's own named example"), so it is deferred to
   the janitor exactly like TOWER-LEVER-01's leftover grate/lever sfx code.
4. **Docs still name the pose:** `docs/architecture.md` lines ~423 and ~1288 list `boulder mid-roll` among
   the poses to keep (historical ME-08b/ME-14c3 spec text). Left for the janitor/PC-A.
5. The route leg keeps its corridor waypoints: they are the PC-A-approved eastern corridor from
   PROP-COLLIDE-01b and remain the regression it always also carried.
