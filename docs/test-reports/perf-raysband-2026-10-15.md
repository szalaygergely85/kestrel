# RTX-RAYS-BAND-01 resolve-pass bench (38.79), 2026-10-15 - NOT MEASURED (blocked)

Goal: ultra resolve pass <= 0.9 ms with raysFarM=40 vs 0 (median of >= 5 flips) at forest / meadow / ford poses, RTX 4060.

| pose | resolve ms (raysFarM=40) | resolve ms (raysFarM=0) | verdict |
|---|---|---|---|
| forestFloor, hillside, meadowDetail, fordDetail | n/a | n/a | blocked |

## What happened
- `tools/bench-presets.mjs 9740 --poses meadowDetail --rays 4 --quality ultra` prints "GPU timestamp queries unavailable" (frame p50 17.6 ms only). Same on bench5 head (integ5).
- `tools/_bandflip.mjs` (new, flips `wgPipeline.resolveBandM` 40/0 inside one page load, 6 alternating flips x 8 samples, reads `stats.wgPassMsP50[3]`) also gets NaN, even with `--enable-webgpu-developer-features`, `?f3=1`, and `setPassTiming(true)`.
- Probe in page: `device.timer.available=true`, `_passTimingOn=true`, `offReason=null`, ported passes include resolve, but `timer._serial=0` (no span ever resolved), `stats.drawMs=0`: the headless WG pipeline is not drawing frames (rAF deltas run at ~17 ms), so no timestamps exist. Cause not found (stop rule / 25-call cap).
- Not measured, so the PO condition (<= 0.9 ms) is neither confirmed nor refuted. Note an `_bandflip` run was done while no other test was known to be running.

## Next
Find why headless `?pose=...&quality=ultra` shows `drawMs=0` (try headed browser via `--headless=old`/non-headless, or `?gpu=1`), then rerun `node tools/_bandflip.mjs forestFloor,meadowDetail,fordDetail` (ports 9730/9731 hard-coded).
