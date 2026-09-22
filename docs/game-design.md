# ASCII Quest – Game Design Document

Owner: Product Owner. Last updated: 2026-09-22.
Related: `docs/decisions.md` (D-001 location, D-002 renderer), `docs/roadmap.md`, `docs/backlog.md`.

---

## 1. Vision

A first-person, Zelda-inspired open-world action RPG drawn entirely with colored ASCII characters. The world should look like a hand-inked, glowing tapestry of glyphs. Light is the star: warm torch glow washing across `#%&` stone, cool sun shafts full of drifting `.` dust, far hills fading into blue fog.

**One-line pitch:** *The beacons that kept the Dim at bay have gone dark. You are the keeper who forgot. Wake up, climb, and relight the world.*

## 2. Pillars

1. **Light is life.** Every scene is built around light sources. Light has gameplay value: it lets you see, and later it drives puzzles and deters enemies. The core loop of the game is relighting beacons.
2. **Taught by geometry, not text.** Players learn by looking at the space: a sun shaft pulls the eye up, a gap tells you to jump, a glinting lever begs to be pulled. Text hints are short, show once, then disappear.
3. **Tactile physics.** Things have weight. The player lands with a small camera dip, boulders roll and settle, rubble clatters. Movement is responsive (no floaty or slippery feel).
4. **Readable ASCII beauty.** Detailed and colorful, but always readable. Silhouette and brightness come first, color second, texture third.
5. **Earned vistas.** The open world is a reward. You climb to see it.

## 3. Setting and story canon

- **World:** the Emberlands, a hilly realm once ringed by a chain of stone beacon towers. While the beacons burned, the Dim (a slow, cold darkness that swallows color) stayed away.
- **The Hollow Watchtower** ("The Sunken Beacon"): the westernmost beacon, a roofless ruined round tower on a hilltop at the edge of the world. Its beacon bowl is cold.
- **The hero:** the Keeper, the tower's forgotten guardian. Nameless on screen in M1 (internal name "Wick"). The hero wakes with no memory. The player never sees the hero's face; they are the hero.
- **The hook (M1):** from the summit breach the player sees the Emberlands below, and a second beacon tower far away that is also dark. Nothing is explained. The question "why are the lights out?" carries the player into M2.
- **Tone:** quiet, lonely, hopeful. No dialogue in M1. Story comes from environment (scrawl, cold ashes, the dead beacon).

## 4. Core controls (keyboard + mouse, M1)

| Input | Action |
|---|---|
| W A S D | Move (forward/strafe/back) |
| Mouse (pointer lock) | Look (yaw; pitch via y-shear, clamped to about ±35 degrees) |
| Arrow keys | Look fallback (yaw 120 deg/s, pitch 60 deg/s) |
| Shift (hold) | Run |
| Space | Jump |
| E | Interact (pick up, pull, push prompt) |
| Esc | Release mouse / pause overlay |
| F3 | Debug overlay (fps, frame ms, position, sector id) |
| R | Restart (only on end screen) |

Click on the canvas captures the mouse. Mouse sensitivity default 0.15 deg per pixel.

## 5. Units, feel numbers (M1 tuning baseline)

1 map grid cell = 1 meter. Fixed simulation step 60 Hz; render decoupled.

| Parameter | Value |
|---|---|
| Player capsule radius | 0.30 m |
| Player height / eye height | 1.70 m / 1.60 m |
| Walk speed | 3.5 m/s |
| Run speed | 6.0 m/s |
| Ground acceleration / deceleration | reach full speed in 0.10 s, stop in 0.08 s |
| Air control | 35% of ground acceleration |
| Gravity | 20 m/s^2 |
| Jump initial velocity | 6.5 m/s (apex about 1.05 m) |
| Coyote time / jump buffer | 100 ms / 100 ms |
| Step-up threshold | 0.45 m (steps higher than that block) |
| Landing camera dip | 0.08 m for falls > 0.5 m, 0.15 m for falls > 2 m, recover in 0.2 s |
| Head bob | 0.03 m amplitude, 2 cycles per meter-ish (subtle, can be toggled off later) |
| Fall damage | none in M1 |

## 6. Visual and render model (summary of D-002)

- Single `<canvas>`, logical grid 160x60 cells of (glyph, fg color, bg color). Grid scales to fit the window, keeping the cell aspect.
- Sector raycaster: per-sector floor and ceiling heights; ceilings can be "sky". Y-shear for pitch. Props are billboards.
- Brightness to glyph density ramp (base ramp ` .:-=+*#%@`, designer may refine per material). Hue comes from material color multiplied by light color.
- Lighting = ambient + sun (directional, shadow test against the roof hole) + point lights (torch, lantern) with distance falloff and flicker.
- Distance fog toward a cool blue-grey; far overworld is a separate cheap heightmap pass.

## 7. Opening: The Awakening (Milestone 1)

Target length: 3 to 5 minutes for a first-time player. A stranger must finish it without instructions.

### 7.1 Space: the Hollow Watchtower

Round tower approximated on the grid. Outer footprint about 12x12 cells, wall 1 cell thick, interior about 10 m across. Walls broken off at irregular heights between 6.5 m and 8.5 m; no roof. Heights are floor heights.

**Level 0 – Ground floor (floor 0.0 m)**
- **Wake spot:** a straw pallet against the south wall. Player starts lying down, looking up.
- **Fire-pit torch:** iron brazier on a stone ring, about 3 m from the wake spot, burning (the torch point light). Cold ashes and a scorched floor around it.
- **Lantern:** unlit brass lantern hanging on a wall hook next to the brazier, at chest height (1.3 m). Glints faintly in torchlight so it reads as "take me".
- **Sun shaft:** morning sun (elevation about 60 degrees) enters through the open top and a large crack in the east wall, painting a bright ellipse of floor near the tower centre. Dust motes (nice-to-have) drift in it.
- **Rubble:** fallen blocks scattered around the edge (static collision, 0.3 to 0.9 m tall). One low hollow (floor -0.3 m) near the north-west.
- **Boulder:** a round stone (radius 0.6 m) sits on the first steps of the stair, blocking it. Floor slopes gently toward the hollow so, once pushed, it rolls down and settles in the hollow with a thud.
- **Wall scrawl** (nice-to-have): scratched text near the pallet: `KEEP THE LIGHT`.

**Level 1 – Spiral stair and mid ledge (0.0 m to 3.0 m)**
- Stone steps hug the inner wall, 1 cell wide, each step 0.30 m rise, climbing clockwise.
- **The gap:** at about 2.7 m high, 1.0 m (one cell) of stairs has collapsed. The landing on the far side is the mid ledge at 3.0 m. A walking jump clears it; the gap is forgiving on purpose. It still requires Space: step-up never works mid-air, and walking off drops 2.1 m onto debris. Falling means landing on rubble at ground level, no damage, walk back up.
- The stair above the sun line is in shade: the lantern makes the gap edges clearly readable; without it they are dim but still visible (soft gate, never a hard lock).
- **Mid ledge:** a 2x2 m stone platform in a wall niche with an iron **lever** (up position). Next to it, the upper stair is blocked by an iron **grate** (portcullis). Chains visibly run from lever to grate.
- **Lever:** E pulls it down (0.4 s), the grate rises (1.5 s) with a rattle, opening the upper stair. One-way; cannot be reset.

**Level 2 – Upper stair and summit (3.0 m to 6.0 m)**
- Upper stair continues 10 steps to the summit walkway, 6.0 m.
- **Summit:** a beacon bastion built onto the tower's west side on a rock spur, reached through a doorway in the broken west wall. It overlooks the tower interior across the low (6.5 m) wall top, so the interior stays roofless for the sun shaft. It has a ring walkway around the bowl and a waist-high parapet. Centre: the cold **beacon bowl** (a large iron basin, 2 m across) full of grey ash. Optional (D-003, US-022): with the lantern, `[E] Light the beacon` starts a large fire; the lantern is kept, the far tower stays dark, and the end text changes to `One beacon burns. The others are dark.`
- **The breach:** a 2 m wide hole in the west parapet, opening onto a stone outcrop and a path going down the hill. Through it the **overworld** is visible: rolling hills, a winding river of blue `~`, forests of green `&%`, blue fog; far away (about 800 m) a second tower on a hill, dark.
- Stepping onto the outcrop past the breach triggers the end.

### 7.2 Beat sheet

| # | Beat | Player does | Game teaches / shows | Target time |
|---|---|---|---|---|
| 1 | Wake | Nothing (0 to 3 s), then any input | Black, eye-blink reveal, camera lying looking up at the sun shaft, rises to eye height; title card | 0:00 to 0:08 |
| 2 | First steps | WASD toward the warm light | "WASD move / Mouse look" hint | to 0:30 |
| 3 | Torch | Arrives at the brazier | Warm flicker on walls, the glinting lantern | to 0:45 |
| 4 | Look up | Looks at the sun shaft | Y-shear pitch, open sky, broken walls, stair winding up | any time |
| 5 | Lantern | E to take it | Interact prompt; lantern light now travels with the player | to 1:00 |
| 6 | Boulder | Walks into the boulder at the stair base | Physics: it rolls down the slope and settles in the hollow | to 1:30 |
| 7 | Climb | Walks up steps | Step-up; the world falls away below | to 2:00 |
| 8 | Gap | Space to jump | "Space jump" hint appears near the gap edge | to 2:30 |
| 9 | Lever | E on lever | Grate rises; cause and effect | to 3:00 |
| 10 | Summit | Walks up, sees cold beacon, looks out the breach | Far overworld view, the second dark tower | to 3:45 |
| 11 | Step out | Walks through the breach | End fade: "The beacons are dark. The world waits." / "To be continued" / R to restart | to 4:00 |

### 7.3 Lighting script (M1 values, designer may tune in palette)

| Light | Color | Intensity | Radius / falloff | Notes |
|---|---|---|---|---|
| Ambient | cool blue `#2a3550` | 0.12 | everywhere | never fully black; glyph `.` at minimum on lit-less walls within 8 m |
| Sun | warm white `#fff2d0` | 1.0 | directional, elev 60 deg, from ESE | shadow test vs roof opening and east crack; sky ceilings are lit |
| Brazier torch | orange `#ff9a3c` | 1.0 | 6 m, smooth quadratic falloff | flicker: noise at 8 to 12 Hz, ±15% intensity, ±0.05 m position jitter |
| Lantern (carried) | amber `#ffd27a` | 0.8 | 5 m | held at right hand (0.3 m right, 0.3 m below eye, 0.4 m forward), gentle sway with walking, ±5% flicker |

### 7.4 UI in M1

- Crosshair: a single dim `+` at screen centre; brightens when an interactable is targeted.
- Interact prompt: `[E] Take lantern`, `[E] Pull lever` under the crosshair, only when within 1.8 m and aimed within about 20 degrees.
- Control hints: small, bottom-left, fade in 0.3 s, disappear once the action is performed or after 8 s. Each hint shows at most once per run.
- Title card: `ASCII QUEST` (large, built from glyphs) and `The Awakening` beneath, centred, fades in 1 s, holds 3 s, fades out 1 s.
- End screen: fade to black 2 s, two lines of text, `[R] Wake again`.
- No health, no inventory, no minimap in M1.

### 7.5 Audio (nice-to-have in M1)

Brazier crackle (positional, loudness by distance), footsteps on stone (per step, slight pitch variation), boulder roll rumble and thud, lever clunk, grate rattle, wind at the summit rising as the player nears the breach. WebAudio, no external libraries.

## 8. Later milestones (outline only)

- **M2 First Steps:** hill outside the tower, heightmap terrain, day/night, sword and lock-on, first melee enemy, a chest, save point at the tower.
- **M3 The Dark Beacons:** open region, three beacons to relight, village and NPCs, second enemy, ranged tool, chunk streaming.
- **M4 The Depths:** first dungeon, light puzzles (mirrors, shadows), keys, boss, item reward.
- **M5 Polish and Release.**

Hearts/health UI, items, and combat are designed in detail when M2 is planned.
