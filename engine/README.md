# engine/

Reusable ASCII 3D engine (D-006). `index.js` is the only public entry point -
`game/` and `tools/` import exactly `engine/index.js`, never a deep path
(enforced by `node tools/check-deps.mjs`, rule 3).

## Folder map

- `core/` - bootstrap: `engine.js` (`createEngine`), `loop.js`, `input.js`,
  `playerLook.js`, `assets.js` (`AssetRegistry`), `events.js` (tiny emitter),
  `behaviours.js` (named behaviour registry).
- `render/` - `RenderTarget`/`RenderTargetGL`/`RenderTargetCanvas2D`,
  `CellBuffer`, `glyphMetrics`, `DepthBuffer`, `OpenSpans`, `sectorCaster.js`
  (`castScene`/`castSectors`/`beginFrame`/`fillSky`), `terrainCaster.js`
  (stub, US-016), `sprites.js` (stub, US-011), `textDraw.js`, `fastShade.js`,
  `shadeTest.js`.
- `world/` - `Level.js` (sector grid, `MAP_FORMAT.md`), `World.js`/`Terrain.js`
  /`serialize.js` (stubs, US-025).
- `physics/` - `sphere.js` (stub, US-013), `integrate.js` (stub, US-025).
  `config.js`/`capsule.js` still live in `game/js/physics/` until US-024
  Phase C.
- `entities/` - `Entity.js`/`Camera.js` (partly real: pose math is real,
  `fromEntity` is a stub), `EntityHandle.js`/`animation.js` (stubs, US-025/
  US-011, see docs/architecture.md section 10.1). `Player.js` still lives in
  `game/js/entities/` until US-024 Phase C.
- `ui/` - `debugOverlay.js`.

## check-deps

`node tools/check-deps.mjs` enforces (docs/architecture.md section 3):

1. every `engine/**/*.js` import resolves inside `engine/` (no bare
   specifiers, no libraries, no Node built-ins);
2. `engine/**/*.js` never reads `window.ASSETS`/`globalThis.ASSETS`/`ASSETS.`/
   `document.getElementById`/`location.search`/`URLSearchParams`;
3. `game/**/*.js` and `tools/**/*.js` import `engine/` only via
   `engine/index.js` (no deep imports, `game/js/dev/*` included);
4. `design/**/*.js` has no `import`/`export` statements (classic scripts
   only, until US-027);
5. JSDoc `import('...')` inside comments is ignored;
6. prints `check-deps OK (N files)` on success, else `file:line: message` per
   finding and exits 1.

## US-024 status (Phases A/B done; Phase C next)

`game/js/physics/*`, `game/js/entities/Player.js` and
`game/js/physics/*.test.js` are NOT moved yet (US-024 Phase C, next
programmer) - they still import `../world/Level.js` and
`../world/levels/test_room.js`, which are forwarding shims onto
`engine/world/Level.js` and `design/levels/test_room.js` respectively. Do not
delete those two shim files until Phase C moves their last reader.
