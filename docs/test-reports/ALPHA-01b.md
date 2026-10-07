# ALPHA-01b test report (B2, 2026-10-07)

JS side only (D-044). GPU upload/discard folded into WG-2b/WG-3.

- Files: engine/render/MaskAtlas.js (+test), engine/mesh/rasterMask.test.js, assets.js, engine.js, DrawList.js, rasterJS.js, compositor.js.
- MaskAtlas.test.js 22/22; rasterMask.test.js 20/20: masked 2 m quad with 4x4 checker == brute-force oracle at 400x150 (kind/planeId/depth, 0 mismatches), back view flips normals, opaque ranges unchanged, shadow twin zbuf == colour zbuf, 0 extra alloc over 1000 frames.
- Fix this session: buildMaskAtlas tolerates stub registries without `keys` (scatterInstances/scatterMesh tests failed in loadWorld).
- run-tests: 280 PASS, 0 FAIL, 1 WARN (typecheck, pre-existing). check-deps OK. validate-content OK.
- gpucompare webgl2 headless vs same-machine `git archive HEAD` baseline: 140 -> 140 passing rows, 0 PASS->FAIL.
- Open: GPU twin (mask texture upload, discard in mesh.frag/shadow.frag) not done; masked meshes stay excluded from instanced groups.
