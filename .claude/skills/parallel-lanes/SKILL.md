---
name: parallel-lanes
description: The three parallel work lanes (B1 + B2 Claude on PC-B, C = Codex clone) with file ownership, branches, ports, merge order and gates; PC-A only reviews, plans, gates and merges. Use when starting a lane item, merging lanes, or deciding who may edit a hot file.
---

# Parallel lanes (owner 2026-10-07)

| Lane | Agent / place | Branch | Queue file | Ports |
|---|---|---|---|---|
| **B1** spine | Claude, PC-B clones `../kestrel-1` (main.js) + `../kestrel-2` (GPU) | `pc-b` | `docs/lanes/pc-b1.md` | 9500-9649 |
| **B2** shaders | Claude, PC-B clones `../kestrel-3` + `../kestrel-4` | `pc-b2` | `docs/lanes/pc-b2.md` | 9650-9799 |
| **C** content/tools | Codex, own clone `../kestrel_c` | `pc-c` | `docs/lanes/pc-c.md` (+ `AGENTS.md`) | 9800-9999 |
| **A** | Claude, PC-A | `pc-a` | reviews, plans, gates, merges | 9000-9499 |

Setup once: PC-B clones per skill `pc-b-5x` (2026-10-09; the old `../game_project_b2` worktree is retired); `git clone https://github.com/szalaygergely85/kestrel ../kestrel_c && git switch -c pc-c origin/pc-a` (C).

## Ownership (one writer per file)
- **B1:** `engine/render/gpu/wg/**`, `GpuDeviceWebGPU.js`, `createRenderer.js`, `RenderTargetWebGPU.js`, `game/js/main.js`, `tools/capture-browser.mjs`, `engine/render/gpu/gpuCompare.js`, WG rows in `docs/backlog.md`.
- **B2:** NEW files under `engine/render/gpu/wgsl/` (one module per pass, `*.wgsl.js` + tests), `engine/mesh/**` (MESH-INST-01, MESH-SHADOW-02 JS side). Never `wg/*.js`, `main.js`, `backlog.md`, `capture-browser.mjs`. B1 plugs finished modules in.
- **C:** `design/**` (not `palette.js` without asking), `content/**`, `tools/editor/**`, `docs/licences.md`, UI text. Never `main.js`, `engine/render/**`, `backlog.md`. Needs a `main.js` or engine change -> write `NEEDS B1:` in its lane file.
- **A (PC-A):** `docs/backlog.md` (folds lane status in), `docs/architecture.md`, `docs/decisions.md`, `.claude/**`, `CLAUDE.md`.
- Status goes in the lane's OWN file (`docs/lanes/<lane>.md`: item, commit, results, `NEEDS ...`), never straight into `backlog.md` (except B1 for WG rows).

## Rhythm
1. `git fetch origin && git merge origin/pc-a` before each item; suites + check-deps (`node tools/run-tests.mjs`).
2. One commit per item; push your branch. B2 merges are done by the PC-B main session into `pc-b` (`git merge pc-b2`), then pushed.
3. PC-A reviews pushes in batches of 2-3 items (skill `arch-batch-review`), runs the gpucompare gate on its machine (skill `gpucompare`, same-machine baseline, D-045/A9, no PASS->FAIL), merges `pc-b` and `pc-c` into `pc-a`, then master (tests + check-deps + gpucompare).
4. Gates/benches run ONE at a time per machine (parallel load makes them time out). Only B1 runs gpucompare on PC-B.
5. Stop rule 40 tool calls -> `ASK ARCHITECT` in the lane file. No new GLSL (D-044). No threshold widening (D-039/D-045).
