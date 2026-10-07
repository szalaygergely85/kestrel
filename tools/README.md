# tools/

Node scripts (no build step). Run from the repo root. Tests are `*.test.mjs` / `engine/**/*.test.js`, run by `node tools/run-tests.mjs`.

## Mesh import

- `gltf-import.mjs <in.gltf|glb> <id> [--mats map.json] [--out path] [--simplify <tris> | --budget]` imports a glTF as `content/meshes/<id>.mesh.json`.
  - `--uvmap <tex.png|auto> [--palette-map <json>]` (MESH-UVMAP-01): one palette material per triangle, sampled from the colour texture at the triangle's centroid UV (Lab-nearest key of `design/meshes/quaternius/palette-map.json`, <= 6 keys per texture, speckle < 3 tris demoted); one range per key, planar UVs kept, `--simplify`/`--budget` run per key range (never merged across keys); prints triangles per key + unmapped colours. `png-read.mjs` is the dependency-free PNG decoder, `uvmap.mjs` the classifier.
  - `--masks <dir|none> [--mask-res 256] [--opaque Mat1,Mat2]` (ALPHA-01a, arch 37.17): a `.gltf` with `alphaMode: MASK` materials imports them as masked ranges (`mask: {tex, cutoff}`, opaque ranges first, `uvMask` = TEXCOORD_0) and writes `<dir>/<pack>/<texture>.mask.json` (default `content/masks`, 8-bit alpha box-averaged to `--mask-res`; re-runs are byte-identical). Auto-opaque rule: a MASK material with no texel under its cutoff inside its triangles' UV region imports opaque with a WARN (`Bark_NormalTree`). Masked primitives are never simplified. Reuses `png-read.mjs` (there is no separate `png.mjs`).
  `--simplify <tris>` reduces the mesh to about `<tris>` triangles (quadric edge collapse, `engine/mesh/simplify.js`: welds positions, keeps open rims, rejects flipping collapses, deterministic; planar UVs only).
  `--budget` uses the per-mesh target from `tools/mesh-budgets.mjs` (trees 2000, rocks 400, path stones 250, mushrooms 250, pebbles 80, grass tufts 60; matched on the id basename).
  The import also writes the collision data (`collider` proxy or `collide:false`), same as `gen-mesh-colliders.mjs`.
- `dae-import.mjs <in.dae> <id> [--map design/meshes/kenney/palette-map.json] [--budget | --simplify <tris>] [--scale s]` (TREES-LP-a) imports a Kenney Nature Kit Collada file as `content/meshes/<id>.mesh.json` (material diffuse colour -> palette key by Lab nearest; trees get a trunk prism proxy); shares `buildMeshFromTris` (engine/mesh/gltf.js) with the glTF importer. Test: `dae-import.test.mjs`.
- `reimport-quaternius.mjs [--dry-run] [name ...]` re-imports every `content/meshes/quaternius/*` mesh that is above its budget from `design/meshes/quaternius/glTF/`, keeping its `mats`, and prints a before/after triangle table.
  - `reimport-quaternius.mjs --uvmap [names...]` re-imports with `--uvmap auto` (default names = the quaternius meshes placed in world_m1), per-key triangle table + ms per mesh.
- `gen-mesh-colliders.mjs [paths] [--check]` (re)writes `collider` / `collide:false` on mesh json (idempotent); `--check` fails if anything would change (CI).

### Unity character export (CHAR-IMPORT-01)

For models that only exist as Unity assets (FBX + mask shaders, e.g. Synty POLYGON modular characters). Static only: the engine has no skinned animation, so a character is exported in its current pose.

1. Copy `tools/unity/KestrelGltfExport.cs` into `<UnityProject>/Assets/Editor/`.
2. In a scene, assemble the character (modular packs: only the wanted parts active; Play mode in a randomiser demo works too), select its root, then **Tools > Kestrel > Export character glTF**. First use asks for the output folder (use `design/local/<pack>/`, git-ignored). Output: `character.gltf` + `.bin` + the colour atlas png + `report.json` (parts, tris, materials). Models taller than 10 units are treated as cm (node scale 0.01).
3. Write a palette map for the atlas (`design/local/<pack>/palette-map.json`, same format as `design/meshes/quaternius/palette-map.json`; `maxKeys` may raise the 6-key cap) and import:
   `node tools/gltf-import.mjs design/local/<pack>/character.gltf <pack>/<Name> --uvmap auto --palette-map design/local/<pack>/palette-map.json --out content/local/meshes/<pack>/<Name>.mesh.json`
4. Licence-restricted assets stay local: list the mesh in `content/local/manifest.json` (a normal manifest, `"files": ["meshes/<pack>/<Name>.mesh.json"]`) and place it in `content/local/placements.json` (`{"world": "world_m1", "structures": [{"id", "mesh", "origin": {x,y,z}, "yawDeg"}]}`). `game/js/localOverlay.js` merges both at boot on that PC only (`?nolocal=1` and `?gpucompare` skip it). Assets whose licence allows redistribution go into `content/meshes/` + `content/manifest.json` instead.
5. Any new palette material needs a v1 record in `design/palette.js` AND a v2 record + `remap` entry in `design/detail-pass.js`; a missing v2 record switches the whole GPU cell pipeline off (console: `GpuCellPipeline inactive (missingV2: ...)`, F3 `path: cpu`).
