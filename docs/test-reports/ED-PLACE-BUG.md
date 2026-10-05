# ED-PLACE-BUG - editor: armed Assets model must place on the next viewport click

Date: 2026-10-06 | Branch: `pc-b` | Base: `c55a694` (master merged) | Author: PC-B (DeepSeek trial)

Owner report (2026-10-04): "I can't add an item from the assets". Clicking an Assets-tab row arms the model
(status `place: prop X`), but the next viewport click opened the US-063 model picker instead of placing.

## Root cause

Not "the armed key was cleared by a tab switch / stray mousedown" as first suspected. The armed state was set
correctly (`armModelPlacement` -> `placeMode='prop'`, `armedModelKey=key`), and the viewport handler's armed
branch did run. It consumed `armedModelKey` and called `placeAt`, and **`placeAt` threw** - but the throw was
invisible, because an exception thrown by a DOM event listener is not rethrown by `dispatchEvent`; it goes to
`window.onerror` and the handler's remaining lines are skipped. Net effect: `armedModelKey` already null,
`placeMode` still `'prop'`, so the *next* click fell into `openModelPicker` - exactly the "the picker opens"
symptom.

The throw itself was `TypeError: world.groundAt is not a function` at `tools/editor/main.js` line 1173 (the
ED-SNAP-1 world-entity snap). `World` (engine/world/World.js) exposes `floorAt(x, y)` - structure floor inside
a structure, `terrain.groundAt` outside - it has **no** `groundAt` method (`groundAt` lives on `Terrain`).
Interior (tower) placement uses a different branch and never hit this, which is why the crash only appeared
when the click landed on terrain outside the tower.

## Fix

- `tools/editor/panel.js`: new pure `worldGroundZ(world, x, y)` that samples `world.floorAt(x, y)` and returns
  `null` when there is no such method (so `snappedWorldPos` falls back to the raw pick point). The
  `snappedWorldPos` doc comment that named `World.groundAt` was corrected to `World.floorAt`.
- `tools/editor/main.js`: the world-entity branch now calls `worldGroundZ(world, pt.x, pt.y)`.

## Tests / checks

- `tools/editor/panel.test.mjs`: 49/49 (new `worldGroundZ` block: samples `floorAt`; `floorAt`-returns-null
  passes through; a `world` with only `groundAt` yields null with no throw; null/undefined world -> null).
- `node tools/run-tests.mjs`: **223/223 suites PASS, 0 FAIL, 0 WARN** (check-deps / typecheck / content OK).
- Headless browser repro (real `mousedown` events on the live editor, RTX 4060 D3D11): click an Assets row
  (arms, chip `model: <key>`, picker hidden) -> click the viewport centre (terrain) -> a world entity
  (`world/world_m1` `entities` `prop_1`) is placed and selected, `placeMode` null, picker stays closed, no
  throw. Tower-interior placement (structure branch) verified working as before.

## Note left for the owner / PC-A

The deeper symptom - a failed `placeAt` silently leaves `armedModelKey` consumed and `placeMode` stuck - is a
general event-listener exception-swallowing issue, not specific to this story. With `groundAt` fixed the
crash is gone; if PC-A wants belt-and-braces, `placeAt` could clear `placeMode`/restore `armedModelKey` on any
throw, but that is out of scope for ED-PLACE-BUG.
