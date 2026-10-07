# MESH-GPUCMP-01 - kind-9 GPU-vs-JS light mismatch (investigation)

Date 2026-10-07, PC-B, commit 7f2b3ff. No code changed.

## Cause
`engine/render/gpu/glsl/mesh.frag.js` has no kind-9 (KIND_MESH) branch. Only `vKind == KIND_MODEL` (8) gets a face/normal rule. The JS twin (`engine/mesh/rasterJS.js` ~l.421-424) does, for kind 9:

- interpolates the per-vertex (smooth) normal barycentrically and normalises it;
- `face = max(|n|) >= 0.9 ? roundedFace(n_world) : FACE_PACKED`;
- writes the packed normal to `aoD` bits (`nrm`), AO = Infinity.

The GPU does this for kind 9:

- `face = vFace`, the face baked at import (`gltf.js dominantFace` of the flat triangle normal in MESH-LOCAL space, not rotated by the placement yaw, and not the smooth normal);
- `nrmBits = 0` (GI.z = 0), `GA.w = floatBitsToUint(aoD)` = bits of 1e30;
- `vNrmW` is declared `flat` (provoking-vertex normal, unused for kind 9 anyway).

For a baked-face-7 triangle (any tilted rock/pebble facet) light.frag l.268 then does `unpackNormalOct(GA.w)` on the bits of 1e30. Node probe (`octNormal.js`): that decodes to N = (0.993, -0.116, -0.013), and GI.z = 0 decodes to (0, 0, -1). Real normals are mostly up-ish, so the angle to the JS normal is up to ~125 deg. That is the `nrmMaxDeg` 115-130 in gpucompare. Axis-face triangles use `faceNormal(vFace)`, which is right only when the placement yaw is a multiple of 90 deg, and the per-triangle rule differs from JS near the 0.9 threshold (yaw-rotated, smoothed). That is the `faceViol` (breach: 33 cells, sample cpu 2 / gpu 4).

The old Ruins meshes passed because they are flat-normal, yaw-0 and axis-faced (ME-14c3 A4 "flat only"). The Quaternius meshes are smooth-normal, curved and yawed, so they hit both gaps. The shade side has the same gap: `shade.frag.js` l.505 forces aoD = 1e30 only for `kind == KIND_MODEL && face == FACE_PACKED`, while JS (`detailShade.js` l.642) does it for KIND_MODEL and KIND_MESH.

Not the cause: no mirrored transform or winding issue (mesh is not two-sided, `flipN` false in JS); AO (JS Infinity = GPU 1e30); `faceK`; shadow bias (the failing metric is `dLViol`/`dLMax` on cells where sunlit and sunN already agree).

## Evidence (one headless gpucompare, port 9561, grid default, 49 s)
Run: `node tools/capture-browser.mjs --mode gpucompare --port 9561`; capture `docs/test-reports/captures/2026-10-07-7f2b3ff-gpucompare-grid.json`. 33 of 138 rows FAIL now (backlog said 29 vs 4 baseline; the extra rows are the ones that see the road too). Row `breach`:

- `cmpGeom` kind 100 %, depth/uv 0 violations, but `faceViol` 33, `nrmViol` 11, `nrmMaxDeg` 124.5;
- `cmpLight` `dLMax` 0.337, `dLViol` 57 (fails the gate, thresholds 1e-3), `nMismatch` 22 of 4603 (0.48 %), `sunlitMismatch` 17;
- `cmpCells` fgMax 57, fgOutside 143 cells.

The sunlit/sunN mismatches follow from the wrong normal (the sun term depends on N.L and normal-offset); they vanish with the same normal.

## Proposed fix - ASK ARCHITECT (shader change, not applied)
`mesh.frag.js` / `mesh.vert.js` / `shade.frag.js`, a literal GLSL port of the JS kind-9 rule:

1. `mesh.vert.js` (static, non-cloth variant): add a smooth `out vec3 vNrmS = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));` next to the flat `vNrmW` (same as the cloth variant already does; perspective-correct interpolation = JS `invq` weighting). Keep `vNrmW` for kind 8.
2. `mesh.frag.js`: add `const uint KIND_MESH = 9u;` and in `main`:
   ```glsl
   if (vKind == KIND_MESH) {
     vec3 n = normalize(vNrmS);                       // no flip, mesh is single-sided
     float m = max(abs(n.x), max(abs(n.y), abs(n.z)));
     if (m >= 0.9) face = roundedFace(n);             // else FACE_PACKED
     else { face = uint(FACE_PACKED); nrmBits = packNormalOct(n); gaW = nrmBits; }
   }
   ```
   (GI.z = nrmBits for both; for the axis-face case JS still writes `nrm` but compareGeometry only reads it for face 7.)
3. `shade.frag.js` l.505: `(kindU == KIND_MODEL || kindU == KIND_MESH) && face == FACE_PACKED`.
4. A `glsl.test.js` string-twin assertion for the roundedFace/threshold lines, and a Node twin test fixing yaw 33 deg + a smooth tilted triangle (JS raster result vs the GLSL formulas in JS).
Expected: `faceViol`, `nrmViol`, `dLViol` back to 0 on kind-9 cells; failing rows back to the 4 baseline. Verify with one `capture-browser.mjs --mode gpucompare --diff <this capture>` run.

Cannot be fixed in JS/mesh data only: making the JS twin emulate the GPU (baked local face, no smooth normal) would degrade the oracle and the look; re-baking faces per placement is not possible (face depends on the instance yaw). No thresholds changed (D-039).
