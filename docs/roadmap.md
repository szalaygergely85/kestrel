# ASCII Quest – Roadmap

Owner: Manager. Updated: 2026-09-22.

## Milestone 1 – "The Awakening" (vertical slice)  — status: IN PROGRESS (kick-off)

Goal: a polished 3–5 minute playable slice, from waking at the bottom of the Hollow Watchtower to stepping through the summit breach and seeing the overworld. Everything else is out.

**In**
- Sector-based ASCII 3D renderer on a single canvas, glyph density ramp shading (D-002).
- Lighting: ambient + directional sun shaft with shadow + torch point light with flicker + carried lantern point light.
- Physics: fixed-step gravity, walk/run, jump, step-up on stairs, capsule-vs-sector collision, one rolling boulder.
- The tower level: ground floor (wake spot, fire-pit torch, rubble), broken spiral stair with one jump gap, mid ledge with lever, summit breach.
- Interactions: pick up lantern (E), pull lever (E) to drop the rubble bridge/open the breach grate.
- Minimal UI: crosshair/interact prompt, first-time control hints, title card on wake.
- Far view: low-detail heightmap overworld visible from the breach; slice ends when the player steps outside (fade + "to be continued").
- 60 fps at 160x60 cells on a normal laptop.
- **P1 (after all P0):** light the summit beacon with the lantern, optional final beat (US-022, D-003).

**P2 stretch (not exit criteria):** dust motes (US-019), procedural WebAudio sound (US-020, D-004), wall scrawl (US-021).

**Out**
- Combat, enemies, inventory, dialogue, NPCs, saving, audio asset files.

**Exit criteria:** PO OK + tester PASS on every **P0** M1 story; a stranger can finish the slice without instructions and without taking the lantern. P1/P2 ship if done, never block.

## Milestone 2 – "First Steps" — status: planned
The hill outside the tower: outdoor heightmap terrain, day/night sun cycle, first enemy type (melee), sword + lock-on, a hidden chest, and a save point at the tower.

## Milestone 3 – "The Dark Beacons" — status: planned
Open-world region with 3 beacons to relight, a village with 3–5 NPCs and dialogue, a second enemy type, ranged tool (bow or lantern-throw), streaming/chunked world.

## Milestone 4 – "The Depths" — status: planned
First dungeon: keys, puzzles using light (mirrors, shadow), a boss, item reward.

## Milestone 5 – "Polish & Release" — status: planned
Performance pass, accessibility (font size, colorblind palettes), gamepad, itch.io-style static release.
