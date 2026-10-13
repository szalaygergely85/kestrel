# MAP-07 geography gate (kestrel-3, 2026-10-11, tip 7d9829bd + DN-04b/MAP-14 changes)

| Gate | Result |
|---|---|
| `node tools/route-walk.mjs` (all legs, incl. new leg 10) | exit 0, no FAIL line; probes PASS. Leg 9 ford: swaps east>west,west>east, band:late 0, max swap 1.49 ms. **Open note:** leg `R1 Rook ruin climb` shows mesh completed = N (stuck wp11 at -505.7,38.4 local; grid Y). Pre-existing MAP-23 leg, does not set the exit code, untouched by this change. |
| leg 10 long grid walk (tools/verify-grid-walk.mjs, `?grid=1` world) | PASS: tower -> bend -> ford -> crossroads -> outwall probe (reaches x 901, no fall) -> lake edge (1237,606) -> back to the tower; swaps g4_7>g3_7>g3_6>g3_5>g3_4 and back (8), band:late 0, no fall, max swap 1.1 ms (<= 16) |
| gpucompare vs `gpucompare-baseline-webgpu-rtx4060.json` | exit 0, 0 PASS->FAIL, 0 new FAIL; 4 new DN-04b rows (dusk 19.5 h / night 23 h x Bend lamps / tower) PASS (+ shadow-parity rows). Baseline now 166 PASS / 2 FAIL (added the DN-04b rows + meadowSkyline x3) |
| perf-pose `lakeEdge` (content/dev-poses.js) | ultra 480x180: JS p95 7.2 ms (p50 6.1), GPU p95 0.33 ms, heap flat: PASS (high 400x150: JS p95 6.0 ms) |
| MAP-28 | `game/js/quest/mapWorld.test.js` (chart region labels + chart-piece unfog) PASS in the suite run |
| Suites | `run-tests --filter route,band,terrain,wg` 64/64 PASS; `check-deps` OK |

## Stills (headless WebGPU, 8 h, game page, `tools/shot-browser.mjs`)
- Meadow: `docs/test-reports/map-geo/meadow.png` (pose meadowDetail)
- Bend: `docs/test-reports/map-geo/bend.png` (pose roadBend, relay waystone)
- Ford: `docs/test-reports/map-geo/ford.png` (pose fordDetail)
- Coast / sea line: `docs/test-reports/map-geo/coast.png` (pose meadowSea, yaw 235)
- Lake edge: `docs/test-reports/map-geo/lakeEdge.png` (pose lakeEdge, yaw 0)
