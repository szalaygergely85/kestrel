# PERF-MEASURE-03: speed gain from 2026-10-15 work (baseline 770b30fb vs pc-b tip)

Summary for the owner:
- The game is faster on the CPU side: the CPU time per frame dropped about 25-30% at every preset (e.g. ultra 10.5 -> 6.0 ms on roadBend).
- Frames per second are up about 33% on average at medium, 27% at high and 39% at ultra (ultra roadBend 88 -> 149 fps).
- The GPU time is tiny (about 1-2.5 ms) and is not the limit; its changes are within noise (a few tenths of a ms), slightly better at ultra, slightly worse at medium.
- Frame time is limited by the CPU (frame p50 is about CPU p50 + 0.4 ms), so the CPU gain is the whole fps gain. Ultra CPU p95 is still 8.4-10.4 ms, above the 8 ms budget in 4 of 5 poses (forest is 8.40 vs 8.80 before).
- Caveat: ONE run each, unthrottled headless Chrome, RTX 4060, other agents' Node tests may have been running; differences under ~10% are noise. `forestFloor` does not exist in the base tree, so the older `forest` pose (at=1544.5,1201.3) was used on both. Grids: medium 320x120 (assumed), high 400x150, ultra 480x180; trees=default. Format: before -> after; "fps %" positive is better, "frame %" and "GPU p95 %" negative is better. Times in ms.

| preset | pose | CPU p50 | CPU p95 | GPU p50 | GPU p95 | frame p50 | fps | fps % | frame % | GPU p95 % |
|---|---|---|---|---|---|---|---|---|---|---|
| medium 320x120 | roadBend | 5.70 -> 4.10 | 7.90 -> 6.50 | 0.72 -> 0.85 | 0.95 -> 1.22 | 6.10 -> 4.50 | 154 -> 208 | 35% | -26% | 28% |
| medium 320x120 | towerExterior | 4.50 -> 3.50 | 6.40 -> 6.50 | 0.46 -> 0.77 | 0.69 -> 1.15 | 4.90 -> 3.90 | 190 -> 229 | 20% | -20% | 66% |
| medium 320x120 | meadowDetail | 5.90 -> 4.10 | 8.00 -> 6.70 | 0.94 -> 0.85 | 0.98 -> 1.49 | 6.30 -> 4.50 | 152 -> 203 | 34% | -29% | 52% |
| medium 320x120 | fordDetail | 6.10 -> 4.10 | 8.30 -> 7.00 | 1.14 -> 0.29 | 1.40 -> 0.41 | 6.50 -> 4.50 | 145 -> 196 | 35% | -31% | -71% |
| medium 320x120 | forest | 4.40 -> 3.30 | 6.40 -> 5.80 | 0.45 -> 0.39 | 0.46 -> 1.08 | 4.90 -> 3.70 | 175 -> 247 | 41% | -24% | 138% |
| high 400x150 | roadBend | 8.90 -> 6.10 | 11.60 -> 8.70 | 0.38 -> 0.89 | 1.25 -> 1.61 | 9.40 -> 6.50 | 101 -> 143 | 42% | -31% | 28% |
| high 400x150 | towerExterior | 7.10 -> 6.10 | 9.30 -> 9.50 | 0.40 -> 0.52 | 1.36 -> 1.11 | 7.50 -> 6.50 | 126 -> 138 | 9% | -13% | -18% |
| high 400x150 | meadowDetail | 7.80 -> 5.90 | 10.30 -> 8.50 | 0.80 -> 0.86 | 1.95 -> 1.17 | 8.30 -> 6.30 | 115 -> 149 | 30% | -24% | -40% |
| high 400x150 | fordDetail | 9.10 -> 5.90 | 11.30 -> 8.90 | 0.48 -> 0.55 | 0.64 -> 1.14 | 9.60 -> 6.40 | 102 -> 145 | 42% | -33% | 78% |
| high 400x150 | forest | 5.40 -> 4.50 | 7.20 -> 7.30 | 0.54 -> 0.69 | 1.08 -> 0.91 | 5.80 -> 4.90 | 165 -> 188 | 15% | -16% | -16% |
| ultra 480x180 | roadBend | 10.50 -> 6.00 | 12.90 -> 8.90 | 1.35 -> 1.53 | 1.70 -> 1.79 | 11.00 -> 6.40 | 88 -> 149 | 69% | -42% | 5% |
| ultra 480x180 | towerExterior | 8.80 -> 5.60 | 11.00 -> 8.90 | 1.32 -> 0.95 | 1.61 -> 1.25 | 9.20 -> 6.00 | 105 -> 152 | 45% | -35% | -23% |
| ultra 480x180 | meadowDetail | 9.20 -> 6.60 | 11.80 -> 9.60 | 1.47 -> 1.33 | 2.55 -> 1.62 | 9.60 -> 7.00 | 100 -> 137 | 38% | -27% | -36% |
| ultra 480x180 | fordDetail | 9.80 -> 7.50 | 12.90 -> 10.40 | 1.31 -> 0.97 | 2.45 -> 1.69 | 10.20 -> 7.90 | 92 -> 119 | 29% | -23% | -31% |
| ultra 480x180 | forest | 6.60 -> 5.60 | 8.80 -> 8.40 | 1.19 -> 1.23 | 1.72 -> 1.52 | 7.00 -> 6.10 | 135 -> 155 | 14% | -13% | -12% |

mean medium: fps 33%, CPU p50 -28%, GPU p95 43%
mean high: fps 27%, CPU p50 -24%, GPU p95 6%
mean ultra: fps 39%, CPU p50 -29%, GPU p95 -19%
