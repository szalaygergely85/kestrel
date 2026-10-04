# design/cinematics - D-036 "Show it" camera paths (US-119a format)

One JSON file per shot, `<id>.json`, `id` == file name (`[\w-]+`). Loaded by `game/js/dev/modes/cinematic.js` `loadCinematic(id)` from `../design/cinematics/<id>.json` - no script tag, manifest or registration.

Format (validated by `validatePath`): `{version: 1, id, fps, keys: [{t, x, y, z, yawDeg, pitchDeg, ease}]}`. World frame (docs/coordinates.md 2): metres, x east, y south, **z = absolute eye height** (not above ground), compass yaw (0 north, 90 east), pitch +up, clamped +-60. `fps` divides 60 (all shots: 30). First key `t = 0`, times strictly increasing. Position = Catmull-Rom through the keys, yaw = shortest arc, pitch = linear, per segment. `ease: 'smooth'` smoothsteps a segment and stops the camera at its end key, so every shot uses `linear` and slows down by key spacing instead. `timeOfDay` is rejected until US-122; the intended hour is in each file's `note` (extra fields are ignored by the loader).

| id | shot | length | intended hour (US-122) |
|---|---|---|---|
| `tower` | 120 deg descending orbit E -> S -> SSW round the tower, 44 -> 31 m | 14 s | 18:00 |
| `fire` | push-in on the burner inside the tower, tilt up with the smoke | 12 s | 19:30 |
| `water` | low glide over quietPond to the tower's north wall | 10 s | 08:00 |
| `grassland` | crane-up lateral sweep west of the crown, pan 225 -> 293 | 13 s | 10:00 |
| `forest` | dolly from the forestEdge pose 76 m SW into the forest band - **provisional**, needs ME-06c3 realTrees; eye z after key 0 is an estimate | 14 s | 16:00 |

Check (headless, no browser): `node tools/cine-check.mjs [id]` prints eye clearance over floor/water and trunk hits per path, plus forest anchors (densest 30 m tree discs) for retargeting `forest.json`.

## Stubs (content not placed yet - no file, so `?cinematic=` cannot load a half path)

- **waterfall** (US-142a2 test cliff): intended a 12 s low push towards the plunge pool, then a tilt up the sheet to the lip (pitch -5 -> +40), ending beside the fall to see behind it. Location: wherever US-142a2 puts the test cliff; if it goes into world_m1, the south skirt of the crown (around 1470-1480, 1060-1075, where the land falls off) keeps it in the near band and in sight of the tower. Author once the lip/foot coordinates are in the world file.
- **ruins** (ME-14c3/c4): intended a 12 s walk-height (eye ground + 1.7) weave between the Ruins pieces west of the breach (first placements around 1470, 1042), starting from the breach side looking west and ending looking back up at the tower (yaw ~75, pitch +15). Author once ME-14c4's 8-12 placements are on master.
