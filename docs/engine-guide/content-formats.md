# Content formats

Short summaries. The full rules live in the linked docs; this page does not copy them.

## Palette and materials (`design/palette.js`)

A classic script that sets `window.ASSETS.palette`: named colors, glyph ramps, materials (which ramp and colors a surface uses) and light presets (`lantern`, `torch`, ...). Models and meshes refer to materials by key, never by raw color. Format: [design/README.md section 1](../../design/README.md). The detail pass (`design/detail-pass.js`) adds per-material surface detail.

## Voxel models

A model is `{ name, voxel: {...} }` in `assets.models`. The `voxel` part:

- `version: 1`, `cellM` (metres per voxel), `size: [x, y, z]`, `anchor` (the point placed at the entity position).
- `mats`: one letter per material key, e.g. `{ B: 'brass_light' }`.
- `layers`: one entry per z layer, each a list of strings (one per y row, one letter per x; `.` is empty).
- `parts`: boxes that group voxels (every voxel must be inside a part) with a `pivot` for animation.
- `animations`: named clips with `durations`, `loop` and per-frame part poses.

`validateVoxelModel(def)` returns `{ errors, warnings }`. Details: [design/README.md section 7](../../design/README.md); large mesh-only models: [architecture.md 28.12](../architecture.md).

## Meshes

Triangle meshes for static geometry. Build one in code with `buildMeshFromTris(tris, parts, name)`, load JSON with `meshFromJSON`, or binary with `meshFromBin`. Each triangle has `p0 p1 p2`, `normal`, `matName`; `mesh.mats` maps part names to palette materials. Imported glTF files are converted by the mesh-import tooling. Binary layout: [docs/mesh-bin.md](../mesh-bin.md).

## Levels and worlds

- A **level** is a grid of cells and lights, placed in a world as a *structure*. Format: [engine/world/MAP_FORMAT.md](../../engine/world/MAP_FORMAT.md) and [design/README.md section 3](../../design/README.md).
- A **world** is `{ name, terrain, structures, entities, state }`. `terrain` names a terrain recipe or is `null`. Load it with `engine.loadWorld(def)`. Terrain details: [architecture.md](../architecture.md) (search "World.load").

## `.kestrel` packages

A `.kestrel` file is a zip that bundles content (models, meshes, levels, worlds, ...) as JSON files with a manifest and a schema version. Load with `loadContentPack` / `openPackage`, write with `writeZip`, upgrade old files with `migrateContent`; problems are reported as `ContentError`. Format and rules: [architecture.md section 38.30](../architecture.md). Prefab files: [architecture.md 38.11](../architecture.md).
