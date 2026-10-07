---
name: engine-physics-colliders
description: How kestrel's mesh physics colliders are built and tested (world collider list, merged mesh BVH, collision proxies, walk-over pieces, benches, route walk). Use for any physics/collider/mesh-collision story or bug (tunnelling, falling through, stuck inside props, collision cost).
---

# Engine physics: colliders

Rules: `engine/physics/` imports only from itself; engine never imports `game/`/`design/`. Physics work is engine work -> ends in `arch-review`. Hot paths are 0-alloc.

## Where things are
- `engine/physics/meshCollide.js` - `moveCircleMesh`, `probeSupport`, `moveSphereMesh`, `raycastColliders` over a `MeshCollider[]` (`{id, kind:'trimesh', bvh, min, max, enabled, parts?}`); `bvh.js` builds/queries the BVHs.
- `engine/world/colliders.js` `buildWorldColliders(world)` - the list used in `physicsMode: 'mesh'`:
  - grid structures: one base collider per structure + one dyn collider per legend tag (`refitDynCollider`, sentinel refit, no rebuild);
  - **`meshes:static`**: ALL placed mesh structures merged into one BVH, built once (MESH-PHYS-01). Uses the mesh json `collider` proxy if present, skips `collide:false` meshes/placements, else falls back to render tris (warns once if > 64 tris);
  - `props:static` (`buildPropCollider`), `scatter:trunks`, `scatter:detail`.
- `engine/mesh/colliderProxy.js` - `buildPrismProxy` (closed vertical prism, convex hull of the bottom `PROXY_BAND_H` = 2 m, <= 8 sides, 28 tris) and `planMeshCollision` (walk-over if top <= `WALK_OVER_H` 0.3 m or name matches `SOFT_NAME_RE` Pebble/Grass/Mushroom). Step-up max is 0.45 m.
- New/changed mesh json: `node tools/gen-mesh-colliders.mjs [paths]` writes `collider`/`collide:false` (idempotent, keeps the file's format; `--check` for CI). `tools/gltf-import.mjs` applies the same (`withCollision`) on import.

## Test / measure
- Unit: `node engine/world/meshProxy.test.js`, `engine/world/meshColliders.test.js`, `engine/world/colliders.test.js`, `engine/physics/meshCollide.test.js` (+ `.parity`), `physics.test.js`, `jump.test.js`.
- Tunnelling pattern (BUG-GONDOLA-FALL style): drop a capsule from 4-5 m at -14..-18 m/s onto the collider at many x/y offsets and yaws; assert grounded, never inside the shape, never below floor z.
- Bench: `node tools/bench-mesh-collide.mjs` (29 road meshes; target collideCircle <= 1.5 us/call; was 3.5 -> 0.5).
- Step cost: `node tools/bench-physics.mjs [--steps N] [--hash]` (one fixed sim step per part, p50/p95 us; `--hash` = bit-exact player-trace fingerprint per scenario, compare before/after a physics change; MESH-PHYS-02).
- Route: `node tools/route-walk.mjs` (Node twin, grid vs mesh; must show `endTrigger:true` both) and `node tools/route-walk-browser.mjs --port 95xx` before pushing `game/js/main.js` changes. Known pre-existing quirk: `jump mesh run peak 0` at the wake spot.
- Baseline comparisons: the clean worktree `../game_project_test` (`git checkout --detach <commit>` there), never stash/reset in the main repo.

Detail: docs/architecture.md (search `meshCollide`, `MESH-PHYS`, `PROP-COLLIDE`, 37.10).
