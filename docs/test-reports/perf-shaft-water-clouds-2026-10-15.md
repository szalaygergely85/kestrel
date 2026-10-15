# Perf: shafts / water finish / morning clouds (2026-10-15)

Tool: `node tools/bench-shaft.mjs <port> --gpu rtx` (headless WebGPU, ultra, 480x180, rays 1, 5 alternating off/on slots x 4 s in one page load, GPU timestamp queries = sum of passes, P50 snapshots every 250 ms). Adapter: nvidia lovelace.

min = lowest P50 snapshot, med = median; delta = on - off. The verdict uses the MEDIAN delta (min is hit by idle-frame timer glitches, kept for reference); run-to-run noise on a ~4 ms total is about +-0.5 ms, so budgets below that need a quiet GPU / the laptop. Off: shaft steps set to 0; water causticK/reflScreenK = 0; clouds shade cloud block zeroed.

| feature | pose | off min / med (ms) | on min / med (ms) | delta min (ms) | delta med (ms) | budget (ms) | verdict |
|---|---|---|---|---|---|---|---|
| shaft (10 steps) | forestFloor | 1.452 / 4.130 | 1.475 / 4.104 | 0.024 | -0.027 | <= 0.4 | PASS |
| shaft (10 steps) | lookForestEdge | 0.492 / 3.619 | 0.663 / 3.504 | 0.171 | -0.115 | <= 0.4 | PASS |
| water | fordDetail | 0.494 / 3.365 | 0.673 / 4.156 | 0.179 | 0.791 | <= 0.05 | OVER |
| water | lakeEdge | 0.369 / 1.866 | 0.368 / 1.663 | -0.001 | -0.203 | <= 0.05 | PASS |
| clouds | towerExterior | 0.585 / 4.194 | 0.646 / 4.241 | 0.061 | 0.047 | - | info (no ms budget in the cloud note) |
| clouds | meadowSea | 3.806 / 5.150 | 4.057 / 5.261 | 0.252 | 0.111 | - | info (no ms budget in the cloud note) |
