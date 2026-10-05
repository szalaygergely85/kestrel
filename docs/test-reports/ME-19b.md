# ME-19b implementation handoff — 2026-10-05

Status: **arch-review**. Implements architecture.md 37.13.2 with the 37.13.5 boundary amendment. PC-A review remains required.

## Change

Removed the CPU sector/terrain/voxel casters and OpenSpans, their public/dev exports, compositor fallback branches, obsolete caster-only tests, and caster benchmarks. Every CPU/editor frame now uses the existing mesh raster twin. Moved sky/ambient code to `sky.js` (including the unchanged shear branch), terrain cell shading to `terrainShade.js`, sun lookup to `lighting.js`, and terrain bounds/near-LOD helpers to `Terrain.js`. Removed span bindings from engine, game, editor, and surviving test frame buffers.

Voxel validation now uses the existing 256-axis / 2,097,152-cell mesh limits for all models; `meshOnly` remains accepted for compatibility. Per 37.13.5, VoxelTextures, voxelPool atlas state, MAX_VOX_STEPS/MAX_VOX_INSTANCES, WorldTextures, and frozen GPU programs remain for ME-19c/ME-15e. `ddaConstants.js` contains the verbatim caster constants and is imported only by the two frozen shaders. Three SHA-256 assertions prove the retained dda/terrain/voxel shader source strings are unchanged from ME-19a.

Eight surviving oracle suites use frozen pre-deletion fixtures: **53 frames + 117 rays, 357,550 encoded file bytes**, recording depth and G-buffer typed-array bytes, including Infinity and packed-normal alias bits. Fixture replacement requires ARCH OK; no regeneration command is committed. The bearClose FNV remains `3bdbc98a`.

## Validation

- Full working tree: **223/223 suites PASS**, zero FAIL/TIMEOUT/WARN. Isolated prospective commit: **222/222 PASS**, zero FAIL/TIMEOUT/WARN. Both include typecheck and content validation.
- `check-deps OK`: working tree 394 files, 1,305 advisory coordinate warnings; isolated 393 files. No rule relaxation.
- Eight migrated suites: **472 checks PASS** with `--expose-gc`; sky **57 PASS** covering pitched GLSL cell direction, shear, finite-depth guard, ambient light, depth clearing and public exports; GLSL **133 PASS**, including three frozen-source hashes.
- Clean real-GPU mesh comparison: **71 rows byte-identical** to published a24ab04 (ME-19a plus the subsequently published sword correction). Seven known precision FAIL rows remain identical; no prior-PASS regression, no changed thresholds.
- Mesh route: **10/10 legs, end trigger reached**, 1,836 frames; 485 trees and 17,014 detail placements. No physics changes.
- Six real browser boot/R-restart cases PASS: plain URL, ignored renderer=dda/junk flags, gpu=0 combinations, and Canvas2D. All resolve mesh; CPU geometry contains 8,236 finite-depth cells; six decals remain. No runtime errors. No DDA rendering checks were run.
- Retained shadow CPU benchmark, 600 measured frames per pose: all five poses PASS at existing 0.15 ms p95 / 64 B per frame limits; worst p95 0.0089 ms, worst measured heap 26.5 B per frame. Moved into `tools/bench-shadow.mjs` without algorithm/budget changes.
- Retargeted `compare-detail-export.mjs` to the mesh twin: existing export PASS at unchanged 95/95/95 same-surface thresholds.
- Owned GPU capture JSON/PNG removed after recording results. Temporary pre-deletion oracle tree moved outside the repository to `C:/MyFiles/CodingProjects/kestrel-me19b-oracle`; it is excluded from the commit. Unrelated local Ruins/render/content changes remain uncommitted.

## Scope adjustments for review

The retained shadow benchmark required replacing the two removed benchmark allowlist entries in check-deps. Two surviving tools (`gpucompare=shade` and detail-export comparison) needed a mesh frame source after their caster imports disappeared; no frozen GPU program changed. Span fields also had to be removed from four surviving rendering suites and dev harnesses beyond the enumerated oracle suites. The meshStructures rendering suite previously asserted that the CPU caster ignored mesh placements; it now asserts retained level geometry, plus identical cell output/counts with the mesh placed before or after the level (20 checks). Visible kind-9 raster geometry remains covered by meshKind9.render.test.js.

Caster-only ray, face/upload/image and caster allocation checks were removed with the deleted implementations. Useful rest/rotated/clipped/scaled mesh probes retain their existing 98/99 percent and heap budgets. The compositor's exact translated-shade equality became repeat-frame determinism (translated geometry/depth checks remain); obsolete caster cull statistics became the existing eight-item mesh feed-cap check. Its outside-footprint oracle comparison now tests frozen west-wall cells rather than unrelated floor/top raster cells, preserving the intended wall-visibility test. These test changes are called out for PC-A rather than changing the renderer to reproduce obsolete caster shading/coverage.

ME-19c remains blocked on PC-A ME-15e; ME-19e remains blocked on ME-16. Next ready queue item is TORCH-01a; PROP-COLLIDE-01b0 is also unblocked by 37.10's sprite amendment.
