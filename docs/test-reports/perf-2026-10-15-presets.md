# PERF-MEASURE-02 laptop half (Intel iGPU, headless WebGPU, 2026-10-15)

PC-A laptop ("Intel(R) Graphics"), pc-a = master b4c88b7a, idle machine. Desktop half: `perf-occl-2026-10-15.md`.

Summary:
1. **Gate PASS:** Intel `high` roadSouth, imp on, occl 0 = **9.17 ms** GPU (limit 10 ms, D-085). Headroom is thin: all three detail poses sit at 9.2-9.7 ms.
2. **occl stays off:** occl=1 never saves >= 0.3 ms (38.60 rule). It costs +1.15 ms at high roadSouth (gate FAIL 10.32 ms) and +0.3-0.7 ms at medium; the only win is medium fordDetail -0.77 ms. -> `occl: false` for high and medium.
3. `high` drops frames: frame p95 33.4 ms (some 30 fps frames) in every pose; `medium` holds 60 fps (p95 16.8-17.0).
4. Next cut for `high` if more headroom is needed: SHADOW-TRIM-01 (was waiting on this measure).

Method: `bench-presets.mjs 9580 --quality Q --gpu intel --imp on --grid G --rays 2 --seconds 10 --query occl=N`, with G = the preset grid (high 400x150, medium 240x90). Note: without `--grid`/`--rays` the tool forces 480x180 and rays 1/2/4 over the preset, so a plain `--quality high` run measures ultra-sized grids (first run did that: roadSouth r2 9.95 ms, meadowDetail r2 11.52 ms - not the preset). Per-pass columns are n/a (no timestamp split on this driver); numbers are total GPU p50.

| preset | pose | occl 0 | occl 1 | frame p50/p95 |
|---|---|---|---|---|
| high (400x150 r2) | roadSouth | **9.17** | 10.32 | 16.7 / 33.4 |
| high | meadowDetail | 9.60 | 9.63 | 16.7 / 33.3 |
| high | fordDetail | 9.71 | 9.69 | 16.7 / 33.3 |
| high | outwall | 5.55 | 6.38 | 16.7 / 33.4 |
| medium (240x90 r2) | roadSouth | 7.40 | 7.90 | 16.7 / 16.8 |
| medium | meadowDetail | 6.19 | 6.48 | 16.7 / 16.8 |
| medium | fordDetail | 8.15 | 7.38 | 16.7 / 16.8 |
| medium | outwall | 3.75 | 4.47 | 16.7 / 16.9 |

Open: `extreme` (RTX) not run here; gpucompare not run (data-only measure, no code change).
