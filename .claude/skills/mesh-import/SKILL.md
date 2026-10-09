---
name: mesh-import
description: Importing or re-importing glTF meshes (Quaternius etc.) into kestrel content - gltf-import flags, triangle budgets, collision data, canonical json, look check. Use when adding, simplifying or replacing a mesh in content/meshes/.
---

# Mesh import

Sources: `design/meshes/quaternius/glTF/` (Kenney DAE: `design/meshes/kenney/dae/`, see architecture 37.15). Output: a PAIR `content/meshes/<pack>/<Name>.mesh.json` (small meta: ranges, mats, bbox, flags, `bin`, `colliderB64` collision proxy) + `<Name>.mesh.bin` (KMSH streams, `docs/mesh-bin.md`, `engine/mesh/meshBin.js`). Never hand-edit the meta arrays or the bin. `gltf-import --json` writes the legacy all-JSON file (still loads). Tools read meshes through `tools/mesh-file.mjs` (`readMeshJSON`), tests through `engine/test/meshFile.test.js`; `node tools/mesh-to-bin.mjs` converts legacy json to the pair; `gen-mesh-colliders --check` compares both files. Tool docs: `tools/README.md`.

## Steps
1. Import: `node tools/gltf-import.mjs <src.gltf> ... --budget` (target = `budgetFor(id)` from `tools/mesh-budgets.mjs`: trees 2000, rocks 400, path stones 250, mushrooms 250, pebbles 80, grass 60) or `--simplify <tris>`. `--budget`/`--simplify` are tool/report options (37.19 MESH-FULL), not the default: a plain import keeps the source triangle count. Simplifier: `engine/mesh/simplify.js` (quadric edge collapse; tests `engine/mesh/simplify.test.js`).
2. Re-import a whole pack to budget, keeping existing `mats`: `node tools/reimport-quaternius.mjs [--dry-run] [names...]`.
3. Collision: import applies `withCollision` (prism `collider` or `collide:false` walk-over). Check: `node tools/gen-mesh-colliders.mjs --check` (0 would change). Rules: skill `engine-physics-colliders`.
4. Format: meshes listed in `content/manifest.json` must be `stringifyContent` canonical (the tools do this); `node tools/content-canonical.test.mjs`, `node tools/validate-content.mjs`.
5. Look: headless capture at `game/index.html?pose=roadSouth` before (clean worktree `../game_project_test`) vs after; captures go to `docs/test-reports/captures/` (git-ignored). Owner look for anything visible.
6. Bench stays green: `node tools/bench-mesh-collide.mjs` (<= 1.5 us/call).

Alpha masks are OPT-IN until ALPHA-01c is wired: `gltf-import.mjs ... --masks content/masks` writes masked ranges + `.mask.json`; without `--masks` the import ignores alpha (old output).

Per-triangle palette keys from the colour texture (MESH-UVMAP-01): `node tools/reimport-quaternius.mjs --uvmap [names]` or `gltf-import.mjs --uvmap auto --budget`; table `design/meshes/quaternius/palette-map.json` (texture -> keys + reference colours; keys must exist in design/palette.js).
Baked vertex AO (ME-20a, opt-in, default off): `gltf-import.mjs --ao [rays]` writes per-vertex AO (1 = open) into aux[5..7] of each triangle (`tools/vertex-ao.mjs`); nothing renders it until ME-20b.
Crease angle (S8-B2-15, opt-in, default off = today's hardcoded 5 deg): `gltf-import.mjs --crease <deg>` welds vertices and averages normals across a shared edge below `<deg>` instead of 5 (triangle count unchanged, only how smoothing groups split).
Budget report (S8-B2-02): `node tools/validate-mesh.mjs [dir|file ...] [--max-tris 20000 --max-ranges 8 --max-bytes 1048576] [--strict]` prints tris/per-id budget (mesh-budgets.mjs)/ranges/bytes/collider kind/open-edge % per mesh; report-only (exit 0, warnings), `--strict` exits 1 over a global cap.

Kenney Collada (.dae): `node tools/dae-import.mjs design/meshes/kenney/dae/<name>.dae kenney/<name> --budget` (colour -> key table `design/meshes/kenney/palette-map.json`, importer `scale`; trees budget 600 tris, trunk prism collider; test `tools/dae-import.test.mjs`). Trunk-aware collision lives in the shared plan: json `colliderParts` (material keys, set by dae-import for trees) limits the prism to those ranges in `withCollision`/`planMeshCollision`, so gen-mesh-colliders keeps it.
