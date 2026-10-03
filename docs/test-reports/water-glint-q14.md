# 36.1b - water glints and surface motion (2026-10-03)

Status: arch-review. Q14 item 9, isolated from the pending 36.1c shoreline/depth implementation.

The water background now uses the un-glinted colour. Foreground glints use glintP (default 0.04), with a rotated 0.25m brick lattice, CPU-folded drift and staggered re-roll phases. Both render twins use the same expression order. JS rounds the lattice arithmetic to shader float precision before floor/hash decisions; the regression covers a real-world lattice boundary where sub-f32 position offsets previously changed glyphs. No tolerance or pose changes.

The shared slot stride is 56 floats. New look keys validate and pack at load; shape/shore fields are reserved for item 10, without activating its rendering behavior. The GPU checks the fragment uniform budget before linking. Pond and murky fixtures exercise the actual designer look table in both twins. No per-frame allocations, runtime libraries or main.js changes.

Verification after merging PC-A particle polish 7d66e6d: 202/202 suites PASS, no FAIL/TIMEOUT/WARN; check-deps OK (365 files, 1280 existing warnings). Five filtered water suites PASS. Composite checks 40/40 PASS, including the 300-frame heap gate under --expose-gc, foreground-only glints, fine lattice coverage, isolated drift, long-clock folding, staggered re-rolls and invalid look data.

Real GPU: ANGLE / NVIDIA RTX 4060 / D3D11. Full mesh gpucompare at 160x60, own no-cache server port 9568: 66 poses; all seven water poses PASS. Same four earlier non-water FAIL rows: voxel half occluded stair edge, rtsHill60, cloth, held sword PITCHED pitch20. No new FAIL rows. The initial water-only capture also passes all seven poses; its standard harness server was replaced by the required no-cache server for the final full check. Only the browsers/servers created for these checks were stopped; generated captures removed.

The earlier atlas boot blocker and test failures in this report are resolved by the separately pushed verification fixes. Owner water appearance review remains for PC-A; no PO verdict is claimed here. Shoreline/depth tint and pond bowl evidence belong to item 10.
