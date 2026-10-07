# tools/

Node scripts (no build step). Run from the repo root. Tests are `*.test.mjs` / `engine/**/*.test.js`, run by `node tools/run-tests.mjs`.

## Mesh import

- `gltf-import.mjs <in.gltf|glb> <id> [--mats map.json] [--out path] [--simplify <tris> | --budget]` imports a glTF as `content/meshes/<id>.mesh.json`.
  - `--uvmap <tex.png|auto> [--palette-map <json>]` (MESH-UVMAP-01): one palette material per triangle, sampled from the colour texture at the triangle's centroid UV (Lab-nearest key of `design/meshes/quaternius/palette-map.json`, <= 6 keys per texture, speckle < 3 tris demoted); one range per key, planar UVs kept, `--simplify`/`--budget` run per key range (never merged across keys); prints triangles per key + unmapped colours. `png-read.mjs` is the dependency-free PNG decoder, `uvmap.mjs` the classifier.
  `--simplify <tris>` reduces the mesh to about `<tris>` triangles (quadric edge collapse, `engine/mesh/simplify.js`: welds positions, keeps open rims, rejects flipping collapses, deterministic; planar UVs only).
  `--budget` uses the per-mesh target from `tools/mesh-budgets.mjs` (trees 2000, rocks 400, path stones 250, mushrooms 250, pebbles 80, grass tufts 60; matched on the id basename).
  The import also writes the collision data (`collider` proxy or `collide:false`), same as `gen-mesh-colliders.mjs`.
- `dae-import.mjs <in.dae> <id> [--map design/meshes/kenney/palette-map.json] [--budget | --simplify <tris>] [--scale s]` (TREES-LP-a) imports a Kenney Nature Kit Collada file as `content/meshes/<id>.mesh.json` (material diffuse colour -> palette key by Lab nearest; trees get a trunk prism proxy); shares `buildMeshFromTris` (engine/mesh/gltf.js) with the glTF importer. Test: `dae-import.test.mjs`.
- `reimport-quaternius.mjs [--dry-run] [name ...]` re-imports every `content/meshes/quaternius/*` mesh that is above its budget from `design/meshes/quaternius/glTF/`, keeping its `mats`, and prints a before/after triangle table.
  - `reimport-quaternius.mjs --uvmap [names...]` re-imports with `--uvmap auto` (default names = the quaternius meshes placed in world_m1), per-key triangle table + ms per mesh.
- `gen-mesh-colliders.mjs [paths] [--check]` (re)writes `collider` / `collide:false` on mesh json (idempotent); `--check` fails if anything would change (CI).
