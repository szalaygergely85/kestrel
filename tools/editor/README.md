# Kestrel level editor (M1.5, `tools/editor/`)

A second, small client of `engine/index.js` (no `game/` import) for viewing
and lightly editing the game's level/world content by hand - a fly-cam over
the real renderer, click to select/move/place things, save the result as
JSON. Background/design notes: `docs/architecture.md` section 24.

## Open it

```
python -m http.server 8000      # from the repo root (or any static server)
```
then open `http://localhost:8000/tools/editor/index.html`.

Useful query params:
- `?world=<id>` - open a different world (default `world_m1`). The world id
  must be one `assets.world(id)` (the content pack / `design/*.js` globals)
  actually has; an unknown id throws a clear "unknown world" error naming the
  known ones.
- `?gpu=0` - force the slow CPU render path (the editor needs a real WebGL2
  backend otherwise; a red gate message says so and the canvas stays hidden).
- `?grid=<cols>x<rows>` - render grid size (default 240x90).
- `?debug=1` - start with the F3 debug overlay already on.

The editor needs a real GPU (WebGL2), same as the game. If your browser/VM
only has a software GL renderer, use `?gpu=0`.

## Fly around

- `W/A/S/D` - move, `R`/`F` - up/down, mouse wheel - fly speed.
- Hold the **right mouse button** and drag to look (pointer lock); release to
  stop.
- `Shift` - move faster (x4), `Ctrl` - move slower (x0.25).
- `Home` - back to the start pose (or wherever `T` last teleported from).
- The camera pose is remembered per browser (`localStorage`), so reloading
  the page returns you to the same spot.
- `Animate` (the checkbox in the side panel) turns on prop/sector animation
  playback; off by default so idle frames cost ~0 (the editor renders a new
  frame only when something actually changed).

## Select and move things

- **Left-click** an entity (a prop, a billboard, a voxel model) to select it;
  click again and drag to move it in the horizontal plane; release to commit.
  `Esc` while dragging cancels and snaps back.
- Lights and interactables have no visible mesh - they're picked as small
  markers (`*` for a light, `o` for an interactable) when **markers** are on
  (`M` toggles them, default on). You can also always select any item from
  the **Outliner** list in the side panel (click = select, double-click =
  select + teleport to it).
- With something selected:
  - **Arrow keys** nudge it on x/y, **PgUp/PgDn** nudge z, by the current
    snap step (`[`/`]` cycles 0.05 / 0.25 / 0.5 / 1 m, shown in the F3
    overlay).
  - `Q`/`E` rotate it +-45 degrees.
  - `G` drops it straight down to the floor under it.
  - `Delete`/`Backspace` deletes it (refused, with a message, if another item
    still references it - e.g. an interactable's `flameProp`).
  - `Ctrl+Z` / `Ctrl+Y` undo/redo (50 steps).
  - `T` teleports the camera to the selection; `Home` returns to the start
    pose.
- The **Properties** panel (side panel) shows every field on the selected
  item as a plain form; editing a field and blurring the input (or toggling a
  checkbox) commits it as one undo step, validated the same way a placement
  is (an invalid edit is refused inline, in red, and never committed).

## Place new things

Press a number key to arm placement mode, then click a surface:

- `1` - prop (opens a **searchable model picker** - type to filter, click a
  model to place it there; `Esc` cancels the whole placement)
- `2` - light (default preset `torch`)
- `3` - trigger (a default 1.5 m circle zone)
- `4` - interactable (a default `[E] Use` prompt)

Clicking on open sky (no surface under the cursor) places the item 8 m out
along the click ray instead of silently doing nothing.

A click that lands **inside a structure's real floor plan** (a tower room, a
courtyard's actual walkable cells - checked against the level's own sector
grid, not just the building's bounding rectangle) places the item into that
structure's level file, in local (structure-relative) coordinates. A click
that lands in a **courtyard gap or any other hole inside the building's
bounding box** (a cell the level grid has no floor/wall data for at all) is
refused with a message - there's nothing to stand on there. A click that
lands genuinely **outside every structure** places a prop into the world
file as a free-standing world entity (world-space coordinates); a
light/trigger/interactable can't be placed out there and is refused with a
message (they only make sense attached to a structure's level).

`Esc` while a placement is armed (before you click, or while the model
picker is open) cancels it.

## Keyboard help overlay

Press `H` to toggle an in-viewport list of every key above (handy full-screen
or when the side panel is out of view); press `H` again, or just keep
working, to dismiss it. The side panel also always shows a short version of
the same list.

`F3` toggles the debug overlay (fps, frame time, camera pose, current snap,
hovered cell, pick result, present count).

## Save, load, play-test

- **Save** (button, or `Ctrl+S`): writes every changed file back out. If your
  browser supports the File System Access API you'll get a native "Save As"
  dialog the first time (and it remembers the handle for the rest of the
  session); otherwise it downloads a `.json` file per changed document. The
  Save button is disabled (with the reason shown) whenever the current
  content wouldn't actually load in the game - a broken id reference, a bad
  number, etc.
- **The editor never writes into `content/` for you.** Every save is either a
  native "Save As" (you choose where) or a browser download - it can't
  silently overwrite the checked-in `content/*.json` files the game loads.
  If you want your edit to ship, save the file, look at the diff, and copy it
  into `content/` yourself (or open the download in place of the existing
  file) - that's a deliberate manual step, not an oversight.
- **Load** (button): opens a `.json` file you saved earlier (or hand-edited)
  and replaces the matching in-memory document with it, after validating it
  the same way Save does. This clears the undo history.
- **Play-test** (button, or `P`): opens `game/index.html` in a new tab with
  your current unsaved edits applied (via a `localStorage` handoff, not a
  file write), so you can walk around and check a change before saving it.
  Reloading that tab replays the same edit.
- Closing or reloading the editor tab while any file has unsaved changes
  pops the browser's own "leave site?" warning.

## Known limits (as of US-063)

- Placed structures can't be moved, rotated or created from the editor (M1.5
  scope - `docs/architecture.md` 24.12 item 7); you can only edit what's
  inside an existing structure or place free-standing world props.
- Cell/circle-shaped triggers have no visible marker in the 3D view (by
  design, to keep the overlay simple) - select them from the Outliner.
- Hover-picking is intentionally off (an expensive GPU readback per
  mousemove would blow the frame budget); only click-picking works, and the
  hovered cell just gets a plain outline.
