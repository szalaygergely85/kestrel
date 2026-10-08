# BOOT-SPEED-01 step 1: boot breakdown (measure only, no optimisation)

Marks: `engine/core/bootMarks.js` (`bootMark` / `bootSpan`, frozen at the first frame; no cost afterwards). Printed once to the console
(`[boot] breakdown ...`), kept in `window.__bootReport`, and the F3 overlay shows `boot: first frame N ms; top spans: ...`.
Run: `node tools/shot-browser.mjs --port 95xx --backend webgl2|webgpu --query "save=0&grid=240x90" --out x.png --eval "window.__bootReport"`.
Machine: PC-B, headless Chrome, WebGPU = NVIDIA/lovelace, WebGL2 = headless GL (software-class, so GL2 compile numbers are pessimistic). ms since navigation start.

## WebGPU (first frame at 3.5 s; 3 runs: 3.5 / 3.9 / 3.5 s)
| t (ms) | step | cost |
|---|---|---|
| 728 | `main.js` module start (HTML + classic scripts + ES import graph) | 728 |
| 775 / 800 | content pack loaded / local overlay / AssetRegistry | 72 |
| 838 | requestAdapter 0.3 + requestDevice 34 (self-test total 72) | 72 |
| 899 | `new RenderTargetWebGPU` | 25 |
| 911 | `new WgCellPipeline` (all passes; ~25 `createRenderPipeline` calls return in 0.1-1 ms each: raster 1.6, shadow 2.1, water 6.1, cell 0.9) | 11 |
| 1934 | **`device.checkErrors()`** (the sync pipeline creates are only queued; this is where the driver compile is paid) | **1023-1221** |
| 1947 | createEngine 1.6, sprites/overlay passes 0.7 | 3 |
| 2369 | world built (`World.load` / deserialize, before `world:loaded`) | 422 |
| 3185 | `world:loaded` handler incl. terrain mesh prebuild (459 ms) | 816 |
| 3521 | first frame rendered | 337 |

## WebGL2 (first frame at 5.9 s in this headless software GL)
| t (ms) | step | cost |
|---|---|---|
| 699 | module start | 699 |
| 813 | content, registry, createRenderer (44) | 114 |
| 4024 | **GL2 `GpuCellPipeline` (shader compile + link)** | **3199** (software GL; not representative of a real GPU) |
| 4602 | sprites/overlay 140, world built 438 | 578 |
| 5462 | `world:loaded` handler, terrain prebuild 485 | 860 |
| 5945 | first frame | 483 |

## Which parts dominate
1. WebGPU: pipeline compile (hidden inside `checkErrors`) is ~1.0-1.2 s = about a third of the 3.5 s: exactly what S8-B1-09 (38.10b) targets (async compile batch behind the loading card; overlaps with content/world work only if `createRenderer` is not awaited before the world build).
2. ~0.7 s before `main.js` runs (module graph + classic scripts): not addressed by 38.10b; check the fetch waterfall (many small ES modules; a bundle or `modulepreload` would help).
3. `world:loaded` handler 0.8 s, of which terrain mesh prebuild ~0.46 s (CPU, could run before/while the pipelines compile or in a worker) and the rest unattributed (beast sim, vitals, decals, lights).
4. World build 0.42 s; first frame 0.34 s (first GPU uploads).
Content/mesh load is small (~70 ms; lazy meshes). Adapter/device are cheap (~70 ms).
Next step (not done here): S8-B1-09a/b async compile, then overlap terrain prebuild with the compile wait.
