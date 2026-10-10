# TREES-PERF-02: forest perf with two-sided leaf cards, mesh trees as default (`?trees=voxel` = old voxel forest)

Machine/method as TREES-PERF-01 (2026-10-09): nvidia/lovelace, WebGPU, Chrome headless=new, `--disable-gpu-vsync --disable-frame-rate-limit --enable-webgpu-developer-features`,
3840x2160 viewport, F3 overlay forced visible (pass timers on), `engine.setGrid(W,H)` after boot, 5.5 s settle, camera yaw spun 0.4 deg per rAF, 3000 frames per config.
Driver: `node tools/perf-pose.mjs --port 9700 [--out f.json]` (committed script; one fresh page load per config). Code at pc-b head (no uncommitted changes besides the driver).
GPU = passStats sum of raster+shadow+light+shade (NaN passes skipped, same as benchGpuLine), p50/p95 over the last 120 frames. CPU = `loop.stats.jsMs`, frame = `loop.stats.intervalMs`. Sim paused (no combat load).
Poses: roadSouth = `?pose=roadSouth`, forest = `?at=1544.5,1201.3,-14.3,270,8`.

| quality / grid | pose | trees | GPU p50 ms | GPU p95 ms | CPU p50 ms | CPU p95 ms | frame p50 ms | frame p95 ms | fps |
|---|---|---|---|---|---|---|---|---|---|
| high 400x150 | roadSouth | mesh (default) | 0.59 | 0.76 | 2.80 | 4.10 | 3.10 | 4.60 | 307 |
| high 400x150 | roadSouth | voxel | 1.23 | 1.44 | 2.50 | 3.80 | 2.80 | 4.20 | 333 |
| high 400x150 | forest | mesh (default) | 0.69 | 0.81 | 2.50 | 3.60 | 2.80 | 4.10 | 339 |
| high 400x150 | forest | voxel | 0.62 | 0.92 | 2.50 | 3.60 | 2.80 | 4.10 | 338 |
| ultra 480x180 | roadSouth | mesh (default) | 1.21 | 1.71 | 3.40 | 4.70 | 3.70 | 5.10 | 261 |
| ultra 480x180 | roadSouth | voxel | 1.67 | 2.13 | 3.20 | 4.60 | 3.60 | 5.00 | 270 |
| ultra 480x180 | forest | mesh (default) | 1.38 | 1.95 | 3.40 | 4.70 | 3.80 | 5.20 | 258 |
| ultra 480x180 | forest | voxel | 0.99 | 1.48 | 3.40 | 4.80 | 3.70 | 5.20 | 259 |

Notes
- Run-to-run noise is about +-0.5 ms GPU (the shadow pass reports samples only intermittently, so the pass sum jumps by ~0.5-0.6 ms between runs; an earlier identical run of roadSouth/high gave 0.65 and 2.09 ms p50). The mesh-vs-voxel differences go both ways (roadSouth/high mesh is lower, ultra forest mesh is higher), so none is significant.
- Mesh trees add about 0 to +0.5 ms GPU p95 and about +0.0-0.3 ms CPU at most; CPU is about 1 ms higher overall than the 2026-10-09 table because this harness samples every rAF in-page with the overlay on (same for both tree modes).
- Single high-end GPU, no sim/combat load (as in TREES-PERF-01).

Recommendation: keep mesh trees as the default. Worst GPU p95 is 2.13 ms (voxel) / 1.95 ms (mesh), well under the 8 ms D-053 combat budget, and two-sided leaf cards did not add a measurable cost over voxel trees. Remaining caveat: confirm once on the weaker target machine (and under combat load) before calling it final.
