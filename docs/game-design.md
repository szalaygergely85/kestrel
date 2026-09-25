# Kestrel – Game Design Document

Owner: Product Owner. Last updated: 2026-09-23 (D-011 incl. owner amendments 1 and 2; D-009 amendment 2; D-012; D-013).
Related: `docs/decisions.md` (D-001 location, D-002 renderer, D-009 GPU + grid, D-011 story canon, D-012 Steam/M6, D-013 writer proposals), `docs/story.md` (writer's text, follows section 3 here), `docs/roadmap.md`, `docs/backlog.md`.

**Title:** *Kestrel* (the stolen airship; it replaces the working titles "ASCII Quest" and "ASCII Quest: Signal"). The engine name is still open.

---

## 1. Vision

A first-person, Zelda-inspired open-world action RPG drawn entirely with colored ASCII characters. The world should look like a hand-inked, glowing tapestry of glyphs. Light is the star: warm lamp glow washing across `#%&` stone, cool sun shafts full of drifting `.` dust, the teal gleam of aether, far hills fading into blue fog.

**One-line pitch (D-011 amendment 2):** *You grew up behind the Wall of a city of machines, taught that nobody survives outside. Then someone out there called for help. You stole the airship Kestrel to answer, and you were shot down. Now you are outside, where the land is alive and magic is real.*

Fantasy first (swords, magic, ruins, nature). Steampunk appears only as rare brass machines, and almost all of them come from Ferrum. The hero's journey is from disbelief to wonder: every upgrade is something he was told could not exist.

## 2. Pillars

1. **Light is life.** Every scene is built around light sources. Light has gameplay value: it lets you see, and later it drives puzzles and deters enemies. The core loop of the game is **waking the dead relays** along the chart's route. Every spell is a light verb.
2. **Taught by geometry, not text.** Players learn by looking at the space: a sun shaft pulls the eye up, a gap tells you to jump, a glinting lever begs to be pulled. Text hints are short, show once, then disappear.
3. **Tactile physics.** Things have weight. The player lands with a small camera dip, boulders roll and settle, rubble clatters. Movement is responsive (no floaty or slippery feel).
4. **Readable ASCII beauty.** Detailed and colorful, but always readable. Silhouette and brightness come first, color second, texture third.
5. **Earned vistas.** The open world is a reward. You climb to see it.
6. **Magic is a discovery.** Ferrum knows only machines, and magic is a children's tale there. Outside, magic is real, and the player finds it step by step: a relay that wakes to the lamp, talking animals, then the first spell. Upgrades (spells, gauntlet crystals) are found in ruins or earned, never bought, and each one should feel like wonder, not like a stat bump.

## 3. Setting and story canon

Canon per D-011 with owner amendment 2 (fantasy with steampunk machine accents; **no amnesia**). It replaces the "Dim / beacon keeper" canon, the "Ember and Ash" canon and the partial-amnesia / borrowed-name versions of D-011. The writer's prose is `docs/story.md`; if the two disagree, this section wins.

- **World:** the Emberlands. Hills, forests, moss-grown ruins and old magic. It is alive and wild, not dead.
- **Ferrum:** a walled, tiered city of stone, timber and **machines only** (brass, steam, gears). The **Crown** (upper tiers) keeps the airships, gear-gates and lamps. The **Low Wards** (lower tiers) haul coal, grease cogs and mend rope, and are forbidden the machines they maintain. **Magic is a myth in Ferrum**, a tale for children, and talking about it too loudly gets you fined. The **Wall Law** says nobody leaves, because no human survives beyond the Wall: out there is only the wild, the "Hush". Ferrum stays off-screen until after M6 (horizon lights and remembered text only).
- **The signal:** a repeating SOS, a light blinking far beyond the Wall, echoed by a hum in the old relay stones under the Low Wards. The Crown denies it. **Pattern (D-013): 3 short, 3 long, 3 short**; short = 0.25 s on, long = 0.75 s on, 0.25 s gap inside a letter, 0.75 s between letters, 2.5 s pause before repeating. The same pattern is used in the log text, the signal-tower emissive (P2 pulse) and any later sound. **The SOS has been sending for years**, since before Wick's escape. The reason is deferred to M4 (the manager picks from the writer's candidates), and no M1-M3 text may contradict it.
- **The hero: Wick** (D-013), a young Low Ward skyworks hand from Ferrum who trims the skyworks lamps and patches Crown balloons. It is his real name. He **remembers everything**, but everything outside the Wall is new to him. He is curious, braver than is sensible, and at first does not believe in magic. First-person, never seen. **Where the name shows:** in M1 only as the **"W."** signature on his pencil notes (map card); his full name is first **spoken by the exiles in M3** and appears in save-slot labels. It is **not** on the title card, the relay-keeper's log does not know him, and nobody (including talking animals) says "Wick" before the M3 exiles.
- **The *Kestrel*:** a small brass Crown patrol airship (balloon envelope, brass gondola, copper burner, a gondola lamp). Wick spends a month pencilling the signal's bearing onto a stolen **Crown sky-chart**, cuts the *Kestrel* loose and flies toward the signal. The wall-ballistae shoot it down, and it crashes through the broken roof of a ruined tower. *Kestrel* is the ship's name and the game's title, not the hero's.
- **The chart (the map):** a printed Crown sky-chart, stolen with the *Kestrel*, that says `BEYOND THE WALL: NOTHING`, with Wick's own pencil course running past it to the signal through a line of old relay towers, and his notes signed "W.". He remembers drawing every line; it is a sign of his defiance, not a mystery about his past.
- **The exiles:** people Ferrum cast out and swore had died. Their village is unnamed in canon (working name "Outwall", decided in M3); nothing in M1/M2 names it.
- **The Hollow Watchtower:** an old signal relay, a roofless, moss-grown ruined round stone tower. Wick comes to on the ground floor among the wreckage, by the smoldering burner. The dead relay at the summit is an aether-crystal bowl in a brass-and-mirror mount (magic plus machine; the machine part is old, older than Ferrum's Wall).
- **The hook (M1):** from the summit you see the torn envelope snagged below the breach. Behind you, Ferrum's walled amber lights sit on the horizon. Ahead, along the pencil line, a teal light shines on a far tower: the signal. Nothing is explained.
- **Magic as discovery and upgrades:** magic (Aether, a magic of light fed by aether crystals) is real outside the Wall, and finding it is both the story arc and the upgrade system.
  - M1: the relay wakes to the lamp (optional beat), the first hint. He has no word for it.
  - M2-M3: talking animals, an early and gentle proof that magic is real.
  - M3: the exiles give him an **artificer's gauntlet** (brass, empty crystal socket). He finds no spring or flint in it, closes his hand, and **Spark** jumps from his fingers: the first spell and the end of his disbelief.
  - Later: **Gust** (push, jump) and **Ward**, each unlocked by a gauntlet crystal found in ruins or won from a dungeon, never bought.
- **Other upgrades:** sword (ruin steel, then reforged at forges), heart vessels (health), chart pieces (extend the route). Tool gating in the Zelda style: new spells and gear open new parts of the map.
- **Core loop:** follow the pencil line from relay to relay and wake each dead relay; each one becomes a light you can return to (save point from M2).
- **Tone:** curious, defiant, wondrous. "I broke out, now what's out here?" Warm lamplight and the odd gleam of brass against cold, vast, overgrown ruins and the teal of magic. No dialogue in M1. The story comes from the wreckage, the chart and the relay-keeper's log.

## 4. Core controls (keyboard + mouse, M1)

| Input | Action |
|---|---|
| W A S D | Move (forward/strafe/back) |
| Mouse (pointer lock) | Look (yaw; pitch via y-shear, clamped to about ±35 degrees) |
| Arrow keys | Look fallback (yaw 120 deg/s, pitch 60 deg/s) |
| Shift (hold) | Run |
| Space | Jump |
| E | Interact (take, pull, read, wake prompts) |
| M | Open / close the chart (map card, US-015) |
| Esc | Release mouse / pause overlay (from M2 the pause overlay also opens Settings, US-038) |
| N | Mute toggle (US-020, P2; moves into Settings in M2) |
| F3 | Debug overlay (fps, frame ms, position, sector id) |
| R | Restart (only on end screen) |

Click on the canvas captures the mouse. Mouse sensitivity default 0.15 deg per pixel. `M` is reserved for the chart.

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

## 6. Visual and render model (summary of D-002, D-009)

- Single `<canvas>`, logical grid of (glyph, fg color, bg color) cells. Grid scales to fit the window, keeping the cell aspect. **Grid (D-009 amendment 2):** default **240x90** on the GPU (`gl2`) path; from M2 the player can choose 160x60 / 240x90 / 320x120 in the Settings menu (US-038, remembered per browser; D-012 puts Settings in M2); `?grid=WxH` stays as the dev override; the CPU fallback is forced to 160x60. All art must read at 160x60 and 240x90 (320x120 is a checked extra).
- Sector raycaster: per-sector floor and ceiling heights; ceilings can be "sky". Y-shear for pitch. Props are billboards (3D glyph models = voxel models with rigid-part animation, D-016, US-039..041, before M3; 8-direction billboards are the M1-M2 interim).
- Brightness to glyph density ramp (base ramp ` .:-=+*#%@`, designer may refine per material). Hue comes from material color multiplied by light color.
- Lighting = ambient + sun (directional, shadow test against the roof hole) + point lights (burner, lamp) with distance falloff and flicker.
- Distance fog toward a cool blue-grey; the far overworld is a separate heightmap pass.
- **Visual direction (D-011): 80-90% fantasy, 10-20% machines.** Stone, wood, iron and sky stay as approved, plus moss and ivy. Aether glow (cyan-teal emissive with `* + .` sparkle) is reserved for magic, crystals and the signal. Brass, copper, rivets, gears, pipes and gauges appear only on machines (the *Kestrel* wreck, the lamp, the lever housing, the relay mount; later doors and sentinels). Machines must read at 160x60: silhouette first, no rivet noise on small props.

## 7. Opening: The Awakening (Milestone 1)

Target length: 3 to 5 minutes for a first-time player. A stranger must finish it without instructions.

Story frame: Wick comes to in the tower where the *Kestrel* crashed. He remembers the escape; the player learns it from the wreckage, the chart and the view. Geometry, beats and numbers are unchanged from D-001 / D-003; only the meaning and the art change (D-011).

### 7.1 Space: the Hollow Watchtower (an old signal relay)

Round tower approximated on the grid. Outer footprint about 12x12 cells, wall 1 cell thick, interior about 10 m across. Walls broken off at irregular heights between 6.5 m and 8.5 m; no roof. Moss and ivy on wall tops and cracks. Heights are floor heights.

**Level 0 – Ground floor (floor 0.0 m)**
- **Wake spot:** a heap of torn balloon canvas against the south wall, beside the wrecked brass **gondola** of the *Kestrel* (same place and footprint as the old straw pallet). Player starts lying down, looking up at the hole the *Kestrel* tore through.
- **The *Kestrel*'s burner:** the copper burner lies on the stone about 3 m from the wake spot, still smoldering (the torch point light; same position and light preset as the old brazier). Scorched floor, scattered embers.
- **The lamp:** the *Kestrel*'s brass gondola lamp, still burning on its bracket on the wreck, next to the burner at chest height (1.3 m; the old lantern position). Its small steady flame warms the corner so it reads as "take me" (OWN-REQ-006).
- **Wreckage:** torn canvas hanging from the broken wall top into the stairwell, ropes, bent brass struts. Decoration only: it never blocks the path from the wake spot to the burner and the stair.
- **Sun shaft:** morning sun (elevation about 60 degrees) enters through the open top and a large crack in the east wall, painting a bright ellipse of floor near the tower centre. Dust motes (nice-to-have) drift in it.
- **Rubble:** fallen blocks scattered around the edge (static collision, 0.3 to 0.9 m tall). One low hollow (floor -0.3 m) near the north-west.
- **Boulder:** a round mossy stone (radius 0.6 m) sits on the first steps of the stair, blocking it. Floor slopes gently toward the hollow so, once pushed, it rolls down and settles in the hollow with a thud.
- **Relay-keeper's log** (nice-to-have, US-021): lines scratched into the stone near the wake spot, read with `[E] Read`; text in `docs/story.md` section 4.

**Level 1 – Spiral stair and mid ledge (0.0 m to 3.0 m)**
- Stone steps hug the inner wall, 1 cell wide, each step 0.30 m rise, climbing clockwise.
- **The gap:** at about 2.7 m high, 1.0 m (one cell) of stairs has collapsed. The landing on the far side is the mid ledge at 3.0 m. A walking jump clears it; the gap is forgiving on purpose. It still requires Space: step-up never works mid-air, and walking off drops 2.1 m onto debris. Falling means landing on rubble at ground level, no damage, walk back up.
- The stair above the sun line is in shade: the lamp makes the gap edges clearly readable; without it they are dim but still visible (soft gate, never a hard lock).
- **Mid ledge:** a 2x2 m stone platform in a wall niche with an iron **lever** in an old **brass gear housing** (up position). Next to it, the upper stair is blocked by an iron **grate** (portcullis). Chains visibly run from the lever to the grate.
- **Lever:** E pulls it down (0.4 s), the gears turn and the grate rises (1.5 s) with a rattle, opening the upper stair. One-way; cannot be reset.

**Level 2 – Upper stair and summit (3.0 m to 6.0 m)**
- Upper stair continues 10 steps to the summit walkway, 6.0 m.
- **Summit:** the relay bastion built onto the tower's west side on a rock spur, reached through a doorway in the broken west wall. It overlooks the tower interior across the low (6.5 m) wall top, so the interior stays roofless for the sun shaft. It has a ring walkway around the relay and a waist-high parapet. Centre: the **dead relay**, a large aether-crystal bowl (2 m across) in a brass-and-mirror mount, dull and grey-teal. Optional (D-003, US-022): with the lamp, `[E] Wake the relay` makes the crystal glow teal; the lamp is kept, the far view does not change, and the end text changes.
- **Looking back (east):** over the interior wall top, Ferrum's walled amber lights on the far horizon.
- **The breach:** a 2 m wide hole in the west parapet, opening onto a stone outcrop and a path going down the hill. The torn *Kestrel* envelope is snagged on the rocks below. Through the breach the **overworld** is visible: rolling hills, a winding river of blue `~`, forests of green `&%`, blue fog; far away (about 800 m, in the chart's direction) the **signal tower** on a hill, a dark silhouette with a teal light at its top.
- Stepping onto the outcrop past the breach triggers the end.

### 7.2 Beat sheet

| # | Beat | Player does | Game teaches / shows | Target time |
|---|---|---|---|---|
| 1 | Wake | Nothing (0 to 3 s), then any input | Black, eye-blink reveal, lying by the wreck looking up through the torn roof, rises to eye height; title card `KESTREL` | 0:00 to 0:08 |
| 2 | The chart | Any key to dismiss | Map card: Crown print "nothing", your pencil line to the signal; `M` re-opens it | to 0:15 |
| 3 | First steps | WASD toward the warm light | "WASD move / Mouse look" hint | to 0:30 |
| 4 | Burner | Arrives at the smoldering burner | Warm flicker on walls, the lamp still burning on the wreck | to 0:45 |
| 5 | Look up | Looks at the sun shaft | Y-shear pitch, open sky, broken walls, stair winding up | any time |
| 6 | Lamp | E to take it | Interact prompt; the lamp light now travels with the player | to 1:00 |
| 7 | Boulder | Walks into the boulder at the stair base | Physics: it rolls down the slope and settles in the hollow | to 1:30 |
| 8 | Climb | Walks up steps | Step-up; the world falls away below | to 2:00 |
| 9 | Gap | Space to jump | "Space jump" hint appears near the gap edge | to 2:30 |
| 10 | Lever | E on lever | Gears turn, grate rises; cause and effect | to 3:00 |
| 11 | Summit | Walks up, sees the dead relay, looks out the breach and back | The signal tower ahead, Ferrum behind, the envelope below | to 3:45 |
| 12 | Step out | Walks through the breach | End fade, two lines, `- to be continued -`, R to restart | to 4:00 |

### 7.3 Lighting script (M1 values, designer may tune in palette)

| Light | Color | Intensity | Radius / falloff | Notes |
|---|---|---|---|---|
| Ambient | cool blue `#2a3550` | 0.12 | everywhere | never fully black; glyph `.` at minimum on lit-less walls within 8 m |
| Sun | warm white `#fff2d0` | 1.0 | directional, elev 60 deg, from ESE | shadow test vs roof opening and east crack; sky ceilings are lit |
| *Kestrel* burner | orange `#ff9a3c` | 1.0 | 6 m, smooth quadratic falloff | the old brazier preset; flicker: noise at 8 to 12 Hz, ±15% intensity, ±0.05 m position jitter |
| Brass lamp (carried) | amber `#ffd27a` | 0.8 | 5 m | held at right hand (0.3 m right, 0.3 m below eye, 0.4 m forward), gentle sway with walking, ±5% flicker |
| Woken relay (US-022, optional) | aether teal (palette key, designer) | 0 to 1.0 over 1.0 s | 12 m target (min 8 m) | slow shimmer ±5%; no fire flicker |
| Signal tower, Ferrum | emissive cells only | - | - | not point lights; drawn in the far view (US-016) |

### 7.4 UI in M1

- Crosshair: a single dim `+` at screen centre; brightens when an interactable is targeted.
- Interact prompt: `[E] Take lamp`, `[E] Pull lever`, `[E] Read` (US-021), `[E] Wake the relay` (US-022) under the crosshair, only when within 1.8 m and aimed within about 20 degrees.
- Control hints: small, bottom-left, fade in 0.3 s, disappear once the action is performed or after 8 s. Each hint shows at most once per run. Story hint lines come from `docs/story.md` section 5.
- Title card: `KESTREL` (large, built from glyphs) and the subtitle `SOMEONE IS CALLING` beneath, centred, fades in 1 s, holds 3 s, fades out 1 s.
- **Map card:** the Crown sky-chart with Wick's pencil course (text in `docs/story.md` section 5). Shown once after the title card, any key dismisses it, `M` re-opens it. Static art only: no inventory, no live position marker, no tracking.
- Pause overlay (Esc): `Click to resume`. (The Settings entry arrives in M2 with US-038.)
- End screen: fade to black 2 s, two lines of text, `- to be continued -`, `[R] Wake again`. End text is owned by the writer (US-017).
- No health, no inventory, no minimap in M1.

### 7.5 Audio (nice-to-have in M1)

Burner crackle and hiss (positional, loudness by distance), footsteps on stone (per step, slight pitch variation), creaking canvas, boulder roll rumble and thud, lever clunk and gear ratchet, grate rattle, wind at the summit rising as the player nears the breach. WebAudio, no external libraries. Mute on `N` in M1 (moves into Settings in M2).

## 8. Later milestones (outline only)

- **M1.5 Editor Preview** (D-010): level viewer and object placer.
- **M2 Out of the Wreck:** the hill outside the tower, heightmap terrain walk-out, day/night, sword (ruin steel) and lock-on, first melee enemy (a wild beast or a Hush-touched creature), a hidden chest, the woken relay as the save point (versioned saves through the platform adapter, D-012), the Settings menu with fullscreen (US-038). The first talking animal can appear here as the earliest sign that magic is real (US-042; it never names Wick).
- **M3 The Relay Line:** an open region, 3 dead relays along the pencil line, the exile village (people Ferrum cast out; working name "Outwall", decided in M3) with NPCs and dialogue (US-042; the exiles are the first to call him Wick), the artificer's gauntlet and **Spark** (first spell, the moment of belief), a ranged tool (bow or crossbow), a second enemy (a stray Crown clockwork sentinel), chunk streaming. Voxel creatures/NPCs (US-039..041, D-016) land before M3.
- **M4 The Signal Source:** the first dungeon is the source of the signal, an ancient ruin with pressure doors and gear locks: keys, light puzzles (mirrors, shadow, aether), a boss, reward = the first gauntlet crystal. Who is calling stays open.
- **M5 Engine Editor v0** (D-010): model and animation editor.
- **M6 Polish and Release:** includes the Steam release (D-012: Electron + steamworks.js, itch.io browser demo first; US-043). Ferrum itself stays off-screen until after M6.

Magic progression across milestones: relay wakes (M1, hint) -> talking animals (M2/M3) -> Spark (M3) -> gauntlet crystals: Gust, Ward (M4+). Hearts/health UI, items and combat are designed in detail when M2 is planned.
