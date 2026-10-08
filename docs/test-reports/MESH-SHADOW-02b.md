# MESH-SHADOW-02b - shadow caster budget rework (2026-10-08)

Change: nearest-4 cap removed. Placed kind-9 mesh budget now lives in the shadow options (`engine/render/shadowSun.js`): `meshCastM` (eye cut in m, 0 = budget OFF = default = whole sun box, nearest-64 pick, bit-identical to today; clamp 0..2000) and `meshCastCap` (safety cap, default `MAX_MESH_DRAWS` 64, clamp 0..64). `buildShadowList` reads `src.meshCastM/meshCastCap` (set by compositor, GpuCellPipeline and WgShadowPass from the resolved options); the module global `meshShadowBudget` is gone. Dev override: `?shadowcast=<m>` in game/js/main.js. With the budget on, every prop inside the cut is kept (near props never dropped); the cap only bites beyond 64.

Numbers at `?pose=roadSouth` (real GPU, webgl2, shadow caster list size after sun cull; CDP scratch script, tris = sum of rangeCount x instCount):
- budget off (default): 118 items, 319,254 tris
- `meshCastM=25`: 81 items, 187,704 tris (-41 %)
Screenshots (git-ignored): docs/test-reports/captures/MESH-SHADOW-02b-roadSouth-before-off.png, ...-after-cut25.png

Tests: shadowList.test.js (cut, all casters inside cut kept, cap only beyond cap, defaults off, options clamp), meshGroups.test.js section 5. `node tools/run-tests.mjs` 299 PASS / 0 WARN; check-deps OK; validate-content OK; gpucompare webgpu and webgl2 both 140 PASS / 6 FAIL (same 6 world_m1 baseline rows).

Not done: boar shadow distance headless check (voxel feed has no cut; not reproduced in Node). ALPHA-01b ARCH CHANGES are noted in the ALPHA-01b row.
