---
name: wgsl-port
description: Rules and checklist for kestrel WG-1..WG-5 WebGPU stories (GLSL -> WGSL port, GpuDeviceWebGPU, WgCellPipeline, headless capture flags). Use before implementing or reviewing any WG-* story or any WGSL/WebGPU change.
---

# WGSL port (EP-WEBGPU, D-044; normative text = docs/architecture.md section 38, read 38.8 only for your step)

**Shape:** second pipeline `engine/render/gpu/wg/WgCellPipeline.js` (same public surface as `GpuCellPipeline`, device-only calls). `GpuCellPipeline`/GLSL are FROZEN until WG-5: no new GLSL, only gate-blocking fixes. `navigator.gpu`/`GPU*` only in `engine/render/gpu/device/`; `device.backend` only read in `createRenderer.js` + F3.

**Translate, don't improve:** same function names and float op order; constants interpolated from the same JS imports. Behaviour changes go into the JS twin first (architect OK). The JS twin is the only oracle.

**WGSL gotchas (string-checked by `wgsl.test.js`):**
- No raw `%` outside `common.wgsl.js` (use `fmodGlsl/imod/umod`); no `round` (use `floor(x+0.5)`); no `dpdx/dpdy/fwidth/frag_depth`; `textureSample` only in present.
- `atan(y,x)->atan2`, `inversesqrt->inverseSqrt`, `floatBitsToUint->bitcast<u32>`, `texelFetch->textureLoad(t,c,0)`, `gl_FrontFacing->@builtin(front_facing)`. Hash math in `u32` with `u` literals.
- Fullscreen passes index with `@builtin(position).xy` (memory rows, no flip). Raster vertex shaders end `pos.y=-pos.y; pos.z=0.5*(pos.z+pos.w);` with `frontFace:'cw'`. Present pass does NOT copy RenderTargetGL's flip.
- Mirrored view-model items (HANDS-01a, det<0): WebGL2 flips `gl.frontFace` per draw; WebGPU fixes `frontFace` in the pipeline, so mirrored items need a second raster pipeline whose frontFace is the OPPOSITE of the default raster pipeline (default 'cw' -> mirrored 'ccw') + `cullMode:'back'` (arch review 2026-10-07; WG-2b ratified).
- Raster G-buffer = 36 B/sample: request adapter `maxColorAttachmentBytesPerSample >= 36` (else ESCALATE TO MANAGER). Integer textures: `textureLoad` only. Explicit bind layouts (never `layout:'auto'`).
- Readbacks return Promises: always `await` (no-op on GL2). Not ported: dda / terrain-caster / voxel-caster. No storage buffers before WG-4.

**Verify (per step):** Node tests + `node tools/check-deps.mjs`; `node tools/capture-browser.mjs --backend webgpu [--swiftshader for correctness only, never bench]` with modes `webgpu-probe` / `wgsl` (compile check) / `presentdiff` / `gpucompare` (skill `gpucompare`, D-039: WebGPU rows must reach the WebGL2 PASS set, never widen a threshold). Switch: `?backend=webgpu|webgl2` (`?gpu=0` stays "GPU cell pipeline off").
**Budgets:** device <= 2 us/draw, submit <= 0.2 ms/frame, zero allocs per draw; GPU 4 ms unchanged.
**Ship:** PC-B cross-track, one commit per step, ends in `arch-review` (PC-A opus, diff only). Use skill `pc-b-sync-verify`.
