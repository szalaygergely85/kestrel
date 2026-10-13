# GFX-04 per-preset gpucompare (parity half; perf half is machine-specific, see backlog GFX-04)

`?gpucompare=1&quality=low|medium|high|ultra` (the preset URL knob; `preset=` is the same thing) applies the preset's
shadows / scatter / lodScale. `?gpucompare=1` still forces grid 160x60 and rays 1 (parity contract, resolveBootOptions) and
no threshold changes. Without a preset the run is exactly today's.

## Commands (main session, one GPU, runs the four one at a time)
First run per preset creates its baseline file (`--baseline` auto-writes when missing); later runs diff against it.

    node tools/browser-batch.mjs --presets --gpu intel --no-default --port-base 9540
    node tools/browser-batch.mjs --presets --gpu rtx4060 --port-base 9540   # on the 4060 machine

Baseline files: `docs/test-reports/gpucompare-baseline-webgpu-<gpu>-<low|medium|high|ultra>.json`.
Any new FAIL is recorded as known-FAIL with metrics (D-039).

## Results (fill in)
| GPU | Preset | PASS | FAIL | New FAIL vs default baseline (metrics) |
|---|---|---|---|---|
| intel | low | | | |
| intel | medium | | | |
| intel | high | | | |
| intel | ultra | | | |
| rtx4060 | low | | | |
| rtx4060 | medium | | | |
| rtx4060 | high | | | |
| rtx4060 | ultra | | | |
