# RTX-RAYS-BAND-01 resolve cost, ultra, raysFarM 40 vs 0 (2026-10-15, bench5, RTX, headless)

Tool: `PORT=9730 node tools/_bandflip.mjs <poses>`; 6 alternating flips per pose (>= 5), each flip waits 2 s then takes ~3 s of raw per-frame WebGPU timestamp samples (median per flip, median of the 6 flips). `ms`, resolve pass slot 3 and sum of all pass slots.

| pose | resolve ms band 40 | resolve ms band 0 | total GPU ms band 40 | total band 0 |
|---|---|---|---|---|
| forestFloor | 0.58 | 0.57 | 5.65 | 5.63 |
| hillside | 0.32 | 1.41 | 2.93 | 6.96 |
| meadowDetail | 0.41 | 0.45 | 4.05 | 4.10 |
| fordDetail | 0.44 | 0.54 | 3.82 | 4.36 |

Reading: the band only pays where far geometry dominates (hillside -1.1 ms resolve, -4.0 ms total); close/forest poses are neutral.

## Why the earlier bench "did not draw"
integ5 DID render at first, then the frame loop died after ~55 frames: `ReferenceError: world is not defined` in `update()` (game/js/main.js, UNDER-LIGHT-CREEP-01 wiring from the `creepwire` merge used a bare `world`; fixed to `engine.world`). After that timestamps stop (frame serial frozen), so `drawMs` 0 / frozen P50. Not a GPU or timestamp problem. Note `stats.drawMs` is 0 on gpufix4 as well (WG path never writes it); gpuMsP50 is the number.
Also `_bandflip.mjs` now logs page exceptions/console errors (`cdp.onEvent(method, params)`).

gpucompare (bench5, rtx4060 baseline): 1 PASS->FAIL `signal tower`, NEW FAIL `shaftForestHigh` (shaft frame B), several NEW PASS; log not committed. Needs a look by the render owner (not bisected).
