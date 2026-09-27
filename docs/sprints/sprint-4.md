# Sprint 4 (planned 2026-09-26, D-029 item 4)

Owner: Manager (scope), Product Owner (stories/acceptance). M2 core = mesh engine phases 0-2 + the walk-out running on it (roadmap, D-029).

## Goal
**Correct coordinates and the first mesh-rendered tower + terrain + props the owner can compare side by side with today's renderer.**

## Stories
| # | ID | Story | PC | Main files | Gate | Depends on |
|---|---|---|---|---|---|---|
| 1 | CO-2 | Placed-structure Frame + world-space load, `world.sun`, `entity.parent`, recipe injected by id (D-028) | PC-A | `engine/world/*`, `engine/core/transform.js` users (no `serialize.js`) | architect review (opus) -> main session | CO-1 (arch-review) |
| 2 | CO-3 | Render invariance test (tower at two origins, identical cells incl. outside poses; runs on both renderers once ME-04 lands) + sun z-shift test | PC-A | `engine/render/*.test.js`, `game/js/dev/*` poses | architect review (opus) | CO-2 |
| 3 | US-026b S1 | Terrain band double buffer (+ CO-6 chunk/cell helpers) - needed by ME-05 | PC-A | `engine/world/Terrain*`, `engine/core/transform.js` helpers | architect review | architecture.md 26 S1 |
| 4 | ME-00 | Typecheck (JSDoc/@ts-check, devDependency `typescript` only) + typed public API | PC-B | `tools/typecheck.mjs`, `tools/tsconfig.json`, `package.json`, `tools/run-tests.mjs`, `engine/core/transform.js`, `engine/index.js`, `engine/dev.js`, `engine/render/GBuffer.js` | arch-review (opus) -> PO (sonnet) | - |
| 5 | ME-01 | `MeshData` + `levelMesh.js` (grid -> quads) | PC-B | `engine/mesh/MeshData.js`, `engine/mesh/levelMesh.js` | arch-review -> PO | CO-1, ME-00 |
| 6 | ME-02 | `projection.js` shear matrix + `culling.js` | PC-B | `engine/render/projection.js`, `engine/mesh/culling.js` | arch-review -> PO | ME-00 |
| 7 | ME-03 | `rasterJS.js` + `DrawList.js` (JS oracle) | PC-B | `engine/mesh/rasterJS.js`, `engine/mesh/DrawList.js` | arch-review -> PO | ME-01, ME-02 |
| 8 | ME-03b | `GpuDevice` + `GpuDeviceGL2` + mock (no behaviour change) | PC-A (PC-B mock if asked) | `engine/render/gpu/device/*`, `engine/test/assert.js`, `tools/check-deps.mjs` | arch-review (fable, core render) -> owner-GPU `?gpucompare=1` identical | ME-00 |
| 9 | ME-04 | GPU raster pass, tower via `?renderer=mesh` | PC-A | `engine/render/gpu/glsl/mesh.*`, `MeshBuffers.js`, `GpuCellPipeline.js`, `light/shade.frag.js` | arch-review (fable) -> PO -> `?gpucompare=1` mesh poses | ME-01..03, ME-03b |
| 10 | ME-05 | `terrainMesh.js` + kind-7 JS twin | PC-B | `engine/mesh/terrainMesh.js`, `engine/mesh/rasterJS.js` | arch-review -> PO | ME-01, US-026b S1 |
| 11 | ME-06 | Terrain in the GPU raster pass + `?gpucompare=mesh` + bench | PC-A | `engine/render/gpu/glsl/terrain.vert.js`, `shade.frag.js`, gpucompare mode | arch-review -> PO -> owner-GPU gpucompare | ME-04, ME-05 |
| 12 | ME-07 | `voxelMesh.js` greedy mesher | PC-B | `engine/mesh/voxelMesh.js` | arch-review -> PO | ME-01 |
| 13 | ME-08 | Voxel meshes on the GPU + side-by-side page + phase-1 gate report | PC-A | `mesh.vert.js`, `GpuCellPipeline.js`, `game/js/dev/*` side-by-side page | arch-review -> PO -> **phase-1 gate** | ME-04, ME-07 |

Stories are larger than the usual 5-6 because phase 1 is one gated unit (D-029); ACs in `docs/backlog.md` "## Mesh engine phases 0-1". PC-B stretch (Node-only, may run ahead of the gate): **ME-09** `bvh.js`, then Queue 3 item 13 (US-073 step 1) as filler.

## Order
- **PC-B** (Queue 3 in `docs/backlog.md`): items 1-10 incl. 6b, 5b (CO-5) -> ME-00 -> ME-01 || ME-02 -> ME-03 -> ME-05 || ME-07 -> ME-09 -> (filler) item 13.
- **PC-A** (one agent at a time; **reordered 2026-09-27, owner: see the mesh tower sooner**): ME-03b -> ME-04 (ME-01..03 are on master) -> batched reviews + CO-1b -> ME-06 -> ME-08 -> gate report; CO-2 -> CO-3 -> US-026b S1 fit in between (not on the phase-1 critical path). Architect writes the per-story addendum into each ME row before PC-B reaches it.

## Freeze (D-029 item 2, until the gate)
`dda.frag`, `terrain.frag`, `voxel.frag` and their JS render twins (`sectorCaster`/`terrainCaster`/`voxelMarch` render halves): owner-visible bug fixes with a regression test only. US-070a (all steps), US-026b S5, BUG-OWN-008 part 3 (`wip/bug-own-008-part3`, not merged).

## Out of scope
- **US-051a** object physics - behind the phase-2 gate (must consume `World.contacts`, ME-11).
- **US-026b S2-S4, S6, S7** - sprint 5 (data/shade rules, feed `terrainMesh.js`); **S5** frozen/dropped.
- **US-070a** frozen; US-070b/c come with ME-15; US-071/072 re-scoped in phase 3 (ME-20, `bvh.js` rays).
- Phase 2-4 (ME-10..ME-34), glTF buildings (ME-13/14/21), deleting the old renderer (ME-19).

## Shared-file risk
- `engine/render/gpu/GpuCellPipeline.js`, `light/shade.frag.js`: PC-A only (ME-03b/04/06/08) - serialise.
- `engine/mesh/rasterJS.js`: ME-03 creates it, ME-05 adds kind 7 (PC-B, in that order).
- `engine/index.js` / `engine/dev.js`: ME-00 types them; later ME exports appended, small edits.
- `tools/run-tests.mjs`, `tools/check-deps.mjs`: ME-00 (typecheck suite) then ME-03b (device rule) - never in parallel.

## Gate = phase-1 owner check (details: `### Mesh phase-1 gate` in docs/backlog.md; architecture.md 27.11)
Owner, on the ME-08 side-by-side page (Chrome, Intel GPU):
- look + speed side by side at **240x90 / 320x120 / 400x150** on the 6 poses (crash room, stairs, brazier, breach, hillside outside, waystone) - "same or better", no new shimmer;
- **tower from outside at 20-150 m**: right shape, **meets the ground, no seams**, no grass through the base;
- `?bench=1` **GPU p95 <= 4 ms at 400x150** (architect line: <= 3.38 ms at 400x150, <= 1.8 ms at 240x90), JS <= 8 ms, `over25 == 0` on the 60 s walk;
- main session: `?gpucompare=1` mesh poses PASS, `?gpucompare=mesh` kind >= 98 % / glyph >= 97 % with differences explained, all Node suites + check-deps + typecheck green.
**Go** -> sprint 5 = phase 2 (ME-09..12) + US-026b S2+. **No-go** -> mesh parked as experiment, freeze lifts, manager decides on a second attempt.

## Review
(PO fills in at sprint end: done / not done / bugs, "missing to be playable", owner walk-test request.)
