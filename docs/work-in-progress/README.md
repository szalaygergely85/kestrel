# ME-14c3 preserved proposal

This branch preserves unfinished work without activating it in the renderer.

- `ME-14c3.patch.gz`: complete binary Git patch against a1b6a86, including the two CC0 Ruins meshes and import maps.
- `ME-14c3-gpu-findings.json`: exact master-versus-candidate findings, including the existing parapetSky regression.
- `../test-reports/ME-14c3-preserved.md`: validation, blocker and recommended decision.

Decompress the archive to a patch and apply with `git apply --3way` only in an isolated checkout after the PC-A decision. Later tower collider changes may require a small collider-order fixture integration. Neither this branch nor the archive claims completed renderer approval.
