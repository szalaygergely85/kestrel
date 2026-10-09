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
- Imported mesh geometry follows the cursor during a move drag, including
  its ground-snapped height. Release saves one move; `Esc` restores the original
  position. A drop with no valid floor cancels the move.
- **Shift/Ctrl+click** toggles props and lights in the selection, in the viewport
  or Scene Tree. Drag on empty space to box-select their pivots; hold Shift/Ctrl
  to add to the current selection. `Esc` cancels a box gesture. All selected
  items are highlighted; the inspector identifies the primary item it edits.
- With multiple props/lights selected, arrows move the whole set, Q/E rotate
  around its centre, and Delete removes it as one undo step (the whole delete
  is refused if any member is referenced). Re-click a selected member and drag
  in Move/Yaw mode to preview the whole set; release commits once, Esc restores.
  Ctrl+D duplicates it one metre to the east and selects the copies.
- Ctrl+G stores a group in one file; Ctrl+Shift+G removes it. Clicking a grouped
  item selects its members; Alt+click selects just that member. Groups cannot
  span files, but a mixed-file selection can move/rotate/duplicate/delete.
  Two placements of the same shared content item cannot be edited together.
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

The **Assets** tab also lists imported meshes in **Meshes / <pack>** folders.
Search matches their asset ids and pack names. These rows show rendered mesh
previews and triangle counts in their tooltips. Click a mesh row and then the
viewport, or drag the row onto a surface, to place it with footprint ground
snapping. Select placed meshes from the Scene Tree's **Meshes** group to edit
world position, yaw, shadow/collision overrides, or delete them. Arrow keys,
PgUp/PgDn, Q/E, G and undo/redo also apply. Click a mesh in the scene to select
it; click again with **Move** and drag to move its geometry live. Release to
commit, or press Esc to restore its original position. Shadow and collision
checkboxes save placement flags and support undo/redo. Shadows apply on reload;
gameplay collision changes await the engine loader's placement-flag support.
Collision is disabled in the inspector when the mesh asset itself disables
collision. Mesh SCALE accepts 0.25..4 and snaps 0.05; Minus/Equal step it. Move
and yaw commits/undo update the live placement without a World reload. With
`?physics=mesh`, committed edits rebuild mesh colliders once; a held drag and
Escape never rebuild them. Structural changes (add/delete/model/scale/flags) still
reload the World, preserving the selected physics mode.

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
or when the side panel is out of view); press `H` again to dismiss it. The side panel also always shows a short version of
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
- For world/level edits, choose the corresponding `content/` file in Save As,
  or copy the downloaded JSON there, then review the diff. Prefab Save asks
  for the `content/` directory and writes the prefab plus its manifest entry
  (see Prefabs below); its download fallback needs both files copied into place.
- **Load** (button): opens a `.json` file you saved earlier (or hand-edited)
  and replaces the matching in-memory document with it, after validating it
  the same way Save does. This clears the undo history.
- **Play-test** (button, or `P`): opens `game/index.html` in a new tab with
  your current unsaved edits applied (via a `localStorage` handoff, not a
  file write), so you can walk around and check a change before saving it.
  Reloading that tab replays the same edit.
- Closing or reloading the editor tab while any file has unsaved changes
  pops the browser's own "leave site?" warning.

## Viewport help

Press **H** with the viewport focused to toggle the in-viewport key-help panel.
It uses the fixed UI layer and the canvas fits the centre pane, including when
the window resizes, so the panel stays visible beside the docks.

## Chart after editor saves

After saving world structures or Terrain brush edits into `content/`, run
`node tools/bake-chart.mjs`, then `node tools/bake-chart.mjs --check` before
shipping the edit. The chart reads final terrain heights, including brush
deltas, ring floors, roads and water. It stays below 100 KB at 240x120 cells.
For a release from staged/tracked files, use `--index` on both commands;
run `node tools/bake-chart.mjs --check --index` as a separate merge-time gate.
The default Node suite checks small fixtures, determinism and stale-input
refusal; it does not rebake the full world. Any change to world_m1, its terrain
recipe or terrain edits requires a rebake followed by this merge-time gate.
Working-file `--check`
also detects unsaved owner placements that differ from the indexed chart.
MAP-01a's final glyphs and MAP-01c's live map remain separate queue items.

## Voxel import GPU check

Run `node tools/editor/verify-vox-import.mjs 9880` (or another lane-C port
9800..9998). It starts its own no-cache server and isolated real-GPU browser,
imports generated small and meshOnly VOX cubes with the editor button, places
them with physical mouse clicks, validates the document and checks undo/redo.
It writes ignored screenshots, then stops its own processes and deletes its
temporary browser profile. It changes only browser memory; no world file is
saved. Imported model definitions remain session-only, as noted in the import
handler. See `docs/test-reports/S8-C-20a.md` for current results.

## Known limits (as of US-063)

- Placed structures can't be moved, rotated or created from the editor (M1.5
  scope - `docs/architecture.md` 24.12 item 7); you can only edit what's
  inside an existing structure or place free-standing world props.
- Cell/circle-shaped triggers have no visible marker in the 3D view (by
  design, to keep the overlay simple) - select them from the Outliner.
- Hover-picking is intentionally off (an expensive GPU readback per
  mousemove would blow the frame budget); only click-picking works, and the
  hovered cell just gets a plain outline.

### Prefabs (ED-GROUP-1c)

Select plain props/lights, enter a title in Assets, then **Save selection as prefab**.
Choose the repository's `content/` directory: Save writes `prefabs/<title_slug>.prefab.json`
and appends that file to `manifest.json`. Existing prefab titles are refused. Cancelled
saves leave the session asset dirty; Ctrl+S retries. Without directory access, Save downloads
both JSON files; put the prefab in `content/prefabs/` and the manifest in `content/`.
Load accepts an exported prefab too; manifested prefabs appear automatically after reload.

Click a prefab row, set **Prefab yaw**, then click the viewport to stamp it. Each stamp
uses fresh item/group IDs and one undo step. Lights outside structures and invalid members
are skipped with a message. The remaining items are ordinary editable props/lights; the
prefab name records provenance and does not create a live link. Saving the edited world/level
and reloading the game keeps the copies. V1 supports visual voxel props and lights;
gameplay entity components cannot be saved as prefabs.
