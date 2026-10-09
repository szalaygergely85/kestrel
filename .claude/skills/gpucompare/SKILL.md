---
name: gpucompare
description: Run and read kestrel's ?gpucompare=1 gate (GPU pipeline vs JS twin parity) headless, compare against a baseline, and apply D-039. Use after any render/GPU/shader/mesh-draw change, before merging render work, or when investigating JS-vs-GPU mismatches.
---

# gpucompare (GPU vs JS twin)

- Run headless (own server + browser, cleans up after itself, ~50 s):
  `node tools/capture-browser.mjs --mode gpucompare --port <95xx PC-B / 90xx PC-A> [--grid 240x90] [--shadows map|dda]`
  Writes `docs/test-reports/captures/<date>-<sha>-gpucompare-<grid>.json` (git-ignored).
- Compare with a prior run: add `--diff <old.json>` (per-row changes). Baseline: run the same command in the clean worktree `../game_project_test` at the base commit.
- Rows = poses (e.g. `breach`, `roadSouth`); metrics per row: `cmpGeom` (kind match, depth/uv viol, `faceViol`, `nrmViol`, `nrmMaxDeg`), `cmpLight` (`dLMax`, `dLViol` - the gate, `nMismatch`, `sunlitMismatch`), `cmpCells` (`fgMax`, `fgOutside`).
- Twins: JS = `engine/render/rasterJS.js` + `engine/render/detailShade.js`; GPU = `engine/render/gpu/GpuCellPipeline.js` + `engine/render/gpu/glsl/*` (`mesh.vert/frag`, `light.frag`, `shade.frag`). Kinds: 8 = level mesh, 9 = placed mesh (`KIND_MESH`).
- Baseline (S8-B1-13): add `--baseline docs/test-reports/gpucompare-baseline-<backend>-<gpu>.json`. Missing file = written (row -> PASS/FAIL + backend/adapter/sha); present = prints only PASS->FAIL, FAIL->PASS, new/missing rows, exit 1 on any PASS->FAIL or backend/adapter mismatch. A FAIL row in the baseline is the recorded known-FAIL (D-039/D-045/D-048). Committed: `-webgpu-rtx4060` (152/2), `-webgl2-rtx4060` (143/11); helper `tools/gpucompare-baseline.mjs`.
- One baseline file per machine (adapter string is checked); regenerate after a GPU driver update. PC-A Arc: `-webgpu-arc` (153/1, tip 8fa0c57+).
- D-039: a NEW pose failing only on JS/GPU precision may merge as a recorded known-FAIL; no previously passing row may regress; never widen thresholds.
- Shader (GLSL) changes need the architect: PC-B writes `ASK ARCHITECT:` / `NEEDS PC-A:` with the exact change.
- Debug Node-first (probe both twins' math, e.g. `octNormal.js` pack/unpack), then one headless run to confirm.

Known open (2026-10-07): A6/A7 smooth-normal and edge fixes plus PREC-04 tie masking are in. PREC-04b (PC-A) owns remaining tie caps/colour outliers. D-045 full-detail baselines are in docs/test-reports/MESH-FULL-01.md. Counts differ by GPU: compare the same-machine branch baseline, never widen thresholds. WG-2 is not a complete scene pipeline yet; WebGPU timer numbers currently measure present only.
