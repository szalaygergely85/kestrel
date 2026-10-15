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

## Teasers (owner 2026-10-15, TikTok, portrait)

Mood-only 9:16 clips: close or abstract (grass, water, fire, sky, leaves, sea). Never in frame: the tower or any building/landmark, characters/animals (fauna is off in cinematic mode anyway), HUD/text, anything that shows gameplay or the map layout. All at fps 30 with `linear` keys. The slow starts and stops come from the key spacing (the outer segments are shorter).

**Framing assumption.** The pitches assume the `--portrait` capture described under "Capture options" below. The engine renders a 16:9 viewport (HFOV 75, so the VFOV is about 47 deg), and ffmpeg centre-crops it to 9:16. That leaves about 27 deg of horizontal field. The subject sits in the vertical centre, and only the middle third of the render matters horizontally. If the capture geometry changes, retune the pitches to the intent in each file's `note`.

| id | shot | length | hour | flags (existing page params) | capture command |
|---|---|---|---|---|---|
| `teaser-grass` | eye ~0.45 m in the north meadow carpet (crown, N of the tower, facing N), 8 m lateral drift W->E, pitch -17..-19 (horizon ~10-15 % below the top = sky sliver) | 14 s | 17:00 | `carpet=1` (**required**: capture has no quality preset, so the carpet is off otherwise) | `node tools/capture-cinematic.mjs --cinematic teaser-grass --port 9510 --portrait --clean --hour 17` (+ carpet=1, see below) |
| `teaser-water` | 0.65 -> 0.5 m over open Glasswater, 20 m glide WNW, tilt -20 -> -22 (water fills the frame, far shore a thin band at the top) | 14 s | 17:00 | - (optional `cloudshadow=1`, WebGPU only) | `node tools/capture-cinematic.mjs --cinematic teaser-water --port 9512 --portrait --clean --hour 17` |
| `teaser-fire` | push-in on the tower burner 2.4 -> 0.84 m, tilt -6 -> +18 up the smoke; night keeps the room dark | 12 s | 22:00 | - | `node tools/capture-cinematic.mjs --cinematic teaser-fire --port 9514 --portrait --clean --hour 22` |
| `teaser-sky` | over the open sea, pitch up 44 -> 50 (frame ~20..74 deg elevation, no ground), slow pan 230 -> 262 into the dusk glow | 14 s | 19:00 | - | `node tools/capture-cinematic.mjs --cinematic teaser-sky --port 9516 --portrait --clean --hour 19` |
| `teaser-leaves` | eye ~0.85 m, 6.4 m push NW into groveNorthWest's ferns/saplings, tilt -38 -> -18 into the trunks | 13 s | 15:30 | - (sun shafts: no page flag yet, see below) | `node tools/capture-cinematic.mjs --cinematic teaser-leaves --port 9518 --portrait --clean --hour 15.5` |
| `teaser-dawn-sea` | open sea only, 1.3 m over the water, horizon just below the centre, very slow pan 100 -> 124 toward the sunrise | 15 s | 06:15 | - | `node tools/capture-cinematic.mjs --cinematic teaser-dawn-sea --port 9520 --portrait --clean --hour 6.25` |

- **Same-day programmer work.** `--portrait` (= `--size 1080x1920`), `--hour H` (sends `?cinehour=H`) and `--clean` are **being added by the programmer (same day)**. They are already in `tools/capture-cinematic.mjs`'s argument parser.
- **Still missing.** There is no passthrough for extra page flags yet, so `teaser-grass` cannot get `carpet=1` from the tool. It needs a small `--query`-style option, or `carpet=1` added to the tool's URL for teasers.
- **Port.** Pick a free port in your PC's range.

**Existing look/weather page params** (from main.js and gfxBoot.js; nothing invented):
- `cinehour=H`: the full live look at hour H. This is what `--hour` sets.
- `time=H`: static sun only.
- `look=morning|noon|dusk|night|afternoon|evening`: the timeOfDay record, load time only.
- `cloudshadow=1`: cloud shadows on the ground, WebGPU only.
- `ao=0..1`
- `carpet=0|1`
- `shadows=map|off`
- `quality=<preset>`: turns the carpet on through the preset.
- `ambient=0`: dust motes. They are already off under `capture=1`.
- `fauna=0`: already off in cinematic mode.

These params have no effect in a cinematic:
- `daylen=<min>`: the clock is frozen in cinematic mode (main.js `clockFrozen`).
- `atmos=0`: the atmos driver only exists with a running clock.

Sky clouds drift on their own (palette `clouds.wind`, driven by sim time). The carpet's wind gusts come from the world wind, not from the path.

**Notes for the PO (engine/tool features these shots would like, not built):**
- **Sun shafts for `teaser-leaves`.** CANOPY-SHAFT-01b `lights.shaft` is only wired in gpucompare rows. There is no page flag for it.
- **Colour shift inside a clip.** A per-key `hour` (US-122a) drives only the sun (applySunHours) and not the sky/fog/ambient look. That is why the dawn/dusk shots use one static `--hour`.
- **Pitch limit for `teaser-sky`.** The owner asked for 50-75 deg. The path format clamps pitch to +-60, and clouds fade out above 55 deg elevation (`materials.sky.cloudBand` [2, 35, 55]), so the shot ends at 50. At 44..50 the clouds fill the lower half of the frame.

**Headless check: NOT RUN for the six teasers.** The designer agent had no shell. Floors were estimated from the recipe (crown flatten r 20 + 60 m skirt, water z, seabed). Run `node tools/cine-check.mjs teaser-<id>` before capturing. Expected: OK for all six, with `teaser-grass` the tightest (clearance ~0.45-0.50, warning threshold 0.40). `teaser-leaves` is the one most likely to need a fix, because its trunk hits are unknown. If a trunk is reported, shorten the push along yaw 309.

Check (headless, no browser): `node tools/cine-check.mjs [id]` prints eye clearance over floor/water and trunk hits per path, plus forest anchors (densest 30 m tree discs) for retargeting `forest.json`.

## Stubs (content not placed yet - no file, so `?cinematic=` cannot load a half path)

- **waterfall** (US-142a2 test cliff): intended a 12 s low push towards the plunge pool, then a tilt up the sheet to the lip (pitch -5 -> +40), ending beside the fall to see behind it. Location: wherever US-142a2 puts the test cliff; if it goes into world_m1, the south skirt of the crown (around 1470-1480, 1060-1075, where the land falls off) keeps it in the near band and in sight of the tower. Author once the lip/foot coordinates are in the world file.
- **ruins** (ME-14c3/c4): intended a 12 s walk-height (eye ground + 1.7) weave between the Ruins pieces west of the breach (first placements around 1470, 1042), starting from the breach side looking west and ending looking back up at the tower (yaw ~75, pitch +15). Author once ME-14c4's 8-12 placements are on master.

## Capture options (teaser recording, `tools/capture-cinematic.mjs`)

`--size WxH` (output video, default 1280x720), `--portrait` (= 1080x1920 + `--grid 480x180`), `--hour H` (clock frozen at H with the full live look: sun/moon, sky, fog colour, clouds, ambient; sends `?cinehour=H`), `--clean` (also hides the player body; HUD/compass/markers/prompts/hands are already off in cinematic mode), `--no-encode`. The engine grid is fixed 8:3, so portrait renders a 16:9 viewport and ffmpeg centre-crops it to 9:16 (about 32% of the width survives: frame subjects in the middle third). Without ffmpeg the PNGs stay and the exact ffmpeg commands are printed. Biome haze (atmos driver) is not applied by `--hour`.

Note (PC-A 2026-10-15): `tools/cine-check.mjs` reads the old `overworld_far` terrain, not the whole-map `world_geo` grid, so its clearance for `teaser-sky` / `teaser-dawn-sea` (over the south sea, rect y 1420-2112, surface z -96) is not valid; eye z -94.5 = 1.5 m above the sea surface. Check those two visually at the first capture. The other four teaser paths passed cine-check (grass 0.44 m, leaves 0.76 m, fire 1.15 m, water over the lake).
