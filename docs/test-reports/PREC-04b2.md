# PREC-04b2 — texel oracle and AO precision bound (PC-B, 2026-10-07)

Implemented architecture 37.1 A9 items 4–6 and the exact A5 AO bound. This is comparison-harness code only; runtime shading, GLSL, poses and existing colour/geometry/light thresholds are unchanged.

Eligible non-pitched cells have equal kind, planeId, material and face, a v2 material, kind outside 0/7/8, and UV deltas within the existing tolerance. The oracle runs `shadeDetailFast` twice with JS depth, derivatives and light: original UVs, then GPU UVs. `finally` restores the original UVs even if the second shade throws. Glyph differences or a foreground/background channel delta above 4 become reported texel ties. The single exclusion mask combines coverage ties, excused rule flips and texel ties; colour results report each class separately. The texel cap is `max(16, ceil(0.005 * nonSky))`; both strict and fallback gates enforce it.

For equal planeIds, AO uses `max(1e-3 * max(1, abs(ca)), uvTol)`. Different planeIds retain the old AO bound.

Focused Node validation: `node engine/render/gpu/gpuCompare.test.js` **79 PASS, 0 FAIL**. It covers an actual stone-course crossing with dv 0.0001, wrong GPU colour with identical UVs, restoration on success and an oracle exception, eligibility exclusions, pitched/kind exclusions, 16 ties accepted/17 rejected, the ceil/nonSky denominator, failed-cap colour rejection, and all three specified A5 AO cases.

Chrome 154 / RTX 4060 same-machine browser comparison: 138 PASS / 6 known FAIL, versus b1's 137/7 and the pre-b1 8dd-equivalent branch's 124/20. Zero previously passing rows regressed. The only b1-to-b2 row status change is waterfall front FAIL → PASS.

| Row | Result | Geometry violations | AO violations | Texel ties / cap | Foreground max difference | Glyph match |
|---|---|---:|---:|---:|---:|---:|
| waterfall front | PASS | 0 | 0 | 10 / 38 | 1 | 100% |
| outsideNear | PASS | 0 | 0 | 2 / 24 | 10 | 99.9722% |

All 15 D-045 full-detail exception rows now PASS. The historical MESH-FULL report and backlog row record the end of that precision exception. The remaining six failures are crash room, lamp empty, voxel half occluded, view-model pitch 20, handsSwapped and forestWalk; they already failed before b2. Captures were copied to ignored scratch baselines for the following WG gate and removed from the capture directory.

Final validation in an isolated PC-B checkout containing this step: **264/264 suites PASS**, `check-deps OK` (464 files, 1,309 existing warnings), content validation 3,233 checks. The separate in-progress WG-2b edits were excluded from this shipment check.
