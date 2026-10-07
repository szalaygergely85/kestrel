# WG-1b3: WebGPU timestamps (PC-B, 2026-10-07)

The device timer uses the already-requested optional `timestamp-query` feature. Without it, capabilities stay false and timing stats stay NaN. The first pass in a bracket writes its start; each pass writes the end, so the last pass bounds the span. Repeated brackets for one slot are summed per submission.

Three independent query/resolve/map sets are created once. Recording reuses descriptors and fixed arrays; when all sets are busy or the 128-span budget is full, timing is skipped while rendering continues. Mapping runs asynchronously after submit; rejected maps and device disposal drop samples. Results retain the newest frame even when maps complete out of order.

The present target publishes `rt.stats`; F3 shows `GPU present p50/p95` while the WebGPU scene still uses the CPU oracle. These numbers cover GPU present, not CPU scene rendering or the future WG-2/3 scene pipeline. Bench captures add `--enable-webgpu-developer-features` for timestamps.

Focused tests: `GpuDeviceWebGPU.test.js` 44 checks; timer mock covers first/last timestamps over three passes, repeated slots, empty brackets, unavailable feature, busy ring, rejected mapping, in-flight disposal, fixed resource/descriptor identity over 1000 recording cycles, target/pipeline stats. Capture flags are checked separately.

Real GPU: NVIDIA GeForce RTX 4060, Lovelace, Chrome 154, fallback false. `caps.timerQueries=true`; F3 present p50/p95 were 0.055296/0.055296 ms in the first sample and about 0.01/0.01 ms on repeat. Six explicit three-pass clear brackets produced finite timing (quantised values can be zero) and no validation errors. The game had no page exceptions. The WebGPU scene remains at its specified 160x60 CPU grid until WG-2; the separate real-GPU 400x150 roadSouth capture was also inspected.

Visible: yes — the green `GPU present p50/p95` line is readable with the other F3 diagnostics on dark scenery. The label distinguishes present cost from the CPU frame cost.

Full suite, dependency and route results are recorded in the shipment row. Engine status: arch-review.
