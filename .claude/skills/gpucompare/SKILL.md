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
- D-039: a NEW pose failing only on JS/GPU precision may merge as a recorded known-FAIL; no previously passing row may regress; never widen thresholds.
- Shader (GLSL) changes need the architect: PC-B writes `ASK ARCHITECT:` / `NEEDS PC-A:` with the exact change.
- Debug Node-first (probe both twins' math, e.g. `octNormal.js` pack/unpack), then one headless run to confirm.

Known open (2026-10-07): MESH-GPUCMP-01 A6 smooth normals are in; 19 rows still fail vs the pre-road run on kind-9 cell colour/glyph (not normals) - see the backlog row. Failure counts differ per GPU: compare against a baseline from the same machine.
