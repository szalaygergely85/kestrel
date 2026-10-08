# GFX-02 auto-pick quality (lane B1, 2026-10-08)

Files: `game/js/gfxAuto.js` (pure `pickQuality`, `tierFromAdapter`, +`gfxAuto.test.js`), `game/js/gfxAutoRun.js` (adapter info, loading card, `AutoBench`), `game/js/main.js` (boot + render hook), `game/js/gfxBoot.js` (F3 text).

Design
- Only when nothing is saved, no `?quality=`, not a capture/bench/gpucompare/cinematic page and not `navigator.webdriver`. `?autoquality=0` skips, `=1` forces (ignores a saved choice).
- Adapter info = `probeWebGpu()` adapter + WebGL renderer string. Candidate tier is picked BEFORE `createEngine` (cheap, no reboot) and is the provisional preset; the 3.5 s benchmark (1.5 s warm-up discarded, 2 s measured, only while the tab is visible) runs behind the 'Checking your graphics...' card at that preset. Result is saved; if it differs: grid applies live (`engine.setGrid`), rays/shadows/scatter/LOD on the next launch (F3 says so).
- GPU ms = pipeline timer rolling p95 with pass timing on (sum of passes); frame-interval fallback (step down only > 22 ms, never up).
- `window.redetectQuality()` re-runs it at the running preset and saves (NEEDS C: Settings "Detect again" button).
- Finding: with vsync on, the GL timer's cast pass reads ~16.7 ms on this 4060 (4 ms with vsync off, 557 fps): the GPU timestamp includes the vsync wait. So a GPU step down needs corroboration: frame p95 > 18.5 ms. `ultra` (gpu p95 < 7) is therefore unreachable under vsync here.

Results (this machine, RTX 4060, headless Chrome ANGLE D3D11, fresh profile, `?autoquality=1&f3=1`)
- picks `high`: "discrete NVIDIA, gpu p95 18.2 ms looks vsync-padded, frames p95 18.3 ms hold 60 fps at high"; saved `quality: high`; F3 line shows it; no card left.
- Arc iGPU (Meteor Lake, MESH-PERF-01: GPU 7.1/8.4 ms at 240x90): tier `medium`, stays medium; heavier -> low (unit tests).
- Node: `gfxAuto.test.js` 11 cases PASS; run-tests 302 PASS + 1 flaky `engine/world/colliders.test.js` in the full run (passes alone and on `--filter`; timing-sensitive, not related); check-deps OK; validate-content OK.
- gpucompare webgpu and webgl2: 390 pass / 50 fail rows, identical to baseline f65be5a; mesh route walk: all 10 legs completed, grid 400x150.

Open: ultra never picked under vsync; webgpu headless boot showed grid 160x60 (pre-existing, not investigated); cache per adapter+browser version not done (re-detect is manual).
