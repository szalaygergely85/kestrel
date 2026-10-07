# tools/

Node scripts (no build step). Run from the repo root. Tests are `*.test.mjs` / `engine/**/*.test.js`, run by `node tools/run-tests.mjs`.

## Mesh import

- `gltf-import.mjs <in.gltf|glb> <id> [--mats map.json] [--out path] [--simplify <tris> | --budget]` imports a glTF as `content/meshes/<id>.mesh.json`.
  `--simplify <tris>` reduces the mesh to about `<tris>` triangles (quadric edge collapse, `engine/mesh/simplify.js`: welds positions, keeps open rims, rejects flipping collapses, deterministic; planar UVs only).
  `--budget` uses the per-mesh target from `tools/mesh-budgets.mjs` (trees 2000, rocks 400, path stones 250, mushrooms 250, pebbles 80, grass tufts 60; matched on the id basename).
  The import also writes the collision data (`collider` proxy or `collide:false`), same as `gen-mesh-colliders.mjs`.
- `reimport-quaternius.mjs [--dry-run] [name ...]` re-imports every `content/meshes/quaternius/*` mesh that is above its budget from `design/meshes/quaternius/glTF/`, keeping its `mats`, and prints a before/after triangle table.
- `gen-mesh-colliders.mjs [paths] [--check]` (re)writes `collider` / `collide:false` on mesh json (idempotent); `--check` fails if anything would change (CI).
