---
name: mesh-import
description: Importing or re-importing glTF meshes (Quaternius etc.) into kestrel content - gltf-import flags, triangle budgets, collision data, canonical json, look check. Use when adding, simplifying or replacing a mesh in content/meshes/.
---

# Mesh import

Sources: `design/meshes/quaternius/glTF/` (Kenney DAE: `design/meshes/kenney/dae/`, see architecture 37.15). Output: `content/meshes/<pack>/<Name>.mesh.json`. Tool docs: `tools/README.md`.

## Steps
1. Import: `node tools/gltf-import.mjs <src.gltf> ... --budget` (target = `budgetFor(id)` from `tools/mesh-budgets.mjs`: trees 2000, rocks 400, path stones 250, mushrooms 250, pebbles 80, grass 60) or `--simplify <tris>`. Simplifier: `engine/mesh/simplify.js` (quadric edge collapse; tests `engine/mesh/simplify.test.js`).
2. Re-import a whole pack to budget, keeping existing `mats`: `node tools/reimport-quaternius.mjs [--dry-run] [names...]`.
3. Collision: import applies `withCollision` (prism `collider` or `collide:false` walk-over). Check: `node tools/gen-mesh-colliders.mjs --check` (0 would change). Rules: skill `engine-physics-colliders`.
4. Format: meshes listed in `content/manifest.json` must be `stringifyContent` canonical (the tools do this); `node tools/content-canonical.test.mjs`, `node tools/validate-content.mjs`.
5. Look: headless capture at `game/index.html?pose=roadSouth` before (clean worktree `../game_project_test`) vs after; captures go to `docs/test-reports/captures/` (git-ignored). Owner look for anything visible.
6. Bench stays green: `node tools/bench-mesh-collide.mjs` (<= 1.5 us/call).

Open next: MESH-UVMAP-01 (per-triangle palette keys from the colour texture, `--uvmap`).
