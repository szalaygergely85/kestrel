---
name: gpucompare
description: Run and read kestrel's ?gpucompare=1 gate (GPU pipeline vs JS twin parity) headless, compare against a baseline, and apply D-039. Use after any render/GPU/shader/mesh-draw change, before merging render work, or when investigating JS-vs-GPU mismatches.
---

# gpucompare (GPU vs JS twin)

- Run headless (own server + browser, cleans up after itself, ~50 s on an idle GPU):
  `node tools/capture-browser.mjs --mode gpucompare --backend webgpu --timeout-ms 600000 --port <95xx PC-B / 90xx PC-A> [--grid 240x90] [--shadows map|dda] > <log> 2>&1`
  `--backend webgpu` (the default and only backend since WG-5b; `--backend webgl2` errors); default timeout 120 s is too short (a loaded machine took 15 min and timed out). ONE gpucompare at a time per machine: parallel agent browser runs make it time out (seen 2026-10-09). Save the full output to a log and grep it for FAIL (tail alone hides early FAIL lines). Writes `docs/test-reports/captures/<date>-<sha>-gpucompare-<grid>.json` (git-ignored).
- Compare with a prior run: add `--diff <old.json>` (per-row changes). Baseline: run the same command in the clean worktree `../game_project_test` at the base commit.
- Rows = poses (e.g. `breach`, `roadSouth`); metrics per row: `cmpGeom` (kind match, depth/uv viol, `faceViol`, `nrmViol`, `nrmMaxDeg`), `cmpLight` (`dLMax`, `dLViol` - the gate, `nMismatch`, `sunlitMismatch`), `cmpCells` (`fgMax`, `fgOutside`).
- Twins: JS = `engine/render/rasterJS.js` + `engine/render/detailShade.js`; GPU = `engine/render/gpu/wg/WgCellPipeline.js` + the WGSL modules in `engine/render/gpu/wg/` (WebGL2 and GLSL were removed in WG-5b). Kinds: 8 = level mesh, 9 = placed mesh (`KIND_MESH`).
- Baseline (S8-B1-13): add `--baseline docs/test-reports/gpucompare-baseline-<backend>-<gpu>.json`. Missing file = written (row -> PASS/FAIL + backend/adapter/sha); present = prints only PASS->FAIL, FAIL->PASS, new/missing rows, exit 1 on any PASS->FAIL or backend/adapter mismatch. A FAIL row in the baseline is the recorded known-FAIL (D-039/D-045/D-048). Committed: `-webgpu-rtx4060` (152/2) (the webgl2 baseline was deleted with WG-5b); helper `tools/gpucompare-baseline.mjs`.
- One baseline file per machine (adapter string is checked); regenerate after a GPU driver update. Desktop PC: `docs/test-reports/gpucompare-baseline-webgpu-rtx4060.json`; laptop: the Intel one (`-webgpu-intel`). PC-A Arc: `-webgpu-arc` (153/1, tip 8fa0c57+).
- D-039: a NEW row that fails only on JS/GPU precision is a recorded known-FAIL and may merge; no previously passing row may regress; never widen thresholds.
- Shader (WGSL) changes need the architect: PC-B writes `ASK ARCHITECT:` / `NEEDS PC-A:` with the exact change.
- Debug Node-first (probe both twins' math, e.g. `octNormal.js` pack/unpack), then one headless run to confirm.

Known open (2026-10-07): A6/A7 smooth-normal and edge fixes plus PREC-04 tie masking are in. PREC-04b (PC-A) owns remaining tie caps/colour outliers. D-045 full-detail baselines are in docs/test-reports/MESH-FULL-01.md. Counts differ by GPU: compare the same-machine branch baseline, never widen thresholds. WG-2 is not a complete scene pipeline yet; WebGPU timer numbers currently measure present only.
